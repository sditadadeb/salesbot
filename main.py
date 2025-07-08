from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ¡restringir en producción!
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    return f'Soy Sales Bot, recibí tu mensaje: "{user_input}"'

@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
    except Exception as e:
        print("Error parsing JSON:", e)
        return {"text": "Hubo un error leyendo tu mensaje 😓"}

    print("DEBUG - data recibido:", data)

    # Si data viene mal estructurado, devolvemos algo por defecto
    if not isinstance(data, dict):
        return {"text": "No entendí el mensaje"}

    user_input = data.get("message", {}).get("text", "").strip()

    response_text = run_chain(user_input)

    return {"text": response_text}
