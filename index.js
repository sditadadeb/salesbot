const express = require('express');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Bot operativo ✅');
});

app.post('/', (req, res) => {
  console.log('📥 Evento recibido:', JSON.stringify(req.body, null, 2));

  const message = req.body?.chat?.messagePayload?.message;
  const thread = message?.thread?.name;
  const text = message?.text || message?.argumentText || '';

  if (!message) {
    console.warn('⚠️ Ignorando evento sin mensaje.');
    return res.status(200).send();
  }

  const respuesta = {
    text: `recibido. tu mensaje fue: "${text.trim()}"`
  };

  if (thread) {
    respuesta.thread = { name: thread };
  }

  console.log('📤 Respondiendo:', JSON.stringify(respuesta, null, 2));
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(respuesta);
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
