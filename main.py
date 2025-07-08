from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS (útil si luego llamas desde un front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # En prod restringir a tus dominios
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí iría tu lógica real / llamada a LangFlow, etc.
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    event = await request.json()
    print("DEBUG Payload recibido:", event)

    # 2) extraemos el texto en todos los posibles lugares
    #    — raíz (argumentText)
    #    — commonEventObject.argumentText
    #    — messagePayload.argumentText
    #    — message.text o formattedText
    user_input = (
        event.get("argumentText")
        or event.get("commonEventObject", {}).get("argumentText")
        or event.get("commonEventObject", {}).get("messagePayload", {}).get("argumentText")
    )

    if not user_input:
        msg = event.get("commonEventObject", {}).get("message", {})
        user_input = (
            msg.get("argumentText")
            or msg.get("text")
            or msg.get("formattedText", "")
        )

    if not user_input:
        # puede ser mensaje directo sin commonEventObject
        user_input = (
            event.get("messagePayload", {})
                 .get("argumentText")
            or event.get("message", {}).get("text", "")
        )

    user_input = (user_input or "").strip()

    # 3) si vino con @mención la quitamos
    if user_input.startswith("@"):
        parts = user_input.split(" ", 1)
        user_input = parts[1].strip() if len(parts) > 1 else ""

    # 4) validación mínima
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 5) tu lógica
    response_text = run_chain(user_input)

    # 6) devolvemos directamente
    return {"text": response_text}

@app.get("/")
async def root():
    return {"status": "ok"}
