const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

app.post('/', (req, res) => {
  const body = req.body;

  console.log('📥 Evento recibido:', JSON.stringify(body, null, 2));

  // Tipo de evento
  const message = body?.chat?.message;
  const thread = message?.thread?.name;
  const text = message?.argumentText || message?.text || '';
  const sender = message?.sender?.displayName || 'usuario';

  const response = {
    text: `recibido. tu mensaje fue: "${text}"`,
  };

  if (thread) {
    response.thread = { name: thread };
  }

  console.log('📤 Respondiendo con:', response);
  res.status(200).json(response);
});

// Endpoint opcional para pruebas
app.get('/', (req, res) => {
  res.send('✅ Bot en línea');
});

app.listen(PORT, () => {
  console.log(`Bot escuchando en puerto ${PORT}`);
});
