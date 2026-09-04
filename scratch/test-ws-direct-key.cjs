const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
const modelName = "gemini-2.0-flash";
const endpoint = "v1alpha";
const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${endpoint}.GenerativeService.BidiGenerateContent?key=${apiKey}`;

console.log('Connecting to:', wsUrl.substring(0, 100) + '...');
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('WS OPENED');
  ws.send(JSON.stringify({
    setup: {
      model: `models/${modelName}`,
      generationConfig: { responseModalities: ["AUDIO", "TEXT"] },
      systemInstruction: { parts: [{ text: "Hello" }] }
    }
  }));
});

ws.on('message', (data) => {
  console.log('MESSAGE:', data.toString().substring(0, 200));
});

ws.on('close', (code, reason) => {
  console.log('CLOSED:', code, reason.toString());
});

ws.on('error', (err) => {
  console.log('ERROR:', err.message);
});
