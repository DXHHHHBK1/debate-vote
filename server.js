// 大学生辩论赛辩题征集投票 - 后端（零依赖，Node 22+）
// 运行：node server.js   环境变量：PORT / ADMIN_PASSWORD / DB_PATH
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'debate2026';
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data.db');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS topics(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS votes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  voter_key TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(topic_id, voter_key)
);
CREATE INDEX IF NOT EXISTS idx_votes_topic ON votes(topic_id);
`);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function getVoterKey(req, res) {
  const c = parseCookies(req);
  if (c.voter && /^[0-9a-f-]{36}$/.test(c.voter)) return { key: c.voter, setCookie: false };
  const key = crypto.randomUUID();
  return { key, setCookie: true };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (ch) => { data += ch; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res, code, obj, setCookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (setCookie) headers['Set-Cookie'] = `voter=${setCookie}; Path=/; Max-Age=31536000; SameSite=Lax`;
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const { key: voterKey, setCookie } = getVoterKey(req, res);
    const cookieVal = setCookie ? voterKey : null;

    // ---- 静态页 ----
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (req.method === 'GET' && p === '/admin') return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    if (req.method === 'GET' && p.startsWith('/static/')) {
      const f = path.normalize(path.join(PUBLIC_DIR, p.slice(8)));
      if (!f.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
      return serveFile(res, f);
    }

    // ---- 学生端 API ----
    if (req.method === 'GET' && p === '/api/topics') {
      const rows = db.prepare(
        `SELECT t.id, t.title, t.name, t.votes,
                EXISTS(SELECT 1 FROM votes v WHERE v.topic_id=t.id AND v.voter_key=?) AS voted
         FROM topics t WHERE t.status='approved' ORDER BY t.votes DESC, t.id ASC`
      ).all(voterKey);
      return json(res, 200, { topics: rows }, cookieVal);
    }
    if (req.method === 'POST' && p === '/api/topics') {
      const body = JSON.parse(await readBody(req) || '{}');
      const title = String(body.title || '').trim().slice(0, 80);
      const name = String(body.name || '').trim().slice(0, 20);
      if (title.length < 4) return json(res, 400, { error: '辩题至少4个字' }, cookieVal);
      if (!name) return json(res, 400, { error: '请填写姓名' }, cookieVal);
      const r = db.prepare('INSERT INTO topics(title,name) VALUES(?,?)').run(title, name);
      return json(res, 201, { id: Number(r.lastInsertRowid), message: '提交成功，待审核通过后上榜' }, cookieVal);
    }
    let m = p.match(/^\/api\/topics\/(\d+)\/vote$/);
    if (m && (req.method === 'POST' || req.method === 'DELETE')) {
      const id = Number(m[1]);
      const t = db.prepare('SELECT id FROM topics WHERE id=? AND status=?').get(id, 'approved');
      if (!t) return json(res, 404, { error: '辩题不存在或未过审' }, cookieVal);
      if (req.method === 'POST') {
        const r = db.prepare('INSERT OR IGNORE INTO votes(topic_id,voter_key,ip) VALUES(?,?,?)').run(id, voterKey, clientIp(req));
        if (r.changes === 0) return json(res, 409, { error: '你已经投过这个辩题了' }, cookieVal);
        db.prepare('UPDATE topics SET votes=votes+1 WHERE id=?').run(id);
        return json(res, 200, { ok: true }, cookieVal);
      } else {
        const r = db.prepare('DELETE FROM votes WHERE topic_id=? AND voter_key=?').run(id, voterKey);
        if (r.changes > 0) db.prepare('UPDATE topics SET votes=max(0,votes-1) WHERE id=?').run(id);
        return json(res, 200, { ok: true }, cookieVal);
      }
    }

    // ---- 管理端 API（请求头 x-admin-password） ----
    const authed = req.headers['x-admin-password'] === ADMIN_PASSWORD;
    if (p.startsWith('/api/admin/')) {
      if (!authed) return json(res, 401, { error: '口令错误' }, cookieVal);
      if (req.method === 'GET' && p === '/api/admin/pending') {
        const rows = db.prepare(`SELECT id,title,name,created_at FROM topics WHERE status='pending' ORDER BY id ASC`).all();
        return json(res, 200, { topics: rows }, cookieVal);
      }
      if (req.method === 'GET' && p === '/api/admin/all') {
        const rows = db.prepare(`SELECT id,title,name,status,votes,created_at FROM topics ORDER BY id DESC`).all();
        return json(res, 200, { topics: rows }, cookieVal);
      }
      m = p.match(/^\/api\/admin\/topics\/(\d+)\/(approve|reject)$/);
      if (m && req.method === 'POST') {
        const status = m[2] === 'approve' ? 'approved' : 'rejected';
        db.prepare('UPDATE topics SET status=? WHERE id=?').run(status, Number(m[1]));
        return json(res, 200, { ok: true, status }, cookieVal);
      }
      return json(res, 404, { error: 'not found' }, cookieVal);
    }

    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '服务器错误' }));
  }
});

server.listen(PORT, () => console.log(`辩题征集投票服务已启动: http://localhost:${PORT}  管理页: http://localhost:${PORT}/admin`));
