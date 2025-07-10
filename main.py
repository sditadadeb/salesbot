from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) Middleware CORS (igual que antes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí iría tu llamada a Langflow o LLM
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # ————————— EXTRACCIÓN CORRECTA —————————
    chat = data.get("chat", {})
    mp   = chat.get("messagePayload", {})
    msg  = mp.get("message", {})

    # 1) Primero tomamos argumentText (lo que viene justo después de la @mención)
    text = msg.get("argumentText", "") or msg.get("text", "")
    text = text.strip()

    # 2) Si por algún motivo aún está vacío, pedimos que repita
    if not text:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 3) Generamos la respuesta
    response_text = run_chain(text)

    # 4) Armamos el JSON para que Google Chat publique inline
    resp = {"text": response_text}

    # 5) Si es un ROOM, devolvemos el mismo thread para publicar ahí
    thread_name = msg.get("thread", {}).get("name")
    if thread_name:
        resp["thread"] = {"name": thread_name}

    print("DEBUG respuesta a enviar:", resp)
    return resp

@app.get("/")
async def root():
    return {"status": "ok"}
