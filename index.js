const express = require('express');
const app = express();

app.use(express.json());

// Ruta principal que responde a Google Chat
app.post('/', (req, res) => {
  const { message } = req.body;

  if (message && message.text) {
    console.log('Mensaje recibido:', message.text);
  }

  res.json({
    text: 'recibido'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));
