const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const start = content.indexOf('app.post("/api/assistant/message"');
const end = content.indexOf('app.post("/api/voice/transcribe"');
console.log(content.substring(start, end));
