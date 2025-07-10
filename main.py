from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

# --- Configuración de logging ---
logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s:%(message)s")
logger = logging.getLogger("sales-bot")

# --- Inicialización de FastAPI ---
app = FastAPI()

# CORS (solo para pruebas locales, no necesario en producción de Google Chat)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    """Simula tu pipeline de generación de respuesta."""
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    # 1) Leer payload
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # 2) Unificar: algunos eventos vienen en payload["messagePayload"]
    event = payload.get("messagePayload", payload)
    space = event.get("space") or payload.get("space")
    message = event.get("message") or payload.get("message")

    # 3) Si no es un evento de mensaje, ignoramos
    if not message:
        logger.debug("❗ No hay campo 'message' en el payload, ignorando evento.")
        return {}

    # 4) Extraer texto, hilo y tipo de espacio
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()

    thread = message.get("thread", {}) or {}
    thread_name = thread.get("name")

    is_dm = space.get("type") == "DIRECT_MESSAGE"
    threading_state = space.get("spaceThreadingState")

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> texto limpio: '%s'", argument)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s", is_dm, threading_state, thread_name)

    # 5) Generar respuesta
    response_text = run_chain(argument or "<vacío>")
    response_payload = {
        "text": response_text,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }

    # 6) Si estamos en un ROOM con hilos, respondemos en el hilo
    if not is_dm and threading_state == "THREADED_MESSAGES" and thread_name:
        response_payload["thread"] = {"name": thread_name}

    logger.debug("✅ Respuesta a enviar: %s", response_payload)
    return response_payload

# --- Entrypoint para ejecución local ---
if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
