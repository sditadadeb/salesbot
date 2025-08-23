// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Parseo JSON del webhook
app.use(express.json());

// Health
app.get("/", (_req, res) => res.status(200).send("OK"));

// Webhook principal de Google Chat
app.post("/events", (req, res) => {
  const body = req.body;

  // --- Logging opcional (no bloquear la respuesta)
  try {
    console.log("📨 POST /events");
    console.log("📥 Cuerpo:", JSON.stringify(body, null, 2));
  } catch (_) {}

  // Extraer datos clave del evento
  const msg = body?.chat?.messagePayload?.message;
  const space = body?.chat?.messagePayload?.space;

  // Si no hay mensaje (p.ej. ADDED_TO_SPACE), saludamos
  if (!msg) {
    const reply = {
      text:
        "¡Gracias por invitarme! Escribime algo (mencionándome en salas) y te respondo con “recibido”.",
      messageReplyOption: "REPLY_MESSAGE_FALLBACK",
    };
    return res
      .status(200)
      .set("Content-Type", "application/json; charset=utf-8")
      .send(reply);
  }

  // Para salas, Google entrega:
  // - message.text (incluye la mención)
  // - message.argumentText (texto SIN la mención) -> preferido
  const textRaw =
    msg.argumentText?.trim() ||
    msg.formattedText?.trim() ||
    msg.text?.trim() ||
    "";

  const threadName = msg?.thread?.name; // responder en el mismo hilo si existe

  // Armar respuesta simple
  const replyText = `recibido. tu mensaje fue: "${textRaw}"`;

  const reply = {
    text: replyText,
    messageReplyOption: "REPLY_MESSAGE_FALLBACK",
  };

  if (threadName) {
    reply.thread = { name: threadName };
  }

  // Enviar respuesta síncrona (lo que espera Chat)
  return res
    .status(200)
    .set("Content-Type", "application/json; charset=utf-8")
    .send(reply);
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
