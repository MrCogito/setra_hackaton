# backend/server.py
import argparse
import contextlib
import os
import sys
from dataclasses import asdict
# import wave # Original didn't use wave here
from io import BytesIO
import uuid
import requests # Add requests import
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Request, File, UploadFile, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel

# Assuming original helpers and spawn are imported
from backend.helpers import DailyConfig, get_daily_config, get_name_from_url, get_token
from backend.spawn import get_status, spawn

# Bot machine dict (as in original)
bot_machines = {}

MAX_BOTS_PER_ROOM = 1 # As in original

load_dotenv()

# Get local mode (as in original)
def get_local_mode() -> bool:
    if "--local" in sys.argv:
        return True
    return False

# Lifespan context manager (as in original)
@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.is_local_mode = get_local_mode()
    logger.info(f"Setting local mode to: {app.state.is_local_mode}")
    yield

# FastAPI app setup (as in original)
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API router (as in original)
api_router = APIRouter(prefix="/api")

# /create endpoint (as in original)
@api_router.post("/create")
async def create_room(request: Request) -> JSONResponse:
    body = await request.body()
    if body:
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
    else:
        data = {}

    if data.get("room_url") is not None:
        room_url = data.get("room_url")
        room_name = get_name_from_url(room_url)
        token = get_token(room_url)
        config = DailyConfig(
            room_url=room_url,
            room_name=room_name,
            token=token,
        )
    else:
        config = get_daily_config()

    return JSONResponse(asdict(config))

# StartAgentItem model (MODIFIED from original)
class StartAgentItem(BaseModel):
    room_url: str
    token: str
    selected_prompt: str
    # --- ADDED ---
    voice_id: str | None = None # From cloning or default
    custom_prompt: str | None = None
    # --- END ADDED ---

# /start endpoint (MODIFIED from original)
@api_router.post("/start")
async def start_agent(item: StartAgentItem, request: Request) -> JSONResponse:
    if item.room_url is None or item.token is None:
        raise HTTPException(status_code=400, detail="room_url and token are required")

    room_url = item.room_url
    token = item.token
    selected_prompt = item.selected_prompt
    # --- ADDED: Get voice_id and custom_prompt ---
    voice_id = item.voice_id
    custom_prompt = item.custom_prompt
    # --- END ADDED ---

    try:
        local = request.app.state.is_local_mode
        # --- MODIFIED: Pass voice_id and custom_prompt to spawn ---
        bot_id = spawn(
            room_url=room_url,
            token=token,
            selected_prompt=selected_prompt,
            voice_id=voice_id, # Pass the received voice_id
            local=local,
            custom_prompt=custom_prompt # Pass the received custom_prompt
        )
        # --- END MODIFIED ---
        bot_machines[bot_id] = room_url
    except Exception as e:
        logger.error(f"Failed to start bot: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start bot: {e}")

    return JSONResponse({"bot_id": bot_id, "room_url": room_url})

# /status endpoint (as in original, with minor cleanup)
@api_router.get("/status/{bot_id}")
def get_bot_status(bot_id: str, request: Request):
    if bot_id not in bot_machines:
        # Check status anyway, maybe it exists but isn't tracked? Unlikely with current spawn.
        logger.warning(f"Bot {bot_id} not found in tracked machines.")
        # Fall through to get_status check, it might handle Fly cases better
        # raise HTTPException(status_code=404, detail=f"Bot with id: {bot_id} not found")

    status = get_status(bot_id, local=request.app.state.is_local_mode)
    if status is None:
        # If status is None, remove from dict if present and raise 404
        if bot_id in bot_machines:
             del bot_machines[bot_id]
        logger.warning(f"Status check for bot {bot_id} returned None. Not found or process ended.")
        raise HTTPException(status_code=404, detail=f"Bot with id: {bot_id} not found or process ended.")
    elif status in ["stopped", "error"] and bot_id in bot_machines:
        # Clean up stopped/errored bots from tracking dict
        del bot_machines[bot_id]

    return JSONResponse({"bot_id": bot_id, "status": status})


# /clone_voice endpoint (MODIFIED from original - uses ElevenLabs)
@api_router.post("/clone_voice")
async def clone_voice(voice_file: UploadFile = File(...)) -> JSONResponse:
    try:
        audio_bytes = await voice_file.read()
        # Use filename from frontend if provided, else generate
        filename = voice_file.filename or f"voice_sample_{uuid.uuid4().hex[:8]}.wav"
        content_type = voice_file.content_type or "audio/wav"

        logger.info(f"Received file for ElevenLabs cloning: {filename}, size: {len(audio_bytes)} bytes, type: {content_type}")

        # ElevenLabs Add Voice API endpoint
        url = "https://api.elevenlabs.io/v1/voices/add"
        api_key = os.getenv("ELEVENLABS_API_KEY")

        if not api_key:
            logger.error("ELEVENLABS_API_KEY environment variable not set.")
            raise HTTPException(status_code=500, detail="Server configuration error: Missing ElevenLabs API key.")

        headers = {"Accept": "application/json", "xi-api-key": api_key}
        files_payload = {'files': (filename, BytesIO(audio_bytes), content_type)}
        data_payload = {'name': f"Terifai Clone {uuid.uuid4().hex[:6]}"}

        try:
            logger.info(f"Sending clone request to ElevenLabs for file: {filename}")
            response = requests.post(url, headers=headers, data=data_payload, files=files_payload)
            response.raise_for_status()

            response_data = response.json()
            voice_id = response_data.get("voice_id")

            if not voice_id:
                logger.error(f"ElevenLabs response missing 'voice_id'. Status: {response.status_code}, Response: {response_data}")
                raise HTTPException(status_code=500, detail="Voice cloning succeeded but API response did not contain voice ID.")

            logger.info(f"ElevenLabs voice cloning successful. Voice ID: {voice_id}")
            # Return the new voice ID in a JSON object
            return JSONResponse({"voice_id": voice_id})

        except requests.exceptions.RequestException as e:
            error_message = f"ElevenLabs API request failed: {e}"
            status_code = 502
            detail_message = "Failed to communicate with voice cloning service."
            if e.response is not None:
                status_code = e.response.status_code
                try:
                    error_detail = e.response.json()
                    detail_message = error_detail.get("detail", {}).get("message", e.response.text)
                    error_message += f" - Status: {status_code}, Detail: {detail_message}"
                except Exception:
                    detail_message = e.response.text
                    error_message += f" - Status: {status_code}, Body: {detail_message}"
            logger.error(error_message)
            raise HTTPException(status_code=status_code, detail=f"Voice cloning failed: {detail_message}")

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Unexpected error in clone_voice: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during voice cloning: {str(e)}")


# Include the API router
app.include_router(api_router)

# Main block (MODIFIED from original)
if __name__ == "__main__":
    # Check environment variables
    required_env_vars = [
        "OPENAI_API_KEY",
        "DAILY_API_KEY",
        "ELEVENLABS_VOICE_ID", # Needed as fallback/default
        "ELEVENLABS_API_KEY", # Needed for cloning and TTS
    ]
    fly_env_vars = ["FLY_API_KEY", "FLY_APP_NAME"]

    parser = argparse.ArgumentParser(description="TerifAI FastAPI server")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address")
    parser.add_argument("--port", type=int, default=7860, help="Port number")
    parser.add_argument("--reload", action="store_true", help="Reload code on change")
    parser.add_argument("--local", action="store_true", help="Run bots locally instead of on Fly")
    args = parser.parse_args() # Parse args early

    # Check environment variables based on local flag
    missing_vars = []
    for env_var in required_env_vars:
        if env_var not in os.environ:
            missing_vars.append(env_var)
    if not args.local: # Only check Fly vars if not local
        for env_var in fly_env_vars:
            if env_var not in os.environ:
                missing_vars.append(env_var)
    if missing_vars:
         raise Exception(f"Missing required environment variables: {', '.join(missing_vars)}")

    import uvicorn
    # Use the app instance directly
    uvicorn.run(
        "backend.server:app", # Correct path to the app instance
        host=args.host,
        port=args.port,
        reload=args.reload
    )