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
        systemInstruction: {
          parts: [{ text: "Say hello." }],
        },
        generationConfig: { 
          responseModalities: ["AUDIO"],
        }
      }
    };
    ws.send(JSON.stringify(setup));
  });
  
  ws.on('message', (data) => {
    const msg = data.toString();
    console.log('WS MESSAGE received length:', msg.length);
    if (msg.includes('setupComplete')) {
      console.log('Sending audio chunk...');
      
      let sampleRate = 16000;
      let chunk = new Float32Array(sampleRate); // 1 sec silence
      ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            data: floatTo16BitPCM(chunk).toString('base64'),
            mimeType: "audio/pcm;rate=16000",
          }]
        }
      }));
      
      console.log('Sending dummy text turnComplete');
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text: " " }] }],
          turnComplete: true
        }
      }));
    }
  });
  ws.on('close', (code, reason) => console.log('WS CLOSED', code, reason.toString()));
  ws.on('error', (err) => console.log('WS ERROR', err.message));
}
test().catch(console.error);
