from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) Middleware CORS (útil si luego llamas desde un front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # En prod restringir a tus dominios
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí tu lógica real (Langflow, LLM, etc.)
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    event = await request.json()
    print("DEBUG Payload recibido:", event)

    # 2) Extraemos el texto de todos los posibles campos
    msg = (
        event.get("argumentText")                          # apps script
        or event.get("commonEventObject", {}).get("argumentText")
        or event.get("commonEventObject", {}).get("messagePayload", {}).get("argumentText")
        or event.get("message", {}).get("text")            # webhook
        or event.get("formattedText")                      # preview link
    ) or ""

    user_input = msg.strip()

    # 3) Si vino con @mención, la quitamos
    if user_input.lower().startswith("@botsales"):
        parts = user_input.split(" ", 1)
        user_input = parts[1].strip() if len(parts) > 1 else ""

    # 4) Validación mínima
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 5) Llamamos a tu lógica
    response_text = run_chain(user_input)

    # 6) Devolvemos directamente el JSON que Google Chat publicará
    return {"text": response_text}


@app.get("/")
async def root():
    return {"status": "ok"}
