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
    Extrae el texto (argumentText o text tras la mención)
    y el nombre de thread (si existe) de tu payload real.
    """
    chat = data.get("chat", {})
    mp   = chat.get("messagePayload", {})
    msg  = mp.get("message", {})

    # 1) Primero argumentText
    text = msg.get("argumentText", "") or ""
    text = text.strip()

    # 2) Fallback: si no hay argumentText, quita el @mención de msg.text
    if not text:
        full = msg.get("text", "")
        parts = full.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""
    
    # 3) Hilo (solo en rooms)
    thread = msg.get("thread", {}).get("name")
    return text, thread

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # Extraemos
    text, thread = extract_text_and_thread(data)

    # Si venía vacío, pedimos repetir
    if not text:
        resp = {
            "text": "No entendí tu mensaje. ¿Podés repetirlo?",
            "actionResponse": {"type": "NEW_MESSAGE"}
        }
        if thread:
            resp["thread"] = {"name": thread}
        print("DEBUG respuesta a enviar:", resp)
        return resp

    # Aquí tu lógica real → por ahora eco
    reply = f"Soy Sales Bot, recibí tu mensaje: {text}"

    # Armamos la respuesta que Google Chat publicará inline
    resp = {
        "text": reply,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }
    if thread:
        resp["thread"] = {"name": thread}

    print("DEBUG respuesta a enviar:", resp)
    return resp

@app.get("/")
async def health():
    return {"status": "ok"}
