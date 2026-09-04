const { GoogleGenAI } = require('@google/genai');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return Buffer.from(buffer);
}

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } });
  
  const LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";

  const created = await ai.authTokens.create({
    config: {
      uses: 1,
      liveConnectConstraints: { 
        model: LIVE_MODEL,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: "Say hello and introduce yourself."
        }
      },
      lockAdditionalFields: [],
    }
  });
  
  const token = created.name;
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
  
  const ws = new WebSocket(url);
  ws.on('open', () => { 
    console.log('WS OPENED'); 
    const setup = {
      setup: {
        model: `models/${LIVE_MODEL}`,
        generationConfig: { 
          responseModalities: ['AUDIO'],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {},
        }
      }
    };
    ws.send(JSON.stringify(setup));
  });
  
  ws.on('message', (data) => {
    const msg = data.toString();
    console.log('WS MESSAGE received length:', msg.length);
    if (msg.includes('setupComplete')) {
      console.log('Sending sine wave (speech)...');
      
      let sampleRate = 16000;
      let frequency = 440;
      
      // send 2 seconds of sine wave
      for(let t=0; t<2; t++) {
        let chunk = new Float32Array(sampleRate);
        for(let i=0; i<sampleRate; i++) {
          chunk[i] = Math.sin(2 * Math.PI * frequency * (i + t*sampleRate) / sampleRate);
        }
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              data: floatTo16BitPCM(chunk).toString('base64'),
              mimeType: "audio/pcm;rate=16000",
            }]
          }
        }));
      }
      
      console.log('Sending silence...');
      // send 3 seconds of silence
      for(let t=0; t<3; t++) {
        let chunk = new Float32Array(sampleRate);
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              data: floatTo16BitPCM(chunk).toString('base64'),
              mimeType: "audio/pcm;rate=16000",
            }]
          }
        }));
      }
    }
  });
  ws.on('close', (code, reason) => console.log('WS CLOSED', code, reason.toString()));
  ws.on('error', (err) => console.log('WS ERROR', err.message));
}
test().catch(console.error);
