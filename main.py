from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS middleware (útil si luego consumís desde otro frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # En prod limita esto a tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    event = await request.json()
    print("DEBUG Payload recibido:", event)

    # 1) Si viene como complemento Workspace App, está bajo commonEventObject
    common = event.get("commonEventObject", event)

    # 2) Intenta extraer argumentText de messagePayload (slash‐command o @mención)
    mp = common.get("messagePayload", {})
    user_input = mp.get("argumentText", "").strip()

    # 3) Si no vino ahí, cae a message.text
    if not user_input:
        user_input = common.get("message", {}).get("text", "").strip()

    # 4) Quita la @mención inicial si existe
    if user_input.startswith("@"):
        parts = user_input.split(" ", 1)
        user_input = parts[1] if len(parts) > 1 else ""
        user_input = user_input.strip()

    # 5) Valida
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 6) Lógica de respuesta
    response_text = run_chain(user_input)

    # 7) Devuelve la respuesta en el JSON
    return {"text": response_text}

@app.get("/")
async def root():
    return {"status": "ok"}
