import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceLiveToken } from '@/services/api';

const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 2048;

function toBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function floatTo16BitPCM(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

function pcmBase64ToAudioBuffer(context, base64) {
  const bytes = fromBase64(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }

  const buffer = context.createBuffer(1, samples.length, OUTPUT_RATE);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

export function useVoiceAgent({
  language = 'English',
  onTranscript,
  onResponse,
  onTurnComplete,
} = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const captureContextRef = useRef(null);
  const playbackContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const playbackTimeRef = useRef(0);

  const cleanup = useCallback(({ closeSocket = true } = {}) => {
    const ws = wsRef.current;
    wsRef.current = null;

    if (closeSocket && ws && ws.readyState < WebSocket.CLOSING) {
      try {
        ws.close(1000, 'Voice session ended');
      } catch {
        /* ignore close errors */
      }
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        /* ignore disconnect errors */
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        /* ignore disconnect errors */
      }
      sourceNodeRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (captureContextRef.current) {
      void captureContextRef.current.close().catch(() => {});
      captureContextRef.current = null;
    }

    if (playbackContextRef.current) {
      void playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }

    playbackTimeRef.current = 0;
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const playAudioChunk = useCallback(async (base64) => {
    if (!base64) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const context =
      playbackContextRef.current || new AudioContextCtor({ sampleRate: OUTPUT_RATE });
    playbackContextRef.current = context;

    if (context.state === 'suspended') {
      await context.resume();
    }

    const buffer = pcmBase64ToAudioBuffer(context, base64);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const when = Math.max(context.currentTime + 0.03, playbackTimeRef.current);
    source.start(when);
    playbackTimeRef.current = when + buffer.duration;
  }, []);

  const startCapture = useCallback(async (ws, stream) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Audio capture is not supported in this browser.');
    }

    const context = new AudioContextCtor({ sampleRate: INPUT_RATE });
    captureContextRef.current = context;

    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

    sourceNodeRef.current = source;
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(context.destination);

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(input);
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: toBase64(pcm16),
              mimeType: `audio/pcm;rate=${INPUT_RATE}`,
            },
          },
        }),
      );
    };
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch {
        /* ignore send errors on shutdown */
      }
    }
    cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    if (isConnected || isConnecting) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone access is not available in this browser.');
      return;
    }

    setError(null);
    setIsConnecting(true);

    try {
      const session = await getVoiceLiveToken();
      const token = session?.token;
      const modelName = String(session?.config?.model || session?.model || '').replace(
        /^models\//,
        '',
      );

      if (!token || !modelName) {
        throw new Error('Voice is not available right now.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const setup = {
          setup: {
            model: `models/${modelName}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            realtimeInputConfig: {
              automaticActivityDetection: {},
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Aoede' },
              },
            },
          },
        };

        if (session?.config?.systemInstruction) {
          setup.setup.systemInstruction = {
            parts: [{ text: session.config.systemInstruction }],
          };
        }

        ws.send(JSON.stringify(setup));
      };

      ws.onmessage = async (event) => {
        let message;

        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.setupComplete) {
          setIsConnected(true);
          setIsConnecting(false);
          await startCapture(ws, stream);
          return;
        }

        const content = message.serverContent;
        if (!content) return;

        if (content.interrupted) {
          const playback = playbackContextRef.current;
          playbackTimeRef.current = playback ? playback.currentTime : 0;
        }

        if (content.inputTranscription?.text) {
          onTranscript?.({
            text: content.inputTranscription.text,
            final: true,
          });
        }

        if (content.outputTranscription?.text) {
          const final = Boolean(content.turnComplete);
          onResponse?.({
            text: content.outputTranscription.text,
            final,
          });
          if (final) onTurnComplete?.();
        } else if (content.turnComplete) {
          onTurnComplete?.();
        }

        const parts = content.modelTurn?.parts || [];
        for (const part of parts) {
          if (part?.inlineData?.data) {
            await playAudioChunk(part.inlineData.data);
          }
        }
      };

      ws.onerror = () => {
        setError('Live voice connection failed.');
        cleanup();
      };

      ws.onclose = () => {
        cleanup({ closeSocket: false });
      };
    } catch (err) {
      cleanup();
      setError(err?.message || 'Could not start live voice.');
    }
  }, [cleanup, isConnected, isConnecting, onResponse, onTranscript, onTurnComplete, playAudioChunk, startCapture]);

  useEffect(() => stop, [stop]);

  return {
    start,
    stop,
    isConnected,
    isConnecting,
    error,
    language,
  };
}
