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
    try:
        data = await request.json()
        print("DEBUG payload recibido:", data)

        # 2) Extraemos el texto que sigue a la mención (argumentText)
        text = data.get("message", {}) \
                   .get("argumentText", "") \
                   .strip()
        # fallback si no viniera argumentText
        if not text:
            full = data.get("message", {}).get("text", "")
            # quitamos la mención que va antes del primer espacio
            text = full.split(" ", 1)[-1].strip()

        # 3) Hilo (para mensajes en rooms)
        thread = data.get("message", {}).get("thread", {})
        thread_name = thread.get("name")

        # 4) Generamos la respuesta
        response_text = run_chain(text)

        # 5) Armamos el JSON que Chat espera
        resp = {
            "text": response_text,
            "actionResponse": {"type": "NEW_MESSAGE"}
        }
        # si vino con hilo, lo incluimos para que responda ahí
        if thread_name:
            resp["thread"] = {"name": thread_name}

        print("DEBUG respuesta a enviar:", resp)
        return resp

    except Exception as e:
        print("ERROR en /webhook:", e)
        return {
            "text": "Ocurrió un error interno. Te aviso cuando lo solucione.",
            "actionResponse": {"type": "NEW_MESSAGE"}
        }

@app.get("/")
async def root():
    return {"status": "ok"}
