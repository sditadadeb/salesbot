from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS: si más tarde consumís desde otro frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # En prod pon solo tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí tu lógica real o llamada a Langflow/LLM
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.get("/")
async def healthcheck():
    # Ruta de salud para verificar que el servicio esté vivo
    return {"status": "ok"}

@app.get("/webhook")
async def on_config_complete():
    """
    Google Chat llamará GET /webhook al 
    terminar la configuración (configCompleteRedirectUri).
    Debe devolver 200 OK para activar el bot.
    """
    return Response(content="✅ Bot configurado correctamente", media_type="text/plain")

@app.post("/webhook")
async def webhook(request: Request):
    """
    3) Aquí llegan todos los mensajes:
    - Extraemos texto de cada payload
    - Quitamos la mención si la hay (@botsales)
    - Ejecutamos run_chain()
    - Devolvemos JSON {"text": ...}
    """
    try:
        payload = await request.json()
    except:
        # No es JSON → nada que hacer
        return {"text": ""}

    # DEBUG en logs de Render
    print("DEBUG Payload recibido:", payload)

    # Extraer texto de TODOS los posibles campos
    text = (
        payload.get("message", {}).get("text")
        or payload.get("argumentText")
        or payload.get("commonEventObject", {}).get("argumentText")
        or payload.get("formattedText")
        or ""
    ).strip()

    # Si viene con @botsales al inicio, la quitamos
    if text.lower().startswith("@botsales"):
        parts = text.split(" ", 1)
        text = parts[1].strip() if len(parts) > 1 else ""

    if not text:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # Llamo a mi lógica / LLM
    response_text = run_chain(text)

    # Google Chat espera un JSON con “text”
    return {"text": response_text}
