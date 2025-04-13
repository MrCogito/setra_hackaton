# backend/bot.py
import argparse
import asyncio
import logging
import os
import time

import aiohttp
from dotenv import load_dotenv

## VAD
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams

## Frames
from pipecat.frames.frames import EndFrame, LLMMessagesFrame

## Pipeline
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask

## Processors
from pipecat.processors.aggregators.llm_response import (
    LLMAssistantResponseAggregator,
    LLMUserResponseAggregator,
)

## Services
from pipecat.services.openai import OpenAILLMService

# Pipecat
## Transports
from pipecat.transports.services.daily import DailyParams, DailyTransport

# --- MODIFIED IMPORTS ---
# Import helpers only if needed (e.g., for prompts, not get_daily_config anymore)
# from backend.helpers import get_daily_config
from backend.processors import (
    # CartesiaTerrify, # Removed
    DeepgramTerrify,
    ElevenLabsTerrify, # Keep only ElevenLabs
    TranscriptionLogger,
    # XTTSTerrify, # Removed
)
from backend.prompts import (
    LLM_INTRO_PROMPT,
    LLM_BASE_PROMPT,
    LLM_PREUPLOAD_BASE_PROMPT,
    LLM_VOICE_CHANGE_PROMPT_DEFAULT,
    LLM_VOICE_CHANGE_PROMPT_IT_SUPPORT,
    LLM_VOICE_CHANGE_PROMPT_CORPORATE,
    LLM_VOICE_CHANGE_PROMPT_FINANCE_FRAUD,
    LLM_VOICE_CHANGE_PROMPT_ENGINEERING_BREACH,
    LLM_VOICE_CHANGE_PROMPT_SECURITY_ALERT
)
# --- END MODIFIED IMPORTS ---

load_dotenv()

# Logging Setup (use a specific name)
log_level = logging.DEBUG if os.environ.get("DEBUG", "").lower() == "true" else logging.INFO
logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("bot")

# Prompt mapping (as in original)
PROMPT_MAP = {
    "default": LLM_VOICE_CHANGE_PROMPT_DEFAULT,
    "it_support": LLM_VOICE_CHANGE_PROMPT_IT_SUPPORT,
    "corporate": LLM_VOICE_CHANGE_PROMPT_CORPORATE,
    "finance_fraud": LLM_VOICE_CHANGE_PROMPT_FINANCE_FRAUD,
    "engineering_breach": LLM_VOICE_CHANGE_PROMPT_ENGINEERING_BREACH,
    "security_alert": LLM_VOICE_CHANGE_PROMPT_SECURITY_ALERT,
}

# --- MODIFIED main signature ---
# Removed xtts, elevenlabs flags as ElevenLabs is now mandatory
async def main(room_url: str, token: str | None = None, selected_prompt: str = "default", voice_id: str = "", custom_prompt: str | None = None):
# --- END MODIFIED main signature ---
    logger.info(f"Starting bot for room: {room_url}")
    logger.info(f"Selected prompt key: {selected_prompt}")
    logger.info(f"Received Voice ID: '{voice_id}' (Type: {type(voice_id)})")
    logger.info(f"Received Custom Prompt: {'Provided' if custom_prompt else 'None'}")
    logger.info(f"Received Token: {'Provided' if token else 'None'}") # Log token presence

    openai_api_key = os.getenv("OPENAI_API_KEY")
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not openai_api_key or not elevenlabs_api_key:
        logger.error("Missing required API keys (OpenAI or ElevenLabs) in environment.")
        return # Exit early

    async with aiohttp.ClientSession() as session:
        # -------------- Transport --------------- #
        # Pass the received token to DailyTransport
        transport = DailyTransport(
            room_url,
            token, # Use the token passed as an argument
            "TerifAI",
            DailyParams(
                audio_out_enabled=True,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
                vad_audio_passthrough=True,
            ),
        )
        logger.info(f"Transport created for room: {room_url}")

        # -------------- Services --------------- #
        stt_service = DeepgramTerrify()
        llm_service = OpenAILLMService(api_key=openai_api_key, model="gpt-4o-mini")

        # --- MODIFIED: Always initialize ElevenLabsTerrify and pass voice_id ---
        logger.info("Using ElevenLabs TTS")
        logger.info(f"Initializing ElevenLabs TTS with provided voice_id: '{voice_id or 'None (will use default env)'}'")
        tts_service = ElevenLabsTerrify(
            aiohttp_session=session,
            api_key=elevenlabs_api_key,
            voice_id=voice_id # Pass the received voice_id here
        )
        # --- END MODIFIED ---

        # --------------- Setup Prompts (logic is correct) ----------------- #
        if voice_id: # If a specific voice_id was provided
            llm_base_prompt = LLM_PREUPLOAD_BASE_PROMPT
            if selected_prompt == "custom" and custom_prompt:
                logger.info("Using provided custom prompt for initial message.")
                LLM_START_PROMPT = {"role": "system", "content": custom_prompt}
            elif selected_prompt in PROMPT_MAP:
                logger.info(f"Using mapped prompt '{selected_prompt}' for initial message.")
                LLM_START_PROMPT = {"role": "system", "content": PROMPT_MAP[selected_prompt]}
            else:
                logger.warning(f"Voice ID provided, but selected_prompt '{selected_prompt}' is invalid. Falling back to default prompt.")
                LLM_START_PROMPT = {"role": "system", "content": PROMPT_MAP["default"]}
        else: # If no voice_id was provided
            logger.info("No specific voice ID provided. Using introductory prompt and base prompt.")
            llm_base_prompt = LLM_BASE_PROMPT
            LLM_START_PROMPT = LLM_INTRO_PROMPT

        logger.debug(f"Using Base Prompt: {llm_base_prompt['content'][:100]}...")
        logger.debug(f"Using Start Prompt: {LLM_START_PROMPT['content'][:100]}...")

        message_history = [llm_base_prompt]
        llm_responses = LLMAssistantResponseAggregator(message_history)
        user_responses = LLMUserResponseAggregator(message_history)
        transcription_logger = TranscriptionLogger()

        # -------------- Pipeline (logic is correct) ----------------- #
        pipeline = Pipeline(
            [
                transport.input(),
                stt_service,
                transcription_logger,
                user_responses,
                llm_service,
                tts_service, # Correct service instance
                transport.output(),
                llm_responses,
            ]
        )

        task = PipelineTask(
            pipeline,
            PipelineParams(
                allow_interruptions=True,
                enable_metrics=True,
                report_only_initial_ttfb=True,
            ),
        )

        # --------------- Events (logic seems correct) ----------------- #
        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant):
            logger.info(f"First participant joined: {participant.get('name', participant.get('id', 'Unknown'))}")
            participant_id = participant.get("id")
            if participant_id:
                transport.capture_participant_transcription(participant_id)
            else:
                 logger.warning("First participant joined event missing participant ID.")
            await asyncio.sleep(1.5) # Use asyncio.sleep
            logger.info("Sending initial LLM message.")
            await task.queue_frame(LLMMessagesFrame([LLM_START_PROMPT]))

        @transport.event_handler("on_participant_left")
        async def on_participant_left(transport, participant, reason):
            logger.info(f"Participant left: {participant.get('name', participant.get('id', 'Unknown'))}, Reason: {reason}")
            participants = transport.participants()
            local_participants = [p for p in participants.values() if not p.get("is_local", False)]
            if len(local_participants) == 0:
                 logger.info("Last non-local participant left. Ending session.")
                 if task and not task.has_ended:
                     await task.queue_frame(EndFrame())
            else:
                 logger.info(f"Other non-local participants remain: {len(local_participants)}")


        @transport.event_handler("on_call_state_updated")
        async def on_call_state_updated(transport, state):
            logger.info(f"Call state updated: {state}")
            if state == "left":
                logger.info("Call state is 'left'. Ending session.")
                if task and not task.has_ended:
                     await task.queue_frame(EndFrame())
                else:
                     logger.warning("Task already stopped or not running when call state became 'left'.")

        # --------------- Runner (logic is correct) ----------------- #
        runner = PipelineRunner()
        logger.info("Starting pipeline runner...")
        await runner.run(task)
        logger.info("Pipeline runner finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TerifAI Bot")
    # --- MODIFIED Arguments ---
    parser.add_argument("--room_url", type=str, required=True, help="Daily room URL") # Required
    parser.add_argument("--token", type=str, help="Daily token (optional, passed by spawn)")
    parser.add_argument("--prompt", type=str, default="default", help="Selected prompt key")
    parser.add_argument("--voice_id", type=str, default="", help="Specific ElevenLabs Voice ID to use")
    parser.add_argument("--custom_prompt", type=str, default=None, help="Full custom prompt text")
    # Removed --default, --xtts, --elevenlabs flags
    # --- END MODIFIED Arguments ---
    args = parser.parse_args()

    # Removed --default logic block

    # Basic validation for custom prompt
    if args.prompt == "custom" and not args.custom_prompt:
        logger.warning("Selected prompt is 'custom' but --custom_prompt was not provided.")

    try:
        # --- MODIFIED Call to main ---
        # Pass arguments directly, removed flags
        asyncio.run(main(
            room_url=args.room_url,
            token=args.token,
            selected_prompt=args.prompt,
            voice_id=args.voice_id,
            custom_prompt=args.custom_prompt
        ))
        # --- END MODIFIED Call to main ---
    except KeyboardInterrupt:
        logger.info("Bot stopped manually.")
    except Exception as e:
        logger.error(f"Bot exited with error: {e}", exc_info=True)
    finally:
        logger.info("Bot shutdown complete.")