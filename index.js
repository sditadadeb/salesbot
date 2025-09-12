from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

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

# ---------------------- Memoria local por sesión ----------------------
# sessionId -> [{"role": "user"|"bot", "text": str, "ts": datetime}, ...]
session_memory: Dict[str, List[Dict]] = {}

# Configuración de memoria
HISTORY_TURNS = int(os.environ.get("HISTORY_TURNS", "8"))  # pares de mensajes a mantener
DISABLE_LOCAL_MEMORY = os.environ.get("DISABLE_LOCAL_MEMORY", "0") == "1"

def get_session_history(session_id: str) -> List[Dict]:
    """Obtiene el historial de una sesión"""
    return session_memory.get(session_id, [])

def push_turn(session_id: str, role: str, text: str):
    """Agrega un turno (usuario o bot) al historial de la sesión"""
    if DISABLE_LOCAL_MEMORY or HISTORY_TURNS == 0:
        return
    
    if session_id not in session_memory:
        session_memory[session_id] = []
    
    session_memory[session_id].append({
        "role": role,
        "text": str(text or ""),
        "ts": datetime.now()
    })
    
    # Mantener solo los últimos N turnos (usuario+bot = 2*N items)
    max_items = max(1, HISTORY_TURNS) * 2
    if len(session_memory[session_id]) > max_items:
        session_memory[session_id] = session_memory[session_id][-max_items:]

def render_history(session_id: str) -> str:
    """Renderiza el historial en formato de texto para el contexto"""
    history = get_session_history(session_id)
    if not history:
        return ""
    
    formatted_history = []
    for turn in history:
        role_label = "USUARIO" if turn["role"] == "user" else "BOT"
        formatted_history.append(f"{role_label}: {turn['text']}")
    
    return "\n".join(formatted_history)

def compute_session_id(space: dict, message: dict, is_dm: bool) -> str:
    """
    Computa un ID de sesión estable basado en:
    - Hilo (thread) si existe -> mantiene contexto por hilo
    - DM con usuario específico -> mantiene contexto por usuario
    - Espacio (room) -> contexto compartido en el espacio
    """
    # Extraer información relevante
    thread = message.get("thread", {})
    thread_name = thread.get("name")
    space_name = space.get("name", "")
    sender = message.get("sender", {})
    user_email = sender.get("email", "unknown")
    
    # Prioridad de sesión:
    # 1. Thread específico (mayor granularidad)
    if thread_name:
        return f"thread:{thread_name}"
    
    # 2. DM con usuario específico
    if is_dm:
        return f"dm:{user_email}"
    
    # 3. Espacio (room) - hilo por defecto del espacio
    if space_name:
        return f"space:{space_name}:default"
    
    # 4. Fallback (no debería pasar)
    message_name = message.get("name", str(uuid.uuid4()))
    return f"fallback:{message_name}"

def build_user_prompt_with_context(session_id: str, user_text: str) -> str:
    """Construye el prompt del usuario incluyendo el contexto de la conversación"""
    if DISABLE_LOCAL_MEMORY or HISTORY_TURNS == 0:
        return user_text
    
    history = render_history(session_id)
    if not history:
        return user_text
    
    # Formato claro para el LLM/agente
    return f"""<<<HISTORIAL_CONVERSACION>>>
{history}
<<<FIN_HISTORIAL>>>

{user_text}"""

def run_chain(user_input: str, session_id: str) -> str:
    """
    Aquí iría tu lógica de negocio o LLM
    Ahora recibe el session_id para poder mantener contexto
    """
    # Ejemplo con contexto
    history_count = len(get_session_history(session_id))
    
    # Simular respuesta contextual
    if history_count == 0:
        return f"¡Hola! Soy Sales Bot. Recibí tu primer mensaje: {user_input}"
    else:
        return f"Soy Sales Bot (mensaje #{history_count//2 + 1}), recibí: {user_input}"

@app.post("/webhook")
async def webhook(request: Request):
    payload = await request.json()
    logger.debug("🔔 Payload completo recibido: %s", payload)

    # Extraer evento
    event = payload.get("messagePayload", payload)

    # Validar estructura básica
    space = event.get("space", {})
    message = event.get("message")
    if not message:
        logger.debug("❗ No hay campo 'message' en el payload, ignorando evento.")
        return {}

    # Extraer información del mensaje
    raw_text = message.get("text", "")
    argument = message.get("argumentText", raw_text).strip()
    
    # Información de threading
    thread = message.get("thread", {})
    thread_name = thread.get("name")
    is_dm = (space.get("type") == "DIRECT_MESSAGE")
    threading_state = space.get("spaceThreadingState")

    logger.debug("   >> espacio: %s", space)
    logger.debug("   >> mensaje: %s", message)
    logger.debug("   >> texto limpio: '%s'", argument)
    logger.debug("   >> is_dm=%s, threading_state=%s, thread_name=%s",
                 is_dm, threading_state, thread_name)

    # *** PARTE CLAVE: Computar sesión estable ***
    session_id = compute_session_id(space, message, is_dm)
    logger.debug("   >> session_id computado: %s", session_id)
    
    # Construir input con contexto histórico
    input_with_context = build_user_prompt_with_context(session_id, argument or "<vacío>")
    logger.debug("   >> input con contexto: %s", input_with_context[:200] + "..." if len(input_with_context) > 200 else input_with_context)

    # Generar respuesta (aquí llamarías a tu LLM/Langflow)
    response_text = run_chain(input_with_context, session_id)

    # *** ACTUALIZAR MEMORIA DE SESIÓN ***
    push_turn(session_id, "user", argument or "<vacío>")
    push_turn(session_id, "bot", response_text)
    
    logger.debug("   >> historial actualizado para sesión %s: %d turnos", 
                 session_id, len(get_session_history(session_id)))

    # Construir respuesta
    response_payload = {"text": response_text}

    # Mantener en el mismo hilo si es necesario
    if not is_dm and threading_state == "THREADED_MESSAGES" and thread_name:
        response_payload["thread"] = {"name": thread_name}

    logger.debug("DEBUG respuesta final a enviar: %s", response_payload)
    return response_payload

# Endpoint para debug/admin de sesiones
@app.get("/sessions")
async def get_sessions():
    """Endpoint para ver el estado de las sesiones (útil para debug)"""
    sessions_info = {}
    for session_id, history in session_memory.items():
        sessions_info[session_id] = {
            "turns": len(history),
            "last_activity": history[-1]["ts"].isoformat() if history else None,
            "preview": history[-2:] if len(history) >= 2 else history
        }
    return sessions_info

@app.delete("/sessions/{session_id}")
async def clear_session(session_id: str):
    """Limpiar una sesión específica"""
    if session_id in session_memory:
        del session_memory[session_id]
        return {"message": f"Sesión {session_id} eliminada"}
    return {"message": "Sesión no encontrada"}

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="debug")
