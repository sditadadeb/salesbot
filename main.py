from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS middleware (útil si luego consumís desde otro frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def build_reply(text: str, thread_name: str = None):
    payload = {
        "text": text,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }
    if thread_name:
        payload["thread"] = {"name": thread_name}
    return payload

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # Extraemos el mensaje y el nombre de hilo (si existe)
    message = data.get("message", {})
    thread_name = message.get("thread", {}).get("name")
    user_input = message.get("argumentText", "").strip()

    # Si no hay texto, preguntamos de nuevo
    if not user_input:
        return build_reply("No entendí tu mensaje. ¿Podés repetirlo?", thread_name)

    # Tu lógica (por ahora simple eco)
    response_text = f"Soy Sales Bot, recibí tu mensaje: {user_input}"

    # Devolvemos la respuesta con hilo y NEW_MESSAGE
    response = build_reply(response_text, thread_name)
    print("DEBUG respuesta a enviar:", response)
    return response

@app.get("/")
async def health():
    return {"status": "ok"}
