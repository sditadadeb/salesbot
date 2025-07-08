from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS – lo dejás igual
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
        print("DEBUG payload recibido:", payload)

        # ————— Corrijo aquí la extracción —————
        chat_obj       = payload.get("chat", {})
        msg_payload    = chat_obj.get("messagePayload", {})
        msg            = msg_payload.get("message", {})

        # Primero intento argumentText, si no, uso text
        user_input = (msg.get("argumentText") or msg.get("text") or "").strip()

        # Quito la mención si quedó pegada
        if user_input.lower().startswith("botsales"):
            user_input = user_input[len("botsales"):].strip()

        if not user_input:
            return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

        # Lógica
        reply = run_chain(user_input)

        # Devuelvo el mismo hilo
        thread = msg.get("thread", {}).get("name")
        response = {"text": reply}
        if thread:
            response["thread"] = {"name": thread}

        print("DEBUG respuesta a enviar:", response)
        return response

    except Exception as e:
        print("ERROR procesando webhook:", e)
        return {"text": "Ocurrió un error procesando tu mensaje."}

@app.get("/")
async def healthcheck():
    return {"status": "ok"}
