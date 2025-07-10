from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS (útil para pruebas locales, si no lo necesitas puedes eliminarlo)
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
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # Aseguramos que venga messagePayload con space y message
    mp = payload.get("messagePayload")
    if not mp:
        logger.debug("❗ No hay 'messagePayload' en el payload, retornando vacío.")
        return {}

    space = mp.get("space")
    message = mp.get("message")
    if not space or not message:
        logger.debug("❗ Faltan 'space' o 'message' dentro de messagePayload, retornando vacío.")
        return {}

    # Extraemos texto ya limpio de la mención
    user_input = message.get("argumentText", message.get("text", "")).strip()
    if not user_input:
        logger.debug("❗ 'argumentText' vacío, pidiendo repetir.")
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # Generamos respuesta
    reply_text = run_chain(user_input)
    response = {"text": reply_text}

    # Si estamos en un ROOM con threading habilitado, devolvemos en el hilo
    if space.get("type") == "ROOM" and space.get("spaceThreadingState") == "THREADED_MESSAGES":
        thread = message.get("thread", {})
        thread_name = thread.get("name")
        if thread_name:
            response["thread"] = {"name": thread_name}

    logger.debug("✅ Respuesta a enviar: %s", response)
    return response

if __name__ == "__main__":
    import os, uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
