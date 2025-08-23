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

// Rutas

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

// Endpoint que recibe eventos (DM o @mención)
app.post('/events', express.json(), (req, res) => {
  const event = req.body;
  console.log("📩 Evento recibido:", JSON.stringify(event, null, 2));

  const message = event.message?.argumentText || event.message?.text || '';
  const thread = event.message?.thread?.name;

  if (message) {
    const response = {
      text: `✅ Recibido: "${message}"`,
      ...(thread && { thread: { name: thread } })
    };
    return res.json(response);
  }

  res.json({ text: "⚠️ No se recibió mensaje de texto." });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
