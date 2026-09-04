const { GoogleGenAI } = require('@google/genai');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

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
          systemInstruction: "Test system instruction"
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
    console.log('WS MESSAGE:', msg);
    if (msg.includes('setupComplete')) {
      ws.send(JSON.stringify({
        clientContent: {
          turns: [],
          turnComplete: true
        }
      }));
    }
  });
  ws.on('close', (code, reason) => console.log('WS CLOSED', code, reason.toString()));
  ws.on('error', (err) => console.log('WS ERROR', err.message));
}
test().catch(console.error);
