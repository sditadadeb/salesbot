// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Parseo JSON del webhook (obligatorio)
app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

// Webhook principal de Google Chat
// Configurá ESTA URL en TODOS los activadores de tu app de Chat:
//   - Mensaje
//   - Comando de la app
//   - Se agregó al espacio
//   - Se quitó del espacio
// Ej: https://salesbot-1.onrender.com/events
app.post("/events", (req, res) => {
  // Log no bloqueante
  try {
    console.log("📨 POST /events");
    console.log("📥 Body:", JSON.stringify(req.body));
  } catch {}

  const msg = req.body?.chat?.messagePayload?.message;
  const space = req.body?.chat?.messagePayload?.space;

  // Si no hay mensaje (por ejemplo ADDED_TO_SPACE), mandamos un saludo corto
  if (!msg) {
    const welcome = {
      text: '¡Gracias por invitarme! Mencioname en el espacio (ej: "@botSales hola") y te respondo con "recibido".'
    };
    console.log("📤 Reply:", JSON.stringify(welcome));
    return res.status(200).json(welcome);
  }

  // En espacios con mención, Google provee:
  //   - message.argumentText  -> texto SIN la mención (preferido)
  //   - message.formattedText -> texto con mención formateada
  //   - message.text          -> texto plano con mención
  const text =
    (msg.argumentText ?? msg.formattedText ?? msg.text ?? "").trim();

  const reply = { text: `recibido. tu mensaje fue: "${text}"` };

  // En espacios con hilos, devolvé SIEMPRE el thread para que aparezca en el mismo hilo
  const threadName = msg?.thread?.name;
  if (threadName) {
    reply.thread = { name: threadName };
  }

  console.log("📤 Reply:", JSON.stringify(reply));
  // Responder síncrono, en < 5s, con JSON puro
  return res.status(200).json(reply);
});

// Arranque
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
