// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

// Endpoint configurado en TODOS los activadores del Chat Add-on
app.post("/events", (req, res) => {
  const body = req.body || {};
  try {
    console.log("📨 POST /events");
    console.log("📥 Body:", JSON.stringify(body));
  } catch {}

  const mp = body?.chat?.messagePayload;
  const msg = mp?.message;
  const threadName = msg?.thread?.name;
  const textIn =
    (msg?.argumentText ?? msg?.formattedText ?? msg?.text ?? "").trim();

  // Construimos el "sobre" que espera un Add-on HTTP para Chat:
  // hostAppDataAction -> chatDataAction -> createMessageAction -> message
  const message = {
    text: textIn
      ? `recibido. tu mensaje fue: "${textIn}"`
      : "recibido.",
  };
  if (threadName) {
    message.thread = { name: threadName };
  }

  const reply = {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message
        }
      }
    }
  };

  console.log("📤 Reply:", JSON.stringify(reply));
  return res
    .status(200)
    .type("application/json; charset=UTF-8")
    .send(JSON.stringify(reply));
});

app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
