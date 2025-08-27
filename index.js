// index.js
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// === ENV requeridas ===
// LANGFLOW_HOST       -> p.ej. https://journey-builder.qa.numia.co
// LANGFLOW_FLOW_ID    -> p.ej. 42037c19-636c-42f0-b8ed-7d9ef7c39459
// LANGFLOW_API_KEY    -> tu API key de Langflow
// (opcional) LANGFLOW_TIMEOUT_MS -> default 4500 (ms)
// (opcional) LOG_LEVEL -> debug | info | warn | error (default: debug)

const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 4500);
const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function log(level, msg, meta = {}) {
  if ((LEVELS[level] || 99) < (LEVELS[LOG_LEVEL] || 99)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  try {
    console.log(JSON.stringify(line));
  } catch {
    console.log(`[${line.ts}] ${level.toUpperCase()} ${msg}`);
  }
}

function truncate(s, n = 500) {
  if (!s) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n) + "…(trunc)" : str;
}

function buildLangflowRunUrl() {
  const host = String(process.env.LANGFLOW_HOST || "").replace(/\/+$/, "");
  const flowId = process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
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
          }
        }
      }
    }
  } catch {}

  // Búsqueda profunda
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

  return ""; // importante para fallback
}

async function callLangflow(userText, sessionId, reqId) {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  const payload = {
    input_value: userText ?? "",
    output_type: "chat",
    input_type: "chat",
    session_id: sessionId || "default_session",
  };

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.LANGFLOW_API_KEY || "",
  };

  log("debug", "langflow.request", {
    reqId,
    url,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    sessionId,
    body: truncate(JSON.stringify(payload), 300),
    hasApiKey: !!process.env.LANGFLOW_API_KEY,
  });

  const resp = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(payload) }, LANGFLOW_TIMEOUT_MS);
  const raw = await resp.text();

  log("debug", "langflow.response", {
    reqId,
    status: resp.status,
    ok: resp.ok,
    raw: truncate(raw, 500),
  });

  if (!resp.ok) {
    throw new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
  }

  // Intentar parsear
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    // si no es JSON, devolver texto plano
    return (raw || "").trim();
  }

  const out = (pickTextFromLangflow(json) || "").trim();

  log("debug", "langflow.extracted", { reqId, outPreview: truncate(out, 300) });
  return out;
}

// ---------- Middleware de logging por request ----------
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => {
  // usar x-request-id si viene de Render, si no generamos uno
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  req.reqId = reqId;
  log("info", "http.request", {
    reqId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    ua: req.headers["user-agent"],
    contentType: req.headers["content-type"],
  });
  next();
});

// Health
app.get("/", (req, res) => {
  log("debug", "healthcheck", { reqId: req.reqId });
  res.status(200).send("OK");
});

// ---------- Webhook principal para Google Chat (Add-on HTTP) ----------
app.post("/events", async (req, res) => {
  const reqId = req.reqId;
  const body = req.body || {};
  log("debug", "chat.event.received", {
    reqId,
    bodyPreview: truncate(JSON.stringify(body), 1000),
  });

  const mp = body?.chat?.messagePayload;
  const msg = mp?.message;
  const threadName = msg?.thread?.name;
  const spaceName = mp?.space?.name;
  const isDM = mp?.space?.type === "DM";
  const userEmail = body?.chat?.user?.email;

  const textRaw = (msg?.argumentText ?? msg?.formattedText ?? msg?.text ?? "").trim();

  log("info", "chat.event.parsed", {
    reqId,
    userEmail,
    spaceName,
    isDM,
    threadName,
    textRaw,
  });

  // Si no hay mensaje (ej: ADDED_TO_SPACE), saludo simple
  if (!msg) {
    const welcome = {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { text: "¡Gracias por invitarme! Decime algo y lo paso por el agente." },
          },
        },
      },
    };
    log("debug", "chat.reply.welcome", { reqId, welcome });
    return res.status(200).type("application/json; charset=UTF-8").send(JSON.stringify(welcome));
  }

  // session_id estable para Langflow
  const sessionId = threadName || spaceName || userEmail || "default_session";

  let agentText = "";
  try {
    agentText = await callLangflow(textRaw, sessionId, reqId);
  } catch (e) {
    log("error", "langflow.error", { reqId, error: e.message });
  }

  if (!agentText) {
    agentText = `recibido. tu mensaje fue: "${textRaw}"`;
    log("warn", "langflow.empty_output_fallback", { reqId });
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

  log("info", "chat.reply.sending", { reqId, replyPreview: truncate(JSON.stringify(reply), 800) });

  return res.status(200).type("application/json; charset=UTF-8").send(JSON.stringify(reply));
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  log("info", "server.started", {
    port: PORT,
    langflowHost: process.env.LANGFLOW_HOST || null,
    flowId: process.env.LANGFLOW_FLOW_ID || null,
    hasApiKey: !!process.env.LANGFLOW_API_KEY,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    logLevel: LOG_LEVEL,
  });
});
