const express = require('express');
const app = express();
app.use(express.json());

app.post('/', (req, res) => {
  const text = req.body.message?.text || '';
  console.log('Mensaje recibido:', text);

  res.json({
    text: `recibido. tu mensaje fue: "${text}"`
  });
});

// 🔥 ESTA PARTE ES CRUCIAL EN RENDER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot escuchando en puerto ${PORT}`);
});
