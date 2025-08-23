// index.js
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Middleware -------------------------------------------------------------
app.set('trust proxy', true);
app.use(bodyParser.json({ limit: '1mb' }));

// Log de todas las requests (método, path, UA, headers clave)
app.use((req, _res, next) => {
  console.log('────────────────────────────────────────────────────────');
  console.log(`📨 ${req.method} ${req.originalUrl}`);
  console.log(`🧑‍💻 IP: ${req.ip} | UA: ${req.headers['user-agent']}`);
  console.log(`🔖 Content-Type: ${req.headers['content-type']}`);
  next();
});

// --- Utilidades -------------------------------------------------------------

/**
 * Normaliza el evento para extraer texto, spaceType y threadName
 * Soporta:
 *  1) Formato clásico de Chat bots: { type, message, space, user, ... }
 *  2) Formato nuevo (lo que viste): { commonEventObject, chat:{ messagePayload:{ message, space, ... } } }
 */
function extractMessageInfo(body) {
  // 1) Formato clásico
  if (body && (body.type || body.message)) {
    const space = body.space || body.message?.space;
    const spaceType = space?.type || space?.spaceType; // algunos envían "SPACE"/"ROOM" vs "DM"/"DIRECT_MESSAGE"
    const text = body.message?.argumentText || body.message?.text || '';
    const threadName = body.message?.thread?.name;
    return {
      text,
      spaceType,
      threadName,
      rawSpace: space,
    };
  }

  // 2) Formato nuevo (el que tenías en logs con "commonEventObject" y "chat.messagePayload")
  const msg = body?.chat?.messagePayload?.message;
  const space = body?.chat?.messagePayload?.space;
  if (msg || space) {
    const text = msg?.argumentText || msg?.text || body?.chat?.messagePayload?.argumentText || '';
    const spaceType = space?.spaceType || space?.type;
    const threadName = msg?.thread?.name;
    return {
      text,
      spaceType,
      threadName,
      rawSpace: space,
    };
  }

  // 3) Nada reconocible
  return { text: '', spaceType: undefined, threadName: undefined, rawSpace: undefined };
}

/**
 * Decide si es DM (mensaje directo) según los campos que pueda traer cada formato.
 */
function isDirect(spaceType, rawSpace) {
  if (!spaceType && rawSpace?.singleUserBotDm) return true;
  const t = (spaceType || '').toUpperCase();
  return t === 'DM' || t === 'DIRECT_MESSAGE';
}

/**
 * Arma el texto "recibido..." sanitizado.
 */
function buildEcho(text) {
  const trimmed = String(text || '').trim();
  return `recibido. tu mensaje fue: "${trimmed}"`;
}

// --- Rutas ------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.status(200).send('🟢 Webhook de Google Chat OK. Usa POST /events');
});

// Healthcheck opcional (algunos balanceadores lo piden)
app.get('/_ah/health', (_req, res) => res.status(200).send('ok'));

/**
 * Endpoint que recibe eventos de Google Chat
 * Configurá esta URL en: Google Chat API → Configuración → Activadores → URL de extremo HTTP → https://TU-RENDER.onrender.com/events
 */
app.post('/events', (req, res) => {
  try {
    console.log('📥 Cuerpo recibido:\n', JSON.stringify(req.body, null, 2));

    const { text, spaceType, threadName, rawSpace } = extractMessageInfo(req.body);
    console.log(`🔎 Normalizado → text="${text}", spaceType="${spaceType}", thread="${threadName}"`);

    if (!text) {
      console.warn('⚠️ Evento sin texto/argumentText. Respondo 200 sin cuerpo.');
      return res.status(200).send(); // importante: 200 para que Chat no reintente
    }

    const responseText = buildEcho(text);

    // Decidir respuesta: si es DM, respondemos plano; si es espacio, respondemos en el mismo hilo
    let responseBody;
    if (isDirect(spaceType, rawSpace)) {
      responseBody = { text: responseText };
      console.log('📤 Respondiendo (DM):', JSON.stringify(responseBody));
      return res.status(200).json(responseBody);
    }

    // Espacio/room/space → intentar responder en el mismo hilo si existe
    responseBody = threadName
      ? { text: responseText, thread: { name: threadName } }
      : { text: responseText };

    console.log('📤 Respondiendo (SPACE):', JSON.stringify(responseBody));
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error('💥 Error manejando evento:', err);
    // Aun con error, devolvemos 200 para evitar reintentos infinitos
    return res.status(200).send();
  }
});

// --- Arranque ---------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
  console.log(`👉 Configurá Google Chat API → Activadores → URL: https://<tu-dominio-render>/events`);
});
