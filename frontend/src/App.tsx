// frontend/src/App.tsx

import { useState, useEffect } from "react";
import { useDaily } from "@daily-co/daily-react";
import { Ear, AlertCircle } from "lucide-react"; // Added AlertCircle
import * as DailyJs from "@daily-co/daily-js";

import deeptrust from "./assets/logos/deeptrust.png";
import MaintenancePage from "./components/MaintenancePage";
import Session from "./components/Session";
import { Configure, PromptSelect } from "./components/Setup";
import { generateCustomPrompt } from "./components/Setup/CustomPromptGenerator";
// --- MODIFIED: Import VoiceRecord instead of VoiceUpload ---
import { VoiceRecord } from "./components/Setup/VoiceRecord";
// --- END MODIFIED ---
import { Alert, AlertTitle } from "./components/ui/alert"; // Assuming these exist
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
// --- MODIFIED: Remove cloneVoice import from here ---
import { fetch_create_room, fetch_start_agent } from "./actions"; // cloneVoice is called by VoiceRecord internally
// --- END MODIFIED ---

const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === "true";

type State =
  | "intro"
  | "configuring_step1"
  | "configuring_step2"
  | "requesting_agent"
  | "connecting"
  | "connected"
  // | "started" // Merged into connected
  // | "finished" // Handled by leave
  | "error";

let serverUrl = import.meta.env.VITE_SERVER_URL;
if (serverUrl && !serverUrl.endsWith("/")) serverUrl += "/";

const autoRoomCreation = !parseInt(import.meta.env.VITE_MANUAL_ROOM_ENTRY);
const roomQs = new URLSearchParams(window.location.search).get("room_url");
const isOpenMic = !!parseInt(import.meta.env.VITE_OPEN_MIC);
const defaultVoiceId = import.meta.env.VITE_DEFAULT_ELEVENLABS_VOICE_ID || "";

export default function App() {
  const daily = useDaily();

  const [state, setState] = useState<State>("intro");
  const [selectedPrompt, setSelectedPrompt] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [startAudioOff, setStartAudioOff] = useState<boolean>(false);
  const [roomUrl] = useState<string | null>(roomQs || null);
  // --- MODIFIED: Remove voiceFile state ---
  // const [voiceFile, setVoiceFile] = useState<File | null>(null);
  // --- END MODIFIED ---
  // --- MODIFIED: Keep clonedVoiceId state (updated by VoiceRecord) ---
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  // --- END MODIFIED ---
  // --- MODIFIED: Remove isCloning state ---
  // const [isCloning, setIsCloning] = useState(false);
  // --- END MODIFIED ---
  const [customScenario, setCustomScenario] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    console.log("Current daily-js version:", DailyJs.version);
  }, []);

  // --- MODIFIED: Keep handleVoiceCloned callback for VoiceRecord ---
  const handleVoiceCloned = (voiceId: string | null) => {
    console.log("App.tsx received voice ID from VoiceRecord:", voiceId);
    setClonedVoiceId(voiceId); // Update state when voice is cloned
  };
  // --- END MODIFIED ---

  async function start(selectedPromptKey: string, joinCallAndRedirect: boolean) {
    if (selectedPromptKey === 'custom' && !customScenario.trim()) {
      setCustomError("Please enter a scenario before continuing");
      return;
    }
    setCustomError(null);
    setState("requesting_agent");

    let finalCustomPromptContent: string | null = null;
    if (selectedPromptKey === 'custom') {
      setIsGeneratingPrompt(true);
      setGeneratedPrompt("");
      try {
        finalCustomPromptContent = await generateCustomPrompt({
          customScenario,
          onGeneratedPrompt: setGeneratedPrompt
        });
        console.log("Custom prompt generated:", finalCustomPromptContent);
      } catch (e: any) {
        console.error("Prompt generation failed:", e);
        setError(`Failed to generate custom prompt: ${e.message || 'Unknown error'}`);
        setState("error");
        setIsGeneratingPrompt(false);
        return;
      } finally {
        setIsGeneratingPrompt(false);
      }
    }

    if (!daily || (!serverUrl && !roomUrl)) {
         setError("Configuration error: Server URL or Room URL missing.");
         setState("error");
         return;
    }

    // --- MODIFIED: Use clonedVoiceId state directly ---
    // Voice cloning happens inside VoiceRecord component now
    const voiceIdToUse = clonedVoiceId || null;
    console.log(`Starting agent with Voice ID: ${voiceIdToUse} (Cloned: ${!!clonedVoiceId}, Default Env: ${defaultVoiceId})`);
    // --- END MODIFIED ---

    // --- MODIFIED: Remove direct cloning logic ---
    // let cloneResult = ""; // No longer needed
    // if (voiceFile) { ... } // This block is removed
    // --- END MODIFIED ---

    let agentStartData;
    let config; // Declare config here

    if (serverUrl) {
      setState("requesting_agent"); // Ensure state is set
      try {
        config = await fetch_create_room(serverUrl, roomUrl || undefined);
        if (config.error) {
          throw new Error(config.detail || "Failed to get room configuration.");
        }

        agentStartData = await fetch_start_agent(
          config.room_url,
          config.token,
          serverUrl,
          selectedPromptKey,
          // --- MODIFIED: Pass voiceIdToUse (from state) ---
          voiceIdToUse,
          // --- END MODIFIED ---
          finalCustomPromptContent
        );

        if (agentStartData.error) {
          throw new Error(agentStartData.detail || "Failed to start the AI agent.");
        }

        // --- REMOVED: Redundant state transition and redirect logic here ---
        // This was causing issues, moved after daily.join
        // if (redirect) {
        //   window.location.href = config.room_url;
        // } else {
        //   setState("connected");
        // }
        // --- END REMOVED ---

      } catch (e: any) {
        console.error("Error during agent start/config fetch:", e);
        setError(`Unable to start agent or fetch config: ${e.message || 'Check server status.'}`);
        setState("error");
        return;
      }
    } else {
      // Manual room entry handling
      if (!roomUrl) {
          setError("Manual room entry requires a room_url query parameter.");
          setState("error");
          return;
      }
      console.warn("No server URL provided. Attempting direct join (agent won't be started).");
      config = { room_url: roomUrl, token: null };
      agentStartData = { room_url: roomUrl };
    }

    // --- Join the daily session ---
    const joinUrl = agentStartData?.room_url || config?.room_url;
    // *** FIX: Use token from config ***
    const joinToken = config?.token;
    // *** END FIX ***

    if (!joinUrl) {
        setError("No room URL available to join.");
        setState("error");
        return;
    }

    console.log(`Attempting to join Daily room: ${joinUrl}`);
    console.log(`Using token for join: ${joinToken ? 'Provided' : 'None'}`);
    setState("connecting");

    try {
      await daily.join({
        url: joinUrl,
        token: joinToken || undefined, // Pass correct token
        videoSource: false,
        startAudioOff: startAudioOff,
      });
      // --- MODIFIED: Set state AFTER successful join ---
      setState("connected");
      // --- END MODIFIED ---

      // --- MODIFIED: Redirect AFTER successful join ---
      if (joinCallAndRedirect) {
        console.log("Redirecting to call URL:", joinUrl);
        window.location.href = joinUrl; // Redirect now
      }
      // --- END MODIFIED ---

    } catch (e: any) {
      console.error("Failed to join Daily room:", e);
       let joinError = `Unable to join room: '${joinUrl}'. ${e.message || 'Check network or room status.'}`;
      if (e.message && (e.message.toLowerCase().includes('token') || e.message.toLowerCase().includes('auth'))) {
          joinError += " This might be due to an invalid or missing token."
      }
      setError(joinError);
      setState("error");
      return;
    }
  }

  async function leave() {
    setState("intro");
    setClonedVoiceId(null); // Reset cloned ID on leave
    setError(null);
    setGeneratedPrompt("");
    setCustomScenario("");
    setSelectedPrompt("default");

    try {
        if (daily && daily.meetingState() !== 'left-meeting') {
            await daily.leave();
            await daily.destroy();
        }
    } catch(e) {
        console.error("Error leaving/destroying Daily call:", e);
    } finally {
        if (state !== 'intro') {
             setState("intro");
        }
    }
  }

  // --- RENDER LOGIC ---

  if (isMaintenanceMode) {
    return <MaintenancePage />;
  }

  if (state === "error") {
    // Using the error display structure from your original code
    return (
        <div className="flex items-center justify-center min-h-screen p-4">
             <Card className="max-w-md w-full">
                 <CardHeader>
                     <CardTitle className="text-center text-red-600">Error</CardTitle>
                 </CardHeader>
                 <CardContent>
                    <Alert variant="destructive">
                       {/* Render icon conditionally if available */}
                       {typeof AlertCircle !== 'undefined' && <AlertCircle className="h-4 w-4"/>}
                       <AlertTitle className="font-bold">An error occurred</AlertTitle>
                       <AlertDescription>{error || "An unknown error occurred. Please try again."}</AlertDescription>
                    </Alert>
                 </CardContent>
                 <CardFooter className="flex flex-col gap-2">
                    <Button onClick={() => window.location.reload()} className="w-full">
                        Reload Page
                    </Button>
                     <Button variant="outline" onClick={leave} className="w-full">
                        Back to Start
                    </Button>
                 </CardFooter>
             </Card>
        </div>
    );
  }

  if (state === "connected") {
    return (
      <Session
        onLeave={leave}
        openMic={isOpenMic}
        startAudioOff={startAudioOff}
      />
    );
  }

  if (state === "intro") {
    // Using the intro structure from your original code
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card shadow className="animate-appear max-w-lg">
          <CardHeader>
            <CardTitle className="text-6xl font-extrabold text-primary font-sans tracking-tight">
              TerifAI
            </CardTitle>
            <CardDescription className="text-2xl font-medium mt-3 font-montserrat">
              Welcome to the AI Voice-Phishing Experience
            </CardDescription>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-sm text-gray-500">built by</span>
              <a
                href="https://www.deeptrust.ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src={deeptrust} alt="Deeptrust Logo" className="h-4 w-auto" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 bg-primary-50 px-4 py-3 md:p-3 rounded-md">
              <p className="text-base text-pretty">
                This app showcases how AI can be used to clone voices and impersonate others.
                By understanding these risks, we can better protect ourselves and others.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              fullWidthMobile
              size="lg"
              onClick={() => setState("configuring_step1")}
            >
              Let's Get Started! →
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state === "configuring_step1") {
    // Using the config step 1 structure from your original code
    return (
      <Card shadow className="animate-appear max-w-lg">
        <CardHeader className="relative space-y-6">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-4 top-4 text-muted-foreground hover:text-foreground hover:bg-gray-50"
            onClick={() => setState("intro")}
          >
            ← Back
          </Button>
          <div className="space-y-1.5 pt-6">
            <CardTitle>Configure your devices</CardTitle>
            <CardDescription>
              Please configure your microphone and speakers below
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent stack>
          <div className="flex flex-row gap-2 bg-primary-50 px-4 py-2 md:p-2 text-sm items-center justify-center rounded-md font-medium text-pretty">
            <Ear className="size-7 md:size-5 text-primary-400" />
            Works best in a quiet environment with a good internet.
          </div>
          <Configure
            startAudioOff={startAudioOff}
            handleStartAudioOff={() => setStartAudioOff(!startAudioOff)}
          />
        </CardContent>
        <CardFooter>
          <Button
            fullWidthMobile
            onClick={() => setState("configuring_step2")}
          >
            Next
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (state === "configuring_step2") {
    // Using the config step 2 structure from your original code
    return (
      <Card shadow className="animate-appear max-w-lg">
        <CardHeader className="relative space-y-6">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-4 top-4 text-muted-foreground hover:text-foreground hover:bg-gray-50"
            onClick={() => setState("configuring_step1")}
          >
            ← Back
          </Button>
          <div className="space-y-1.5 pt-6">
            <CardTitle>Customize Bot Behavior</CardTitle>
            <CardDescription>
              Choose how you want the bot to interact
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* --- MODIFIED: Use VoiceRecord component --- */}
          <VoiceRecord
            onVoiceCloned={handleVoiceCloned} // Pass callback
            serverUrl={serverUrl}             // Pass server URL
          />
          {/* --- END MODIFIED --- */}
          <div className="space-y-2">
            <PromptSelect
              selectedSetting={selectedPrompt}
              onSettingChange={setSelectedPrompt}
              onCustomPromptChange={setCustomScenario}
              customScenarioValue={customScenario} // Pass value back to input
              error={customError}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <div className="flex gap-3 w-full">
            <div className="flex-1">
              <Button
                fullWidthMobile
                size="lg"
                className="w-full"
                onClick={() => start(selectedPrompt, false)}
              >
                Let's Chat 😊
              </Button>
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                1:1 conversation with TerifAI
              </p>
            </div>
            <div className="flex-1">
              <Button
                fullWidthMobile
                size="lg"
                className="w-full"
                onClick={() => start(selectedPrompt, true)}
                // --- MODIFIED: Disable based on clonedVoiceId ---
                disabled={!clonedVoiceId}
                // --- END MODIFIED ---
              >
                Join Call ☎️
              </Button>
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                {/* --- MODIFIED: Update text based on clonedVoiceId --- */}
                {clonedVoiceId
                    ? "Open video call with your cloned voice"
                    : "Record voice sample above to enable call with cloned voice"
                 }
                 {/* --- END MODIFIED --- */}
              </p>
            </div>
          </div>
        </CardFooter>
      </Card>
    );
  }

  // Loading state (using structure from original code)
  // --- MODIFIED: Removed isCloning check ---
  if (state === "requesting_agent" || state === "connecting") {
     let loadingMessage = "Please wait...";
     if (isGeneratingPrompt) loadingMessage = "Generating Custom Prompt...";
     else if (state === "requesting_agent") loadingMessage = "Starting AI Assistant...";
     else if (state === "connecting") loadingMessage = "Connecting to call...";
  // --- END MODIFIED ---

    return (
      <Card shadow className="animate-appear max-w-lg">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="mt-8 text-lg font-medium">
            {/* --- MODIFIED: Simplified loading message logic --- */}
            {loadingMessage}
            {/* --- END MODIFIED --- */}
          </div>
          {isGeneratingPrompt && generatedPrompt && (
            <div className="max-w-md w-full p-4 bg-gray-50 rounded-md border">
               <p className="text-sm font-semibold mb-2 text-gray-600">Generated Scenario Preview:</p> {/* Added heading */}
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{generatedPrompt.substring(0,200)}{generatedPrompt.length > 200 ? '...' : ''}</p> {/* Truncate preview */}
            </div>
          )}
          <CardDescription className="text-center text-sm text-muted-foreground">
            {/* --- MODIFIED: Simplified description logic --- */}
            {isGeneratingPrompt
              ? "Generating your custom scenario..."
              : "Depending on traffic, this may take 1 to 2 minutes..."
            }
            {/* --- END MODIFIED --- */}
          </CardDescription>
        </CardContent>
      </Card>
    );
  }

  // Fallback rendering
   return (
       <div className="flex items-center justify-center min-h-screen">
           Unhandled application state: {state}
       </div>
   );
}