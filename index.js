// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Requerido para leer el JSON del webhook
app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

// Webhook principal (configurá ESTA ruta en TODOS los activadores)
app.post("/events", (req, res) => {
  // Log liviano
  try {
    console.log("📨 POST /events");
    console.log("📥 Body:", JSON.stringify(req.body));
  } catch {}

  const payload = req.body;
  const msg = payload?.chat?.messagePayload?.message;

  // Si no hay mensaje (p.ej. ADDED_TO_SPACE), devolver saludo breve
  if (!msg) {
    const welcome = {
      text: '¡Gracias por invitarme! Decime algo y te contesto con "recibido".',
      fallbackText: "Bot listo para responder.",
    };
    console.log("📤 Reply:", JSON.stringify(welcome));
    return res
      .status(200)
      .type("application/json; charset=UTF-8")
      .send(JSON.stringify(welcome));
  }

  // En salas con mención: usar argumentText (sin la mención)
  const textIn =
    (msg.argumentText ?? msg.formattedText ?? msg.text ?? "").trim();

  // Construir respuesta mínima
  const reply = {
    text: `recibido. tu mensaje fue: "${textIn}"`,
    fallbackText: `recibido. tu mensaje fue: "${textIn}"`,
  };

  // Mantener el hilo si existe
  const threadName = msg?.thread?.name;
  if (threadName) {
    reply.thread = { name: threadName };
  }

  // (Opcional) Card simple para que siempre haya UI visible
  reply.cardsV2 = [
    {
      cardId: "ack",
      card: {
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: `✅ <b>Recibido</b><br/>Tu mensaje: <i>${escapeHtml(
                    textIn
                  )}</i>`,
                },
              },
            ],
          },
        ],
      },
    },
  ];

  console.log("📤 Reply:", JSON.stringify(reply));

  // Responder síncrono, en <5s, con JSON puro
  return res
    .status(200)
    .type("application/json; charset=UTF-8")
    .send(JSON.stringify(reply));
});

// Utilidad mínima para evitar HTML raro en la card
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
