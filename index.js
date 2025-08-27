// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// === ENV requeridas ===
// LANGFLOW_HOST       -> p.ej. https://journey-builder.qa.numia.co
// LANGFLOW_FLOW_ID    -> p.ej. 42037c19-636c-42f0-b8ed-7d9ef7c39459
// LANGFLOW_API_KEY    -> tu API key de Langflow
// (opcional) LANGFLOW_TIMEOUT_MS -> default 4500

if (!process.env.LANGFLOW_HOST) console.warn("⚠️ Falta LANGFLOW_HOST");
if (!process.env.LANGFLOW_FLOW_ID) console.warn("⚠️ Falta LANGFLOW_FLOW_ID");
if (!process.env.LANGFLOW_API_KEY) console.warn("⚠️ Falta LANGFLOW_API_KEY");

const LANGFLOW_TIMEOUT_MS = Number(process.env.LANGFLOW_TIMEOUT_MS || 4500);

app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

/** Build URL de /run/<FLOW_ID> a partir de HOST + FLOW_ID */
function buildLangflowRunUrl() {
  const host = String(process.env.LANGFLOW_HOST || "").replace(/\/+$/, "");
  const flowId = process.env.LANGFLOW_FLOW_ID || "";
  if (!host || !flowId) return "";
  return `${host}/api/v1/run/${flowId}`;
}

/** fetch con timeout */
async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

/** Mejor esfuerzo para extraer texto útil del JSON de Langflow */
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

  // Búsqueda profunda de "text"
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

  return JSON.stringify(json).slice(0, 1000);
}

/** Llama a Langflow y devuelve texto del agente */
async function callLangflow(userText, sessionId = "default_session") {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  const payload = {
    input_value: userText ?? "",
    output_type: "chat",
    input_type: "chat",
    session_id: sessionId,
  };

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.LANGFLOW_API_KEY || "",
    },
    body: JSON.stringify(payload),
  };

  const resp = await fetchWithTimeout(url, options, LANGFLOW_TIMEOUT_MS);
  const json = await resp.json().catch(() => ({}));
  return pickTextFromLangflow(json);
}

/** Escapa HTML para cards si hiciera falta en el futuro */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// === Endpoint principal para Google Chat (Add-on HTTP) ===
// Debe estar configurado como HTTP endpoint en TODOS los activadores.
app.post("/events", async (req, res) => {
  const body = req.body || {};
  try {
    console.log("📨 POST /events");
    console.log("📥 Body:", JSON.stringify(body));
  } catch {}

  const mp = body?.chat?.messagePayload;
  const msg = mp?.message;
  const threadName = msg?.thread?.name;
  const spaceName = mp?.space?.name;
  const userText = (msg?.argumentText ?? msg?.formattedText ?? msg?.text ?? "").trim();

  // Si no hay mensaje (p.ej. ADDED_TO_SPACE), saludo simple
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
    return res.status(200).type("application/json; charset=UTF-8").send(JSON.stringify(welcome));
  }

  // Elegimos una session_id estable para Langflow (hilo > espacio > email > default)
  const sessionId = threadName || spaceName || body?.chat?.user?.email || "default_session";

  let agentText = "";
  try {
    agentText = await callLangflow(userText, sessionId);
  } catch (e) {
    console.error("❌ Error Langflow:", e.message);
    agentText = `No pude hablar con el agente ahora. Eco: "${userText}"`;
  }

  // En Add-on HTTP, la respuesta síncrona DEBE venir envuelta:
  // hostAppDataAction -> chatDataAction -> createMessageAction -> message
  const message = { text: agentText || "(sin respuesta del agente)" };
  if (threadName) message.thread = { name: threadName };

  const reply = {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: { message },
      },
    },
  };

  console.log("📤 Reply:", JSON.stringify(reply));
  return res.status(200).type("application/json; charset=UTF-8").send(JSON.stringify(reply));
});

app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
