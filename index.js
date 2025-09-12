from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging
import httpx
import os
from typing import Dict, List, Optional
import hashlib

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("sales-bot")

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sistema de memoria simple en memoria (para producción usar Redis/DB)
session_memory: Dict[str, List[Dict[str, str]]] = {}

def get_session_id(space: dict, thread: dict, message: dict) -> str:
    """Genera un ID de sesión único basado en el contexto de Google Chat"""
    space_name = space.get("name", "")
    thread_name = thread.get("name", "")
    
    if thread_name:
        # Si hay un hilo específico, usar ese como sesión
        return f"thread:{thread_name}"
    elif space_name:
        # Si es un espacio sin hilo específico, usar el espacio
        return f"space:{space_name}"
    else:
        # Fallback usando el nombre del mensaje
        return f"message:{message.get('name', 'default')}"

def add_to_memory(session_id: str, role: str, content: str, max_history: int = 10):
    """Agrega un mensaje a la memoria de la sesión"""
    if session_id not in session_memory:
        session_memory[session_id] = []
    
    session_memory[session_id].append({
        "role": role,
        "content": content
    })
    
    # Mantener solo los últimos max_history mensajes
    if len(session_memory[session_id]) > max_history:
        session_memory[session_id] = session_memory[session_id][-max_history:]

def get_conversation_context(session_id: str) -> str:
    """Obtiene el contexto de conversación para la sesión"""
    if session_id not in session_memory:
        return ""
    
    context_parts = []
    for msg in session_memory[session_id]:
        role_label = "Usuario" if msg["role"] == "user" else "Bot"
        context_parts.append(f"{role_label}: {msg['content']}")
    
    if context_parts:
        return f"Contexto de conversación anterior:\n" + "\n".join(context_parts) + "\n\nNuevo mensaje:\n"
    return ""

def run_chain(user_input: str, session_id: str) -> str:
    """Tu lógica de negocio o LLM con contexto de sesión"""
    context = get_conversation_context(session_id)
    full_prompt = context + user_input
    
    # Aquí puedes integrar con tu LLM/Langflow usando full_prompt
    # Por ahora solo devolvemos un echo con contexto
    response = f"Sales Bot (Sesión: {session_id[:20]}...): Recibí tu mensaje: {user_input}"
    
    # Agregar a memoria
    add_to_memory(session_id, "user", user_input)
    add_to_memory(session_id, "assistant", response)
    
    return response

@app.get("/")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Sales Bot is running"}

@app.get("/egress")
async def get_egress_ip():
    """Obtiene la IP de salida del servidor para configurar allowlist"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://api.ipify.org?format=json")
            ip_data = response.json()
            logger.info(f"IP de salida detectada: {ip_data.get('ip')}")
            return ip_data
    except Exception as e:
        logger.error(f"Error obteniendo IP de salida: {str(e)}")
        return {"error": f"No se pudo obtener la IP: {str(e)}"}

@app.get("/sessions")
async def get_active_sessions():
    """Debug endpoint para ver sesiones activas"""
    return {
        "active_sessions": len(session_memory),
        "sessions": {k: len(v) for k, v in session_memory.items()}
    }

@app.post("/webhook")
async def webhook(request: Request):
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # Extraemos messagePayload (para Chats nuevos) o directo del payload
    event = payload.get("messagePayload", payload)

    # Espacio y mensaje
    space = event.get("space", {})
    message = event.get("message")
    if not message:
        logger.debug("❗ No hay campo 'message' en el payload, ignorando evento.")
        return {}

    # Limpiamos el texto de la mención
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()

    # Hilo
    thread = message.get("thread", {})
    thread_name = thread.get("name")

    # Detectamos DM vs ROOM con hilos
    is_dm = (space.get("type") == "DIRECT_MESSAGE")
    threading_state = space.get("spaceThreadingState")

    # Generamos session_id único para mantener contexto
    session_id = get_session_id(space, thread, message)

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> texto limpio: '%s'", argument)
    logger.debug("   >> session_id: %s", session_id)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s",
                 is_dm, threading_state, thread_name)

    # Generamos respuesta con contexto de sesión
    response_text = run_chain(argument or "<vacío>", session_id)
    response_payload = {"text": response_text}

    # Si es sala con hilos, devolvemos en el mismo hilo
    if not is_dm and threading_state == "THREADED_MESSAGES" and thread_name:
        response_payload["thread"] = {"name": thread_name}

    logger.debug("DEBUG respuesta final a enviar: %s", response_payload)
    return response_payload

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
