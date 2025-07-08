from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Middleware CORS (ok)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simula una respuesta de tu bot
def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: \"{user_input}\""

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()

    # Extrae el texto según la estructura correcta del JSON
    user_input = data.get("message", {}).get("text", "").strip()

    # Ejecuta la lógica
    response_text = run_chain(user_input)

    # Google Chat espera una respuesta directa en el cuerpo JSON
    return {
        "text": response_text
    }

# Opcional para responder al GET raíz (evita el 404 de Render)
@app.get("/")
def index():
    return {"status": "ok"}
