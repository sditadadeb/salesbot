from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS (para pruebas desde cualquier frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_message_info(data: dict):
    # Navegamos al objeto message
    msg = data.get("chat", {}) \
              .get("messagePayload", {}) \
              .get("message", {})

    print(">>> [LOG] raw message object:", msg)

    # 1) argumentText (lo que sigue a la mención)
    raw_arg = msg.get("argumentText")
    arg = (raw_arg or "").strip()
    print(f">>> [LOG] raw argumentText: {repr(raw_arg)}")

    # 2) fallback a msg.text
    if not arg:
        full = msg.get("text", "") or ""
        print(f">>> [LOG] raw text: {repr(full)}")
        parts = full.split(" ", 1)
        arg = parts[1].strip() if len(parts) > 1 else ""
    print(f">>> [LOG] extracted text: {repr(arg)}")

    # 3) thread si viene
    thread = msg.get("thread", {}).get("name")
    print(f">>> [LOG] extracted thread name: {repr(thread)}")

    return arg, thread

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # Extraemos texto y thread
    text, thread = extract_message_info(data)

    # Info del espacio
    space = data.get("chat", {}) \
                .get("messagePayload", {}) \
                .get("space", {})
    state = space.get("spaceThreadingState")
    print(f">>> [LOG] spaceThreadingState: {repr(state)}")

    # Solo incluimos thread si el espacio soporta threaded messages
    use_thread = bool(thread and state == "THREADED_MESSAGES")
    print(f">>> [LOG] include thread in response? {use_thread}")

    # Si no entendemos nada
    if not text:
        resp = {
            "text": "No entendí tu mensaje. ¿Podés repetirlo?",
            "actionResponse": {"type": "NEW_MESSAGE"},
        }
        if use_thread:
            resp["thread"] = {"name": thread}
        print("DEBUG respuesta (repite):", resp)
        return resp

    # Lógica real (eco)
    reply = f"Soy Sales Bot, recibí tu mensaje: {text}"
    print(f">>> [LOG] reply text: {repr(reply)}")

    # Construimos la respuesta definitiva
    resp = {
        "text": reply,
        "actionResponse": {"type": "NEW_MESSAGE"},
    }
    if use_thread:
        resp["thread"] = {"name": thread}

    print("DEBUG respuesta final a enviar:", resp)
    return resp

@app.get("/")
async def health():
    return {"status": "ok"}
