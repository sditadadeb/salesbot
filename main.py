from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Middleware CORS (opcional pero útil)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lógica de respuesta
def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: \"{user_input}\""

# Endpoint que recibe los mensajes de Google Chat
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        user_input = ""

        if isinstance(data, dict):
            message = data.get("message", {})
            user_input = message.get("argumentText", "").strip()

        response_text = run_chain(user_input)

        return {
            "text": response_text
        }

    except Exception as e:
        print("Error procesando webhook:", str(e))
        return {
            "text": "Hubo un error procesando tu mensaje."
        }

# Endpoint opcional para GET
@app.get("/")
def index():
    return {"status": "ok"}
