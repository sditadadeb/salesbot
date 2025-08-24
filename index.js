// index.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Parseo JSON del webhook (obligatorio para leer el evento)
app.use(express.json());

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

// Webhook principal: configurar esta URL en TODOS los activadores de Google Chat
// (Mensaje, Comando de la app, Se agregó al espacio, Se quitó del espacio)
app.post("/events", (req, res) => {
  // Log liviano (no bloquear la respuesta)
  try {
    console.log("📨 POST /events");
    console.log("📥 Body:", JSON.stringify(req.body));
  } catch {}

  // Extraer el mensaje desde el payload de Chat
  const msg = req.body?.chat?.messagePayload?.message;

  // Si no hay mensaje (p. ej., ADDED_TO_SPACE), responder saludo corto
  if (!msg) {
    const welcome = {
      text:
        '¡Gracias por invitarme! Mencioname en el espacio (ej: "@botSales hola") y te respondo con "recibido".',
    };
    return res
      .status(200)
      .type("application/json; charset=UTF-8")
      .send(JSON.stringify(welcome));
  }

  // En espacios: argumentText trae el texto SIN la mención
  const text =
    (msg.argumentText ?? msg.formattedText ?? msg.text ?? "").trim();

  // Respuesta síncrona mínima (lo que espera Google Chat)
  const reply = { text: `recibido. tu mensaje fue: "${text}"` };

  // Importante: responder rápido, con 200 y application/json
  return res
    .status(200)
    .type("application/json; charset=UTF-8")
    .send(JSON.stringify(reply));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Escuchando en http://localhost:${PORT}`);
});
