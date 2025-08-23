
const express = require("express");
const { google } = require("googleapis");
const open = require("open");
const fs = require("fs");

const app = express();

// ⚠️ Reemplazá estos valores con los de tu consola de Google
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "https://bot-con-credencial.onrender.com/oauth2callback";

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Ruta para iniciar la autenticación
app.get("/auth", async (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/chat.bot", "https://www.googleapis.com/auth/chat"],
    prompt: "consent",
  });
  res.redirect(authUrl);
});

// Ruta para recibir el token tras autorizar
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("No se encontró el código de autorización");
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Guarda el token para uso futuro
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    res.send("Autenticado correctamente ✅. Token guardado.");
  } catch (error) {
    console.error("Error al obtener token:", error);
    res.status(500).send("Error al obtener token");
  }
});

// Ruta de prueba: lee mensajes de Google Chat
app.get("/test", async (req, res) => {
  try {
    const token = JSON.parse(fs.readFileSync("token.json"));
    oAuth2Client.setCredentials(token);

    const chat = google.chat({ version: "v1", auth: oAuth2Client });

    const result = await chat.spaces.list(); // ejemplo: listar espacios
    res.json(result.data);
  } catch (error) {
    console.error("Error al llamar a la API de Chat:", error);
    res.status(500).send("Error al llamar a la API");
  }
});

// 🚀 Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
