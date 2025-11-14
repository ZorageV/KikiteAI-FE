import { useState, useRef, useEffect } from "react";
import Iridescence from "./components/Iridescence";

export default function App() {
  const [stage, setStage] = useState("idle"); // idle | recording | loading | playing
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  // Start recording
  const startRecording = async () => {
    setStage("recording");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);

    mediaRecorder.onstop = async () => {
      setStage("loading");

      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      try {
        const formData = new FormData();
        formData.append("file", blob, "recording.webm");

        const response = await fetch("http://127.0.0.1:8000/chat", {
          method: "POST",
          headers: { "X-Language": "en-US" },
          body: formData,
        });

        if (!response.ok) throw new Error("API request failed");

        // Assume API returns audio as blob
        const responseBlob = await response.blob();
        const url = URL.createObjectURL(responseBlob);
        setAudioUrl(url);
        setStage("playing");
      } catch (err) {
        console.error(err);
        setStage("idle");
      }
    };

    mediaRecorder.start();
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const handleAudioEnd = () => {
    setStage("idle");
    setAudioUrl(null);
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#fff", // always white
        flexDirection: "column",
      }}
    >
      {stage === "idle" && (
        <button
          onClick={startRecording}
          style={{
            padding: "1rem 2rem",
            fontSize: "1.2rem",
            borderRadius: "10px",
            cursor: "pointer",
          }}
        >
          Record
        </button>
      )}

      {stage === "recording" && (
        <>
          <div style={{ marginBottom: "1rem" }}>Recording...</div>
          <button
            onClick={stopRecording}
            style={{
              padding: "1rem 2rem",
              fontSize: "1.2rem",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        </>
      )}

      {stage === "loading" && (
        <div style={{ fontSize: "1.2rem" }}>Processing and fetching response...</div>
      )}

      {stage === "playing" && audioUrl && (
        <div
          style={{
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <Iridescence color={[0.7, 0.8, 2.8]} speed={2} amplitude={1.2} />
          <audio
            ref={audioRef}
            src={audioUrl}
            autoPlay
            onEnded={handleAudioEnd}
          />
        </div>
      )}
    </div>
  );
}
