from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

# Middleware CORS — esto ahora sí funciona
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción restringí esto
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pegá tu webhook de Google Chat acá (el que generaste en el espacio)
GOOGLE_CHAT_WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAQAwN9u-kA/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=NWNC3za0Mbw2KWs8ctM5kqhaEMkGIzKgD8NL7dJeUos"

def run_chain(user_input: str) -> str:
    """
    lala aca va a langflow pero ahora es esto para ser felices
    """
    return f"Recibí esto: '{user_input}'. (respuesta simulada)"

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    user_input = data.get("message", "sin mensaje")

    response_text = run_chain(user_input)

    # Mandar respuesta al webhook de Google Chat
    async with httpx.AsyncClient() as client:
        await client.post(
            GOOGLE_CHAT_WEBHOOK,
            json={"text": response_text}
        )

    return {"status": "ok"}
