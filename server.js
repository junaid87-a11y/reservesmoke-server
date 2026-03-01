const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const APP_ID = process.env.APP_ID || 'X2RDPYNGEKNPC';
const APP_SECRET = process.env.APP_SECRET || '24a195ce-953b-7641-afa2-1a8e696d75e6';
const MERCHANT_ID = process.env.MERCHANT_ID || '526334862889';
const APP_PIN = process.env.APP_PIN || '1234';
const TOKEN_FILE = '/tmp/clover_token.json';

// Load saved token
function getToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE));
      return data.token;
    }
  } catch(e) {}
  return process.env.CLOVER_TOKEN || null;
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }));
}

// OAuth callback - Clover redirects here with token
app.get('/callback', (req, res) => {
  const { access_token, merchant_id, code } = req.query;
  
  if (access_token) {
    saveToken(access_token);
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0a0a0a; color:white; flex-direction:column; }
          .check { font-size:80px; margin-bottom:20px; }
          h1 { color:#4ade80; margin:0 0 10px; }
          p { color:#888; }
        </style>
      </head>
      <body>
        <div class="check">✅</div>
        <h1>Connected!</h1>
        <p>Your ReserveSmoke app is now connected to Clover.</p>
        <p>Close this page and open your app!</p>
      </body>
      </html>
    `);
  }

  // If we got a code, exchange it for token
  if (code) {
    axios.post('https://api.clover.com/oauth/token', null, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, code }
    }).then(response => {
      const token = response.data.access_token;
      saveToken(token);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0a0a0a; color:white; flex-direction:column; }
          </style>
        </head>
        <body>
          <h1 style="color:#4ade80">✅ Connected to Clover!</h1>
          <p>Close this and open your app.</p>
        </body>
        </html>
      `);
    }).catch(err => {
      res.status(500).send('Error exchanging code: ' + err.message);
    });
    return;
  }

  res.status(400).send('No token received');
});

// Connect page - visit this to start OAuth
app.get('/connect', (req, res) => {
  const oauthUrl = `https://www.clover.com/oauth/v2/authorize?client_id=${APP_ID}&response_type=token&merchant_id=${MERCHANT_ID}&redirect_uri=https://reservesmoke-server.onrender.com/callback`;
  res.redirect(oauthUrl);
});

// Health check
app.get('/health', (req, res) => {
  const token = getToken();
  res.json({ status: 'ok', merchant: MERCHANT_ID, connected: !!token });
});

// PIN auth
app.post('/auth/pin', (req, res) => {
  const { pin } = req.body;
  if (pin === APP_PIN) {
    res.json({ success: true, token: 'app-session-' + Date.now() });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

// Middleware to check Clover token
function requireToken(req, res, next) {
  const token = getToken();
  if (!token) {
    return res.status(503).json({ 
      error: 'Not connected to Clover', 
      connectUrl: 'https://reservesmoke-server.onrender.com/connect' 
    });
  }
  req.cloverToken = token;
  next();
}

// Get inventory
app.get('/api/inventory', requireToken, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/items`,
      {
        headers: { Authorization: `Bearer ${req.cloverToken}` },
        params: { limit: 1000, expand: 'categories,price' }
      }
    );
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      // Token expired, clear it
      try { fs.unlinkSync(TOKEN_FILE); } catch(e) {}
      return res.status(401).json({ error: 'Token expired, please reconnect', connectUrl: 'https://reservesmoke-server.onrender.com/connect' });
    }
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Update item
app.put('/api/inventory/:itemId', requireToken, async (req, res) => {
  try {
    const response = await axios.post(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/items/${req.params.itemId}`,
      req.body,
      { headers: { Authorization: `Bearer ${req.cloverToken}`, 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Create item
app.post('/api/inventory', requireToken, async (req, res) => {
  try {
    const response = await axios.post(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/items`,
      req.body,
      { headers: { Authorization: `Bearer ${req.cloverToken}`, 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Delete item
app.delete('/api/inventory/:itemId', requireToken, async (req, res) => {
  try {
    await axios.delete(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/items/${req.params.itemId}`,
      { headers: { Authorization: `Bearer ${req.cloverToken}` } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Get sales
app.get('/api/sales', requireToken, async (req, res) => {
  try {
    const now = Date.now();
    const response = await axios.get(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/orders`,
      {
        headers: { Authorization: `Bearer ${req.cloverToken}` },
        params: { limit: 100, filter: `createdTime>${now - 86400000}` }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ReserveSmoke server running on port ${PORT}`));
