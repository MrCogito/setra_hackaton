# backend/spawn.py
import os
import subprocess
import sys
import uuid
import requests
from loguru import logger

def spawn(room_url: str, token: str, selected_prompt: str, voice_id: str | None, local: bool, custom_prompt: str | None) -> str:
    """
    Spawns the bot process either locally or on Fly.io.

    Args:
        room_url: The Daily room URL for the bot to join.
        token: The Daily token for the bot to use.
        selected_prompt: The key indicating which prompt scenario to use.
        voice_id: The specific ElevenLabs voice ID to use (cloned or default).
        local: Boolean indicating whether to run locally or on Fly.
        custom_prompt: The full text of the custom prompt, if selected.

    Returns:
        The ID of the spawned bot (UUID for local, Fly machine ID for Fly).
    """
    bot_id = str(uuid.uuid4()) # Generate initial ID, may be replaced by Fly ID
    logger.info(f"Spawning bot {bot_id} for room {room_url}. Local: {local}. Voice ID: {voice_id}. Prompt: {selected_prompt}")

    # --- Prepare Common Command-Line Arguments ---
    common_args = [
        "--room_url", room_url,
        "--prompt", selected_prompt,
        # No need for --elevenlabs flag anymore as bot.py assumes it
    ]
    if token:
         # Only add token if it's not None or empty
         common_args.extend(["--token", token])
    if voice_id:
        common_args.extend(["--voice_id", voice_id])
    if custom_prompt:
        common_args.extend(["--custom_prompt", custom_prompt])
    # --- End Common Arguments ---

    if local:
        # --- Local Execution using subprocess ---
        python_executable = sys.executable # Use the same python interpreter running the server

        # Use -m to run bot.py as a module within the backend package
        command = [
            python_executable,
            "-m",                 # Run as module
            "backend.bot",        # Module path (package.module)
        ]
        command.extend(common_args) # Add specific arguments

        logger.info(f"Running local command: {' '.join(command)}")
        try:
            # Start the process. Assumes the server is run from the project root ('setra_hackaton')
            # so that the 'backend' package is discoverable.
            process = subprocess.Popen(command)
            logger.info(f"Local bot process started with PID: {process.pid}")
            # Note: We are not storing the 'process' object here. Status check is basic.
        except FileNotFoundError:
            logger.error(f"Failed to start local bot: Python executable not found at '{python_executable}' or module 'backend.bot' not found.")
            raise RuntimeError("Failed to find Python or bot module.")
        except Exception as e:
            logger.error(f"Failed to start local bot process: {e}", exc_info=True)
            raise RuntimeError(f"Failed to start local bot process: {e}")

    else:
        # --- Fly.io Execution using Machines API ---
        fly_api_key = os.getenv("FLY_API_KEY")
        fly_app_name = os.getenv("FLY_APP_NAME")
        if not fly_api_key or not fly_app_name:
            logger.error("FLY_API_KEY and FLY_APP_NAME environment variables are required for non-local mode.")
            raise ValueError("Fly API key and App name missing for Fly deployment.")

        api_url = f"https://api.machines.dev/v1/apps/{fly_app_name}/machines"
        headers = {"Authorization": f"Bearer {fly_api_key}", "Content-Type": "application/json"}

        # Use -m for Fly command consistency
        fly_command = [
            "python",
            "-m",                 # Run as module
            "backend.bot",        # Module path
        ]
        fly_command.extend(common_args) # Add specific arguments

        # Ensure the image name matches your Fly deployment
        image_name = f"registry.fly.io/{fly_app_name}:deployment-latest" # Adjust if necessary

        # Define necessary environment variables for the Fly machine
        fly_env = {
            "DAILY_API_KEY": os.getenv("DAILY_API_KEY"),
            "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
            "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY"),
            "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID"), # Default voice ID
            "DEEPGRAM_API_KEY": os.getenv("DEEPGRAM_API_KEY"), # Pass Deepgram key too
            "DEBUG": os.getenv("DEBUG", "false"), # Pass debug setting
            # Add any other environment variables your bot needs
        }
        # Filter out None values from env vars, as Fly expects strings
        fly_env = {k: v for k, v in fly_env.items() if v is not None}


        # Machine configuration payload
        data = {
            "name": f"bot-{bot_id}", # Use the generated UUID for the machine name initially
            "config": {
                "image": image_name,
                "env": fly_env,
                "guest": {"cpu_kind": "shared", "cpus": 1, "memory_mb": 512}, # Adjust resources as needed
                "auto_destroy": True, # Destroy machine when process exits
                "restart": {"policy": "no"}, # Do not restart on exit/failure
                "command": fly_command, # Command to execute
            }
        }

        logger.info(f"Creating Fly machine with command: {' '.join(fly_command)}")
        try:
            response = requests.post(api_url, headers=headers, json=data)
            response.raise_for_status() # Raise exception for non-2xx responses
            machine_info = response.json()
            # Use the actual Fly machine ID as the definitive bot_id
            bot_id = machine_info.get("id", bot_id)
            logger.info(f"Fly machine {bot_id} created successfully.")
        except requests.exceptions.RequestException as e:
            error_message = f"Failed to create Fly machine: {e}"
            if e.response is not None:
                 error_message += f" - Status: {e.response.status_code}, Body: {e.response.text}"
            logger.error(error_message)
            raise RuntimeError(error_message) # Re-raise to signal failure

    return bot_id # Return the final bot ID (UUID or Fly machine ID)

def get_status(bot_id: str, local: bool) -> str | None:
    """Checks the status of a bot process/machine."""
    if local:
        # Local status check remains basic without process management.
        # Assume running if it was successfully spawned and hasn't been explicitly stopped/failed.
        # A real implementation would need to track the Popen object.
        logger.debug(f"Local status check for bot {bot_id} (placeholder: returning 'running')")
        return "running" # Placeholder
    else:
        # Check status on Fly.io using the machine ID (which is bot_id in this case)
        fly_api_key = os.getenv("FLY_API_KEY")
        fly_app_name = os.getenv("FLY_APP_NAME")
        if not fly_api_key or not fly_app_name:
            logger.error("Fly API key or App name missing for status check.")
            return "error"

        api_url = f"https://api.machines.dev/v1/apps/{fly_app_name}/machines/{bot_id}"
        headers = {"Authorization": f"Bearer {fly_api_key}"}

        try:
            response = requests.get(api_url, headers=headers)
            if response.status_code == 404:
                logger.warning(f"Fly machine {bot_id} not found.")
                return None # Not found
            response.raise_for_status()
            machine_info = response.json()
            status = machine_info.get("state", "unknown")
            logger.debug(f"Fly machine {bot_id} status: {status}")
            # Map Fly states
            if status == "started": return "running"
            if status in ["stopped", "destroyed"]: return "stopped"
            if status == "failed": return "error"
            return status # e.g., "created", "starting"
        except requests.exceptions.RequestException as e:
            error_message = f"Failed to get Fly machine status for {bot_id}: {e}"
            if e.response is not None:
                 error_message += f" - Status: {e.response.status_code}, Body: {e.response.text}"
            logger.error(error_message)
            return "error" # Indicate an error occurred during status check