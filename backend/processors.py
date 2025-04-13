# backend/processors.py

import io # Keep standard imports
import os
# import time # Keep if used by other processors
# import wave # Keep if used by other processors
from dataclasses import dataclass

import aiohttp
from dotenv import load_dotenv
from loguru import logger

# Import necessary pipecat components (as in original)
from pipecat.audio.utils import calculate_audio_volume, exp_smoothing # Keep if used elsewhere
from pipecat.frames.frames import (
    AudioRawFrame,
    CancelFrame,
    DataFrame,
    EndFrame,
    Frame,
    LLMMessagesUpdateFrame, # Keep if used elsewhere
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.deepgram import DeepgramSTTService
from pipecat.services.elevenlabs import ElevenLabsTTSService
# from pipecat.services.xtts import XTTSService # Remove if not used
# from pipecat.services.cartesia import CartesiaTTSService # Remove if not used

# Import prompts if needed by other logic
# from backend.prompts import ...

load_dotenv()

# --- API Keys and Defaults ---
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
DEFAULT_ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID") # Fallback voice ID

if not DEFAULT_ELEVENLABS_VOICE_ID:
    logger.warning("ELEVENLABS_VOICE_ID environment variable not set. TTS might fail if no voice ID is provided during initialization.")

logger.info(f"Default ElevenLabs voice ID from env: {DEFAULT_ELEVENLABS_VOICE_ID}")


# --- Custom Audio Frame (Keep if original had it and needed) ---
@dataclass
class AudioFrameTerrify(DataFrame):
    """Separate dataclass for audio frames. May be needed by other processors."""
    audio: bytes
    sample_rate: int
    num_channels: int

    def __post_init__(self):
        super().__post_init__()
        # Assuming 16-bit audio samples (2 bytes per sample per channel)
        bytes_per_sample = 2
        self.num_frames = int(len(self.audio) / (self.num_channels * bytes_per_sample))

    def __str__(self):
        return f"{self.name}(size: {len(self.audio)}, frames: {self.num_frames}, sample_rate: {self.sample_rate}, channels: {self.num_channels})"


# --- Transcription Logger (As in original) ---
class TranscriptionLogger(FrameProcessor):
    """Logs transcriptions that pass through it."""
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            logger.debug(f"Transcription: {frame.text}")
        await self.push_frame(frame)


# --- Deepgram STT (As in original) ---
class DeepgramTerrify(DeepgramSTTService):
    """Custom Deepgram STT service that also pushes AudioFrameTerrify downstream."""
    def __init__(self):
        dg_key = os.getenv("DEEPGRAM_API_KEY")
        if not dg_key:
            # Log error and raise for clarity
            logger.error("DEEPGRAM_API_KEY environment variable not set.")
            raise ValueError("DEEPGRAM_API_KEY environment variable not set.")
        super().__init__(api_key=dg_key)
        logger.info("DeepgramTerrify STT initialized.")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Processes audio frames for STT and pushes AudioFrameTerrify."""
        if isinstance(frame, AudioRawFrame):
            # Create and push the custom frame type if needed downstream
            # Check if AudioRawFrame has necessary attributes first
            if hasattr(frame, 'audio') and hasattr(frame, 'sample_rate') and hasattr(frame, 'num_channels'):
                audio_capture_frame = AudioFrameTerrify(
                    audio=frame.audio,
                    sample_rate=frame.sample_rate,
                    num_channels=frame.num_channels,
                )
                await self.push_frame(audio_capture_frame, direction)
            else:
                 logger.warning("Received AudioRawFrame missing expected attributes (audio, sample_rate, num_channels).")
            # Let the parent handle the original AudioRawFrame for STT processing
            await super().process_frame(frame, direction)
        else:
            # Pass other frame types (like TranscriptionFrame from parent) through
             await super().process_frame(frame, direction)


# --- ElevenLabs TTS (MODIFIED from original to handle voice_id) ---
class ElevenLabsTerrify(ElevenLabsTTSService):
    """Custom ElevenLabs TTS service that uses a specific voice ID passed during initialization or falls back to default."""
    def __init__(
        self,
        *,
        aiohttp_session: aiohttp.ClientSession,
        api_key: str,
        voice_id: str | None = None, # Accepts voice_id (can be None or empty string)
        model: str = "eleven_turbo_v2", # Default model
        **kwargs,
    ):
        # Determine the effective voice ID:
        # 1. Use `voice_id` if it's provided and not an empty string.
        # 2. Otherwise, use the default ID from the environment variable.
        effective_voice_id = voice_id if voice_id else DEFAULT_ELEVENLABS_VOICE_ID

        if not effective_voice_id:
            # This should only happen if voice_id is None/empty AND the env var is not set.
            logger.error("ElevenLabsTerrify requires a voice_id, but none was provided via argument and ELEVENLABS_VOICE_ID env var is not set.")
            raise ValueError("No voice_id available for ElevenLabs TTS service.")

        logger.info(f"Initializing ElevenLabsTerrify TTS with effective voice_id: '{effective_voice_id}' (Provided: '{voice_id}', Default Env: '{DEFAULT_ELEVENLABS_VOICE_ID}')")

        # Initialize the parent service with the determined voice ID
        super().__init__(
            aiohttp_session=aiohttp_session,
            api_key=api_key,
            model=model,
            voice_id=effective_voice_id, # Pass the determined voice_id
            **kwargs,
        )
        # No internal cloning logic needed here

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Processes frames for TTS generation using the initialized voice_id."""
        # Parent class handles the text-to-audio conversion.
        await super().process_frame(frame, direction)
        # No custom logic needed here for this use case.

# --- Remove XTTSTerrify and CartesiaTerrify if they were in the original and not needed ---