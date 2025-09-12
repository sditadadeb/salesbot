// index.js
// Bot de Google Chat (HTTP Add-on) + Langflow con reintentos, logs y **memoria local** por sesión
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 15000);
const LANGFLOW_RETRIES = Number(process.env.LANGFLOW_RETRIES || 2);
const HISTORY_TURNS = Math.max(0, Number(process.env.HISTORY_TURNS || 8));
const DISABLE_LOCAL_MEMORY = String(process.env.DISABLE_LOCAL_MEMORY || "0") === "1";

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

function getHistory(sessionId) {
  return mem.get(sessionId) || [];
}
function pushTurn(sessionId, role, text) {
  const arr = mem.get(sessionId) || [];
  arr.push({ role, text: String(text || ""), ts: Date.now() });
  const maxItems = Math.max(1, HISTORY_TURNS) * 2;
  if (arr.length > maxItems) arr.splice(0, arr.length - maxItems);
  mem.set(sessionId, arr);
}
function renderHistory(sessionId) {
  const arr = getHistory(sessionId);
  if (!arr.length) return "";
  return arr
    .map(m => (m.role === "user" ? `USUARIO: ${m.text}` : `BOT: ${m.text}`))
    .join("\n");
}

// ---------------------- Langflow helpers ----------------------
function buildLangflowRunUrl() {
  const host = String(process.env.LANGFLOW_HOST || "").replace(/\/+$/, "");
  const flowId = process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
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

// Llamada a Langflow con session_id consistente
async function callLangflow(userText, sessionId, reqId) {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  const payload = {
    input_value: userText ?? "",
    output_type: "chat",
    input_type: "chat",
    session_id: sessionId, // CLAVE: usar el mismo sessionId consistente
    tweaks: {} // Por si necesitas tweaks específicos
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
      sessionId, body: truncate(JSON.stringify(payload), 300),
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
        raw: truncate(raw, 500),
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
        log("debug", "langflow.extracted", { reqId, outPreview: truncate(out, 300) });
        return out;
      }
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const abortLike = /aborted|timeout|The operation was aborted|This operation was aborted/i.test(msg);
      log("warn", "langflow.attempt_failed", { reqId, attempt: `${i}/${attempts}`, error: msg });

      if (abortLike || (lastErr && /Langflow HTTP (5\d\d|429)/.test(String(lastErr.message)))) {
        if (i < attempts) {
          const delay = Math.min(1000 * i * i, 4000);
          log("info", "langflow.retrying_after_backoff", { reqId, inMs: delay });
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
  res.status(200).send("OK");
});

// Egress IP (para allowlist en Langflow)
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
  // Generar un session_id más estable y simple para Langflow
  let sessionBase;
  
  if (threadName) {
    // Para hilos específicos, usar el nombre del hilo directamente
    sessionBase = threadName.replace(/^spaces\/[^\/]+\/threads\//, "thread_");
  } else if (isDM && userEmail) {
    // Para DMs, usar el email del usuario
    sessionBase = `dm_${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  } else if (spaceName) {
    // Para espacios sin hilo específico
    sessionBase = spaceName.replace(/^spaces\//, "space_");
  } else {
    // Fallback
    sessionBase = `fallback_${crypto.randomUUID()}`;
  }

  // Hacer hash para que sea más corto y consistente
  return crypto.createHash('sha256').update(sessionBase).digest('hex').substring(0, 16);
}

function buildUserPrompt(sessionId, textRaw) {
  if (DISABLE_LOCAL_MEMORY || HISTORY_TURNS === 0) return textRaw;
  const history = renderHistory(sessionId);
  if (!history) return textRaw;
  return [
    "<<<HISTORIAL_CONVERSACION>>>",
    history,
    "<<<FIN_HISTORIAL>>>",
    "\n",
    textRaw
  ].join("\n");
}

// ---------------------- Webhook Google Chat ----------------------
app.post("/events", async (req, res) => {
  const reqId = req.reqId;
  const body = req.body || {};
  log("debug", "chat.event.received", { reqId, bodyPreview: truncate(JSON.stringify(body), 1000) });

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
            message: { text: "¡Gracias por invitarme! Escribeme algo y mantendré el contexto de nuestra conversación." },
          },
        },
      },
    };
    log("debug", "chat.reply.welcome", { reqId });
    return res.status(200).json(welcome);
  }

  // CLAVE: Generar session ID consistente y estable
  const sessionId = computeSessionId({ 
    threadName, 
    isDM, 
    userEmail, 
    spaceName, 
    msg 
  });

  log("info", "chat.session_computed", { 
    reqId, 
    sessionId,
    threadName,
    isDM,
    userEmail: userEmail ? userEmail.substring(0, 10) + "..." : null,
    spaceName: spaceName ? spaceName.substring(spaceName.lastIndexOf('/') + 1) : null
  });

  // Agregar mensaje del usuario al historial local (backup)
  if (!DISABLE_LOCAL_MEMORY && HISTORY_TURNS > 0) {
    pushTurn(sessionId, "user", textRaw);
    log("debug", "chat.history_updated", { 
      reqId, 
      sessionId, 
      localHistoryLength: getHistory(sessionId).length 
    });
  }

  // NO usar buildUserPrompt - dejar que Langflow maneje la memoria
  // const inputForAgent = buildUserPrompt(sessionId, textRaw);
  const inputForAgent = textRaw; // Usar solo el texto actual

  let agentText = "";
  try {
    agentText = await callLangflow(inputForAgent, sessionId, reqId);
  } catch (e) {
    log("error", "langflow.error", { reqId, sessionId, error: e.message });
    if (/Client IP not allowed/i.test(String(e.message))) {
      agentText = "No tengo permiso para hablar con el agente (IP bloqueada). Avisá para allowlistear mi IP de salida.";
    } else {
      agentText = `Error al procesar tu mensaje: ${e.message}`;
    }
  }

  if (!agentText) {
    agentText = `Recibí tu mensaje: "${textRaw}" (sesión: ${sessionId})`;
    log("warn", "langflow.empty_output_fallback", { reqId, sessionId });
  }

  // Agregar respuesta del bot al historial local (backup)
  if (!DISABLE_LOCAL_MEMORY && HISTORY_TURNS > 0) {
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
    localHistoryLength: getHistory(sessionId).length,
    replyPreview: truncate(agentText, 200)
  });

  return res.status(200).json(reply);
});

// Debug endpoint mejorado
app.get("/sessions", (req, res) => {
  const sessions = {};
  for (const [sessionId, history] of mem.entries()) {
    sessions[sessionId] = {
      messageCount: history.length,
      lastMessages: history.slice(-3).map(m => `${m.role}: ${truncate(m.text, 50)}`)
    };
  }
  res.json({
    totalSessions: mem.size,
    sessions
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
  });
});
