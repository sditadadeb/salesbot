const express = require("express");
const { google } = require("googleapis");
const open = require("open");
const fs = require("fs");
const app = express();

const CLIENT_ID = "TU_CLIENT_ID";
const CLIENT_SECRET = "TU_CLIENT_SECRET";
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

let tokenPath = "token.json";

// Paso inicial: iniciar auth
app.get("/auth", async (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/chat.bot", "https://www.googleapis.com/auth/chat.messages"],
  });
  await open(authUrl);
  res.send("Abriendo navegador para autenticar...");
});

// Redirección OAuth
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens));
  res.send("Autenticación exitosa. Podés cerrar esta pestaña.");
});

// Enviar mensaje a espacio o DM
app.get("/send", async (req, res) => {
  if (!fs.existsSync(tokenPath)) return res.send("Falta autenticar primero (/auth)");
  const tokens = JSON.parse(fs.readFileSync(tokenPath));
  oAuth2Client.setCredentials(tokens);

  const chat = google.chat({ version: "v1", auth: oAuth2Client });

  const result = await chat.spaces.messages.create({
    parent: "spaces/AAA... (reemplazar con el ID del espacio o DM)",
    requestBody: {
      text: "Hola desde el bot user real!",
    },
  });

  res.send("Mensaje enviado ✅");
});

app.listen(3000, () => console.log("Servidor escuchando en http://localhost:3000"));
