from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS middleware (útil si luego consumís desde otro frontend)
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
    try:
        data = await request.json()
        print("DEBUG payload recibido:", data)

        # Extraemos el texto correctamente
        user_input = (
            data
            .get("messagePayload", {})
            .get("message", {})
            .get("argumentText", "")
            .strip()
        )

        # Si viniera la mención incluida, la sacamos
        if user_input.lower().startswith("botsales"):
            user_input = user_input[len("botsales"):].strip()

        if not user_input:
            return {"text": "No entendí tu mensaje. ¿Podés repetirlo?"}

        response_text = run_chain(user_input)
        return {"text": response_text}

    except Exception as e:
        print("ERROR procesando webhook:", e)
        return {"text": "Ocurrió un error procesando tu mensaje."}


@app.get("/")
async def root():
    return {"status": "ok"}
