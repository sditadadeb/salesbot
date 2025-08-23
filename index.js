const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

const SCOPES = [
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
];

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/oauth2callback`
);

let chat; // Cliente de Google Chat

// Intenta leer el token desde archivo
function authorizeWithSavedToken() {
  try {
    const token = fs.readFileSync('token.json');
    oAuth2Client.setCredentials(JSON.parse(token));
    chat = google.chat({ version: 'v1', auth: oAuth2Client });
    console.log("✅ Bot autenticado con token guardado");
  } catch (err) {
    console.log("❌ Token no encontrado. Ir a /auth para iniciar sesión");
  }
}

authorizeWithSavedToken();

// Rutas de autenticación
app.get('/', (req, res) => {
  res.send('🟢 Bot corriendo. Ir a /auth para autenticarse.');
});

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No se recibió código');

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync('token.json', JSON.stringify(tokens));
    chat = google.chat({ version: 'v1', auth: oAuth2Client });
    console.log("✅ Token guardado correctamente");
    res.send('✅ Autenticación exitosa. Ya podés usar el bot.');
  } catch (error) {
    console.error('❌ Error al intercambiar código:', error);
    res.status(500).send('Error al autenticar');
  }
});

// Endpoint para enviar mensaje manual
app.get('/send', async (req, res) => {
  const spaceName = req.query.space; // Ejemplo: spaces/AAA...
  const text = req.query.text || 'Hola desde el bot!';
  if (!spaceName) return res.status(400).send('Falta parámetro ?space=');

  try {
    const response = await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: { text },
    });
    res.send(`✅ Mensaje enviado a ${spaceName}: ${text}`);
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error);
    res.status(500).send("Error al enviar mensaje");
  }
});

// Endpoint para ver los spaces a los que pertenece
app.get('/spaces', async (req, res) => {
  try {
    const result = await chat.spaces.list();
    const spaces = result.data.spaces || [];
    res.json(spaces);
  } catch (error) {
    console.error("❌ Error al listar spaces:", error);
    res.status(500).send("Error al obtener spaces");
  }
});

// ================== POLLING AUTOMÁTICO ==================
const lastTimestamps = {};

async function pollMessages() {
  const spaceId = process.env.SPACE_ID;
  if (!spaceId || !chat) return;

  try {
    const response = await chat.spaces.messages.list({ parent: spaceId });
    const messages = response.data.messages || [];

    for (const msg of messages.reverse()) {
      const senderEmail = msg.sender?.email;
      const text = msg.text;
      const time = msg.createTime;

      if (
        !text ||
        senderEmail === 'bot@numia.co' ||
        (lastTimestamps[spaceId] && time <= lastTimestamps[spaceId])
      ) continue;

      lastTimestamps[spaceId] = time;

      console.log(`📩 Nuevo mensaje en ${spaceId}: ${text} (de ${senderEmail})`);

      await chat.spaces.messages.create({
        parent: spaceId,
        requestBody: {
          text: `✅ Recibido: "${text}"`
        }
      });

      console.log(`📤 Respondido a ${senderEmail}`);
    }
  } catch (err) {
    console.error('❌ Error en polling de mensajes:', err.message);
  }
}

setInterval(pollMessages, 10000); // cada 10s

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
