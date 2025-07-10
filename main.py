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

def extract_text_and_thread(data: dict):
    chat = data.get("chat", {})
    mp   = chat.get("messagePayload", {})
    msg  = mp.get("message", {})

    print(">>> [LOG] message object:", msg)

    # 1) argumentText primero
    text = msg.get("argumentText", "") or ""
    text = text.strip()
    print(f">>> [LOG] raw argumentText: {repr(msg.get('argumentText', None))}")

    # 2) fallback sobre msg.text
    if not text:
        full = msg.get("text", "")
        print(f">>> [LOG] raw text: {repr(full)}")
        parts = full.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""
    print(f">>> [LOG] extracted text: {repr(text)}")

    # 3) hilo (thread) para salas
    thread = msg.get("thread", {}).get("name")
    print(f">>> [LOG] extracted thread: {repr(thread)}")

    return text, thread

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # Extraemos texto y thread
    text, thread = extract_text_and_thread(data)

    # Info del espacio para distinguir DM vs ROOM
    space = data.get("chat", {}).get("messagePayload", {}).get("space", {})
    print(">>> [LOG] space object:", space)
    is_dm = space.get("type") == "DIRECT_MESSAGE" or space.get("singleUserBotDm", False)
    print(f">>> [LOG] is_dm: {is_dm}")

    # Si no hay texto, pedimos repetir
    if not text:
        resp = {
            "text": "No entendí tu mensaje. ¿Podés repetirlo?",
            "actionResponse": {"type": "NEW_MESSAGE"}
        }
        if not is_dm and thread:
            resp["thread"] = {"name": thread}
        print("DEBUG respuesta a enviar (empty text):", resp)
        return resp

    # Lógica real (eco)
    reply = f"Soy Sales Bot, recibí tu mensaje: {text}"
    print(f">>> [LOG] reply text: {repr(reply)}")

    # Construimos la respuesta final
    resp = {
        "text": reply,
        "actionResponse": {"type": "NEW_MESSAGE"}
    }
    if not is_dm and thread:
        resp["thread"] = {"name": thread}

    print("DEBUG respuesta a enviar:", resp)
    return resp

@app.get("/")
async def health():
    return {"status": "ok"}
