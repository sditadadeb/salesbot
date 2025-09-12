// index.js
// Bot de Google Chat con memoria híbrida y timeouts corregidos
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURACIÓN CORREGIDA - usar 45 segundos por defecto
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 45000); // 45 segundos
const LANGFLOW_RETRIES = Number(process.env.LANGFLOW_RETRIES || 2);
const HISTORY_TURNS = Math.max(0, Number(process.env.HISTORY_TURNS || 6));
const DISABLE_LOCAL_MEMORY = String(process.env.DISABLE_LOCAL_MEMORY || "0") === "1";
const USE_HYBRID_MEMORY = String(process.env.USE_HYBRID_MEMORY || "1") === "1";

console.log(`🚀 INICIANDO BOT CON TIMEOUT: ${LANGFLOW_TIMEOUT_MS}ms`);

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
const mem = new Map(); 
const sessionMetadata = new Map(); 

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
  if (!arr.length) return "";
  
  const contextLines = ["=== CONVERSACIÓN PREVIA ==="];
  
  // Solo los últimos turnos
  const recentHistory = arr.slice(-Math.min(8, HISTORY_TURNS * 2));
  for (const entry of recentHistory) {
    if (entry.role === "user") {
      contextLines.push(`👤 Usuario: ${entry.text}`);
    } else {
      contextLines.push(`🤖 Asistente: ${entry.text}`);
    }
  }
  
  contextLines.push("=== FIN CONVERSACIÓN PREVIA ===");
  contextLines.push("");
  contextLines.push("Nueva pregunta:");
  
  return contextLines.join("\n");
}

// ---------------------- Langflow helpers ----------------------
function buildLangflowRunUrl() {
  const host = String(process.env.LANGFLOW_HOST || "").replace(/\/+$/, "");
  const flowId = process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = LANGFLOW_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { 
    return await fetch(url, { ...options, signal: controller.signal }); 
  } finally { 
    clearTimeout(id); 
  }
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
            if (o2?.results?.message?.data?.text) return String(o2.results.message.data.text);
          }
        }
      }
    }
  } catch {}

  return "";
}

async function callLangflow(userText, sessionId, reqId) {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  // Construir input con contexto híbrido
  let finalInput = userText;
  if (USE_HYBRID_MEMORY && !DISABLE_LOCAL_MEMORY) {
    const context = renderHistoryForLangflow(sessionId);
    if (context) {
      finalInput = context + userText;
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
    const startTime = Date.now();
    
    log("info", "langflow.request", {
      reqId, attempt: `${i}/${attempts}`,
      url, timeoutMs: LANGFLOW_TIMEOUT_MS,
      sessionId, 
      originalInput: truncate(userText, 200),
      finalInputPreview: truncate(finalInput, 400),
      hasContext: finalInput !== userText,
      historyLength: getHistory(sessionId).length,
    });

    try {
      const resp = await fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(payload) },
        LANGFLOW_TIMEOUT_MS
      );

      const elapsed = Date.now() - startTime;
      const contentType = resp.headers.get("content-type") || "";
      const raw = await resp.text();

      log("info", "langflow.response", {
        reqId, attempt: `${i}/${attempts}`,
        status: resp.status, ok: resp.ok, 
        elapsedMs: elapsed,
        rawPreview: truncate(raw, 300),
      });

      if (!resp.ok) {
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        } else {
          throw new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        }
      } else {
        let json;
        try { json = JSON.parse(raw); }
        catch {
          log("warn", "langflow.parse_failed", { reqId, rawPreview: truncate(raw, 200) });
          return "";
        }
        const out = (pickTextFromLangflow(json) || "").trim();
        log("info", "langflow.extracted", { 
          reqId, sessionId, 
          outPreview: truncate(out, 200),
          elapsedMs: elapsed 
        });
        return out;
      }
    } catch (e) {
      const elapsed = Date.now() - startTime;
      lastErr = e;
      const msg = String(e?.message || e);
      const abortLike = /aborted|timeout|The operation was aborted/i.test(msg);
      
      log("warn", "langflow.attempt_failed", { 
        reqId, attempt: `${i}/${attempts}`, sessionId, 
        error: msg, elapsedMs: elapsed, wasTimeout: abortLike 
      });

      if (abortLike || (lastErr && /Langflow HTTP (5\d\d|429)/.test(String(lastErr.message)))) {
        if (i < attempts) {
          const delay = Math.min(3000 * i, 8000);
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
  });
  next();
});

// Health
app.get("/", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    timeout: LANGFLOW_TIMEOUT_MS,
    hybridMemory: USE_HYBRID_MEMORY,
    activeSessions: mem.size
  });
});

// Egress IP
app.get("/egress", async (req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    log("info", "egress.ip", { ip: j.ip });
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------- Utilidades de sesión CORREGIDAS ----------------------
function computeSessionId({ threadName, isDM, userEmail, spaceName, msg }) {
  let sessionBase;
  
  if (threadName) {
    // CORREGIDO: usar solo el ID del thread, no el path completo
    const threadId = threadName.split('/').pop() || threadName;
    sessionBase = `thread_${threadId}`;
  } else if (isDM && userEmail) {
    // Para DMs, usar el email
    sessionBase = `dm_${userEmail}`;
  } else if (spaceName) {
    // Para espacios sin hilo
    const spaceId = spaceName.split('/').pop() || spaceName;
    sessionBase = `space_${spaceId}`;
  } else {
    sessionBase = `fallback_${msg?.name || crypto.randomUUID()}`;
  }

  // Hash más simple y estable
  const hash = crypto.createHash('md5').update(sessionBase).digest('hex').substring(0, 12);
  
  log("debug", "session.computed", {
    threadName: threadName ? truncate(threadName, 50) : null,
    sessionBase: truncate(sessionBase, 100),
    hash,
    isDM,
    userEmail: userEmail ? userEmail.substring(0, 10) + "..." : null
  });
  
  return hash;
}

// ---------------------- Webhook Google Chat ----------------------
app.post("/events", async (req, res) => {
  const reqId = req.reqId;
  const body = req.body || {};

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
              text: `¡Hola! Soy Numi Ventas 💜 Tu asistente con memoria. Recordaré nuestra conversación. ¡Pregúntame lo que necesites!`
            },
          },
        },
      },
    };
    return res.status(200).json(welcome);
  }

  // CORREGIDO: usar función de sessionId mejorada
  const sessionId = computeSessionId({ 
    threadName, 
    isDM, 
    userEmail, 
    spaceName, 
    msg 
  });

  updateSessionMetadata(sessionId, {
    threadName,
    isDM,
    userEmail,
    spaceName,
    created: sessionMetadata.get(sessionId)?.created || Date.now()
  });

  const currentHistory = getHistory(sessionId);

  log("info", "chat.session_info", { 
    reqId, 
    sessionId,
    isExistingSession: currentHistory.length > 0,
    totalTurns: currentHistory.length,
    isDM,
    userEmail: userEmail ? userEmail.substring(0, 10) + "..." : null,
    threadName: threadName ? truncate(threadName, 50) : null
  });

  let agentText = "";
  try {
    agentText = await callLangflow(textRaw, sessionId, reqId);
  } catch (e) {
    log("error", "langflow.error", { reqId, sessionId, error: e.message });
    if (/Client IP not allowed/i.test(String(e.message))) {
      agentText = "❌ No tengo permiso para conectar con el servicio. Contacta al administrador para allowlistear la IP.";
    } else if (/timeout|aborted/i.test(String(e.message))) {
      agentText = "⏱️ El servicio está tardando mucho. Por favor intenta reformular tu pregunta o espera un momento.";
    } else {
      agentText = `🔧 Hubo un error técnico: ${e.message}. Intenta de nuevo.`;
    }
  }

  if (!agentText) {
    const historyCount = currentHistory.length;
    agentText = `Recibí tu mensaje: "${textRaw}". Conversación #${Math.ceil((historyCount + 2)/2)} en sesión ${sessionId}`;
    log("warn", "langflow.empty_fallback", { reqId, sessionId });
  }

  // Agregar al historial después de respuesta exitosa
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

  log("info", "chat.reply.sending", { 
    reqId, 
    sessionId,
    historyLength: getHistory(sessionId).length,
    replyPreview: truncate(agentText, 150)
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
      threadName: metadata.threadName ? truncate(metadata.threadName, 30) : null,
      userEmail: metadata.userEmail ? metadata.userEmail.substring(0, 15) + "..." : null,
      recentMessages: history.slice(-2).map(m => `${m.role}: ${truncate(m.text, 40)}`)
    };
  }
  res.json({
    totalSessions: mem.size,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    hybridMemory: USE_HYBRID_MEMORY,
    maxHistoryTurns: HISTORY_TURNS,
    sessions
  });
});

// ---------------------- Start ----------------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`⏱️  Timeout Langflow: ${LANGFLOW_TIMEOUT_MS}ms`);
  console.log(`🧠 Memoria híbrida: ${USE_HYBRID_MEMORY ? 'ACTIVA' : 'INACTIVA'}`);
  console.log(`📝 Max turnos historial: ${HISTORY_TURNS}`);
  
  log("info", "server.started", {
    port: PORT,
    langflowHost: process.env.LANGFLOW_HOST || null,
    flowId: process.env.LANGFLOW_FLOW_ID || null,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    useHybridMemory: USE_HYBRID_MEMORY,
  });
});
