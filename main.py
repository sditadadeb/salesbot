from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

app = FastAPI()
logging.basicConfig(level=logging.DEBUG)

# CORS middleware
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
    try:
        payload = await request.json()
        logging.debug("🔔 Payload recibido: %s", payload)

        # Extraer datos
        space = payload["messagePayload"]["space"]
        msg = payload["messagePayload"]["message"]
        raw_arg = msg.get("argumentText", "")
        user_input = raw_arg.strip()
        logging.debug("   >> raw argumentText: %r", raw_arg)
        logging.debug("   >> extracted text: %r", user_input)

        # Determinar si es DM o ROOM threading
        is_dm = space["spaceType"] == "DIRECT_MESSAGE"
        state = space.get("spaceThreadingState")
        logging.debug("   >> is_dm: %s, spaceThreadingState: %r", is_dm, state)

        # Construir respuesta
        reply_text = run_chain(user_input) if user_input else "No entendí tu mensaje."
        response = {"text": reply_text}
        logging.debug("   >> base response: %s", response)

        # Solo en ROOMS con hilos incluir thread
        if not is_dm and state == "THREADED_MESSAGES":
            thread_name = msg["thread"]["name"]
            response["thread"] = {"name": thread_name}
            logging.debug("   >> añadido thread: %r", thread_name)

        # Devolver solo el JSON necesario
        return response

    except Exception as e:
        logging.exception("ERROR en /webhook:")
        return {"text": "Ocurrió un error procesando tu mensaje."}

@app.get("/")
async def health():
    return {"status": "ok"}
