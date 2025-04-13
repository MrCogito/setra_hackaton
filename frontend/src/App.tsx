// frontend/src/App.tsx

import { useState, useEffect } from "react";
import { useDaily } from "@daily-co/daily-react";
import { Ear, AlertCircle } from "lucide-react"; // Keep icons

// Import the new background component
import MatrixBackground from "./components/MatrixBackground";

import deeptrust from "./assets/logos/deeptrust.png";
import logoSign from "./assets/logos/logo-sign.png";
import MaintenancePage from "./components/MaintenancePage";
import Session from "./components/Session";
import { Configure, PromptSelect } from "./components/Setup";
import { generateCustomPrompt } from "./components/Setup/CustomPromptGenerator";
// --- MODIFIED: Import VoiceRecord instead of VoiceUpload ---
import { VoiceRecord } from "./components/Setup/VoiceRecord";
// --- END MODIFIED ---
import { Alert, AlertTitle} from "./components/ui/alert"; // Will need terminal styling
import { Button } from "./components/ui/button"; // Will need terminal styling
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card"; // Will need terminal styling
import * as DailyJs from "@daily-co/daily-js";
import { fetch_create_room, fetch_start_agent } from "./actions";

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

// --- Terminal Card Base Styles ---
// Sharp corners, black background, green border, mono font
const terminalCardBaseStyles = `
  bg-black/80 backdrop-blur-sm border border-matrix-green/50 rounded-none shadow-lg
  text-matrix-green-light font-mono w-full max-w-xl mx-4
  transition-colors duration-200 ease-in-out /* Keep subtle transitions */
`;

// --- Terminal Button Styles ---
const terminalButtonBaseStyles = `
  border border-matrix-green/70 text-matrix-green hover:bg-matrix-green/10
  hover:border-matrix-green hover:text-matrix-green-light
  focus:outline-none focus:ring-2 focus:ring-matrix-green focus:ring-offset-2 focus:ring-offset-black
  px-4 py-2 rounded-none text-sm uppercase tracking-wider font-medium transition-colors duration-150
  disabled:opacity-50 disabled:cursor-not-allowed disabled:border-gray-600 disabled:text-gray-500 disabled:bg-transparent
`;
const terminalButtonPrimaryStyles = `
  bg-matrix-green/80 border-matrix-green/90 text-black font-semibold
  hover:bg-matrix-green hover:text-black
  ${terminalButtonBaseStyles}
`;
const terminalButtonGhostStyles = `
  border-transparent text-matrix-green-light hover:bg-matrix-green/10 hover:text-matrix-green
  px-2 py-1 text-xs
  ${terminalButtonBaseStyles}
`;

export default function App() {
  const daily = useDaily();

  const [state, setState] = useState<State>("intro");
  const [selectedPrompt, setSelectedPrompt] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [startAudioOff, setStartAudioOff] = useState<boolean>(false);
  const [roomUrl] = useState<string | null>(roomQs || null);
  // --- MODIFIED: Keep clonedVoiceId state (updated by VoiceRecord) ---
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
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
      setCustomError(">>> Error: Please enter a scenario before continuing"); // Terminal style error
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
        setError(`>>> Error: Failed to generate custom prompt: ${e.message || 'Unknown error'}`);
        setState("error");
        setIsGeneratingPrompt(false);
        return;
      } finally {
        setIsGeneratingPrompt(false);
      }
    }

    if (!daily || (!serverUrl && !roomUrl)) {
         setError(">>> Error: Configuration error: Server URL or Room URL missing.");
         setState("error");
         return;
    }

    // --- MODIFIED: Use clonedVoiceId state directly ---
    // Voice cloning happens inside VoiceRecord component now
    const voiceIdToUse = clonedVoiceId || null;
    console.log(`Starting agent with Voice ID: ${voiceIdToUse} (Cloned: ${!!clonedVoiceId}, Default Env: ${defaultVoiceId})`);
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

      } catch (e: any) {
        console.error("Error during agent start/config fetch:", e);
        setError(`>>> Error: Unable to start agent or fetch config: ${e.message || 'Check server status.'}`);
        setState("error");
        return;
      }
    } else {
      // Manual room entry handling
      if (!roomUrl) {
          setError(">>> Error: Manual room entry requires a room_url query parameter.");
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
        setError(">>> Error: No room URL available to join.");
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
       let joinError = `>>> Error: Unable to join room: '${joinUrl}'. ${e.message || 'Check network or room status.'}`;
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
  const renderContent = () => {
    if (isMaintenanceMode) {
      // Apply terminal styling if MaintenancePage allows className
      return <MaintenancePage className="font-mono text-matrix-green" />;
    }

    if (state === "error") {
      return (
        <div className="flex items-center justify-center min-h-screen p-4">
          <Card className={`${terminalCardBaseStyles} max-w-md w-full border-red-500`}>
            <CardHeader>
              <CardTitle className="text-center text-red-400 uppercase tracking-wider">SYSTEM ERROR</CardTitle>
            </CardHeader>
            <CardContent>
              <Alert variant="destructive" className="bg-black/60 border border-red-500/50">
                {typeof AlertCircle !== 'undefined' && <AlertCircle className="h-4 w-4 text-red-400"/>}
                <AlertTitle className="font-bold text-red-400">Terminal Error Detected</AlertTitle>
                <AlertDescription className="text-red-300 font-mono">{error || ">>> Error: An unknown error occurred. Please try again."}</AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 border-t border-matrix-green/30 pt-4">
              <Button onClick={() => window.location.reload()} className={`${terminalButtonBaseStyles} w-full border-red-400 text-red-400`}>
                &gt; System.Reload()
              </Button>
              <Button variant="outline" onClick={leave} className={`${terminalButtonGhostStyles} w-full text-matrix-green-light`}>
                &lt; Return.To.Start()
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
          // Pass theme-related props if Session component supports it
          className="font-mono text-matrix-green"
        />
      );
    }

    if (state === "intro") {
      return (
        <Card className={`${terminalCardBaseStyles} animate-appear`}>
          <CardHeader className="text-center border-b border-matrix-green/30 pb-4">
            <CardTitle className="text-4xl md:text-5xl font-bold text-matrix-green uppercase tracking-widest">
              sentra.ai
            </CardTitle>
            <CardDescription className="text-lg md:text-xl font-medium mt-2 text-matrix-green-light lowercase">
              // DeepFake Security Training Simulation //
            </CardDescription>
            <div className="flex items-center justify-center gap-2 mt-4">
              <span className="text-xs text-matrix-green/70">// built_by:</span>
              <a
                href="https://www.deeptrust.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-80 hover:opacity-100 transition-opacity"
              >
                <img src={logoSign} alt="Sentra Logo" className="h-3 w-auto" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6 text-sm">
            <div className="flex flex-col gap-2 bg-matrix-green/5 p-3 border border-matrix-green/20">
              <p className="text-pretty text-matrix-green-light">
                <span className="text-matrix-green font-semibold">MISSION:</span> Democratize deepfake awareness. Provide SOTA security training accessible and engaging for individuals, businesses, and organizations to defend against the frontier of digital threats.
              </p>
            </div>
            <p className="text-xs text-center text-matrix-green/60">
              [System Ready] Press START to initialize...
            </p>
          </CardContent>
          <CardFooter className="border-t border-matrix-green/30 pt-4">
            <Button
              fullWidthMobile
              size="lg"
              className={`${terminalButtonPrimaryStyles} w-full`}
              onClick={() => setState("configuring_step1")}
            >
              &gt; Start Initialization
            </Button>
          </CardFooter>
        </Card>
      );
    }

    if (state === "configuring_step1") {
      return (
        <Card className={`${terminalCardBaseStyles} animate-appear`}>
          <CardHeader className="relative border-b border-matrix-green/30 pb-4">
            <Button
              variant="ghost"
              size="sm"
              className={`${terminalButtonGhostStyles} absolute left-2 top-2`}
              onClick={() => setState("intro")}
            >
              &lt; Back
            </Button>
            <div className="space-y-1 pt-8 text-center md:text-left">
              <CardTitle className="text-xl font-semibold text-matrix-green uppercase">
                Step 1: Device Configuration
              </CardTitle>
              <CardDescription className="text-matrix-green-light lowercase">
                // Configure microphone and speakers //
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="flex flex-row gap-2 bg-matrix-green/5 px-3 py-2 border border-matrix-green/20 text-xs items-center justify-center font-medium text-pretty text-matrix-green-light">
              <Ear className="size-4 text-matrix-green shrink-0" /> Optimal performance requires: quiet environment &amp; stable connection.
            </div>
            <Configure
              startAudioOff={startAudioOff}
              handleStartAudioOff={() => setStartAudioOff(!startAudioOff)}
              className="font-mono text-matrix-green"
            />
          </CardContent>
          <CardFooter className="border-t border-matrix-green/30 pt-4">
            <Button
              fullWidthMobile
              className={`${terminalButtonPrimaryStyles} w-full`}
              onClick={() => setState("configuring_step2")}
            >
              Next &gt;
            </Button>
          </CardFooter>
        </Card>
      );
    }

    if (state === "configuring_step2") {
      return (
        <Card className={`${terminalCardBaseStyles} animate-appear`}>
          <CardHeader className="relative border-b border-matrix-green/30 pb-4">
            <Button
              variant="ghost"
              size="sm"
              className={`${terminalButtonGhostStyles} absolute left-2 top-2`}
              onClick={() => setState("configuring_step1")}
            >
              &lt; Back
            </Button>
            <div className="space-y-1 pt-8 text-center md:text-left">
              <CardTitle className="text-xl font-semibold text-matrix-green uppercase">
                Step 2: Bot Behavior Customization
              </CardTitle>
              <CardDescription className="text-matrix-green-light lowercase">
                // Define interaction parameters //
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <VoiceRecord
              onVoiceCloned={handleVoiceCloned}
              serverUrl={serverUrl}
              className="font-mono text-matrix-green"
            />
            <div className="space-y-2">
              <PromptSelect
                selectedSetting={selectedPrompt}
                onSettingChange={setSelectedPrompt}
                onCustomPromptChange={setCustomScenario}
                customScenarioValue={customScenario}
                error={customError}
                className="font-mono text-matrix-green"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 border-t border-matrix-green/30 pt-4">
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <div className="flex-1 flex flex-col items-center">
                <Button
                  fullWidthMobile
                  size="lg"
                  className={`${terminalButtonBaseStyles} w-full bg-matrix-green/10`}
                  onClick={() => start(selectedPrompt, false)}
                  disabled={isGeneratingPrompt || (selectedPrompt === 'custom' && !customScenario.trim())}
                >
                  Chat 1:1 [TerifAI]
                </Button>
                <p className="text-xs text-matrix-green/60 mt-1.5 text-center">// Private Session //</p>
              </div>
              <div className="flex-1 flex flex-col items-center">
                <Button
                  fullWidthMobile
                  size="lg"
                  className={`${terminalButtonBaseStyles} w-full bg-matrix-green/10`}
                  onClick={() => start(selectedPrompt, true)}
                  disabled={!clonedVoiceId || isGeneratingPrompt || (selectedPrompt === 'custom' && !customScenario.trim())}
                >
                  Join Call [Video Enabled]
                </Button>
                <p className="text-xs text-matrix-green/60 mt-1.5 text-center">
                  {clonedVoiceId
                    ? "// Voice Clone Ready //"
                    : "// Requires Voice Recording //"}
                </p>
              </div>
            </div>
            {selectedPrompt === 'custom' && !customScenario.trim() && (
              <p className="text-xs text-yellow-400 text-center w-full">
                &gt;&gt;&gt; Warning: Custom scenario required. Input above.
              </p>
            )}
          </CardFooter>
        </Card>
      );
    }

    // Loading state (using structure from original code)
    if (state === "requesting_agent" || state === "connecting") {
      let loadingMessage = "System Initializing...";
      if (isGeneratingPrompt) loadingMessage = "Generating Custom Prompt...";
      else if (state === "requesting_agent") loadingMessage = "Initializing AI Assistant...";
      else if (state === "connecting") loadingMessage = "Establishing Connection...";

      return (
        <Card className={`${terminalCardBaseStyles} animate-appear`}>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4 text-center">
            <div className="h-6 w-3 bg-matrix-green animate-blink mb-2"></div>
            
            <div className="text-lg font-medium text-matrix-green uppercase tracking-wider">
              {loadingMessage}
            </div>
            
            {isGeneratingPrompt && generatedPrompt && (
              <div className="max-w-md w-full p-3 mt-2 bg-matrix-green/5 border border-matrix-green/20 text-left">
                <p className="text-xs font-semibold mb-2 text-matrix-green">// Generated Scenario Preview:</p>
                <p className="text-xs text-matrix-green-light whitespace-pre-wrap">
                  {generatedPrompt.substring(0,200)}{generatedPrompt.length > 200 ? '...' : ''}
                </p>
              </div>
            )}
            
            <CardDescription className="text-sm text-matrix-green/70 lowercase">
              {isGeneratingPrompt
                ? "// Crafting unique interaction parameters... Stand by... //"
                : "// Network traffic dependent. May take 1-2 minutes... //"}
            </CardDescription>
          </CardContent>
        </Card>
      );
    }

    // Fallback rendering
    return (
      <div className="flex items-center justify-center min-h-screen text-matrix-green font-mono">
        &gt;&gt;&gt; Unhandled application state: {state}
      </div>
    );
  };

  // Main wrapper to center content vertically and horizontally
  return (
    <div className="relative flex items-center justify-center min-h-screen w-full p-4 z-10">
      <MatrixBackground /> {/* Render the background */}
      {renderContent()}   {/* Render the main UI card */}
    </div>
  );
}