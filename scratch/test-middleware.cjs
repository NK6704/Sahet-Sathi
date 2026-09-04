const express = require('express');

const app = express();

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
      if (!res.headersSent) next();
    } catch (err) {
      next(err);
    }
  };
}

const requireAuth = handler(async (req, res) => {
  req.caller = { id: 'trial-user-123' };
  return;
});

app.get('/test', requireAuth, handler(async (req, res) => {
  if (!req.caller) {
    res.status(401).json({ error: 'Sign in to continue' });
    return;
  }
  res.json({ success: true, caller: req.caller });
}));

const server = app.listen(3333, async () => {
  const res = await fetch('http://localhost:3333/test');
  const json = await res.json();
  console.log('Result:', json);
  server.close();
});
