from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS (para pruebas desde cualquier origen)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_text_and_thread(data: dict):
    """
    Extrae el texto del usuario y el hilo (si es una sala).
    """
    chat = data.get("chat", {})
    mp   = chat.get("messagePayload", {})
    msg  = mp.get("message", {})

    # 1) argumentText es lo que sigue a la mención
    text = msg.get("argumentText", "") or ""
    text = text.strip()

    # 2) Si está vacío, quita la @mención de msg.text
    if not text:
        full = msg.get("text", "")
        parts = full.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""

    # 3) Hilo (solo relevante en salas)
    thread = msg.get("thread", {}).get("name")
    return text, thread

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    text, thread = extract_text_and_thread(data)
    space = data.get("chat", {}).get("messagePayload", {}).get("space", {})
    is_dm = space.get("type") == "DIRECT_MESSAGE" or space.get("singleUserBotDm")

    # Si no entendemos nada
    if not text:
        resp = {
            "text": "No entendí tu mensaje. ¿Podés repetirlo?",
            "actionResponse": {"type": "NEW_MESSAGE"}
        }
        # En sala, mantenemos el hilo
        if not is_dm and thread:
            resp["thread"] = {"name": thread}
        print("DEBUG respuesta a enviar:", resp)
        return resp

    # Tu lógica real va aquí. Ahora, un eco simple:
    reply = f"Soy Sales Bot, recibí tu mensaje: {text}"

    # Construimos la respuesta que Google Chat mostrará
    resp = {
        "text": reply,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }

    # Solo en sala incluimos thread; en DM NO
    if not is_dm and thread:
        resp["thread"] = {"name": thread}

    print("DEBUG respuesta a enviar:", resp)
    return resp

@app.get("/")
async def health():
    return {"status": "ok"}
