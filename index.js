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

app.get('/send', async (req, res) => {
  const spaceName = req.query.space;
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

// 🆕 Endpoint que responde a mensajes entrantes
app.post('/events', express.json(), (req, res) => {
  const event = req.body;

  console.log("📥 Evento completo recibido:\n", JSON.stringify(event, null, 2));

  const messageText = event.message?.argumentText || event.message?.text;
  const space = event.space;
  const thread = event.message?.thread?.name;
  const spaceType = space?.spaceType || space?.type;
  const sender = event.message?.sender?.displayName || 'usuario';

  if (!messageText) {
    console.warn("⚠️ Ignorando evento sin texto");
    return res.json({ text: "⚠️ No se recibió mensaje de texto." });
  }

  const replyText = `✅ Recibido, ${sender}. Tu mensaje fue: "${messageText}"`;

  if (spaceType === 'DIRECT_MESSAGE') {
    console.log("✉️ Respondemos en DM:", replyText);
    return res.json({ text: replyText });
  }

  if (spaceType === 'ROOM' || spaceType === 'SPACE') {
    console.log("✉️ Respondemos en espacio:", replyText, "Thread:", thread);
    return res.json({
      text: replyText,
      thread: thread ? { name: thread } : undefined
    });
  }

  console.warn("❗ Tipo de espacio no reconocido:", spaceType);
  res.status(200).send(); // Evita error de Google Chat
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
