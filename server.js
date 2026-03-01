require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const CLOVER_TOKEN = process.env.CLOVER_TOKEN;
const MERCHANT_ID = process.env.MERCHANT_ID;
const APP_PIN = process.env.APP_PIN || '1234';
const BASE = `https://api.clover.com/v3/merchants/${MERCHANT_ID}`;
const headers = { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' };

// ── AUTH ──────────────────────────────────────────────────────
app.post('/login', (req, res) => {
  const { pin } = req.body;
  if (pin === APP_PIN) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

// ── INVENTORY ─────────────────────────────────────────────────
app.get('/api/inventory', async (req, res) => {
  try {
    const [itemsRes, stockRes] = await Promise.all([
      axios.get(`${BASE}/items?expand=categories&limit=1000`, { headers }),
      axios.get(`${BASE}/item_stocks?limit=1000`, { headers })
    ]);
    const stockMap = {};
    (stockRes.data.elements || []).forEach(s => { stockMap[s.item.id] = s.quantity ?? 0; });
    const items = (itemsRes.data.elements || []).map(item => ({
      id: item.id,
      name: item.name,
      price: item.price || 0,
      priceFormatted: `$${((item.price || 0) / 100).toFixed(2)}`,
      sku: item.sku || '',
      category: item.categories?.elements?.[0]?.name || 'Uncategorized',
      stock: stockMap[item.id] ?? null,
    }));
    res.json({ items, total: items.length });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const { name, price, sku, stock } = req.body;
    const itemRes = await axios.post(`${BASE}/items`, { name, price: Math.round(parseFloat(price) * 100), sku }, { headers });
    if (stock) await axios.post(`${BASE}/item_stocks`, { item: { id: itemRes.data.id }, quantity: parseInt(stock) }, { headers });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { name, price, sku, stock } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (price !== undefined) updates.price = Math.round(parseFloat(price) * 100);
    if (sku !== undefined) updates.sku = sku;
    await axios.post(`${BASE}/items/${req.params.id}`, updates, { headers });
    if (stock !== undefined && stock !== '') {
      await axios.post(`${BASE}/item_stocks/${req.params.id}`, { item: { id: req.params.id }, quantity: parseInt(stock) }, { headers });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    await axios.delete(`${BASE}/items/${req.params.id}`, { headers });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── SALES ─────────────────────────────────────────────────────
app.get('/api/sales', async (req, res) => {
  try {
    const { period = '24h' } = req.query;
    const periods = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    const since = Date.now() - (periods[period] || 86400000);
    const ordersRes = await axios.get(`${BASE}/orders?filter=clientCreatedTime>${since}&expand=lineItems&limit=500`, { headers });
    const orders = ordersRes.data.elements || [];
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const itemSales = {};
    orders.forEach(order => {
      (order.lineItems?.elements || []).forEach(li => {
        const name = li.name || 'Unknown';
        if (!itemSales[name]) itemSales[name] = { name, qty: 0, revenue: 0 };
        itemSales[name].qty += (li.unitQty || 1);
        itemSales[name].revenue += (li.price || 0);
      });
    });
    res.json({
      totalRevenue,
      totalRevenueFormatted: `$${(totalRevenue / 100).toFixed(2)}`,
      totalOrders: orders.length,
      topItems: Object.values(itemSales).sort((a, b) => b.qty - a.qty).slice(0, 10)
    });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── ALERTS ────────────────────────────────────────────────────
app.get('/api/alerts', async (req, res) => {
  try {
    const threshold = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;
    const [itemsRes, stockRes] = await Promise.all([
      axios.get(`${BASE}/items?expand=categories&limit=1000`, { headers }),
      axios.get(`${BASE}/item_stocks?limit=1000`, { headers })
    ]);
    const stockMap = {};
    (stockRes.data.elements || []).forEach(s => { stockMap[s.item.id] = s.quantity ?? 0; });
    const lowStock = (itemsRes.data.elements || [])
      .map(item => ({ id: item.id, name: item.name, sku: item.sku || '', category: item.categories?.elements?.[0]?.name || 'Uncategorized', stock: stockMap[item.id] ?? null }))
      .filter(i => i.stock !== null && i.stock <= threshold)
      .sort((a, b) => a.stock - b.stock);
    res.json({ lowStock, threshold, count: lowStock.length });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', merchant: MERCHANT_ID }));

app.listen(PORT, () => console.log(`✅ ReserveSmoke server running on port ${PORT}`));
