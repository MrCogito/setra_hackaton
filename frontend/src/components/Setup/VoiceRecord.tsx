// frontend/src/components/Setup/VoiceRecord.tsx

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button"; // Assuming you have a Button component from your UI library
import { Loader2, Mic, Square, AlertCircle } from "lucide-react"; // Example icons

interface VoiceRecordProps {
  onVoiceCloned: (voiceId: string | null) => void;
  serverUrl: string; // Keep serverUrl if needed for API endpoint
}

type RecordingStatus = "idle" | "permission" | "recording" | "processing" | "success" | "error";

// Make sure this path is correct relative to VoiceRecord.tsx
// If actions.ts is in src/, the path might be '../../actions'
import { cloneVoice } from "../../actions"; // Adjust path if necessary

export const VoiceRecord: React.FC<VoiceRecordProps> = ({ onVoiceCloned, serverUrl }) => {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null); // To keep track of the stream for stopping tracks

  // Cleanup function
  useEffect(() => {
    return () => {
      stopMediaStream(); // Ensure media stream is stopped on unmount
    };
  }, []);


  const stopMediaStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        console.log("Media stream stopped.");
      }
  };

  const requestMicrophonePermission = async () => {
    setStatus("permission");
    setErrorMessage(null);
    console.log("Requesting microphone permission...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; // Store the stream
      console.log("Microphone permission granted.");
      setStatus("idle"); // Permission granted, ready to record
      return stream;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setErrorMessage("Microphone access denied. Please allow microphone access in your browser settings.");
      setStatus("error");
      return null;
    }
  };

  const startRecording = async () => {
    // Ensure previous stream is stopped before requesting a new one if necessary
    stopMediaStream();

    let stream = streamRef.current; // Check if we already have a stream (though unlikely after stopMediaStream)
    if (!stream) {
        stream = await requestMicrophonePermission();
        if (!stream) {
            console.log("Permission denied or error, cannot start recording.");
            return; // Permission denied or error
        }
    }

    setStatus("recording");
    setErrorMessage(null);
    setClonedVoiceId(null); // Reset previous clone ID
    onVoiceCloned(null); // Inform parent that previous clone ID is invalid

    audioChunksRef.current = []; // Clear previous chunks
    console.log("Starting recording...");

    try {
        // Use a common MIME type, though server might re-encode
        const options = { mimeType: 'audio/webm;codecs=opus' }; // webm is widely supported
        let recorder : MediaRecorder;
        try {
           recorder = new MediaRecorder(stream, options);
           console.log(`Using mimeType: ${options.mimeType}`);
        } catch (e1) {
           console.warn(`mimeType ${options.mimeType} not supported, trying default.`);
           try {
               recorder = new MediaRecorder(stream); // Try default
               console.log(`Using default mimeType: ${recorder.mimeType}`);
           } catch (e2) {
               console.error("MediaRecorder creation failed:", e2);
               setErrorMessage("Could not create audio recorder. Your browser might not support it.");
               setStatus("error");
               stopMediaStream();
               return;
           }
        }

        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
                // console.log(`Audio chunk received: ${event.data.size} bytes`);
            }
        };

        recorder.onstop = async () => {
            console.log("Recording stopped. Processing audio...");
            setStatus("processing");
            const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType }); // Use recorded mimeType
            console.log(`Created audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
            audioChunksRef.current = []; // Clear chunks after creating blob

            // --- Send Blob to Backend ---
            // Use the cloneVoice action directly
            try {
                // cloneVoice should handle FormData creation internally if needed,
                // or just take the blob and serverUrl. Adjust cloneVoice if necessary.
                // Assuming cloneVoice takes serverUrl and the blob/file.
                const resultVoiceId = await cloneVoice(serverUrl, audioBlob); // Pass blob directly

                if (resultVoiceId) {
                    console.log("Voice cloning successful, received ID:", resultVoiceId);
                    setClonedVoiceId(resultVoiceId);
                    onVoiceCloned(resultVoiceId); // Send ID to parent
                    setStatus("success");
                } else {
                    // This case might happen if cloneVoice returns null/undefined on failure
                    throw new Error("Cloning process completed but no voice_id was returned.");
                }

            } catch (error: any) {
                console.error("Error uploading/cloning voice:", error);
                // Attempt to get a more specific message from the error if possible
                const detail = error?.detail || error?.message || "Failed to clone voice.";
                setErrorMessage(detail);
                setStatus("error");
            } finally {
                 stopMediaStream(); // Stop tracks after processing is done or failed
            }
        };

        recorder.onerror = (event: Event) => {
             // The event itself might not be very informative, cast to MediaRecorderErrorEvent if needed
             console.error("MediaRecorder error:", event);
             setErrorMessage("An error occurred during recording.");
             setStatus("error");
             stopMediaStream();
        }

        recorder.start(); // Start recording

    } catch (error) {
         console.error("Error starting recording setup:", error);
         setErrorMessage("Failed to start recording.");
         setStatus("error");
         stopMediaStream(); // Clean up stream if setup failed
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === "recording") {
      console.log("Stop recording button clicked.");
      mediaRecorderRef.current.stop(); // This will trigger the 'onstop' handler
      // Don't stop the media stream here, wait for onstop to finish processing
    } else {
        console.log("Stop recording called but recorder not active or not in recording state.");
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold">Record Voice Sample (Optional)</h3>
      <div className="flex items-center gap-2">
        <Button
          onClick={startRecording}
          disabled={status === "recording" || status === "processing" || status === "permission"}
          variant="outline"
          size="sm"
        >
          {/* Conditional rendering for loading/mic icon */}
          {status === "permission" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
          Record
        </Button>
        <Button
          onClick={stopRecording}
          disabled={status !== "recording"}
          variant="destructive" // Use destructive variant for stop
          size="sm"
        >
          <Square className="mr-2 h-4 w-4" />
          Stop
        </Button>
      </div>

      {/* Status Messages */}
      {status === "permission" && (
         <p className="text-xs text-muted-foreground flex items-center"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Requesting microphone permission...</p>
      )}
       {status === "recording" && (
         <p className="text-xs text-primary flex items-center"><Mic className="mr-1 h-3 w-3 text-red-500 animate-pulse" /> Recording...</p>
      )}
       {status === "processing" && (
         <p className="text-xs text-muted-foreground flex items-center"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Processing audio...</p>
      )}
       {status === "success" && clonedVoiceId && (
         <p className="text-xs text-green-600">
           Voice cloned successfully! Ready to use.
           {/* Optionally show ID: ID: <span className="font-mono bg-muted px-1 rounded">{clonedVoiceId}</span> */}
         </p>
      )}
      {status === "error" && errorMessage && (
        <p className="text-xs text-red-500 flex items-center">
            <AlertCircle className="mr-1 h-3 w-3" /> {errorMessage}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Record 10-20 seconds of clear speech for best results.</p>
    </div>
  );
};