const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = process.env.DROPBOX_APP_KEY || '4pt6d2d7f8q1z7n';
const REFRESH = process.env.DROPBOX_REFRESH_TOKEN || '';
const PINS = (process.env.APP_PINS || 'ALFONSO2026,SUPERVISOR,CARINTHIA2009').split(',').map(s => s.trim()).filter(Boolean);
const COLS = ['poli', 'cosecha', 'volq', 'labores', 'monit', 'superv', 'insumos', 'trab', 'grupo', 'preciohist'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-pin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

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
function merge(a, b, col) {
  const m = {};
  (a || []).concat(b || []).forEach(r => { if (!r || r.id == null) return; const k = r.id, c = m[k]; if (!c || ((r._m || r.id) >= (c._m || c.id))) m[k] = r; });
  let out = Object.values(m);
  const key = col === 'trab' ? 'nombre' : (col === 'labores' ? 'desc' : null);
  if (key) {
    const bk = {};
    out.forEach(r => { const kk = (r[key] || '').toString().trim().toLowerCase(); if (!kk) { bk['__' + r.id] = r; return; } const c = bk[kk]; if (!c || ((r._m || r.id) >= (c._m || c.id))) bk[kk] = r; });
    out = Object.values(bk);
  }
  return out;
}
function sendJSON(res, code, obj) { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS)); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (u.pathname === '/api/health') return sendJSON(res, 200, { ok: true, dropbox: !!REFRESH });
  if (u.pathname === '/api/data') {
    const pin = req.headers['x-pin'] || '';
    if (!PINS.includes(pin)) return sendJSON(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET') { dl().then(({ data }) => sendJSON(res, 200, data || {})).catch(() => sendJSON(res, 500, { error: 'server' })); return; }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const incoming = JSON.parse(body || '{}');
          let { data, rev } = await dl(); data = data || {};
          const out = {}; COLS.forEach(c => { out[c] = merge(data[c], incoming[c], c); });
          let ok = await up(out, rev);
          if (!ok) { const d2 = await dl(); COLS.forEach(c => { out[c] = merge((d2.data || {})[c], incoming[c], c); }); ok = await up(out, d2.rev); }
          sendJSON(res, 200, out);
        } catch (e) { sendJSON(res, 500, { error: 'server' }); }
      });
      return;
    }
    return sendJSON(res, 405, { error: 'method' });
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  let fp = path.join(__dirname, decodeURIComponent(p));
  if (!fp.startsWith(__dirname)) fp = path.join(__dirname, 'index.html');
  fs.readFile(fp, (err, buf) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); res.end('not found'); }
        else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b2); }
      });
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('CubiroSync server (node) on ' + PORT));
