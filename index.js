const express = require('express');
const bodyParser = require('body-parser');
const app = express();

// Puerto que Render usará (por defecto 10000 en tu caso)
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

// Ruta raíz para saludos o test
app.get('/', (req, res) => {
  res.send('Bot operativo ✅');
});

// Ruta principal para eventos desde Google Chat
app.post('/', (req, res) => {
  console.log('📥 Evento recibido:', JSON.stringify(req.body, null, 2));

  const message = req.body?.chat?.message;
  const thread = message?.thread?.name;
  const text = message?.text || message?.argumentText || '';

  // Verificamos que es un mensaje válido
  if (!message) {
    console.warn('⚠️ Ignorando evento sin mensaje.');
    return res.status(200).send(); // Respondemos sin contenido
  }

  // Preparamos respuesta
  const respuesta = {
    text: `recibido. tu mensaje fue: "${text.trim()}"`
  };

  // Si hay thread (en espacios), lo incluimos en la respuesta
  if (thread) {
    respuesta.thread = { name: thread };
  }

  console.log('📤 Enviando respuesta:', JSON.stringify(respuesta, null, 2));

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(respuesta);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
