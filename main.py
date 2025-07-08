from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Middleware CORS (por si accedés vía navegador también)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Respuesta del bot
def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: \"{user_input}\""

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()

    print("DATOS RECIBIDOS:", data)

    # Manejo seguro del input
    user_input = ""
    if isinstance(data, dict):
        message = data.get("message")
        if isinstance(message, dict):
            user_input = message.get("text", "").strip()

    # Responder
    return {
        "text": run_chain(user_input)
    }

# Evita error 405 con GET
@app.get("/")
def index():
    return {"status": "ok"}
