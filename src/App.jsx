import { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:8000/ws/audio";


export default function App() {
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const outputQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const currentSourceRef = useRef(null);
  const playbackBufferRef = useRef([]);
  const PLAYBACK_CHUNK_MS = 120; // sweet spot for voice
  const noiseFloorRef = useRef(0);



  const [debug, setDebug] = useState({
    wsMessages: 0,
    queued: 0,
    playing: false,
    lastChunkBytes: 0,
  });


  const updateDebug = (patch) =>
    setDebug((d) => ({ ...d, ...patch }));




  const [connected, setConnected] = useState(false);

  useEffect(() => {
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      console.log("WS connected");
      setConnected(true);
    };

    wsRef.current.onclose = () => setConnected(false);

    wsRef.current.onmessage = (e) => {
      playbackBufferRef.current.push(e.data);
      maybePlayBufferedAudio();
    };




    return () => wsRef.current?.close();
  }, []);

  const startMic = async () => {
    audioCtxRef.current = new AudioContext({ sampleRate: 16000 });

    // const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);

    processorRef.current = audioCtxRef.current.createScriptProcessor(1024, 1, 1);

    processorRef.current.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);

      // --- compute energy ---
      let energy = 0;
      for (let i = 0; i < input.length; i++) {
        energy += Math.abs(input[i]);
      }

      // --- adaptive noise floor ---
      noiseFloorRef.current =
        noiseFloorRef.current * 0.95 + energy * 0.05;

      const START_THRESHOLD = noiseFloorRef.current * 3.5;
      const STOP_THRESHOLD = noiseFloorRef.current * 1.5;

      // --- SPEECH START (edge) ---
      if (energy > START_THRESHOLD && !userSpeakingRef.current) {
        userSpeakingRef.current = true;

        console.log("[BARGE-IN] user started speaking → pause output");

        // 🔥 STOP CURRENT OUTPUT IMMEDIATELY
        if (currentSourceRef.current) {
          currentSourceRef.current.stop();
          currentSourceRef.current = null;
        }

        // 🔥 CLEAR FUTURE OUTPUT
        playbackBufferRef.current.length = 0;
        isPlayingRef.current = false;
      }

      // --- SPEECH END ---
      if (energy < STOP_THRESHOLD && userSpeakingRef.current) {
        userSpeakingRef.current = false;
      }

      // --- ALWAYS send mic audio ---
      const pcm16 = floatTo16BitPCM(input);
      wsRef.current.send(btoa(pcm16));
    };



    // keep audio graph alive without feedback
    const silentGain = audioCtxRef.current.createGain();
    silentGain.gain.value = 0; // 🔇 silence

    sourceRef.current.connect(processorRef.current);
    processorRef.current.connect(silentGain);
    silentGain.connect(audioCtxRef.current.destination);
  };
  
  const maybePlayBufferedAudio = async () => {
    if (isPlayingRef.current) return;
    if (userSpeakingRef.current) return; 

    const bufferedChunks = playbackBufferRef.current.length;
    if (bufferedChunks < 5) return;

    // 🔑 mark playback active BEFORE starting
    isPlayingRef.current = true;

    // merge BYTES, not base64
    const chunks = playbackBufferRef.current.splice(0, bufferedChunks);

    const byteArrays = chunks.map((b64) =>
      Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    );

    const totalLength = byteArrays.reduce((s, a) => s + a.length, 0);
    const merged = new Uint8Array(totalLength);

    let offset = 0;
    for (const arr of byteArrays) {
      merged.set(arr, offset);
      offset += arr.length;
    }

    await playAudioBytes(merged);
  };

  const playAudioBytes = async (bytes) => {
    const ctx =
      audioCtxRef.current ||
      new AudioContext({ sampleRate: 24000 });

    audioCtxRef.current = ctx;
    await ctx.resume();

    // PCM16 → Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);

    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    currentSourceRef.current = src;

    src.onended = () => {
      currentSourceRef.current = null;
      isPlayingRef.current = false; // 🔑 RELEASE QUEUE
      maybePlayBufferedAudio();     // play next batch if exists
    };

    src.start();
  };
  const stopAllOutput = () => {
    // stop currently playing audio
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }

    // clear buffered audio
    playbackBufferRef.current.length = 0;

    // reset playback state
    isPlayingRef.current = false;
  };




  // const tryPlayNext = async () => {
  //   if (isPlayingRef.current) return;
  //   if (outputQueueRef.current.length === 0) return;

  //   isPlayingRef.current = true;
  //   const chunk = outputQueueRef.current.shift();
  //   await playAudio(chunk);
  // };
  const tryPlayNext = async () => {
    if (isPlayingRef.current) {
      console.log("[PLAYBACK] already playing, skip");
      return;
    }

    if (outputQueueRef.current.length === 0) {
      console.log("[PLAYBACK] queue empty");
      return;
    }

    const chunk = outputQueueRef.current.shift();

    console.log(
      "[PLAYBACK] starting chunk, remaining queue:",
      outputQueueRef.current.length
    );

    updateDebug({
      queued: outputQueueRef.current.length,
      playing: true,
    });

    isPlayingRef.current = true;
    await playAudio(chunk);
  };



  return (
    <div style={{ padding: 20 }}>
      <h2>Gemini Live Voice</h2>
      <button disabled={!connected} onClick={startMic}>
        Start Talking
      </button>
    </div>
  );
}

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
