// index.js
// Bot Google Chat ↔ Langflow (Render)
// ENV aceptadas:
// - LANGFLOW_API_HOST  (o LANGFLOW_HOST)  ← se aceptan ambas
// - LANGFLOW_FLOW_ID
// - LANGFLOW_API_KEY
// - SESSION_STRATEGY   (opcional: thread | space | space_user | user) [default: thread]
// - LANGFLOW_TIMEOUT_MS (opcional, default 15000)
// - LANGFLOW_RETRIES    (opcional, default 2)
// - PORT (Render la setea)

"use strict";

const express = require("express");
const { randomUUID } = require("crypto");

// ----------------- Utils de log -----------------
function log(level, msg, meta = {}) {
  try { console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta })); }
  catch { console.log(`[${level}] ${msg}`); }
}
function preview(obj, n = 1000) {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    return s.length > n ? s.slice(0, n) + "…(trunc)" : s;
  } catch { return "<unserializable>"; }
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function stripTrailingSlash(u){ return (u || "").replace(/\/+$/, ""); }

// ----------------- ENV y defaults -----------------
const LANGFLOW_HOST_ENV = process.env.LANGFLOW_API_HOST || process.env.LANGFLOW_HOST || "";
const LANGFLOW_FLOW_ID  = process.env.LANGFLOW_FLOW_ID || "";
const LANGFLOW_API_KEY  = process.env.LANGFLOW_API_KEY || "";
const SESSION_STRATEGY  = (process.env.SESSION_STRATEGY || "thread").toLowerCase();
const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 15000);
const LANGFLOW_RETRIES    = Number(process.env.LANGFLOW_RETRIES || 2);
const PORT = process.env.PORT || 3000;

if (!LANGFLOW_HOST_ENV || !LANGFLOW_FLOW_ID || !LANGFLOW_API_KEY) {
  log("error", "Faltan variables de entorno requeridas", {
    need: ["LANGFLOW_API_HOST (o LANGFLOW_HOST)", "LANGFLOW_FLOW_ID", "LANGFLOW_API_KEY"],
    have: {
      LANGFLOW_API_HOST_or_LANGFLOW_HOST: !!LANGFLOW_HOST_ENV,
      LANGFLOW_FLOW_ID: !!LANGFLOW_FLOW_ID,
      LANGFLOW_API_KEY: !!LANGFLOW_API_KEY,
    },
  });
  process.exit(1);
}

const LANGFLOW_URL = `${stripTrailingSlash(LANGFLOW_HOST_ENV)}/api/v1/run/${LANGFLOW_FLOW_ID}`;

// ----------------- App -----------------
const app = express();
app.use(express.json({ limit: "2mb" }));

// Health
app.get("/", (_req, res) => res.status(200).send("OK"));

// Egress IP (para allowlist)
app.get("/egress", async (_req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    log("info", "egress.ip", { ip: j.ip });
    res.json(j);
  } catch (e) {
    log("warn", "egress.ip.failed", { error: String(e.message || e) });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// (Opcional) ver config (sin exponer API key)
app.get("/config", (_req, res) => {
  res.json({
    langflowUrl: LANGFLOW_URL,
    sessionStrategy: SESSION_STRATEGY,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    retries: LANGFLOW_RETRIES,
    hasApiKey: !!LANGFLOW_API_KEY,
  });
});

// ----------------- Helpers Google Chat -----------------
function parseChatEvent(body) {
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

  const threadName = message?.thread?.name || undefined;

  let textRaw = message.argumentText || message.text || "";
  textRaw = (textRaw || "").trim();
  textRaw = textRaw.replace(/^@\S+\s*/, ""); // limpia "@bot ..."

  return {
    userEmail: user.email,
    spaceName,
    isDM,
    threadName,
    textRaw,
  };
}

function computeSessionId({ strategy, isDM, threadName, spaceName, userEmail }) {
  // Forzamos sesiones estables en DM:
  const effStrategy = isDM ? "space_user" : (strategy || "thread");
  switch (effStrategy) {
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
  const message = { text: text || "" };
  if (threadName) message.thread = { name: threadName };
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: { message },
      },
    },
    text: message.text,      // fallback
    thread: message.thread,  // fallback
  };
}

// ----------------- Langflow -----------------
function looksHtml(s) {
  return /^\s*</.test(s || "");
}

async function callLangflow({ text, sessionId, reqId }) {
  const payload = {
    input_value: text ?? "",
    output_type: "chat",
    input_type: "chat",
    session_id: sessionId || "default_session",
  };

  let lastErr;
  const attempts = LANGFLOW_RETRIES + 1;

  for (let i = 1; i <= attempts; i++) {
    log("debug", "langflow.request", {
      reqId, attempt: `${i}/${attempts}`,
      url: LANGFLOW_URL, timeoutMs: LANGFLOW_TIMEOUT_MS,
      sessionId, body: preview(payload, 300), hasApiKey: !!LANGFLOW_API_KEY,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LANGFLOW_TIMEOUT_MS);

    try {
      const r = await fetch(LANGFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": LANGFLOW_API_KEY },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = r.headers.get("content-type") || "";
      const raw = await r.text();

      log("debug", "langflow.response", {
        reqId, attempt: `${i}/${attempts}`, status: r.status, ok: r.ok,
        contentType, raw: preview(raw, 500),
      });

      if (!r.ok) {
        if (r.status === 403) {
          throw new Error(`403_FORBIDDEN ${raw}`);
        }
        if (r.status >= 500 || r.status === 429) {
          lastErr = new Error(`Langflow HTTP ${r.status}: ${raw}`);
          // retry con backoff
        } else {
          throw new Error(`Langflow HTTP ${r.status}: ${raw}`);
        }
      } else {
        if (looksHtml(raw) || (!contentType.includes("json") && !raw.trim().startsWith("{"))) {
          log("warn", "langflow.non_json_response", { reqId, contentType });
          return ""; // forzamos fallback amable
        }
        let json;
        try { json = JSON.parse(raw); }
        catch { return ""; }
        const textOut = extractText(json);
        return (textOut || "").trim();
      }
    } catch (e) {
      clearTimeout(timer);
      const msg = String(e?.message || e);
      log("warn", "langflow.attempt_failed", { reqId, attempt: `${i}/${attempts}`, error: msg });

      const abortLike = /aborted|timeout/i.test(msg);
      const retriable = abortLike || /Langflow HTTP (5\d\d|429)/i.test(msg);
      if (retriable && i < attempts) {
        const delay = Math.min(1000 * i * i, 4000); // 1s, 4s, 9s... cap 4s
        log("info", "langflow.retrying_after_backoff", { reqId, inMs: delay });
        await sleep(delay);
        continue;
      }
      lastErr = e;
      break;
    }
  }
  throw lastErr || new Error("Langflow no respondió");
}

// Extrae texto desde distintas formas de respuesta de Langflow
function extractText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;

  // 1) Claves frecuentes
  for (const k of ["text", "message", "output", "content", "result"]) {
    if (typeof raw[k] === "string" && raw[k].trim()) return raw[k];
  }

  // 2) outputs[] anidados
  try {
    const outs = raw.outputs;
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

  // 3) Búsqueda profunda
  try {
    const stack = [raw];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);
      if (typeof cur.text === "string" && cur.text.trim()) return cur.text;
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  } catch {}
  return "";
}

// ----------------- Webhook -----------------
app.post("/events", async (req, res) => {
  const reqId = randomUUID();
  log("info", "http.request", {
    reqId, method: "POST", path: "/events",
    ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
    ua: req.headers["user-agent"],
    contentType: req.headers["content-type"],
  });

  const body = req.body || {};
  log("debug", "chat.event.received", { reqId, bodyPreview: preview(body) });

  const parsed = parseChatEvent(body);
  log("info", "chat.event.parsed", { reqId, ...parsed });

  if (!parsed.textRaw) {
    // evento sin texto (alta al espacio, etc.)
    const welcome = buildChatReply("¡Gracias por invitarme! Decime algo y lo paso por el agente.", parsed.threadName);
    log("debug", "chat.reply.welcome", { reqId, replyPreview: preview(welcome) });
    return res.status(200).json(welcome);
  }

  const sessionId = computeSessionId({
    strategy: SESSION_STRATEGY,
    isDM: parsed.isDM,
    threadName: parsed.threadName,
    spaceName: parsed.spaceName,
    userEmail: parsed.userEmail,
  });

  let textOut = "";
  try {
    textOut = await callLangflow({ text: parsed.textRaw, sessionId, reqId });
  } catch (e) {
    const msg = String(e?.message || e);
    log("error", "langflow.error", { reqId, error: msg });
    if (/403_FORBIDDEN/i.test(msg) || /Client IP not allowed/i.test(msg)) {
      textOut = "No tengo permiso para hablar con el agente (IP bloqueada). Pedí que allowlisteen mi IP de salida.";
    }
  }

  if (!textOut) {
    textOut = `recibido. tu mensaje fue: "${parsed.textRaw}"`;
    log("warn", "langflow.empty_output_fallback", { reqId });
  }

  const reply = buildChatReply(textOut, parsed.threadName);
  log("info", "chat.reply.sending", { reqId, replyPreview: preview(reply) });
  res.status(200).json(reply);
});

// ----------------- Start -----------------
app.listen(PORT, () => {
  log("info", "server.started", {
    port: PORT,
    langflowUrl: LANGFLOW_URL,
    sessionStrategy: SESSION_STRATEGY,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    retries: LANGFLOW_RETRIES,
    hasApiKey: !!LANGFLOW_API_KEY,
  });
});
