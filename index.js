const express = require("express");
const fs = require("fs");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Endpoint para autenticación inicial
app.get("/auth", async (req, res) => {
  const credentials = JSON.parse(fs.readFileSync("credentials.json"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/chat"],
  });

  res.redirect(authUrl);
});

// Callback que guarda el token
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  const credentials = JSON.parse(fs.readFileSync("credentials.json"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    res.send("✅ Autenticado correctamente. Token guardado.");
  } catch (err) {
    console.error("Error obteniendo token:", err);
    res.status(500).send("❌ Error autenticando.");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
