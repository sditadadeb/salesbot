from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging

app = FastAPI()

# Middleware CORS — bien configurado
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción: restringir esto a tus dominios
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Habilitamos logs para debug
logging.basicConfig(level=logging.INFO)

# Lógica de respuesta del bot
def run_chain(user_input: str) -> str:
    return f'Soy Sales Bot, recibí tu mensaje: "{user_input}"'

# Webhook que recibe los eventos desde Google Chat
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        logging.info(f"DEBUG - data recibido: {data}")
    except Exception as e:
        logging.exception("Error leyendo JSON desde la request")
        return {"text": "No pude leer tu mensaje 😕"}

    # Extraemos el texto útil que el usuario envió
    user_input = data.get("message", {}).get("argumentText", "").strip()

    if not user_input:
        return {"text": "¿Me podés decir algo?"}

    response_text = run_chain(user_input)
    return {"text": response_text}
