from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS middleware (útil si luego consumís desde otro frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # En producción limita esto a tu dominio
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

    # 1) Saca commonEventObject (o el body si no existe)
    common = event.get("commonEventObject", event)

    # 2) Intenta directamente el argumentText de raíz o de commonEventObject
    user_input = (
        event.get("argumentText")
        or common.get("argumentText")
        or common.get("messagePayload", {}).get("argumentText", "")
    )

    # 3) Si aún vacío, cae a message.text o formattedText
    if not user_input:
        msg = common.get("message", {})
        user_input = (
            msg.get("argumentText")
            or msg.get("text")
            or msg.get("formattedText", "")
        )

    user_input = (user_input or "").strip()

    # 4) Si vino con @mención al principio la quitamos
    if user_input.startswith("@"):
        parts = user_input.split(" ", 1)
        user_input = parts[1].strip() if len(parts) > 1 else ""

    # 5) Validación mínima
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 6) Tu lógica de negocio
    response_text = run_chain(user_input)

    # 7) Devuelve la respuesta en JSON tal cual la espera Google Chat
    return {"text": response_text}

@app.get("/")
async def root():
    return {"status": "ok"}
