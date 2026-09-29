#!/usr/bin/env node
// SCPresence: local bridge between the browser extension and Discord Rich Presence.
// Zero dependencies. Idle = no timers, no Discord connection, ~0% CPU.
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch {}
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || cfg.clientId;
const PORT = Number(process.env.SCPRESENCE_PORT || cfg.port || 47800);

if (!CLIENT_ID || CLIENT_ID.includes('YOUR_')) {
  console.error('Set your Discord Application ID in config.json (or DISCORD_CLIENT_ID env var). See README.md.');
  process.exit(1);
}
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

/* ---------------- Discord IPC ---------------- */
function ipcPaths() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') {
      out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    } else {
      const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
      for (const b of new Set(bases)) {
        out.push(path.join(b, `discord-ipc-${i}`));
        out.push(path.join(b, 'snap.discord', `discord-ipc-${i}`));
        out.push(path.join(b, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
      }
    }
  }
  return out;
}

const tryConnect = (p) => new Promise((resolve, reject) => {
  const s = net.createConnection(p);
  s.once('connect', () => resolve(s));
  s.once('error', reject);
});

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

class Discord {
  constructor() {
    this.sock = null; this.ready = false; this.buf = Buffer.alloc(0);
    this.desired = null;       // activity we want shown (null = nothing)
    this.connecting = false; this.path = null; this.retryMs = 5000; this.timer = null;
  }

  // Connect lazily: only when there is something to show. Remember the working path.
  async connect() {
    if (this.sock || this.connecting) return;
    this.connecting = true;
    try {
      const all = ipcPaths();
      const paths = this.path ? [this.path, ...all.filter((p) => p !== this.path)] : all;
      for (const p of paths) {
        try { this.attach(await tryConnect(p)); this.path = p; this.retryMs = 5000; return; } catch {}
      }
    } finally { this.connecting = false; }
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (this.timer || !this.desired) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.desired) this.connect(); }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 60000); // back off while Discord isn't running
  }

  attach(sock) {
    this.sock = sock; this.ready = false; this.buf = Buffer.alloc(0);
    sock.on('data', (d) => this.onData(d));
    sock.on('error', () => {});
    sock.on('close', () => {
      if (this.sock === sock) { this.sock = null; this.ready = false; if (this.desired) { log('Discord disconnected, will retry'); this.scheduleRetry(); } }
    });
    this.write(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID });
  }

  write(op, payload) {
    if (!this.sock) return;
    const data = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0); head.writeInt32LE(data.length, 4);
    this.sock.write(Buffer.concat([head, data]));
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let msg = {};
      try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString()); } catch {}
      this.buf = this.buf.slice(8 + len);
      if (op === OP.PING) this.write(OP.PONG, msg);
      else if (op === OP.CLOSE) { log('Discord closed connection:', msg.message || ''); this.sock && this.sock.destroy(); }
      else if (op === OP.FRAME) {
        if (msg.evt === 'READY') { this.ready = true; log('Connected to Discord'); if (this.desired) this.flush(); }
        else if (msg.evt === 'ERROR') log('Discord error:', msg.data && msg.data.message);
      }
    }
  }

  setActivity(activity) {
    this.desired = activity;
    if (activity) {
      if (this.ready) this.flush(); else this.connect();
    } else if (this.ready) {
      this.flush(); // clear...
      // ...then drop the connection so nothing stays open while idle
      setTimeout(() => { if (!this.desired && this.sock) this.sock.destroy(); }, 500);
    } else if (this.sock) this.sock.destroy();
  }

  flush() {
    if (!this.ready) return;
    this.write(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.desired }, nonce: String(Date.now()) + Math.random() });
  }
}
const discord = new Discord();

/* ---------------- Presence logic ---------------- */
const pad = (s) => { s = String(s || '').trim(); return s.length >= 2 ? s.slice(0, 128) : (s + '  ').slice(0, 2); };
let current = null;   // { url, start }
let watchdog = null;  // clears status if the extension goes quiet (tab closed, browser quit)

function clear() {
  clearTimeout(watchdog); watchdog = null;
  if (current) { log('Cleared presence'); current = null; }
  discord.setActivity(null);
}

function handle(t) {
  if (!t || !t.playing || !t.title) return clear();

  clearTimeout(watchdog);
  watchdog = setTimeout(clear, 75000); // extension heartbeat is every 30s

  const start = Math.round(Date.now() - (t.position || 0) * 1000);
  if (current && current.url === t.url && Math.abs(current.start - start) < 3000) return; // no change -> no work
  current = { url: t.url, start };

  const activity = { type: 2, status_display_type: 2, details: pad(t.title), state: pad(t.artist || 'Unknown artist'), assets: {}, timestamps: { start } };
  if (t.duration > 0) activity.timestamps.end = start + Math.round(t.duration * 1000);
  if (t.artwork) { activity.assets.large_image = t.artwork; activity.assets.large_text = pad(t.title); }
  if (t.url && /^https:\/\/soundcloud\.com\//.test(t.url)) activity.buttons = [{ label: 'Listen on SoundCloud', url: t.url }];

  log(`Now playing: ${t.artist} - ${t.title}`);
  discord.setActivity(activity);
}

/* ---------------- HTTP endpoint for the extension ---------------- */
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); return res.end(JSON.stringify({ ok: true, discord: discord.ready })); }
  if (req.method === 'POST' && req.url === '/update') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try { handle(JSON.parse(body)); res.writeHead(200); res.end('ok'); }
      catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => log(`SCPresence listening on http://127.0.0.1:${PORT}`));

process.on('SIGINT', () => { discord.setActivity(null); setTimeout(() => process.exit(0), 300); });
