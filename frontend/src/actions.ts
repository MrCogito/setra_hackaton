// frontend/src/actions.ts

// Function to create a room
export async function fetch_create_room(serverUrl: string, roomUrl?: string) {
  try {
    const response = await fetch(`${serverUrl}create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: roomUrl ? JSON.stringify({ room_url: roomUrl }) : null,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Failed to create room" }));
      console.error("Error creating room:", errorData);
      return { error: true, detail: errorData.detail || "Unknown error" };
    }
    const data = await response.json();
    return data; // { room_url: string, token: string, room_name: string }
  } catch (error: any) {
    console.error("Network or other error in fetch_create_room:", error);
    return { error: true, detail: error.message || "Network error" };
  }
}

// Function to clone voice (as originally provided, sending to /clone_voice)
// Assumes the backend /clone_voice returns JSON like {"voice_id": "..."} on success
export async function cloneVoice(serverUrl: string, audioBlob: Blob): Promise<string | null> {
  const formData = new FormData();
  const fileName = `voice_sample_${Date.now()}.wav`; // Original filename generation
  formData.append("voice_file", audioBlob, fileName); // "voice_file" matches backend expectation

  try {
    console.log(`Sending audio blob (${(audioBlob.size / 1024).toFixed(1)} KB) to ${serverUrl}api/clone_voice`);
    const response = await fetch(`${serverUrl}clone_voice`, {
      method: "POST",
      body: formData,
    });

    const responseData = await response.json();

    if (!response.ok) {
      const errorDetail = responseData?.detail || `HTTP error ${response.status}`;
      console.error("Error cloning voice:", errorDetail);
      throw new Error(errorDetail); // Throw error for component to catch
    }

    if (responseData && responseData.voice_id) {
       console.log("Voice cloned successfully, Voice ID:", responseData.voice_id);
       return responseData.voice_id; // Return the voice ID
    } else {
       console.error("Cloning request succeeded, but response did not contain voice_id:", responseData);
       throw new Error("Cloning succeeded but no voice ID was returned.");
    }

  } catch (error: any) {
    console.error("Error in cloneVoice action:", error);
    // Re-throw the error so the calling component knows it failed
    throw new Error(error.message || "Failed to clone voice due to network or server error.");
  }
}


// Function to start the agent (as originally provided, sending necessary fields)
// This version already includes voiceId and customPrompt
export async function fetch_start_agent(
  roomUrl: string,
  token: string,
  serverUrl: string,
  selectedPrompt: string,
  voiceId: string | null, // Accept voiceId
  customPrompt: string | null // Accept customPrompt
) {
  try {
    console.log(`Requesting agent start for room: ${roomUrl}`);
    console.log(`  -> Prompt: ${selectedPrompt}`);
    console.log(`  -> Voice ID: ${voiceId || 'None provided (will use default)'}`);
    console.log(`  -> Custom Prompt: ${customPrompt ? 'Provided' : 'None'}`);

    const response = await fetch(`${serverUrl}start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room_url: roomUrl,
        token: token,
        selected_prompt: selectedPrompt,
        voice_id: voiceId, // Send null or the actual ID
        custom_prompt: customPrompt // Send null or the actual prompt
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Failed to start agent" }));
      console.error("Error starting agent:", errorData);
      return { error: true, detail: errorData.detail || "Unknown error starting agent" };
    }

    const data = await response.json();
    console.log("Agent start request successful:", data);
    return data; // { bot_id: string, room_url: string }
  } catch (error: any) {
    console.error("Network or other error in fetch_start_agent:", error);
    return { error: true, detail: error.message || "Network error starting agent" };
  }
}