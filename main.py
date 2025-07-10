from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def make_response(text: str, thread_name: str = None):
    """
    Devuelve el dict que Chat espera: text + NEW_MESSAGE + opcional thread
    """
    resp = {
        "text": text,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }
    if thread_name:
        resp["thread"] = {"name": thread_name}
    return resp

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # 1) Extraer el mensaje: cubrimos ambos formatos
    msg = data.get("message") or data.get("messagePayload", {}).get("message", {})
    argument = msg.get("argumentText", "").strip()
    thread = msg.get("thread", {}).get("name")

    # 2) Si no viene nada, pedimos que repita
    if not argument:
        return make_response("No entendí tu mensaje. ¿Podés repetirlo?", thread)

    # 3) Nuestra “lógica” (aquí: un eco)
    reply = f"Soy Sales Bot, recibí tu mensaje: {argument}"
    response = make_response(reply, thread)
    print("DEBUG respuesta a enviar:", response)
    return response

@app.get("/")
async def root():
    return {"status": "ok"}
