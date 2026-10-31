// Shared storage for the guard scheduler: one document per secret id.
// GET /s/:id -> {ver, data, at}   POST /s {data} -> {id, ver}   PUT /s/:id {ver, data} -> {ver} | 409 {ver, data, at}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const MAX = 400000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const newId = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(12)); return [...b].map(x => a[x % a.length]).join(''); };
async function body(req) {
  const t = await req.text();
  if (t.length > MAX) throw new Error('too big');
  const j = JSON.parse(t);
  if (!j || typeof j.data !== 'object' || !j.data || !Array.isArray(j.data.soldiers)) throw new Error('bad data');
  return j;
}
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/s(?:\/([a-z0-9]{6,32}))?\/?$/);
    if (!m) return json({ error: 'not found' }, 404);
    const id = m[1];
    try {
      if (req.method === 'POST' && !id) {
        const { data } = await body(req), nid = newId(), now = Date.now();
        await env.DB.prepare('INSERT INTO docs (id, ver, data, at) VALUES (?, 1, ?, ?)').bind(nid, JSON.stringify(data), now).run();
        return json({ id: nid, ver: 1, at: now });
      }
      if (!id) return json({ error: 'not found' }, 404);
      if (req.method === 'GET') {
        const r = await env.DB.prepare('SELECT ver, data, at FROM docs WHERE id = ?').bind(id).first();
        return r ? json({ ver: r.ver, at: r.at, data: JSON.parse(r.data) }) : json({ error: 'not found' }, 404);
      }
      if (req.method === 'PUT') {
        const { ver, data } = await body(req), now = Date.now();
        // compare-and-set: only saves if nobody else saved since this client's version
        const res = await env.DB.prepare('UPDATE docs SET ver = ver + 1, data = ?, at = ? WHERE id = ? AND ver = ?').bind(JSON.stringify(data), now, id, ver).run();
        if (res.meta.changes === 1) return json({ ver: ver + 1, at: now });
        const r = await env.DB.prepare('SELECT ver, data, at FROM docs WHERE id = ?').bind(id).first();
        return r ? json({ ver: r.ver, at: r.at, data: JSON.parse(r.data) }, 409) : json({ error: 'not found' }, 404);
      }
      return json({ error: 'method' }, 405);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  },
};
