from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1) CORS (si luego querés exponer un front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # En prod restringir
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_chain(user_input: str) -> str:
    # Aquí vendría tu llamada a Langflow/LLM...
    return f"Soy Sales Bot, recibí tu mensaje: {user_input}"

@app.get("/webhook")
async def config_complete(request: Request):
    """
    Google Chat envía un GET aquí al terminar la configuración.
    Simplemente devolvemos OK (puede ser un HTML si querés).
    """
    return Response(content="Bot configurado ✔️", media_type="text/plain")

@app.post("/webhook")
async def webhook(request: Request):
    """
    Aquí llegan todos los eventos MESSAGE, ADDED_TO_SPACE, etc.
    Nos enfocamos en MESSAGE para leer el texto y responder.
    """
    try:
        payload = await request.json()
    except:
        # Si no es JSON->dict, cortamos
        return {"text": ""}

    # DEBUG en logs
    print("DEBUG Payload recibido:", payload)

    # Determinar el “common” object si existe
    common = payload.get("commonEventObject", {})

    # 2) Extraer texto de todos los posibles lugares
    text = (
        # webhook directo
        payload.get("message", {}).get("text")
        # apps script redirect
        or payload.get("argumentText")
        or common.get("argumentText")
        # mensajería tradicional
        or common.get("message", {}).get("text")
        or payload.get("formattedText")
        or ""
    )
    user_input = text.strip()

    # 3) Si vinimos en grupo y traemos "@botSales ..." lo quitamos
    mention = "@botsales"
    low = user_input.lower()
    if low.startswith(mention):
        parts = user_input.split(" ", 1)
        user_input = parts[1].strip() if len(parts) > 1 else ""

    # 4) Si no hay nada útil, pedimos que repita
    if not user_input:
        return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

    # 5) Tu lógica / LLM
    response_text = run_chain(user_input)

    # 6) Devolvemos el JSON que Google Chat publicará
    return {"text": response_text}

