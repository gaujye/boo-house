const crypto = require('node:crypto');

const COOKIE = 'boo_player';
const YEAR = 365 * 24 * 60 * 60;
function sign(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', process.env.BOO_SESSION_SECRET).update(payload).digest('base64url');
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', process.env.BOO_SESSION_SECRET).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.exp > Date.now() ? data : null; } catch { return null; }
}
function session(req) {
  const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='));
  const data = verify(token ? token.slice(COOKIE.length + 1) : '');
  return data?.kind === 'player' ? data : null;
}
function cookie(res, token, age = YEAR) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
}
async function db(path, options = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json', ...options.headers };
  // Legacy service_role compatibility; modern secret keys are API keys, not JWTs.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('DATABASE_UNAVAILABLE');
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
async function profile(id) {
  const [players, totals, runs] = await Promise.all([
    db(`boo_players?id=eq.${id}&select=id,nickname,created_at`),
    db(`boo_player_totals?player_id=eq.${id}&select=best_score,total_games,total_hits,total_penalties`),
    db(`boo_runs?player_id=eq.${id}&select=id,score,hits,penalties,shots,created_at&order=created_at.desc&limit=8`)
  ]);
  if (!players[0]) return null;
  return { ...players[0], ...(totals[0] || { best_score: 0, total_games: 0, total_hits: 0, total_penalties: 0 }), runs };
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: '不支援的操作。' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY || !process.env.BOO_SESSION_SECRET) {
    return res.status(503).json({ error: '雲端紀錄尚未連線，請稍後再試。' });
  }
  try {
    if (req.method === 'GET') {
      const player = session(req);
      return res.json({ player: player ? await profile(player.id) : null });
    }
    // Same-origin requests only. Do not allow other sites to change the selected player.
    if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`) {
      return res.status(403).json({ error: '請從遊戲網站操作。' });
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: '請使用 JSON。' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (body.action === 'login') {
      const nickname = typeof body.nickname === 'string' ? body.nickname.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
      if (!nickname || [...nickname].length > 24 || /[\p{Cc}\p{Cf}]/u.test(nickname)) return res.status(400).json({ error: '暱稱請填寫 1–24 個字。' });
      // Deliberately passwordless: the optional password is neither sent nor stored.
      const players = await db('boo_players?on_conflict=nickname_key', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ nickname, nickname_key: nickname.toLocaleLowerCase('en-US') })
      });
      const player = await profile(players[0].id);
      cookie(res, sign({ kind: 'player', id: player.id, exp: Date.now() + YEAR * 1000 }));
      return res.json({ player });
    }
    if (body.action === 'logout') { cookie(res, '', 0); return res.json({ player: null }); }
    const player = session(req);
    if (!player) return res.status(401).json({ error: '請先輸入暱稱。' });
    if (body.action === 'begin') {
      return res.json({ ticket: sign({ kind: 'run', id: crypto.randomUUID(), playerId: player.id, started: Date.now(), exp: Date.now() + 7 * 86400000 }) });
    }
    if (body.action === 'save') {
      const run = verify(body.ticket);
      if (!run || run.kind !== 'run' || run.playerId !== player.id) return res.status(400).json({ error: '這局紀錄不屬於目前玩家，請重新登入原本的暱稱。' });
      if (Date.now() - run.started < 59000) return res.status(400).json({ error: '挑戰尚未完成。' });
      const { score, hits, penalties, shots } = body;
      if (![score, hits, penalties, shots].every(Number.isSafeInteger) || hits < 0 || penalties < 0 || shots < hits + penalties || shots > 10000 || hits + penalties > 200 || score < -200 * penalties || score > hits * 900 - penalties * 200 || score % 50 !== 0) {
        return res.status(400).json({ error: '遊戲紀錄格式不正確。' });
      }
      await db('boo_runs?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ id: run.id, player_id: player.id, score, hits, penalties, shots }) });
      return res.json({ player: await profile(player.id) });
    }
    return res.status(400).json({ error: '未知的操作。' });
  } catch {
    return res.status(503).json({ error: '暫時無法連上雲端，請稍後重試。' });
  }
};
