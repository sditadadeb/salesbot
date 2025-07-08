from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS middleware – útil si agregás después un frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # En prod restringir a tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Tu lógica real o llamada a Langflow/LLM iría aquí.
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.get("/webhook")
async def on_config_complete():
    """
    2) Google Chat llama GET /webhook al
    terminar la configuración (configCompleteRedirectUri).
    Debe responder 200 OK para activar el bot.
    """
    return Response(content="✅ Bot configurado correctamente", media_type="text/plain")

@app.post("/webhook")
async def webhook(request: Request):
    """
    3) Aquí llega cada mensaje del espacio.
    Extraemos texto de TODOS los campos posibles,
    quitamos la mención @botsales, ejecutamos run_chain
    y devolvemos {"text": ...}.
    """
    try:
        payload = await request.json()
    except:
        # No es JSON → nada que hacer
        return {"text": ""}

    # DEBUG en logs de Render
    print("DEBUG Payload recibido:", payload)

    # Extraer texto de todos los posibles lugares
    common = payload.get("commonEventObject", {})
    text = (
        payload.get("message", {}).get("text")
        or payload.get("argumentText")
        or common.get("argumentText")
        or common.get("message", {}).get("text")
        or payload.get("formattedText")
        or ""
    ).strip()

    # Quitar @botsales al inicio si viene en grupo
    if text.lower().startswith("@botsales"):
        parts = text.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""

    if not text:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # Tu lógica / LLM
    response_text = run_chain(text)

    # La respuesta que Google Chat va a publicar
    return {"text": response_text}
