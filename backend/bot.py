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
from pipecat.frames.frames import EndFrame, LLMMessagesFrame # Keep LLMMessagesFrame just in case, though not used for initial message

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

from backend.processors import (
    DeepgramTerrify,
    ElevenLabsTerrify,
    TranscriptionLogger,
)
# --- REMOVED INTRO/BASE PROMPTS, KEPT SCENARIO PROMPTS ---
from backend.prompts import (
    # LLM_INTRO_PROMPT, # No longer needed
    # LLM_BASE_PROMPT,  # No longer needed
    LLM_PREUPLOAD_BASE_PROMPT, # This is now the only base prompt
    LLM_VOICE_CHANGE_PROMPT_DEFAULT,
    LLM_VOICE_CHANGE_PROMPT_IT_SUPPORT,
    LLM_VOICE_CHANGE_PROMPT_CORPORATE,
    LLM_VOICE_CHANGE_PROMPT_BINANCE_CEO_HACKATHON,
    LLM_VOICE_CHANGE_PROMPT_ENGINEERING_BREACH,
    LLM_VOICE_CHANGE_PROMPT_SECURITY_ALERT,
    LLM_VOICE_CHANGE_PROMPT_FINANCE_FRAUD
)
# --- END MODIFIED IMPORTS ---

load_dotenv()

log_level = logging.DEBUG if os.environ.get("DEBUG", "").lower() == "true" else logging.INFO
logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("bot")

# Prompt mapping for scenarios (ensure keys match --prompt options)
PROMPT_MAP = {
    "default": LLM_VOICE_CHANGE_PROMPT_DEFAULT,
    "it_support": LLM_VOICE_CHANGE_PROMPT_IT_SUPPORT,
    "corporate": LLM_VOICE_CHANGE_PROMPT_CORPORATE,
    "finance_fraud": LLM_VOICE_CHANGE_PROMPT_FINANCE_FRAUD,
    "binance_ceo": LLM_VOICE_CHANGE_PROMPT_BINANCE_CEO_HACKATHON,
    "engineering_breach": LLM_VOICE_CHANGE_PROMPT_ENGINEERING_BREACH,
    "security_alert": LLM_VOICE_CHANGE_PROMPT_SECURITY_ALERT,
}

# --- MODIFIED main signature and logic ---
async def main(room_url: str, token: str | None = None, selected_prompt: str = "default", voice_id: str = "", custom_prompt: str | None = None):
    logger.info(f"Starting bot for room: {room_url}")
    logger.info(f"Selected scenario prompt key: {selected_prompt}")
    logger.info(f"Using ElevenLabs Voice ID: '{voice_id or 'Default (from env or service default)'}'")
    logger.info(f"Received Custom Prompt: {'Provided' if custom_prompt else 'None'}")
    logger.info(f"Received Token: {'Provided' if token else 'None'}")

    openai_api_key = os.getenv("OPENAI_API_KEY")
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not openai_api_key or not elevenlabs_api_key:
        logger.error("Missing required API keys (OpenAI or ElevenLabs) in environment.")
        return

    async with aiohttp.ClientSession() as session:
        # -------------- Transport --------------- #
        transport = DailyTransport(
            room_url,
            token,
            "Assistant", # Generic name as specific persona comes from prompt
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
        tts_service = ElevenLabsTerrify(
            aiohttp_session=session,
            api_key=elevenlabs_api_key,
            voice_id=voice_id # Pass voice_id for voice selection
        )

        # --------------- Setup Prompts and Initial History (ALWAYS SCENARIO MODE) --------------- #
        logger.info("Configuring for immediate scenario simulation (standard behavior).")
        # Base prompt always defines the AI's red team operator role
        llm_base_prompt = LLM_PREUPLOAD_BASE_PROMPT

        # Determine the specific scenario content (system message)
        scenario_prompt_content = ""
        if selected_prompt == "custom" and custom_prompt:
            logger.info("Using provided custom prompt for scenario.")
            scenario_prompt_content = custom_prompt
        elif selected_prompt in PROMPT_MAP:
            logger.info(f"Using mapped prompt '{selected_prompt}' for scenario.")
            scenario_prompt_content = PROMPT_MAP[selected_prompt]
        else:
            # Fallback if the selected_prompt key is invalid
            logger.warning(f"Selected prompt '{selected_prompt}' is invalid or not in PROMPT_MAP. Falling back to default scenario prompt.")
            # Use .get for safety, provide a clear fallback message if 'default' is also missing
            scenario_prompt_content = PROMPT_MAP.get("default", "Error: Default scenario prompt is missing.")
            if "Error:" in scenario_prompt_content:
                 logger.error("Default scenario prompt ('default' key in PROMPT_MAP) is missing or invalid!")
                 # Consider exiting or using a minimal placeholder if this is critical
                 # For now, it will proceed with the error message as the prompt content.

        # Initialize message history with BOTH the base role and the specific scenario
        # This gives the LLM the full context right away
        message_history = [
            llm_base_prompt,
            {"role": "system", "content": scenario_prompt_content}
        ]
        logger.debug("Initialized message history with PREUPLOAD_BASE and specific scenario prompt.")

        # Setup aggregators using the initialized message_history
        llm_responses = LLMAssistantResponseAggregator(message_history)
        user_responses = LLMUserResponseAggregator(message_history)
        transcription_logger = TranscriptionLogger()

        # -------------- Pipeline ----------------- #
        pipeline = Pipeline(
            [
                transport.input(),
                stt_service,
                transcription_logger,
                user_responses,
                llm_service,
                tts_service,
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

        # --------------- Events (Simplified on_first_participant_joined) ----------------- #
        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant):
            participant_name = participant.get('name', participant.get('id', 'Unknown'))
            logger.info(f"First participant joined: {participant_name}")
            participant_id = participant.get("id")
            if participant_id:
                transport.capture_participant_transcription(participant_id)
            else:
                 logger.warning("First participant joined event missing participant ID.")

            await asyncio.sleep(1.5) # Give things a moment to settle

            # Always starting in scenario mode. No initial message sent by bot.
            # The LLM already has context from message_history.
            # It will generate its first response after receiving the first user utterance.
            logger.info("Scenario mode active. No initial message sent by bot. Waiting for user input or LLM's first turn based on context.")


        @transport.event_handler("on_participant_left")
        async def on_participant_left(transport, participant, reason):
            logger.info(f"Participant left: {participant.get('name', participant.get('id', 'Unknown'))}, Reason: {reason}")
            participants = transport.participants()
            other_participants = [p for p in participants.values() if not p.get("is_local", False)]
            if len(other_participants) == 0:
                 logger.info("Last remote participant left. Ending session.")
                 if task and not task.has_ended:
                     await task.queue_frame(EndFrame())
            else:
                 logger.info(f"Other remote participants remain: {len(other_participants)}")


        @transport.event_handler("on_call_state_updated")
        async def on_call_state_updated(transport, state):
            logger.info(f"Call state updated: {state}")
            if state == "left":
                logger.info("Call state is 'left'. Ending session.")
                if task and not task.has_ended:
                     await task.queue_frame(EndFrame())
                else:
                     logger.warning("Task already stopped or not running when call state became 'left'.")

        # --------------- Runner ----------------- #
        runner = PipelineRunner()
        logger.info("Starting pipeline runner...")
        await runner.run(task)
        logger.info("Pipeline runner finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TerifAI Scenario Bot") # Updated description
    parser.add_argument("--room_url", type=str, required=True, help="Daily room URL")
    parser.add_argument("--token", type=str, help="Daily token (optional, passed by spawn)")
    parser.add_argument("--prompt", type=str, default="default",
                        choices=list(PROMPT_MAP.keys()) + ["custom"],
                        help="Selects the scenario prompt key or 'custom'")
    # Updated help text for voice_id
    parser.add_argument("--voice_id", type=str, default="", help="Specific ElevenLabs Voice ID to use for TTS (optional)")
    parser.add_argument("--custom_prompt", type=str, default=None, help="Full custom scenario prompt text (used only if --prompt is 'custom')")
    args = parser.parse_args()

    if args.prompt == "custom" and not args.custom_prompt:
        logger.error("Selected prompt is 'custom' but --custom_prompt text was not provided. Exiting.")
        exit(1)
    # Check if the selected prompt key (if not 'custom') is actually in the map
    if args.prompt != "custom" and args.prompt not in PROMPT_MAP:
         logger.error(f"Provided --prompt '{args.prompt}' is not 'custom' and not a recognized key in PROMPT_MAP: {list(PROMPT_MAP.keys())}. Exiting.")
         exit(1) # Exit if a bad key is provided

    try:
        asyncio.run(main(
            room_url=args.room_url,
            token=args.token,
            selected_prompt=args.prompt,
            voice_id=args.voice_id,
            custom_prompt=args.custom_prompt
        ))
    except KeyboardInterrupt:
        logger.info("Bot stopped manually.")
    except Exception as e:
        logger.error(f"Bot exited with error: {e}", exc_info=True)
    finally:
        logger.info("Bot shutdown complete.")