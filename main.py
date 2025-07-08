from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS — puedes restringir allow_origins en producción
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí va tu lógica real / llamada a Langflow, etc.
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.get("/")
async def healthcheck():
    return {"status": "ok"}

@app.get("/webhook")
async def on_config_complete():
    """
    Google Chat invoca GET /webhook como configCompleteRedirectUri.
    Debe devolver 200 OK para que el bot quede activo.
    """
    return Response(content="✅ Bot configurado correctamente", media_type="text/plain")

@app.post("/webhook")
async def webhook(request: Request):
    """
    Aquí llegan los mensajes (EVENT_TYPE.MESSAGE) y otros eventos.
    Extraemos el texto de:
      - messagePayload.argumentText
      - messagePayload.message.argumentText
      - messagePayload.message.text
    Quitamos la @mención y devolvemos {"text": ...}, 
    además de incluir el mismo hilo (thread.name) para que la respuesta
    aparezca en el hilo correcto.
    """
    try:
        payload = await request.json()
    except:
        return {"text": ""}

    print("DEBUG payload recibido:", payload)

    # 1) Navegamos hasta el objeto real
    chat = payload.get("chat", {})
    mp   = chat.get("messagePayload", {})
    msg  = mp.get("message", {})

    # 2) Extraemos el texto útil
    text = (
        mp.get("argumentText")             # payload['chat']['messagePayload']['argumentText']
        or msg.get("argumentText")         # payload['chat']['messagePayload']['message']['argumentText']
        or msg.get("text")                 # payload['chat']['messagePayload']['message']['text']
        or ""
    ).strip()

    # 3) Limpiamos la mención si la trae
    low = text.lower()
    for prefix in ("@botsales", "botsales", "@bot sales", "bot sales"):
        if low.startswith(prefix):
            text = text[len(prefix):].strip()
            break

    if not text:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 4) Tu lógica / LLM
    reply = run_chain(text)

    # 5) Construimos la respuesta en el mismo hilo
    thread_name = msg.get("thread", {}).get("name")
    response = {"text": reply}
    if thread_name:
        response["thread"] = {"name": thread_name}

    print("DEBUG respuesta a enviar:", response)
    return response
