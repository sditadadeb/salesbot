const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bot de Google Chat activo');
});

app.post('/', (req, res) => {
  console.log('📥 Nueva solicitud POST recibida');
  console.log('🧾 Cuerpo completo:', JSON.stringify(req.body, null, 2));

  // Detectamos de dónde viene el mensaje según la estructura
  const text = req.body.message?.text
    || req.body.chat?.messagePayload?.message?.text
    || '';
  const user = req.body.message?.sender?.displayName
    || req.body.chat?.user?.displayName
    || 'usuario desconocido';

  const respuesta = {
    text: `recibido. tu mensaje fue: "${text}"`
  };

  console.log(`📤 Enviando respuesta a ${user}:`, respuesta);

  res.json(respuesta);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
