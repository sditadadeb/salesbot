// Solo muestro las partes que cambian...

// ---------------------- Memoria local por sesión ----------------------
const mem = new Map(); 
const sessionMetadata = new Map(); 
const sessionIdMapping = new Map(); // NUEVO: mapeo de nuestro ID -> Langflow ID

function mapToLangflowSession(ourSessionId, langflowSessionId) {
  if (langflowSessionId && langflowSessionId !== ourSessionId) {
    sessionIdMapping.set(ourSessionId, langflowSessionId);
    log("debug", "session.mapped", { ourSessionId, langflowSessionId });
  }
}

function getLangflowSessionId(ourSessionId) {
  return sessionIdMapping.get(ourSessionId) || ourSessionId;
}

// Modificar callLangflow para usar el session_id correcto:
async function callLangflow(userText, sessionId, reqId) {
  const url = buildLangflowRunUrl();
  if (!url) throw new Error("LANGFLOW_HOST / LANGFLOW_FLOW_ID no configuradas");

  // Usar el session_id que Langflow conoce
  const langflowSessionId = getLangflowSessionId(sessionId);

  let finalInput = userText;
  if (USE_HYBRID_MEMORY && !DISABLE_LOCAL_MEMORY) {
    const context = renderHistoryForLangflow(sessionId);
    if (context) {
      finalInput = context + "Pregunta actual: " + userText;
    }
  }

  const payload = {
    input_value: finalInput,
    output_type: "chat", 
    input_type: "chat",
    session_id: langflowSessionId, // USAR EL ID CORRECTO
    tweaks: {}
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-key": process.env.LANGFLOW_API_KEY || "",
  };

  let lastErr;
  const attempts = LANGFLOW_RETRIES + 1;

  for (let i = 1; i <= attempts; i++) {
    log("debug", "langflow.request", {
      reqId, attempt: `${i}/${attempts}`,
      url, timeoutMs: LANGFLOW_TIMEOUT_MS,
      ourSessionId: sessionId,
      langflowSessionId, // MOSTRAR AMBOS IDs
      originalInput: truncate(userText, 200),
      finalInputPreview: truncate(finalInput, 400),
      hasContext: finalInput !== userText,
      historyLength: getHistory(sessionId).length,
      hasApiKey: !!process.env.LANGFLOW_API_KEY,
    });

    try {
      const resp = await fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(payload) },
        LANGFLOW_TIMEOUT_MS
      );

      const contentType = resp.headers.get("content-type") || "";
      const raw = await resp.text();

      log("debug", "langflow.response", {
        reqId, attempt: `${i}/${attempts}`,
        status: resp.status, ok: resp.ok, contentType,
        raw: truncate(raw, 800),
      });

      if (!resp.ok) {
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        } else {
          throw new Error(`Langflow HTTP ${resp.status}: ${truncate(raw, 300)}`);
        }
      } else {
        const looksHtml = /^\s*</.test(raw) || contentType.includes("text/html");
        const looksJson = contentType.includes("application/json");
        if (looksHtml || (!looksJson && !raw.trim().startsWith("{") && !raw.trim().startsWith("["))) {
          log("warn", "langflow.non_json_response", { reqId, contentType, rawPreview: truncate(raw, 200) });
          return "";
        }
        let json;
        try { json = JSON.parse(raw); }
        catch {
          log("warn", "langflow.parse_failed", { reqId, rawPreview: truncate(raw, 200) });
          return "";
        }

        // CAPTURAR Y MAPEAR EL SESSION_ID QUE DEVUELVE LANGFLOW
        const returnedSessionId = json.session_id;
        if (returnedSessionId && returnedSessionId !== sessionId) {
          mapToLangflowSession(sessionId, returnedSessionId);
          log("info", "langflow.session_mapped", { 
            reqId, ourSessionId: sessionId, langflowSessionId: returnedSessionId 
          });
        }

        const out = (pickTextFromLangflow(json) || "").trim();
        log("debug", "langflow.extracted", { reqId, sessionId, outPreview: truncate(out, 300) });
        return out;
      }
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const abortLike = /aborted|timeout|The operation was aborted|This operation was aborted/i.test(msg);
      log("warn", "langflow.attempt_failed", { reqId, attempt: `${i}/${attempts}`, sessionId, error: msg });

      if (abortLike || (lastErr && /Langflow HTTP (5\d\d|429)/.test(String(lastErr.message)))) {
        if (i < attempts) {
          const delay = Math.min(3000 * i, 8000);
          log("info", "langflow.retrying_after_backoff", { reqId, sessionId, inMs: delay });
          await sleep(delay);
          continue;
        }
      }
      break;
    }
  }
  throw lastErr || new Error("Langflow no respondió");
}

// Actualizar el endpoint de debug para mostrar el mapeo:
app.get("/sessions", (req, res) => {
  const sessions = {};
  for (const [sessionId, history] of mem.entries()) {
    const metadata = getSessionMetadata(sessionId);
    const langflowSessionId = getLangflowSessionId(sessionId);
    sessions[sessionId] = {
      messageCount: history.length,
      conversationTurns: Math.ceil(history.length / 2),
      langflowSessionId: langflowSessionId !== sessionId ? langflowSessionId : null, // Solo mostrar si es diferente
      created: new Date(metadata.created || 0).toISOString(),
      lastUsed: new Date(metadata.lastUsed || 0).toISOString(),
      isDM: metadata.isDM,
      threadName: metadata.threadName ? truncate(metadata.threadName, 50) : null,
      userEmail: metadata.userEmail ? metadata.userEmail.substring(0, 15) + "..." : null,
      lastMessages: history.slice(-4).map(m => `${m.role}: ${truncate(m.text, 60)}`)
    };
  }
  res.json({
    totalSessions: mem.size,
    timeoutMs: LANGFLOW_TIMEOUT_MS,
    hybridMemory: USE_HYBRID_MEMORY,
    maxHistoryTurns: HISTORY_TURNS,
    sessionMappings: Object.fromEntries(sessionIdMapping),
    sessions
  });
});
