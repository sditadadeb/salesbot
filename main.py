from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS (te sirve si luego llamás desde un browser u otro frontend)
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

        # 1) Extrae el nodo de message dentro de messagePayload
        msg = payload.get("messagePayload", {}).get("message", {})

        # 2) Toma primero argumentText, si está vacío, fallback a text
        user_input = msg.get("argumentText", "").strip()
        if not user_input:
            user_input = msg.get("text", "").strip()

        # 3) Quita la mención '@botSales' si quedó pegada
        mention = "botsales"
        low = user_input.lower()
        if low.startswith(mention):
            user_input = user_input[len(mention):].strip()

        if not user_input:
            return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

        # 4) Lógica de tu bot
        reply_text = run_chain(user_input)

        # 5) Responde en el mismo thread
        thread_name = msg.get("thread", {}).get("name")
        response: dict = {"text": reply_text}
        if thread_name:
            response["thread"] = {"name": thread_name}

        print("DEBUG respuesta a enviar:", response)
        return response

    except Exception as e:
        print("ERROR procesando webhook:", e)
        return {"text": "Ocurrió un error procesando tu mensaje."}

@app.get("/")
async def healthcheck():
    return {"status": "ok"}
