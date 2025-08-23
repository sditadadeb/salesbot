const express = require("express");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error("❌ Faltan variables de entorno: CLIENT_ID, CLIENT_SECRET o REDIRECT_URI");
  process.exit(1);
}

// Inicializa cliente OAuth2
const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const TOKEN_PATH = path.join(__dirname, "token.json");

// Intenta cargar el token desde archivo
function loadToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    console.log("✅ Token cargado");
    return true;
  } else {
    console.log("📭 No hay token.json aún. Visitá /auth para autorizar.");
    return false;
  }
}

// Ruta para iniciar autenticación
app.get("/auth", (req, res) => {
  const SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/chat.bot",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.messages.create"
  ];

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  res.redirect(authUrl);
});

// Callback de OAuth
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Falta el código de autorización.");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log("✅ Token guardado en token.json");
    res.send("Autenticación completada. Podés cerrar esta pestaña.");
  } catch (err) {
    console.error("❌ Error al obtener token:", err);
    res.status(500).send("Error al obtener el token.");
  }
});

// Ruta de prueba protegida (usá esto para probar lectura Gmail u otros)
app.get("/test", async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.send("Token no encontrado. Visitá /auth primero.");
  }

  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const result = await gmail.users.messages.list({ userId: "me", maxResults: 5 });

    res.send(result.data.messages || "No hay mensajes.");
  } catch (err) {
    console.error("❌ Error al llamar a Gmail API:", err);
    res.status(500).send("Error al usar Gmail API.");
  }
});

// Inicia servidor
app.listen(PORT, () => {
  loadToken();
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
