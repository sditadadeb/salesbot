from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS – igual que antes
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

        # 2) Extraigo desde payload["chat"]["messagePayload"]["message"]
        chat_obj    = payload.get("chat", {})
        mp          = chat_obj.get("messagePayload", {})
        msg         = mp.get("message", {})

        # 3) Primero argumentText (si viene), si no texto plano
        user_input = (msg.get("argumentText") or msg.get("text") or "").strip()

        # 4) Si quedó el username al principio, lo recorto
        lower = user_input.lower()
        for prefix in ("botsales", "@botsales", "bot sales"):
            if lower.startswith(prefix):
                user_input = user_input[len(prefix):].strip()
                break

        if not user_input:
            return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

        # 5) Llamo a tu lógica
        reply_text = run_chain(user_input)

        # 6) Armo la respuesta, pegada al mismo hilo
        response = {"text": reply_text}
        thread = msg.get("thread", {}).get("name")
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
