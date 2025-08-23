const express = require('express');
const app = express();

app.use(express.json());

// Ruta GET para testeo desde navegador o Render health check
app.get('/', (req, res) => {
  res.send('🤖 Bot de Google Chat activo y esperando mensajes');
});

// Ruta POST para eventos de Google Chat
app.post('/', (req, res) => {
  const body = req.body;

  console.log('📥 Evento recibido:', JSON.stringify(body, null, 2));

  // Detectar tipo de evento
  const eventType = body.type || body.commonEventObject?.eventType;

  if (eventType !== 'MESSAGE') {
    console.log(`⚠️ Ignorando evento tipo: ${eventType}`);
    return res.status(200).send(); // No se responde a otros eventos
  }

  // Extraer texto del mensaje desde estructura de DM o espacio
  const text =
    body.message?.text ||
    body.chat?.messagePayload?.message?.text ||
    '';

  // Eliminar mención al bot si viene de un grupo
  const cleanText = text.replace(/^@\w+\s*/, '').trim();

  // Nombre del remitente
  const user =
    body.message?.sender?.displayName ||
    body.chat?.user?.displayName ||
    'usuario desconocido';

  // Armar respuesta
  const respuesta = {
    text: `recibido. tu mensaje fue: "${cleanText}"`
  };

  console.log(`📤 Respondiendo a ${user}:`, respuesta);
  res.json(respuesta);
});

// Escuchar en el puerto asignado por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
