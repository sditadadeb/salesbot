// index.js
// Bot de Google Chat con memoria híbrida corregida
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 25000); // Incrementado
const LANGFLOW_RETRIES = Number(process.env.LANGFLOW_RETRIES || 2);
const HISTORY_TURNS = Math.max(0, Number(process.env.HISTORY_TURNS || 6));
const DISABLE_LOCAL_MEMORY = String(process.env.DISABLE_LOCAL_MEMORY || "0") === "1";
const USE_HYBRID_MEMORY = String(process.env.USE_HYBRID_MEMORY || "1") === "1";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function log(level, msg, meta = {}) {
  if ((LEVELS[level] || 99) < (LEVELS[LOG_LEVEL] || 99)) return;
  const line = { ts: new Date().toISOString(), level, msg, ...meta };
  try { console.log(JSON.stringify(line)); }
  catch { console.log(`[${line.ts}] ${level.toUpperCase()} ${msg}`); }
}
function truncate(s, n = 500) {
  if (!s) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n) + "…(trunc)" : str;
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ---------------------- Memoria local por sesión ----------------------
const mem = new Map(); // sessionId -> [{role:"user"|"bot", text, ts}, ...]
const sessionMetadata = new Map(); // sessionId -> {created, lastUsed, threadName, userEmail, etc}

function getHistory(sessionId) {
  return mem.get(sessionId) || [];
}

function getSessionMetadata(sessionId) {
  return sessionMetadata.get(sessionId) || {};
}

function updateSessionMetadata(sessionId, data) {
  const existing = sessionMetadata.get(sessionId) || {};
  sessionMetadata.set(sessionId, { ...existing, ...data, lastUsed: Date.now() });
}

function pushTurn(sessionId, role, text) {
  const arr = mem.get(sessionId) || [];
  arr.push({ role, text: String(text || ""), ts: Date.now() });
  const maxItems = Math.max(1, HISTORY_TURNS) * 2;
  if (arr.length > maxItems) arr.splice(0, arr.length - maxItems);
  mem.set(sessionId, arr);
  
  log("debug", "memory.turn_added", {
    sessionId, role, textPreview: truncate(text, 100), 
    totalTurns: arr.length, maxItems
  });
}

function renderHistoryForLangflow(sessionId) {
  if (!USE_HYBRID_MEMORY) return "";
  
  const arr = getHistory(sessionId);
  if (!arr.length) return ""; // No hay historial previo
  
  // Formato optimizado para Langflow - solo mensajes previos
  const contextLines = ["=== HISTORIAL PREVIO DE LA CONVERSACIÓN ==="];
  
  // Tomar solo los mensajes anteriores (no incluir el actual)
  for (const entry of arr) {
    if (entry.role === "user") {
      contextLines.push(`Usuario: ${entry.text}`);
    } else {
      contextLines.push(`Asistente: ${entry.text}`);
    }
  }
  
  contextLines.push("=== FIN HISTORIAL ===");
  contextLines.push("");
  
  return contextLines.join("\n");
}

// ---------------------- Langflow helpers ----------------------
function buildLangflowRunUrl() {
  const host = String(process.env.LANGFLOW_HOST || "").replace(/\/+$/, "");
  const flowId = process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function pickTextFromLangflow(json) {
  if (typeof json === "string") return json;
  if (typeof json?.text === "string") return json.text;
  if (typeof json?.message === "string") return json.message;
  if (typeof json?.output === "string") return json.output;

  try {
    const outs = json?.outputs;
    if (Array.isArray(outs)) {
      for (const o1 of outs) {
        const o2s = o1?.outputs;
        if (Array.isArray(o2s)) {
          for (const o2 of o2s) {
            if (typeof o2?.text === "string") return o2.text;
            if (typeof o2?.message === "string") return o2.message;
            if (typeof o2?.output_text === "string") return o2.output_text;
            if (o2?.data?.text) return String(o2.data.text);
            if (o2?.artifacts?.text) return String(o2.artifacts.text);
            if (o2?.results?.message?.text) return String(o2.results.message.text);
          }
        }
      }
    }
  } catch {}

  try {
    const stack = [json];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);
      if (typeof cur.text === "string") return cur.text;
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  } catch {}
  return "";
}

// Llamada a Langflow con memoria híbrida corregida
async function callLangflow(userText, sessionId, reqId) {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  // CORRECCIÓN: Construir contexto SOLO con historial previo
  let finalInput = userText;
  if (USE_HYBRID_MEMORY && !DISABLE_LOCAL_MEMORY) {
    const context = renderHistoryForLangflow(sessionId);
    if (context) {
      finalInput = context + "Pregunta actual: " + userText;
    }
  }

  const payload = {
    input_value: finalInput,
    output_type: "chat", 
    input_type: "chat",
    session_id: sessionId,
    tweaks: {}
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-key": process.env.LANGFLOW_API_KEY || "",
  };

  let lastErr;
  const attempts = LANGFLOW_RETRIES + 1;

  for (let i = 1; i <= attempts; i++) {
    log("debug", "langflow.request", {
      reqId, attempt: `${i}/${attempts}`,
      url, timeoutMs: LANGFLOW_TIMEOUT_MS,
      sessionId, 
      originalInput: truncate(userText, 200),
      finalInputPreview: truncate(finalInput, 400),
      hasContext: finalInput !== userText,
      historyLength: getHistory(sessionId).length,
      hasApiKey: !!process.env.LANGFLOW_API_KEY,
    });

    try {
      const resp = await fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(payload) },
        LANGFLOW_TIMEOUT_MS
      );

      const contentType = resp.headers.get("content-type") || "";
      const raw = await resp.text();

      log("debug", "langflow.response", {
        reqId, attempt: `${i}/${attempts}`,
        status: resp.status, ok: resp.ok, contentType,
        raw: truncate(raw, 800),
      });

      if (!resp.ok) {
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        } else {
          throw new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        }
      } else {
        const looksHtml = /^\s*</.test(raw) || contentType.includes("text/html");
        const looksJson = contentType.includes("application/json");
        if (looksHtml || (!looksJson && !raw.trim().startsWith("{") && !raw.trim().startsWith("["))) {
          log("warn", "langflow.non_json_response", { reqId, contentType, rawPreview: truncate(raw, 200) });
          return "";
        }
        let json;
        try { json = JSON.parse(raw); }
        catch {
          log("warn", "langflow.parse_failed", { reqId, rawPreview: truncate(raw, 200) });
          return "";
        }
        const out = (pickTextFromLangflow(json) || "").trim();
        log("debug", "langflow.extracted", { reqId, sessionId, outPreview: truncate(out, 300) });
        return out;
      }
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const abortLike = /aborted|timeout|The operation was aborted|This operation was aborted/i.test(msg);
      log("warn", "langflow.attempt_failed", { reqId, attempt: `${i}/${attempts}`, sessionId, error: msg });

      if (abortLike || (lastErr && /Langflow HTTP (5\d\d|429)/.test(String(lastErr.message)))) {
        if (i < attempts) {
          const delay = Math.min(2000 * i, 5000); // Incrementado el delay
          log("info", "langflow.retrying_after_backoff", { reqId, sessionId, inMs: delay });
          await sleep(delay);
          continue;
        }
      }
      break;
    }
  }
  throw lastErr || new Error("Langflow no respondió");
}

// ---------------------- Middleware ----------------------
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => {
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  req.reqId = reqId;
  log("info", "http.request", {
    reqId, method: req.method, path: req.path,
    ip: req.ip, ua: req.headers["user-agent"],
    contentType: req.headers["content-type"],
  });
  next();
});

// Health
app.get("/", (req, res) => {
  log("debug", "healthcheck", { reqId: req.reqId });
  res.status(200).send("OK - Bot con memoria funcionando");
});

// Egress IP
app.get("/egress", async (req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    log("info", "egress.ip", { ip: j.ip });
    res.json(j);
  } catch (e) {
    log("warn", "egress.ip.failed", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ---------------------- Utilidades de sesión ----------------------
function computeSessionId({ threadName, isDM, userEmail, spaceName, msg }) {
  let sessionBase;
  
  if (threadName) {
    // Usar el thread name completo pero limpiarlo
    sessionBase = threadName;
  } else if (isDM && userEmail) {
    // Para DMs, usar el email del usuario
    sessionBase = `dm_${userEmail}`;
  } else if (spaceName) {
    // Para espacios sin hilo específico
    sessionBase = `${spaceName}_default`;
  } else {
    // Fallback usando el nombre del mensaje si existe
    sessionBase = `fallback_${msg?.name || crypto.randomUUID()}`;
  }

  // Crear hash consistente pero legible
  const hash = crypto.createHash('sha256').update(sessionBase).digest('hex').substring(0, 12);
  return hash;
}

// ---------------------- Webhook Google Chat ----------------------
app.post("/events", async (req, res) => {
  const reqId = req.reqId;
  const body = req.body || {};
  
  log("debug", "chat.event.raw", { reqId, bodyPreview: truncate(JSON.stringify(body), 1500) });

  const mp = body?.chat?.messagePayload;
  const msg = mp?.message;
  const threadName = msg?.thread?.name;
  const spaceName = mp?.space?.name;
  const isDM = mp?.space?.type === "DM";
  const userEmail = body?.chat?.user?.email;
  const textRaw = (msg?.argumentText ?? msg?.formattedText ?? msg?.text ?? "").trim();

  log("info", "chat.event.parsed", {
    reqId, userEmail, spaceName, isDM, threadName, textRaw,
  });

  // Si no hay mensaje (ej: alta al espacio)
  if (!msg) {
    const welcome = {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { 
              text: `¡Hola! Soy un bot con memoria persistente. Recordaré nuestra conversación en este ${isDM ? 'chat directo' : 'hilo'}. ¡Pregúntame algo!`
            },
          },
        },
      },
    };
    log("debug", "chat.reply.welcome", { reqId });
    return res.status(200).json(welcome);
  }

  // Generar session ID consistente
  const sessionId = computeSessionId({ 
    threadName, 
    isDM, 
    userEmail, 
    spaceName, 
    msg 
  });

  // Actualizar metadata de sesión
  updateSessionMetadata(sessionId, {
    threadName,
    isDM,
    userEmail,
    spaceName,
    created: sessionMetadata.get(sessionId)?.created || Date.now()
  });

  const metadata = getSessionMetadata(sessionId);
  const currentHistory = getHistory(sessionId);

  log("info", "chat.session_info", { 
    reqId, 
    sessionId,
    isExistingSession: currentHistory.length > 0,
    totalTurns: currentHistory.length,
    sessionAge: metadata.created ? Date.now() - metadata.created : 0,
    threadName: threadName ? truncate(threadName, 50) : null,
    isDM,
    userEmail: userEmail ? userEmail.substring(0, 10) + "..." : null
  });

  // CORRECCIÓN: NO agregar el mensaje del usuario antes de llamar a Langflow
  // Esto permite que el contexto sea solo del historial previo

  let agentText = "";
  try {
    agentText = await callLangflow(textRaw, sessionId, reqId);
  } catch (e) {
    log("error", "langflow.error", { reqId, sessionId, error: e.message });
    if (/Client IP not allowed/i.test(String(e.message))) {
      agentText = "No tengo permiso para hablar con el agente (IP bloqueada). Revisa la configuración de IP allowlist.";
    } else if (/timeout|aborted/i.test(String(e.message))) {
      agentText = "El servicio está tardando mucho en responder. Intenta de nuevo en un momento.";
    } else {
      agentText = `Error al procesar tu mensaje: ${e.message}`;
    }
  }

  if (!agentText) {
    const historyCount = getHistory(sessionId).length;
    agentText = `Recibí tu mensaje: "${textRaw}". Esta sería nuestra conversación #${Math.ceil((historyCount + 2)/2)} (sesión: ${sessionId})`;
    log("warn", "langflow.empty_output_fallback", { reqId, sessionId });
  }

  // AHORA SÍ agregar ambos mensajes al historial después de la respuesta exitosa
  if (!DISABLE_LOCAL_MEMORY) {
    pushTurn(sessionId, "user", textRaw);
    pushTurn(sessionId, "bot", agentText);
  }

  const message = { text: agentText };
  if (threadName) message.thread = { name: threadName };

  const reply = {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: { message },
      },
    },
  };

  const finalHistory = getHistory(sessionId);
  log("info", "chat.reply.sending", { 
    reqId, 
    sessionId,
    finalHistoryLength: finalHistory.length,
    replyPreview: truncate(agentText, 200)
  });

  return res.status(200).json(reply);
});

// Debug endpoints
app.get("/sessions", (req, res) => {
  const sessions = {};
  for (const [sessionId, history] of mem.entries()) {
    const metadata = getSessionMetadata(sessionId);
    sessions[sessionId] = {
      messageCount: history.length,
      conversationTurns: Math.ceil(history.length / 2),
      created: new Date(metadata.created || 0).toISOString(),
      lastUsed: new Date(metadata.lastUsed || 0).toISOString(),
      isDM: metadata.isDM,
      threadName: metadata.threadName ? truncate(metadata.threadName, 50) : null,
      userEmail: metadata.userEmail ? metadata.userEmail.substring(0, 15) + "..." : null,
      lastMessages: history.slice(-4).map(m => `${m.role}: ${truncate(m.text, 60)}`)
    };
  }
  res.json({
    totalSessions: mem.size,
    hybridMemory: USE_HYBRID_MEMORY,
    maxHistoryTurns: HISTORY_TURNS,
    sessions
  });
});

app.get("/sessions/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const history = getHistory(sessionId);
  const metadata = getSessionMetadata(sessionId);
  
  if (history.length === 0) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  res.json({
    sessionId,
    metadata,
    messageCount: history.length,
    conversationTurns: Math.ceil(history.length / 2),
    messages: history
  });
});

// ---------------------- Start ----------------------
app.listen(PORT, () => {
  log("info", "server.started", {
    port: PORT,
    langflowHost: process.env.LANGFLOW_HOST || null,
    flowId: process.env.LANGFLOW_FLOW_ID || null,
    hasApiKey: !!process.env.LANGFLOW_API_KEY,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    retries: LANGFLOW_RETRIES,
    logLevel: LOG_LEVEL,
    historyTurns: HISTORY_TURNS,
    disableLocalMemory: DISABLE_LOCAL_MEMORY,
    useHybridMemory: USE_HYBRID_MEMORY,
  });
});
