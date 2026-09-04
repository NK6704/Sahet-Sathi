const { GoogleGenAI } = require('@google/genai');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } });
  
  const LIVE_MODEL = "gemini-2.0-flash-exp";

  const created = await ai.authTokens.create({
    config: {
      uses: 1,
      liveConnectConstraints: { 
        model: LIVE_MODEL,
        config: {
          responseModalities: ["AUDIO", "TEXT"],
        }
      },
      lockAdditionalFields: [],
    }
  });
  
  const token = created.name;
  console.log('Got token:', token);
  
  // USE V1ALPHA HERE
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
  
  const ws = new WebSocket(url);
  ws.on('open', () => { 
    console.log('WS OPENED'); 
    const setup = {
      setup: {
        model: `models/${LIVE_MODEL}`,
        generationConfig: { 
          responseModalities: ["AUDIO", "TEXT"],
        }
      }
    };
    ws.send(JSON.stringify(setup));
  });
  
  ws.on('message', (data) => {
    console.log('WS MESSAGE:', data.toString().substring(0, 200)); 
  });
  ws.on('close', (code, reason) => console.log('WS CLOSED', code, reason.toString()));
  ws.on('error', (err) => console.log('WS ERROR', err.message));
}
test().catch(console.error);
