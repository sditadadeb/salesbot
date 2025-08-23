const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());

app.post('/', (req, res) => {
  console.log('📥 Evento recibido:', JSON.stringify(req.body, null, 2));

  const message = req.body?.chat?.message;
  const space = message?.space;
  const spaceType = space?.spaceType;
  const messageText = message?.text;

  if (!messageText) {
    console.warn('⚠️ Ignorando evento sin mensaje.');
    return res.status(200).send(); // Respondemos 200 igual para evitar errores en Google Chat
  }

  const responseText = `recibido. tu mensaje fue: "${messageText}"`;

  // Si es un mensaje directo (DM), no incluimos thread
  if (spaceType === 'DIRECT_MESSAGE') {
    console.log('📤 Respondiendo en DM:', responseText);
    return res.json({
      text: responseText
    });
  }

  // Si es un espacio (grupo), respondemos en el mismo thread
  if (spaceType === 'SPACE' || spaceType === 'ROOM') {
    const threadName = message?.thread?.name;
    console.log('📤 Respondiendo en espacio:', responseText, 'Thread:', threadName);

    return res.json({
      text: responseText,
      thread: {
        name: threadName
      }
    });
  }

  console.warn('⚠️ Tipo de espacio no reconocido:', spaceType);
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en puerto ${PORT}`);
});
