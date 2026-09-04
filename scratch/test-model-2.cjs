const { GoogleGenAI } = require('@google/genai');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } });
  
  // Try gemini-2.0-flash-exp
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
  console.log('Got token for', LIVE_MODEL);
}
test().catch(console.error);
