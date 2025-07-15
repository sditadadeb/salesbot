from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("sales-bot")

app = FastAPI()

# CORS (no necesario para Google Chat, pero útil para pruebas locales)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí iría tu lógica de negocio o LLM
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # extraemos messagePayload (para Chats nuevos) o directo del payload
    event = payload.get("messagePayload", payload)

    # espacio y mensaje
    space = event.get("space", {})
    message = event.get("message")
    if not message:
        logger.debug("❗ No hay campo 'message' en el payload, ignorando evento.")
        return {}  # responde 200 OK vacío

    # limpiamos el texto de la mención
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()

    # hilo
    thread = message.get("thread", {})
    thread_name = thread.get("name")

    # detectamos DM vs ROOM con hilos
    is_dm = (space.get("type") == "DIRECT_MESSAGE")
    threading_state = space.get("spaceThreadingState")

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> texto limpio: '%s'", argument)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s",
                 is_dm, threading_state, thread_name)

    # generamos respuesta
    response_text = run_chain(argument or "<vacío>")
    response_payload = {"text": response_text}

    # si es sala con hilos, devolvemos en el mismo hilo
    if not is_dm and threading_state == "THREADED_MESSAGES" and thread_name:
        response_payload["thread"] = {"name": thread_name}

    logger.debug("DEBUG respuesta final a enviar: %s", response_payload)
    return response_payload

if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
