// index.js - TIMEOUT CORREGIDO
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ASEGURAR QUE EL TIMEOUT SE LEA CORRECTAMENTE
const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS) || 45000; // 45 segundos por defecto
const LANGFLOW_RETRIES = Number(process.env.LANGFLOW_RETRIES) || 2;
const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const HISTORY_TURNS = Math.max(0, Number(process.env.HISTORY_TURNS) || 6);
const DISABLE_LOCAL_MEMORY = String(process.env.DISABLE_LOCAL_MEMORY || "0") === "1";
const USE_HYBRID_MEMORY = String(process.env.USE_HYBRID_MEMORY || "1") === "1";

const ENVIRONMENTS = {
  "qa": {
    "host": process.env.LANGFLOW_HOST_QA || "",
  },
  "prod": {
    "host": process.env.LANGFLOW_HOST_PRODUCTION || "",
  },
}

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
  
  const contextLines = ["=== HISTORIAL PREVIO DE LA CONVERSACIÓN ==="];
  
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
function buildLangflowRunUrl(environment = 'qa', flowId) {
  const host = String(ENVIRONMENTS[environment]["host"] || "").replace(/\/+$/, "");
  flowId = flowId || process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}

// FUNCIÓN MEJORADA CON TIMEOUT EXPLÍCITO
async function fetchWithTimeout(url, options = {}, timeoutMs = LANGFLOW_TIMEOUT_MS) {
  const controller = new AbortController();
  const startTime = Date.now();
  
  const timeoutId = setTimeout(() => {
    log("warn", "fetch.timeout", { url, timeoutMs, elapsedMs: Date.now() - startTime });
    controller.abort();
  }, timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;
    
    log("debug", "fetch.completed", { 
      url, 
      status: response.status, 
      ok: response.ok, 
      elapsedMs,
      timeoutMs
    });
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;
    
    log("warn", "fetch.error", { 
      url, 
      error: error.message, 
      elapsedMs, 
      timeoutMs,
      wasTimeout: elapsedMs >= timeoutMs * 0.95 // 95% del timeout
    });
    
    throw error;
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

async function callLangflow(userText, sessionId, reqId, environment, flowId, apiKey, chatContext = {}) {
  const url = buildLangflowRunUrl(environment, flowId);
  if (!url) throw new Error("LANGFLOW_HOST_QA / LANGFLOW_HOST_PRODUCTION / LANGFLOW_FLOW_ID no configuradas");

  let textForFlow = userText;
  if (USE_HYBRID_MEMORY && !DISABLE_LOCAL_MEMORY) {
    const context = renderHistoryForLangflow(sessionId);
    if (context) {
      textForFlow = context + "Pregunta actual: " + userText;
    }
  }

  const structuredInput = JSON.stringify({
    ...chatContext,
    text: textForFlow
  });

  const payload = {
    input_value: structuredInput,
    output_type: "chat", 
    input_type: "chat",
    session_id: sessionId,
    tweaks: {}
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-key": apiKey || ""
  };

  let lastErr;
  const attempts = LANGFLOW_RETRIES + 1;

  for (let i = 1; i <= attempts; i++) {
    const startTime = Date.now();
    
    log("info", "langflow.request", {
      reqId, attempt: `${i}/${attempts}`,
      url, timeoutMs: LANGFLOW_TIMEOUT_MS,
      sessionId,
      chatContext: truncate(JSON.stringify(chatContext), 300),
      originalInput: truncate(userText, 200),
      structuredInputPreview: truncate(structuredInput, 500),
      hasContext: textForFlow !== userText,
      historyLength: getHistory(sessionId).length
    });

    try {
      const resp = await fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(payload) },
        LANGFLOW_TIMEOUT_MS
      );

      const contentType = resp.headers.get("content-type") || "";
      const raw = await resp.text();
      const elapsedMs = Date.now() - startTime;

      log("info", "langflow.response", {
        reqId, attempt: `${i}/${attempts}`,
        status: resp.status, ok: resp.ok, contentType,
        elapsedMs,
        rawPreview: truncate(raw, 400),
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
        log("info", "langflow.extracted", { 
          reqId, sessionId, 
          outPreview: truncate(out, 300), 
          elapsedMs 
        });
        return out;
      }
    } catch (e) {
      lastErr = e;
      const elapsedMs = Date.now() - startTime;
      const msg = String(e?.message || e);
      const abortLike = /aborted|timeout|The operation was aborted|This operation was aborted/i.test(msg);
      const wasTimeout = elapsedMs >= LANGFLOW_TIMEOUT_MS * 0.95;
      
      log("warn", "langflow.attempt_failed", { 
        reqId, attempt: `${i}/${attempts}`, sessionId, 
        error: msg, elapsedMs, wasTimeout 
      });

      if (abortLike || wasTimeout || (lastErr && /Langflow HTTP (5\d\d|429)/.test(String(lastErr.message)))) {
        if (i < attempts) {
          const delay = Math.min(5000 * i, 10000); // 5s, 10s
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
  res.status(200).send(`OK - Bot funcionando. Timeout: ${LANGFLOW_TIMEOUT_MS}ms`);
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
function computeSessionId({ threadName, isDM, userEmail, userName, spaceName, spaceDisplayName, msg }) {
  let sessionId;

  if (isDM) {
    const personName = userName || userEmail || "Desconocido";
    sessionId = `Privado - ${personName}`;
  } else {
    sessionId = spaceDisplayName || spaceName || `fallback_${msg?.name || crypto.randomUUID()}`;
  }

  log("debug", "session.computed", {
    sessionId: truncate(sessionId, 100),
    isDM,
    threadName: threadName ? truncate(threadName, 50) : null,
    spaceName: spaceName ? truncate(spaceName, 50) : null,
    spaceDisplayName: spaceDisplayName ? truncate(spaceDisplayName, 50) : null
  });

  return sessionId;
}

// ---------------------- Webhook Google Chat ----------------------
app.post("/:environment/events/:flowId/:apiKey", async (req, res) => {
  const { environment, flowId, apiKey } = req.params;

  const reqId = req.reqId;
  const body = req.body || {};
  
  log("debug", "chat.event.raw", { reqId, bodyPreview: truncate(JSON.stringify(body), 1500) });

  const mp = body?.chat?.messagePayload;
  const msg = mp?.message;
  const chatUser = body?.chat?.user || {};
  const space = mp?.space || {};

  const threadName = msg?.thread?.name;
  const spaceName = space.name || "";
  const spaceDisplayName = space.displayName || "";
  const spaceType = space.spaceType || space.type || "";
  const isDM = space.type === "DM" || spaceType === "DIRECT_MESSAGE";

  const userEmail = chatUser.email || "";
  const userName = chatUser.displayName || chatUser.name || userEmail || "Desconocido";
  const userType = chatUser.type || "";
  const userAvatarUrl = chatUser.avatarUrl || "";

  const textRaw = (msg?.argumentText ?? msg?.formattedText ?? msg?.text ?? "").trim();
  const messageId = msg?.name || "";
  const messageCreateTime = msg?.createTime || "";
  const annotations = msg?.annotations || [];
  const attachments = msg?.attachment || [];

  const eventType = body?.chat?.type || body?.type || "";
  const eventTime = body?.chat?.eventTime || body?.eventTime || "";

  const chatContext = {
    user: {
      name: userName,
      email: userEmail,
      type: userType,
      avatarUrl: userAvatarUrl,
    },
    space: {
      name: spaceName,
      displayName: spaceDisplayName,
      type: spaceType,
      isDM,
    },
    message: {
      id: messageId,
      threadName,
      createTime: messageCreateTime,
      hasAnnotations: annotations.length > 0,
      annotationCount: annotations.length,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
    },
    event: {
      type: eventType,
      time: eventTime,
    }
  };

  log("info", "chat.event.parsed", {
    reqId, userEmail, userName, spaceName, spaceDisplayName,
    isDM, threadName, textRaw, eventType,
    annotations: annotations.length, attachments: attachments.length,
  });

  if (!msg) {
    const welcome = {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { 
              text: `¡Hola! Se instaló la aplicación correctamente. Recordaré nuestra conversación en este ${isDM ? 'chat directo' : 'hilo'}.`
            },
          },
        },
      },
    };
    log("debug", "chat.reply.welcome", { reqId });
    return res.status(200).json(welcome);
  }

  const sessionId = computeSessionId({ 
    threadName, 
    isDM, 
    userEmail, 
    userName,
    spaceName, 
    spaceDisplayName,
    msg 
  });

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
    isDM,
    userEmail: userEmail ? userEmail.substring(0, 10) + "..." : null,
    threadName: threadName ? truncate(threadName, 50) : null
  });

  let agentText = "";
  try {
    agentText = await callLangflow(textRaw, sessionId, reqId, environment, flowId, apiKey, chatContext);
  } catch (e) {
    log("error", "langflow.error", { reqId, sessionId, error: e.message });
    if (/Client IP not allowed/i.test(String(e.message))) {
      agentText = "No tengo permiso para hablar con el agente (IP bloqueada). Revisa la configuración de IP allowlist.";
    } else if (/timeout|aborted/i.test(String(e.message))) {
      agentText = "El servicio está tardando mucho en responder. Intenta de nuevo en un momento o reformula tu pregunta.";
    } else {
      agentText = `Hubo un error procesando tu mensaje: ${e.message}. Intenta de nuevo.`;
    }
  }

  if (!agentText) {
    const historyCount = getHistory(sessionId).length;
    agentText = `Recibí tu mensaje: "${textRaw}". Esta sería nuestra conversación #${Math.ceil((historyCount + 2)/2)} (sesión: ${sessionId})`;
    log("warn", "langflow.empty_output_fallback", { reqId, sessionId });
  }

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
    historyLength: finalHistory.length,
    replyPreview: truncate(agentText, 200)
  });

  return res.status(200).json(reply);
});

app.post("/test/:environment/:flowId/:apiKey", async (req, res) => {
  const { environment, flowId, apiKey } = req.params;
  const reqId = req.reqId;
  const body = req.body || {};
  const text = body.text;

  if (!text) {
    return res.status(400).json({ error: "Campo 'text' requerido en el body" });
  }

  const sessionId = `test_${crypto.randomUUID().substring(0, 8)}`;

  const chatContext = {
    user: {
      name: body.userName || "TestUser",
      email: body.userEmail || "test@test.com",
      type: body.userType || "HUMAN",
      avatarUrl: "",
    },
    space: {
      name: body.spaceName || "spaces/test",
      displayName: body.spaceDisplayName || "test-space",
      type: body.spaceType || "ROOM",
      isDM: body.isDM || false,
    },
    message: {
      id: `test-msg-${Date.now()}`,
      threadName: body.threadName || null,
      createTime: new Date().toISOString(),
      hasAnnotations: false,
      annotationCount: 0,
      hasAttachments: false,
      attachmentCount: 0,
    },
    event: {
      type: "MESSAGE",
      time: new Date().toISOString(),
    }
  };

  log("info", "test.request", { reqId, chatContext, text: truncate(text, 200) });

  try {
    const agentText = await callLangflow(text, sessionId, reqId, environment, flowId, apiKey, chatContext);
    return res.status(200).json({
      success: true,
      sessionId,
      payloadSent: { ...chatContext, text: truncate(text, 200) },
      response: agentText
    });
  } catch (e) {
    log("error", "test.error", { reqId, error: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
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
    timeoutMs: LANGFLOW_TIMEOUT_MS,
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
    flowId: process.env.LANGFLOW_FLOW_ID || null,
    host_qa: process.env.LANGFLOW_HOST_QA || null,
    host_prod: process.env.LANGFLOW_HOST_PRODUCTION || null,
    timeoutMs: LANGFLOW_TIMEOUT_MS, // Debe mostrar 45000 ahora
    retries: LANGFLOW_RETRIES,
    logLevel: LOG_LEVEL,
    historyTurns: HISTORY_TURNS,
    disableLocalMemory: DISABLE_LOCAL_MEMORY,
    useHybridMemory: USE_HYBRID_MEMORY,
  });
});
