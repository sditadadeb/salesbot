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
    """
    - Devuelve (text, thread_name) extraídos del payload,
      cubriendo argumento, fallback de text, y extrae thread si existe.
    """
    msg = data.get("message") or \
          data.get("chat", {}) \
              .get("messagePayload", {}) \
              .get("message", {})

    # LOG raw message object
    print(">>> [LOG] raw message object:", msg)

    # argumento tras la @mención (si aplica)
    arg = msg.get("argumentText", "") or ""
    arg = arg.strip()
    print(f">>> [LOG] raw argumentText: {repr(msg.get('argumentText'))}")

    # fallback a msg.text
    if not arg:
        full = msg.get("text", "") or ""
        print(f">>> [LOG] raw text: {repr(full)}")
        parts = full.split(" ", 1)
        arg = parts[1].strip() if len(parts) > 1 else ""
    print(f">>> [LOG] extracted text: {repr(arg)}")

    # thread (si viene)
    thread = msg.get("thread", {}).get("name")
    print(f">>> [LOG] extracted thread name: {repr(thread)}")

    return arg, thread

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    text, thread = extract_message_info(data)

    # Si no hay texto, pedimos al usuario repetir
    if not text:
        resp = {
            "text": "No entendí tu mensaje. ¿Podés repetirlo?",
            "actionResponse": {"type": "NEW_MESSAGE"},
            **({"thread": {"name": thread}} if thread else {})
        }
        print("DEBUG respuesta (repite):", resp)
        return resp

    # Tu lógica: aquí un eco
    reply = f"Soy Sales Bot, recibí tu mensaje: {text}"
    print(f">>> [LOG] reply text: {repr(reply)}")

    # Armamos la respuesta definitiva, **incluyendo siempre el thread si existe**
    resp = {
        "text": reply,
        "actionResponse": {"type": "NEW_MESSAGE"},
        **({"thread": {"name": thread}} if thread else {})
    }
    print("DEBUG respuesta final a enviar:", resp)
    return resp

@app.get("/")
async def health():
    return {"status": "ok"}
