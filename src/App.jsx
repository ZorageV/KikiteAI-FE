import { useEffect, useRef, useState } from "react";
import "./App.css";

const WS_URL = "ws://localhost:8000/ws/audio";

export default function App() {
  const wsRef = useRef(null);

  const micCtxRef = useRef(null);
  const playCtxRef = useRef(null);

  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  const playbackQueueRef = useRef([]);
  const userSpeakingRef = useRef(false);
  const noiseFloorRef = useRef(0);

  // ---- Jitter buffer + timeline ----
  const TARGET_BUFFER_MS = 150;
  const bufferedMsRef = useRef(0);
  const playheadTimeRef = useRef(0);

  const [connected, setConnected] = useState(false);

  /* ===================== WS ===================== */

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      // interruption / reset
      if (typeof e.data === "string" && e.data.startsWith("{")) {
        stopPlayback();
        return;
      }

      // enqueue PCM16 @ 24kHz (base64)
      playbackQueueRef.current.push(e.data);

      // estimate duration
      const byteLen = atob(e.data).length;
      const samples = byteLen / 2;
      bufferedMsRef.current += (samples / 24000) * 1000;

      scheduleIfReady();
    };

    return () => ws.close();
  }, []);

  /* ===================== MIC ===================== */

  const startMic = async () => {
    const ctx = new AudioContext({ sampleRate: 16000 });
    micCtxRef.current = ctx;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    sourceRef.current = ctx.createMediaStreamSource(stream);
    processorRef.current = ctx.createScriptProcessor(1024, 1, 1);

    processorRef.current.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);

      let energy = 0;
      for (let i = 0; i < input.length; i++) energy += Math.abs(input[i]);

      noiseFloorRef.current =
        noiseFloorRef.current * 0.95 + energy * 0.05;

      const START = noiseFloorRef.current * 3.5;
      const STOP = noiseFloorRef.current * 1.5;

      if (energy > START && !userSpeakingRef.current) {
        userSpeakingRef.current = true;
        stopPlayback(); // barge-in
      }

      if (energy < STOP) {
        userSpeakingRef.current = false;
      }

      const pcm16 = floatTo16BitPCM(input);
      wsRef.current?.send(btoa(pcm16));
    };

    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    sourceRef.current.connect(processorRef.current);
    processorRef.current.connect(silentGain);
    silentGain.connect(ctx.destination);
  };

  /* ===================== PLAYBACK ===================== */

  const scheduleIfReady = async () => {
    if (userSpeakingRef.current) return;
    if (bufferedMsRef.current < TARGET_BUFFER_MS) return;
    if (playbackQueueRef.current.length === 0) return;

    if (!playCtxRef.current) {
      playCtxRef.current = new AudioContext({ sampleRate: 24000 });
      playheadTimeRef.current =
        playCtxRef.current.currentTime + 0.05; // safety lead
    }

    const ctx = playCtxRef.current;
    await ctx.resume();

    while (
      playbackQueueRef.current.length > 0 &&
      bufferedMsRef.current >= TARGET_BUFFER_MS
    ) {
      const chunk = playbackQueueRef.current.shift();
      scheduleChunk(chunk);
    }
  };

  const scheduleChunk = (base64Data) => {
    const ctx = playCtxRef.current;

    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);

    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const startTime = Math.max(
      playheadTimeRef.current,
      ctx.currentTime + 0.01
    );

    src.start(startTime);
    playheadTimeRef.current = startTime + buffer.duration;

    bufferedMsRef.current -= buffer.duration * 1000;
  };

  const stopPlayback = () => {
    playbackQueueRef.current.length = 0;
    bufferedMsRef.current = 0;
    playheadTimeRef.current = 0;

    if (playCtxRef.current) {
      playCtxRef.current.close();
      playCtxRef.current = null;
    }
  };

  /* ===================== UI ===================== */

  return (
    <div className="app-container">
      <button disabled={!connected} onClick={startMic}>
        Start Talking
      </button>
    </div>
  );
}

/* ===================== UTILS ===================== */

function floatTo16BitPCM(float32) {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);

  let offset = 0;
  for (let i = 0; i < float32.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return String.fromCharCode(...new Uint8Array(buffer));
}
