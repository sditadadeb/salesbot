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

let chat;
let lastTimestamp = null;

// =======================
// 🔐 Autenticación
// =======================
function authorizeWithSavedToken() {
  try {
    const token = fs.readFileSync('token.json');
    oAuth2Client.setCredentials(JSON.parse(token));
    chat = google.chat({ version: 'v1', auth: oAuth2Client });
    console.log("✅ Bot autenticado correctamente");
  } catch {
    console.log("❌ Token no encontrado. Ir a /auth para autenticar");
  }
}

// =======================
// 🕒 Timestamp persistente
// =======================
const TIMESTAMP_FILE = 'last_seen.json';

function loadLastTimestamp() {
  try {
    const data = JSON.parse(fs.readFileSync(TIMESTAMP_FILE, 'utf-8'));
    lastTimestamp = data.lastSeen;
    console.log(`🕓 Último mensaje visto: ${lastTimestamp}`);
  } catch {
    console.log("🕓 No hay timestamp previo, iniciando desde cero");
    lastTimestamp = null;
  }
}

function saveLastTimestamp(ts) {
  fs.writeFileSync(TIMESTAMP_FILE, JSON.stringify({ lastSeen: ts }), 'utf-8');
  lastTimestamp = ts;
}

// =======================
// 🔁 Polling de mensajes nuevos
// =======================
async function pollForMessages() {
  if (!process.env.SPACE_ID) {
    console.warn("⚠️ Falta SPACE_ID en .env");
    return;
  }

  try {
    const url = `https://chat.googleapis.com/v1/${process.env.SPACE_ID}/messages`;
    const res = await oAuth2Client.request({ url });
    const messages = res.data.messages || [];

    for (const msg of messages.reverse()) {  // más antiguos primero
      const { text, sender, createTime, name, thread } = msg;

      if (!text || sender?.email === 'bot@numia.co') continue;
      if (lastTimestamp && createTime <= lastTimestamp) continue;

      console.log(`📩 Nuevo mensaje: "${text}" de ${sender?.email} (${createTime})`);

      await chat.spaces.messages.create({
        parent: process.env.SPACE_ID,
        requestBody: {
          text: `✅ Recibido: "${text}"`,
          ...(thread ? { thread: { name: thread.name } } : {})
        },
      });

      console.log("📤 Respuesta enviada");
      saveLastTimestamp(createTime);
    }

  } catch (error) {
    console.error("❌ Error en polling:", error.message || error);
  }
}

setInterval(() => {
  console.log('🔄 Ejecutando polling...');
  pollForMessages();
}, 5000);

// =======================
// Rutas públicas
// =======================
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
    console.error('❌ Error al autenticar:', error);
    res.status(500).send('Error al autenticar');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
