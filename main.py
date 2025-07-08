from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

# Middleware CORS — OK como está
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, restringí esto
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tu webhook de respuesta a Google Chat (para RESPONDER desde el bot)
# (No se usa más en este código — Google espera la respuesta directamente)
# GOOGLE_CHAT_WEBHOOK = "..."

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: \"{user_input}\""

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()

    # Extrae el texto del mensaje de Google Chat
    user_input = data.get("message", {}).get("text", "").strip()

    # Llama a tu lógica
    response_text = run_chain(user_input)

    # Devuelve la respuesta directamente en el body JSON
    return {
        "text": response_text
    }
