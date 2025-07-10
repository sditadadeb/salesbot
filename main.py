from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging
import json

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("sales-bot")

app = FastAPI()

# Health check rápido
@app.get("/")
async def healthz():
    logger.debug("🏥 Health check OK")
    return {"status": "ok"}

# CORS (útil para pruebas locales, no rompe Google Chat)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    # 1) Leer y loguear body crudo
    raw_body = await request.body()
    logger.debug("🔔 Raw body: %s", raw_body.decode(errors="ignore"))

    # 2) Intentar parsear JSON
    try:
        payload = json.loads(raw_body)
    except Exception as e:
        logger.error("❌ No pude parsear JSON: %s", e)
        return {"text": "Error interno de formato"}

    logger.debug("🔔 Payload parseado: %s", payload)

    # 3) Unificar estructura (messagePayload vs root)
    mp = payload.get("messagePayload", {})
    space = mp.get("space") or payload.get("space", {})
    message = mp.get("message") or payload.get("message", {})

    if not message:
        logger.debug("❗ Sin campo 'message', saliendo OK sin respuesta.")
        return {}

    # 4) Extraer texto limpio y threading
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()

    thread = message.get("thread", {})
    thread_name = thread.get("name")

    is_dm = space.get("type") == "DIRECT_MESSAGE"
    threading_state = space.get("spaceThreadingState")

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> argumento extraído: '%s'", argument)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s", is_dm, threading_state, thread_name)

    # 5) Generar y devolver respuesta
    response_text = run_chain(argument or "<vacío>")
    response = {"text": response_text}

    # en rooms con hilos, responder en el mismo hilo
    if not is_dm and threading_state == "THREADED_MESSAGES" and thread_name:
        response["thread"] = {"name": thread_name}

    logger.debug("✅ Respuesta a enviar: %s", response)
    return response

if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
