import { useState, useRef } from 'react';
import DarkVeil from './components/DarkVeil'

export default function App() {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const toggleRecording = async () => {
    if (!recording) {
      // START recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.start();
        setRecording(true);
        console.log('Recording started...');
      } catch (err) {
        console.error('Microphone access denied:', err);
      }
    } else {
      // STOP recording
      mediaRecorderRef.current.stop();
      setRecording(false);

      mediaRecorderRef.current.onstop = async () => {
        console.log('Recording stopped');

        const blob = new Blob(audioChunksRef.current, {
          type: mediaRecorderRef.current.mimeType,
        });

        // Send audio to API
        const formData = new FormData();
        formData.append('file', blob, 'recording.webm');

        try {
          const response = await fetch('http://127.0.0.1:8000/chat', {
            method: 'POST',
            headers: { 'X-Language': 'en-US' },
            body: formData,
          });

          const audioBlob = new Blob([await response.arrayBuffer()], {
            type: blob.type,
          });
          new Audio(URL.createObjectURL(audioBlob)).play();
        } catch (err) {
          console.error('Error sending file to API:', err);
        }
      };
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* DarkVeil background */}
      <DarkVeil
        hueShift={30}
        noiseIntensity={0.1}
        scanlineIntensity={0.05}
        warpAmount={0.02}
      />

      {/* Foreground content */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <button
          onClick={toggleRecording}
          style={{
            padding: '18px 42px',
            fontSize: '20px',
            fontWeight: '600',
            borderRadius: '14px',
            border: '1px solid rgba(255,255,255,0.6)',
            cursor: 'pointer',
            background: recording ? '#f44336' : '#4CAF50',
            color: 'white',
          }}
        >
          {recording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </div>
    </div>
  );
}
