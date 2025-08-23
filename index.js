const express = require('express');
const app = express();

app.use(express.json());

// Ruta de prueba GET
app.get('/', (req, res) => {
  res.send('🤖 Bot de Google Chat activo y esperando mensajes');
});

// Ruta principal para eventos desde Google Chat
app.post('/', (req, res) => {
  const body = req.body;

  console.log('📥 Evento recibido:', JSON.stringify(body, null, 2));

  // Extraer el texto del mensaje desde diferentes estructuras posibles
  const rawText =
    body.message?.text ||
    body.chat?.messagePayload?.message?.text;

  if (!rawText) {
    console.log('⚠️ No hay texto en el mensaje. Ignorando evento.');
    return res.status(200).send();
  }

  // Limpiar mención al bot si viene de grupo
  const cleanText = rawText.replace(/^@\w+\s*/, '').trim();

  // Obtener el nombre del remitente
  const user =
    body.message?.sender?.displayName ||
    body.chat?.user?.displayName ||
    'usuario desconocido';

  // Detectar el hilo si el mensaje vino desde un hilo (espacio grupal)
  const threadName =
    body.message?.thread?.name ||
    body.chat?.messagePayload?.message?.thread?.name;

  // Armar la respuesta
  const respuesta = {
    text: `recibido. tu mensaje fue: "${cleanText}"`,
    ...(threadName && { thread: { name: threadName } }) // Incluir hilo solo si existe
  };

  console.log(`📤 Respondiendo a ${user}:`, respuesta);
  res.json(respuesta);
});

// Puerto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
