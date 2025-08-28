// index.js
// Bot de Google Chat ↔ Langflow (Render)
// --------------------------------------
// Requisitos de entorno (ENV):
// - LANGFLOW_API_HOST   (p.ej. https://api.journey-builder.qa.numia.co)
// - LANGFLOW_FLOW_ID    (ID del flow en Langflow, sin /api/v1/run/)
// - LANGFLOW_API_KEY    (API key de Langflow)
// - SESSION_STRATEGY    (opcional: thread | space | space_user | user)  [default: thread]
// - PORT                (opcional, Render lo provee como 10000)

"use strict";

const express = require("express");

// ---- Utilidades de log en JSON (legibles en Render) ----
function log(level, msg, extra = {}) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
  } catch {
    console.log(`[${level}] ${msg}`);
  }
}

// ---- Validación de ENV ----
const {
  LANGFLOW_API_HOST,
  LANGFLOW_FLOW_ID,
  LANGFLOW_API_KEY,
  SESSION_STRATEGY = "thread",
} = process.env;

if (!LANGFLOW_API_HOST || !LANGFLOW_FLOW_ID || !LANGFLOW_API_KEY) {
  log("error", "Faltan variables de entorno requeridas", {
    need: ["LANGFLOW_API_HOST", "LANGFLOW_FLOW_ID", "LANGFLOW_API_KEY"],
    have: { LANGFLOW_API_HOST: !!LANGFLOW_API_HOST, LANGFLOW_FLOW_ID: !!LANGFLOW_FLOW_ID, LANGFLOW_API_KEY: !!LANGFLOW_API_KEY },
  });
  process.exit(1);
}

const LANGFLOW_URL = `${stripTrailingSlash(LANGFLOW_API_HOST)}/api/v1/run/${LANGFLOW_FLOW_ID}`;

// ---- App HTTP ----
const app = express();
app.use(express.json({ limit: "2mb" }));

// Healthcheck
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

// Punto de entrada del Webhook de Google Chat
app.post("/events", async (req, res) => {
  const reqId = cryptoId();
  log("info", "http.request", {
    reqId,
    method: "POST",
    path: "/events",
    ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    ua: req.headers["user-agent"],
    contentType: req.headers["content-type"],
  });

  const body = req.body || {};
  log("debug", "chat.event.received", {
    reqId,
    bodyPreview: safePreviewJSON(body),
  });

  // Parseo de evento (DM/SPACE, texto, hilo, etc.)
  const parsed = parseChatEvent(body);
  log("info", "chat.event.parsed", { reqId, ...parsed });

  // Si no hay texto, ignoramos con 200 (para que Chat no reintente)
  if (!parsed.textRaw) {
    log("warn", "chat.event.no_text", { reqId });
    return res.status(200).send({});
  }

  // Construir session_id según estrategia
  const sessionId = computeSessionId({
    strategy: SESSION_STRATEGY,
    threadName: parsed.threadName,
    spaceName: parsed.spaceName,
    userEmail: parsed.userEmail,
  });

  // Enviar a Langflow
  let replyText = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const lfBody = {
      input_value: parsed.textRaw,
      output_type: "chat",
      input_type: "chat",
      session_id: sessionId,
    };

    log("debug", "langflow.request", {
      reqId,
      url: LANGFLOW_URL,
      timeoutMs: 4500,
      sessionId,
      body: JSON.stringify(lfBody),
      hasApiKey: !!LANGFLOW_API_KEY,
    });

    const r = await fetch(LANGFLOW_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": LANGFLOW_API_KEY,
      },
      body: JSON.stringify(lfBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = r.headers.get("content-type") || "";
    const raw = contentType.includes("application/json") ? await r.json().catch(() => ({})) : await r.text();

    log("debug", "langflow.response", {
      reqId,
      status: r.status,
      ok: r.ok,
      contentType,
      raw: contentType.includes("json") ? safePreviewJSON(raw) : safePreviewText(raw),
    });

    if (!r.ok) {
      // Errores típicos (IP allowlist, etc.)
      if (r.status === 403) {
        const msg = "No tengo permiso para hablar con el agente (IP bloqueada). Avisá para allowlistear mi IP de salida.";
        log("error", "langflow.error", { reqId, error: `Langflow HTTP 403: ${JSON.stringify(raw)}` });
        replyText = msg;
      } else {
        log("error", "langflow.error", { reqId, error: `Langflow HTTP ${r.status}` });
        replyText = `Ups, hubo un error (${r.status}).`;
      }
    } else {
      // Extraer texto de la respuesta de Langflow
      replyText = extractTextFromLangflow(raw);
      if (!replyText) {
        replyText = `recibido. tu mensaje fue: "${parsed.textRaw}"`; // Fallback amable
        log("warn", "langflow.empty_output_fallback", { reqId });
      }
    }
  } catch (err) {
    const errMsg = String(err && err.message ? err.message : err);
    log("error", "langflow.error", { reqId, error: errMsg });
    replyText = "Se agotó el tiempo o falló la conexión con el agente.";
  }

  // Armar respuesta para Google Chat
  const response = buildChatReply(replyText, parsed.threadName);
  log("info", "chat.reply.sending", { reqId, replyPreview: safePreviewJSON(response) });

  // Enviar 200 inmediatamente con el payload
  res.status(200).json(response);
});

// ---- Helpers ----

function parseChatEvent(body) {
  // El payload puede venir bajo body.chat.messagePayload.message o body.message, según la versión.
  const mp = body?.chat?.messagePayload || {};
  const space = mp.space || body?.space || {};
  const message = mp.message || body?.message || {};
  const user = message.sender || body?.user || body?.chat?.user || {};

  const spaceName = space.name;
  const isDM =
    space.singleUserBotDm === true ||
    space.type === "DM" ||
    space.spaceType === "DIRECT_MESSAGE" ||
    space.spaceThreadingState === "UNTHREADED_MESSAGES";

  const threadName =
    message?.thread?.name ||
    mp?.message?.thread?.name ||
    undefined;

  // Texto: preferimos argumentText (sin menciones); sino text.
  let textRaw = message.argumentText || message.text || "";
  textRaw = (textRaw || "").trim();

  // Si aún viene con mención manual, limpiamos "@bot algo"
  textRaw = textRaw.replace(/^@\S+\s*/, "");

  return {
    userEmail: user.email,
    spaceName,
    isDM,
    threadName,
    textRaw,
  };
}

function computeSessionId({ strategy, threadName, spaceName, userEmail }) {
  switch ((strategy || "").toLowerCase()) {
    case "space":
      return spaceName || threadName || userEmail || "default_session";
    case "space_user":
      return `${spaceName || "space"}:${userEmail || "anon"}`;
    case "user":
      return userEmail || spaceName || threadName || "default_session";
    case "thread":
    default:
      return threadName || spaceName || userEmail || "default_session";
  }
}

function buildChatReply(text, threadName) {
  // Respuesta simple compatible con Google Chat (sin HTML)
  const message = { text: text || "", };
  if (threadName) message.thread = { name: threadName };

  // Usamos hostAppDataAction (soporta respuestas ricas), con fallback a text plano.
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: { message },
      },
    },
    // Fallback para clientes que no soporten hostAppDataAction
    text: message.text,
    thread: message.thread,
  };
}

// Intenta extraer texto de estructuras variadas de Langflow
function extractTextFromLangflow(raw) {
  if (raw == null) return "";

  if (typeof raw === "string") {
    // Si Langflow devolvió HTML (ej. index app), no lo mostramos
    if (raw.trim().startsWith("<!doctype") || raw.trim().startsWith("<html")) return "";
    return raw;
  }

  // Caso esperado de Langflow (distintas formas)
  // Buscamos cualquier 'text' profundo
  const deep = findFirstStringByKeys(raw, ["text", "content", "message", "output", "result"]);
  if (deep) return deep;

  // Algunos flows devuelven { outputs: [ { outputs: [ { results: { message: [ { data: { text } } ]}}]}]}
  try {
    const outputs = raw.outputs || raw.data || [];
    const first = Array.isArray(outputs) ? outputs[0] : outputs;
    const nested = first?.outputs || first?.results || first;
    const asArr = Array.isArray(nested) ? nested : [nested];

    for (const item of asArr) {
      // message array
      const msgArr = item?.results?.message || item?.message || [];
      if (Array.isArray(msgArr)) {
        for (const m of msgArr) {
          const t = m?.data?.text || m?.text;
          if (typeof t === "string" && t.trim()) return t;
        }
      }
      // direct text
      const t = item?.results?.text || item?.text;
      if (typeof t === "string" && t.trim()) return t;
    }
  } catch {
    // ignore
  }

  // Nada encontrado
  return "";
}

function findFirstStringByKeys(obj, keys) {
  try {
    if (typeof obj === "string") return obj;
    if (Array.isArray(obj)) {
      for (const it of obj) {
        const v = findFirstStringByKeys(it, keys);
        if (v) return v;
      }
      return "";
    }
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        if (keys.includes(k) && typeof obj[k] === "string" && obj[k].trim()) {
          return obj[k];
        }
        const v = findFirstStringByKeys(obj[k], keys);
        if (v) return v;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

function safePreviewJSON(v) {
  try {
    const s = JSON.stringify(v);
    return s.length > 1000 ? s.slice(0, 1000) + "…(trunc)" : s;
  } catch {
    return "<unserializable>";
  }
}
function safePreviewText(v) {
  try {
    const s = String(v);
    return s.length > 1000 ? s.slice(0, 1000) + "…(trunc)" : s;
  } catch {
    return "<unserializable>";
  }
}
function stripTrailingSlash(u) {
  return (u || "").replace(/\/+$/, "");
}
function cryptoId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^cryptoRandom()*16>>c/4).toString(16));
}
// pseudo-random simple (no crypto)
function cryptoRandom() {
  return Math.random();
}

// ---- Inicio del servidor ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log("info", `Servidor escuchando en http://localhost:${PORT}`, { port: PORT, sessionStrategy: SESSION_STRATEGY });
});
