from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("sales-bot")

app = FastAPI()

# ➊ CORS habilitado para permitir pruebas desde cualquier origen
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # en prod, restringe aquí a tus dominios
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # ➋ Extraer siempre chat.messagePayload si existe
    chat = payload.get("chat", {})
    mp = chat.get("messagePayload")
    if mp:
        space   = mp.get("space", {})
        message = mp.get("message", {})
    else:
        # Fallback para otros casos
        mp = payload.get("messagePayload", {})
        space   = mp.get("space", {}) or payload.get("space", {})
        message = mp.get("message", {}) or payload.get("message", {})

    # ➌ Si no tenemos un mensaje, respondemos 200 OK sin cuerpo
    if not message:
        logger.debug("❗ No hay campo 'message' en el payload, ignorando evento.")
        return {}

    # ➍ Limpiar la @mención
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()

    # ➎ Detectar hilo y DM
    thread      = message.get("thread", {})
    thread_name = thread.get("name")
    is_dm       = space.get("type") == "DIRECT_MESSAGE"
    threading   = space.get("spaceThreadingState")

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> texto limpio: '%s'", argument)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s", is_dm, threading, thread_name)

    # ➏ Generar respuesta
    response_text = run_chain(argument or "<vacío>")
    response_payload = {"text": response_text}

    # ➐ Si estamos en ROOM y con hilos, respondemos en el mismo hilo
    if not is_dm and threading == "THREADED_MESSAGES" and thread_name:
        response_payload["thread"] = {"name": thread_name}

    logger.debug("DEBUG respuesta final a enviar: %s", response_payload)
    return response_payload

if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
