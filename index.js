const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

// Asegurá que parseamos JSON
app.use(express.json());

// Salud
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Utilidad: extrae el "message" y el "space" soportando esquemas distintos
function extractMessageAndSpace(body) {
  // Esquema “oficial” de Google Chat App
  if (body && body.message) {
    return { message: body.message, space: body.space || body.message.space };
  }
  // Esquema que viste en tus logs (chat.messagePayload)
  if (body && body.chat && body.chat.messagePayload) {
    return {
      message: body.chat.messagePayload.message,
      space: body.chat.messagePayload.space
    };
  }
  // Fallback
  return { message: undefined, space: undefined };
}

// Endpoint principal de eventos
app.post('/events', (req, res) => {
  console.log('📥 Evento completo recibido:\n', JSON.stringify(req.body, null, 2));

  const { message, space } = extractMessageAndSpace(req.body);

  // Si no hay mensaje (p.ej. added_to_space, removed_from_space)
  const topType = req.body.type || req.body.eventType; // por si viene en otro campo
  if (!message) {
    // Mensaje de bienvenida cuando agregan el bot a un espacio/DM
    if (topType === 'ADDED_TO_SPACE' || req.body?.chat?.type === 'ADDED_TO_SPACE') {
      const isDm =
        (space?.type === 'DM') ||
        (space?.spaceType === 'DIRECT_MESSAGE') ||
        (req.body?.space?.type === 'DM');
      const text = isDm
        ? '¡Hola! Soy el bot. Escribime y te respondo 🙂'
        : '¡Gracias por invitarme! Mencioname con @<bot> y te respondo 🙂';
      return res.json({ text });
    }

    console.warn('⚠️ Evento sin message. Respondemos 200 vacío.');
    return res.status(200).send(); // Siempre 200 para que Chat no reintente
  }

  // Texto: usar argumentText si te mencionan, si no, usar text
  const text =
    (message.argumentText && message.argumentText.trim()) ||
    (message.text && message.text.trim()) ||
    '';

  if (!text) {
    console.warn('⚠️ Ignorando evento sin texto.');
    return res.status(200).send();
  }

  const isDm =
    (space?.type === 'DM') ||
    (space?.spaceType === 'DIRECT_MESSAGE') ||
    (message?.space?.type === 'DM') ||
    (message?.space?.spaceType === 'DIRECT_MESSAGE');

  const reply = { text: `recibido. tu mensaje fue: "${text}"` };

  // En espacios, respondemos en el mismo thread
  if (!isDm && message.thread?.name) {
    reply.thread = { name: message.thread.name };
  }

  console.log('📤 Respuesta que enviamos:', reply);
  return res.json(reply); // responder en línea (sync). Debe ser <10s
});

// Arranque
app.listen(PORT, () => {
  console.log(`🚀 Bot de Chat por eventos escuchando en puerto ${PORT}`);
});
