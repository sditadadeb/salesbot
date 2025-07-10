from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

app = FastAPI()
logging.basicConfig(level=logging.DEBUG)

# ─── MIDDLEWARE CORS ──────────────────────────────────────────────────────────
# Permite peticiones desde cualquier origen (útil en desarrollo)
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

        # Ojo: el messagePayload está anidado en payload["chat"]
        mp = payload.get("chat", {}).get("messagePayload", {})
        space = mp.get("space", {})
        msg   = mp.get("message", {})

        logging.debug("   >> space object: %s", space)
        logging.debug("   >> raw message object: %s", msg)

        # Extraemos el argumento tras la mención
        raw_arg    = msg.get("argumentText", "")
        user_input = raw_arg.strip()
        logging.debug("   >> raw argumentText: %r", raw_arg)
        logging.debug("   >> extracted text: %r", user_input)

        # Detectar DM vs ROOM con hilos
        is_dm = space.get("spaceType") == "DIRECT_MESSAGE"
        state = space.get("spaceThreadingState")
        logging.debug("   >> is_dm: %s, spaceThreadingState: %r", is_dm, state)

        # Construir texto de respuesta
        reply_text = run_chain(user_input) if user_input else "No entendí tu mensaje."
        response = {"text": reply_text}

        # Sólo en ROOMS con hilos incluyo thread para responder en el hilo
        if not is_dm and state == "THREADED_MESSAGES":
            thread_name = msg.get("thread", {}).get("name")
            if thread_name:
                response["thread"] = {"name": thread_name}
                logging.debug("   >> añadido thread: %r", thread_name)

        logging.debug("DEBUG respuesta final a enviar: %s", response)
        return response

    except Exception:
        logging.exception("ERROR en /webhook:")
        return {"text": "Ocurrió un error procesando tu mensaje."}

@app.get("/")
async def health():
    return {"status": "ok"}
