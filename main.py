from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

# ─── Configuración de logging ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(message)s",
)

app = FastAPI()

# ─── MIDDLEWARE CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # en producción restringe a tu dominio
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
        logging.debug("🔔 Payload completo recibido: %s", payload)

        # ─── Extracción segura de campos ─────────────────────────────────────────
        chat = payload.get("chat", {})
        mp   = chat.get("messagePayload", {})
        space = mp.get("space", {})
        msg   = mp.get("message", {})

        logging.debug("   >> space object: %s", space)
        logging.debug("   >> raw message object: %s", msg)

        # ─── Procesar contenido del mensaje ──────────────────────────────────────
        raw_arg    = msg.get("argumentText", None)
        if raw_arg is None:
            logging.warning("   >> argumentText no encontrado en el mensaje")
            return {"text": "No entendí tu mensaje (falta argumentText)."}

        user_input = raw_arg.strip()
        logging.debug("   >> raw argumentText: %r", raw_arg)
        logging.debug("   >> extracted user_input: %r", user_input)

        # ─── Detectar contexto ───────────────────────────────────────────────────
        is_dm = space.get("spaceType") == "DIRECT_MESSAGE"
        threading_state = space.get("spaceThreadingState")
        logging.debug("   >> is_dm: %s, threading_state: %r", is_dm, threading_state)

        # ─── Preparar respuesta ──────────────────────────────────────────────────
        if user_input:
            reply_text = run_chain(user_input)
        else:
            reply_text = "No entendí tu mensaje. ¿Podés repetirlo?"
        logging.info("   >> reply_text generado: %r", reply_text)

        response = {"text": reply_text}

        # ─── Si es ROOM con hilos, incluimos thread en la respuesta ─────────────
        if not is_dm and threading_state == "THREADED_MESSAGES":
            thread_obj = msg.get("thread")
            if thread_obj and "name" in thread_obj:
                response["thread"] = {"name": thread_obj["name"]}
                logging.debug("   >> añadido thread.name: %r", thread_obj["name"])
            else:
                logging.debug("   >> no se encontró 'thread.name' para adjuntar")

        logging.debug("DEBUG respuesta final a enviar: %s", response)
        return response

    except Exception as e:
        logging.exception("❌ ERROR en /webhook:")
        # Devuelvo 200 OK con mensaje de error para que Google Chat no deshabilite el bot
        return {"text": "Ocurrió un error interno procesando tu mensaje."}

@app.get("/")
async def health():
    return {"status": "ok"}
