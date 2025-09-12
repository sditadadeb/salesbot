const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

// Almacén de memoria local por sesión
const memoryStore = new Map(); // sessionId -> [messages]

app.use(express.json());

function getSessionId(space, message, isDM) {
    const thread = message?.thread;
    const threadName = thread?.name;
    
    if (threadName) {
        return `thread:${threadName}`;
    }
    
    if (isDM) {
        const userEmail = message?.sender?.email || "unknown";
        return `dm:${userEmail}`;
    }
    
    const spaceName = space?.name || "unknown";
    return `space:${spaceName}:default`;
}

function getConversationHistory(sessionId, maxTurns = 8) {
    const history = memoryStore.get(sessionId) || [];
    
    if (!history.length) return "";
    
    const recentHistory = maxTurns > 0 ? history.slice(-maxTurns * 2) : history;
    
    return recentHistory
        .map(entry => `${entry.role === 'user' ? 'USUARIO' : 'BOT'}: ${entry.text}`)
        .join('\n');
}

function addToHistory(sessionId, role, text) {
    if (!memoryStore.has(sessionId)) {
        memoryStore.set(sessionId, []);
    }
    
    const history = memoryStore.get(sessionId);
    history.push({
        role,
        text,
        timestamp: new Date().toISOString()
    });
    
    // Mantener solo los últimos 20 mensajes
    if (history.length > 20) {
        history.splice(0, history.length - 20);
    }
}

function runChain(userInput, sessionId) {
    const history = getConversationHistory(sessionId);
    
    let response = `Sales Bot responde (Sesión: ${sessionId.substring(0, 8)}...): ${userInput}`;
    
    if (history) {
        const messageCount = (memoryStore.get(sessionId) || []).length;
        response += ` [Recordando ${messageCount} mensajes anteriores]`;
    }
    
    return response;
}

app.post("/webhook", (req, res) => {
    const payload = req.body;
    console.log("🔔 Payload recibido:", JSON.stringify(payload, null, 2));

    const event = payload?.messagePayload || payload;
    const space = event?.space || {};
    const message = event?.message;

    if (!message) {
        console.log("❗ No hay mensaje, ignorando evento");
        return res.json({});
    }

    const sender = message?.sender || {};
    const userEmail = sender?.email || "unknown";
    const argument = (message?.argumentText || message?.text || "").trim();
    const thread = message?.thread || {};
    const threadName = thread?.name;
    const isDM = space?.type === "DIRECT_MESSAGE";
    const threadingState = space?.spaceThreadingState;

    // Generar ID de sesión estable
    const sessionId = getSessionId(space, message, isDM);

    console.log(`   >> Sesión ID: ${sessionId}`);
    console.log(`   >> Usuario: ${userEmail}`);
    console.log(`   >> Texto: '${argument}'`);

    // Añadir al historial
    addToHistory(sessionId, "user", argument || "<vacío>");

    // Generar respuesta
    const responseText = runChain(argument || "<vacío>", sessionId);
    
    // Añadir respuesta al historial
    addToHistory(sessionId, "bot", responseText);

    // Construir respuesta
    const responsePayload = { text: responseText };

    if (!isDM && threadingState === "THREADED_MESSAGES" && threadName) {
        responsePayload.thread = { name: threadName };
    }

    console.log("DEBUG respuesta final:", responsePayload);
    res.json(responsePayload);
});

// Endpoints de debug
app.get("/sessions", (req, res) => {
    const sessionsInfo = {};
    for (const [sessionId, history] of memoryStore.entries()) {
        sessionsInfo[sessionId] = {
            messageCount: history.length,
            lastMessage: history.length > 0 ? history[history.length - 1].timestamp : null
        };
    }
    res.json(sessionsInfo);
});


// Egress IP (para allowlist en Langflow)
app.get("/egress", async (req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    log("info", "egress.ip", { ip: j.ip });
    res.json(j);
  } catch (e) {
    log("warn", "egress.ip.failed", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.get("/session/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId;
    res.json({
        sessionId,
        history: memoryStore.get(sessionId) || []
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
