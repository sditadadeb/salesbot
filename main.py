from fastapi import FastAPI, Request
import json

app = FastAPI()

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    # 1) Leer y loguear el body
    raw = await request.body()
    text = raw.decode("utf-8", errors="ignore")
    print("=== /webhook invocado ===")
    print("Raw body:", text)

    # 2) Parsear JSON
    try:
        payload = json.loads(text)
    except Exception as e:
        print("❌ JSON inválido:", e)
        return {}

    # 3) Localizar el contenedor de mensaje (puede estar en payload["messagePayload"] 
    #    o en payload["chat"]["messagePayload"])
    msg_container = (
        payload.get("messagePayload")
        or payload.get("chat", {}).get("messagePayload")
        or {}
    )
    print("msg_container:", msg_container.keys())

    # 4) Extraer espacio y mensaje
    space = msg_container.get("space", {})
    message = msg_container.get("message")
    if not message:
        print("⚠️ No encontré 'message' (podría ser un evento de add/remove), ignoro.")
        return {}

    # 5) Limpiar texto de la @mención
    argument = message.get("argumentText", message.get("text", "")).strip()
    print("ArgumentText:", repr(argument))

    # 6) Generar respuesta
    reply_text = run_chain(argument or "<vacío>")
    print("Respuesta a enviar:", reply_text)

    # 7) Construir payload de respuesta (sin hilos para simplificar)
    response = {"text": reply_text}

    # 8) Si es un ROOM con threading, devolvemos en el hilo
    if space.get("type") == "ROOM" and space.get("spaceThreadingState") == "THREADED_MESSAGES":
        thread_name = message.get("thread", {}).get("name")
        if thread_name:
            response["thread"] = {"name": thread_name}
            print("→ Respondemos en hilo:", thread_name)

    return response
