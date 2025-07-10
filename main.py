from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

# 1) CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    print("DEBUG payload recibido:", data)

    # 2) Extraer payload correcto
    payload = data.get("messagePayload", {})
    msg     = payload.get("message", {})
    space   = payload.get("space", {})

    # 3) Texto tras la mención
    text = msg.get("argumentText", "").strip()
    if not text:
        # fallback al texto completo (quita la @mención)
        full = msg.get("text", "")
        parts = full.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""

    # 4) Construir respuesta
    resp: dict = {"text": run_chain(text)}

    # 5) Si es DM => NEW_MESSAGE, si es ROOM => usar thread.name
    if space.get("spaceType") == "DIRECT_MESSAGE" or space.get("singleUserBotDm"):
        resp["actionResponse"] = {"type": "NEW_MESSAGE"}
    else:
        thread = msg.get("thread", {})
        if thread.get("name"):
            resp["thread"] = {"name": thread["name"]}

    print("DEBUG respuesta a enviar:", resp)
    return resp

@app.get("/")
async def root():
    return {"status": "ok"}
