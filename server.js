const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-pin');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const KEY = process.env.DROPBOX_APP_KEY || '';
const REFRESH = process.env.DROPBOX_REFRESH_TOKEN || '';
const PINS = (process.env.APP_PINS || 'ALFONSO2026,SUPERVISOR,CARINTHIA2009').split(',').map(s => s.trim()).filter(Boolean);
const COLS = ['poli', 'cosecha', 'volq', 'labores', 'monit', 'superv', 'insumos', 'trab', 'grupo', 'preciohist'];

let _tok = null, _exp = 0;
async function token() {
  if (_tok && Date.now() < _exp - 60000) return _tok;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH, client_id: KEY });
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  _tok = j.access_token; _exp = Date.now() + ((j.expires_in || 14400) * 1000);
  return _tok;
}
async function dl() {
  const t = await token();
  const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t, 'Dropbox-API-Arg': JSON.stringify({ path: '/datos.json' }) } });
  if (!r.ok) return { data: {}, rev: null };
  let meta = {}; try { meta = JSON.parse(r.headers.get('dropbox-api-result') || '{}'); } catch (e) {}
  const txt = await r.text(); let data = {}; try { data = JSON.parse(txt); } catch (e) {}
  return { data, rev: meta.rev || null };
}
async function up(obj, rev) {
  const t = await token();
  const arg = { path: '/datos.json', mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'overwrite' }, autorename: false, mute: true };
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t, 'Dropbox-API-Arg': JSON.stringify(arg), 'Content-Type': 'application/octet-stream' }, body: JSON.stringify(obj) });
  return r.ok;
}
function merge(a, b) {
  const m = {};
  (a || []).concat(b || []).forEach(r => { if (!r || r.id == null) return; const k = r.id, c = m[k]; if (!c || ((r._m || r.id) >= (c._m || c.id))) m[k] = r; });
  return Object.values(m);
}
function auth(req, res) { const p = req.get('x-pin') || ''; if (!PINS.includes(p)) { res.status(401).json({ error: 'unauthorized' }); return false; } return true; }

app.get('/api/data', async (req, res) => {
  if (!auth(req, res)) return;
  try { const { data } = await dl(); res.json(data || {}); } catch (e) { res.status(500).json({ error: 'server' }); }
});
app.post('/api/data', async (req, res) => {
  if (!auth(req, res)) return;
  try {
    const incoming = req.body || {};
    let { data, rev } = await dl(); data = data || {};
    const out = {}; COLS.forEach(c => { out[c] = merge(data[c], incoming[c]); });
    let ok = await up(out, rev);
    if (!ok) { const d2 = await dl(); COLS.forEach(c => { out[c] = merge((d2.data || {})[c], incoming[c]); }); ok = await up(out, d2.rev); }
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'server' }); }
});
app.get('/api/health', (req, res) => res.json({ ok: true, dropbox: !!REFRESH }));

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CubiroSync server on ' + PORT));
