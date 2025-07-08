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

    # 1) IntentText (si vino como comando o mención con arg)
    user_input = event.get("argumentText", "")

    # 2) Si no, toma el texto completo del mensaje
    if not user_input:
        user_input = event.get("message", {}).get("text", "")

    # 3) Quita la parte de mención al bot si existe ("@botSales …")
    if user_input.startswith("@"):
        parts = user_input.split(" ", 1)
        user_input = parts[1] if len(parts) > 1 else ""
    user_input = user_input.strip()

    # 4) Validación
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 5) Lógica de respuesta
    response_text = run_chain(user_input)

    # 6) Devuelvo JSON con el campo "text"
    return {"text": response_text}

@app.get("/")
async def root():
    return {"status": "ok"}
