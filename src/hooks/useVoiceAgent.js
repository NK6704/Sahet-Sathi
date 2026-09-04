import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceLiveToken } from '@/services/api';

const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
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
  const [volume, setVolume] = useState(0);

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

    const context = playbackContextRef.current;
    if (!context) return;

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
    const context = captureContextRef.current;
    if (!context) {
      throw new Error('Audio capture is not supported in this browser.');
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

    sourceNodeRef.current = source;
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(context.destination);

    processor.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer.getChannelData(0);
      
      // Calculate RMS volume (0.0 to 1.0)
      let sumSquares = 0;
      for (let i = 0; i < inputBuffer.length; i++) {
        sumSquares += inputBuffer[i] * inputBuffer[i];
      }
      const rms = Math.sqrt(sumSquares / inputBuffer.length);
      // Scale it up nicely for visualizer (usually RMS is very small, like 0.05 for normal speech)
      setVolume(Math.min(1, rms * 10));

      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      
      const pcm16 = floatTo16BitPCM(inputBuffer);
      ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                data: toBase64(pcm16),
                mimeType: `audio/pcm;rate=${INPUT_RATE}`,
              },
            ],
          },
        }),
      );
    };
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: ' ' }] }],
              turnComplete: true,
            },
          }),
        );
      } catch {
        /* ignore send errors on shutdown */
      }
    }
    
    // Pause microphone capture but leave WebSocket open
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const start = useCallback(async () => {
    if (isConnected || isConnecting) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setIsConnected(true);
      if (processorRef.current) {
        processorRef.current.onaudioprocess = (event) => {
          const ws = wsRef.current;
          if (ws?.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = floatTo16BitPCM(input);
          ws.send(
            JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  {
                    data: toBase64(pcm16),
                    mimeType: `audio/pcm;rate=${INPUT_RATE}`,
                  },
                ],
              },
            }),
          );
        };
      }
      return;
    }

    setIsConnecting(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone access is not available in this browser.');
      return;
    }

    setError(null);

    try {
      // Eagerly initialize AudioContexts during the user gesture to prevent browser blocking
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!captureContextRef.current && AudioContextCtor) {
        captureContextRef.current = new AudioContextCtor({ sampleRate: INPUT_RATE });
      }
      if (!playbackContextRef.current && AudioContextCtor) {
        playbackContextRef.current = new AudioContextCtor({ sampleRate: OUTPUT_RATE });
      }

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

      const wsUrl = `${LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`;
      console.log('[useVoiceAgent] Connecting to WS:', LIVE_WS_URL);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[useVoiceAgent] WS OPENED. Sending setup...');
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${modelName}`,
              systemInstruction: {
                parts: [{ text: session?.config?.systemInstruction || '' }],
              },
              generationConfig: {
                responseModalities: session?.config?.responseModalities || ['AUDIO'],
              },
              realtimeInputConfig: {
                automaticActivityDetection: {}
              }
            },
          }),
        );
      };

      ws.onmessage = async (event) => {
        let message;

        try {
          let textData = event.data;
          if (textData instanceof Blob) {
            textData = await textData.text();
          }
          message = JSON.parse(textData);
          console.log('[useVoiceAgent] Received WS message keys:', Object.keys(message));
        } catch (err) {
          console.error('[useVoiceAgent] Error parsing WS message:', err);
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

      ws.onerror = (err) => {
        console.error('[useVoiceAgent] WS ERROR:', err);
        setError('Live voice connection failed.');
        cleanup();
      };

      ws.onclose = (event) => {
        console.log('[useVoiceAgent] WS CLOSED', event.code, event.reason);
        cleanup({ closeSocket: false });
      };
    } catch (err) {
      cleanup();
      setError(err?.message || 'Could not start live voice.');
    }
  }, [cleanup, isConnected, isConnecting, onResponse, onTranscript, onTurnComplete, playAudioChunk, startCapture]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    start,
    stop,
    isConnected,
    isConnecting,
    error,
    volume,
    language,
  };
}
