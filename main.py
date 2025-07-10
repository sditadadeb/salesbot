from fastapi import FastAPI, Request
import json

app = FastAPI()

def run_chain(user_input: str) -> str:
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.get("/")
async def healthz():
    print("🏥 Health check OK")
    return {"status": "ok"}

@app.post("/webhook")
async def webhook(request: Request):
    # 1) Mostrar que llegó algo
    print("=== /webhook invoked ===")
    print("Method:", request.method)
    print("URL   :", request.url)

    # 2) Leer cuerpo crudo y mostrarlo
    raw = await request.body()
    try:
        text_body = raw.decode("utf-8")
    except:
        text_body = str(raw)
    print("Raw body:", text_body)

    # 3) Intentar cargar JSON
    try:
        payload = json.loads(text_body)
    except Exception as e:
        print("❌ JSON parse error:", e)
        return {"text": "Error interno: formato inválido"}

    print("Parsed payload:", payload)

    # 4) Extraer mensaje
    msg = payload.get("messagePayload", {}).get("message") or payload.get("message")
    if not msg:
        print("⚠️  No encuentro 'message' en el payload, ignoro.")
        return {}

    # 5) Texto limpio
    argument = msg.get("argumentText", msg.get("text", "")).strip()
    print("ArgumentText:", repr(argument))

    # 6) Generar respuesta
    reply = run_chain(argument or "<vacío>")
    print("Reply:", reply)

    # 7) Retornar (sin hilos para simplificar)
    return {"text": reply}
