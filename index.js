const express = require('express');
const app = express();

app.use(express.json());

// Ruta GET para comprobar que el bot está vivo
app.get('/', (req, res) => {
  res.send('🤖 Bot de Google Chat activo y escuchando');
});

// Ruta POST para manejar eventos desde Google Chat
app.post('/', (req, res) => {
  const body = req.body;

  console.log('📥 Evento recibido:', JSON.stringify(body, null, 2));

  // Detectar si hay texto en alguna estructura válida
  const rawText =
    body.message?.text ||
    body.chat?.messagePayload?.message?.text;

  if (!rawText) {
    console.log('⚠️ No hay texto en el mensaje. Ignorando evento.');
    return res.status(200).send(); // No respondemos si no hay texto
  }

  // Eliminar la mención al bot si viene de grupo (ej: "@botSales hola")
  const cleanText = rawText.replace(/^@\w+\s*/, '').trim();

  // Obtener nombre del remitente
  const user =
    body.message?.sender?.displayName ||
    body.chat?.user?.displayName ||
    'usuario desconocido';

  // Construir la respuesta
  const respuesta = {
    text: `recibido. tu mensaje fue: "${cleanText}"`
  };

  console.log(`📤 Respondiendo a ${user}:`, respuesta);
  res.json(respuesta); // Enviar la respuesta a Google Chat
});

// Escuchar en el puerto asignado por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
