const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/connect', (req, res) => {
  const oauthUrl = `https://www.clover.com/oauth/v2/authorize?client_id=${APP_ID}&response_type=token&merchant_id=${MERCHANT_ID}&redirect_uri=https://reservesmoke-server.onrender.com/callback`;
  res.redirect(oauthUrl);
});

app.get('/callback', (req, res) => {
  const { access_token } = req.query;
  if (access_token) {
    saveToken(access_token);
    return res.send('<h1 style="color:green">Connected! Close this and open your app.</h1>');
  }
  res.status(400).send('No token received');
});

app.get('/health', (req, res) => {
  const token = getToken();
  res.json({ status: 'ok', merchant: MERCHANT_ID, connected: !!token });
});

app.post('/auth/pin', (req, res) => {
  const { pin } = req.body;
  if (pin === APP_PIN) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

function requireToken(req, res, next) {
  const token = getToken();
  if (!token) {
    return res.status(503).json({ error: 'Not connected', connectUrl: 'https://reservesmoke-server.onrender.com/connect' });
  }
  req.cloverToken = token;
  next();
}

app.get('/api/inventory', requireToken, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/items`,
      { headers: { Authorization: `Bearer ${req.cloverToken}` }, params: { limit: 1000 } }
    );
    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 401) {
      try { fs.unlinkSync(TOKEN_FILE); } catch(e) {}
      return res.status(401).json({ error: 'Token expired', connectUrl: 'https://reservesmoke-server.onrender.com/connect' });
    }
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

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

app.get('/api/sales', requireToken, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.clover.com/v3/merchants/${MERCHANT_ID}/orders`,
      { headers: { Authorization: `Bearer ${req.cloverToken}` }, params: { limit: 100 } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
