const express = require('express');
const app = express();

app.use(express.json());

// Ruta GET de prueba (opcional)
app.get('/', (req, res) => {
  res.send('Bot de Google Chat activo');
});

// Ruta POST para mensajes desde Google Chat
app.post('/', (req, res) => {
  const body = req.body;

  console.log('📥 Nueva solicitud POST recibida');
  console.log('🧾 Cuerpo completo:', JSON.stringify(body, null, 2));

  const text = body.message?.text || '';
  const user = body.message?.sender?.displayName || 'usuario desconocido';

  const respuesta = {
    text: `recibido. tu mensaje fue: "${text}"`,
  };

  console.log(`📤 Enviando respuesta a ${user}:`, respuesta);

  res.json(respuesta);
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
