// One Durable Object holds every account (SQLite-backed, so no separate database to set up).
// Handles: sign-up / login / sessions, saving each player's profile, friend requests, and room invites.
const enc = new TextEncoder()
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)))
const same = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0 }
const ITER = 100000 // the most PBKDF2 iterations Workers allow
async function pbkdf2(pw: string, saltHex: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(saltHex.match(/../g)!.map(h => parseInt(h, 16))), iterations: ITER, hash: 'SHA-256' }, k, 256))
}
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const DAY = 86400000, ONLINE = 45000, MAX_USERS = 5000, MAX_FRIENDS = 100, MAX_PENDING = 50, MAX_PROFILE = 120000
class Fail extends Error { constructor(public status: number, msg: string) { super(msg) } }
const uname = (v: any) => String(v ?? '').trim().toLowerCase()
const validName = (u: string) => /^[a-z0-9_]{3,20}$/.test(u)

export class Accounts {
  sql: any
  constructor(public state: any, public env: any) {
    this.sql = state.storage.sql
    for (const q of [
      `CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt TEXT, hash TEXT, created INTEGER, seen INTEGER DEFAULT 0, profile TEXT, fails INTEGER DEFAULT 0, lock INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, name TEXT, exp INTEGER)`,
      `CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, status TEXT, PRIMARY KEY(a, b))`,
      `CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY AUTOINCREMENT, frm TEXT, too TEXT, room TEXT, ts INTEGER)`,
    ]) this.sql.exec(q)
  }
  rows(q: string, ...b: any[]): any[] { return this.sql.exec(q, ...b).toArray() }
  one(q: string, ...b: any[]): any { return this.rows(q, ...b)[0] }
  run(q: string, ...b: any[]) { this.sql.exec(q, ...b) }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname.replace(/^\/api\//, '')
    try {
      let b: any = {}; try { b = await req.json() } catch { /* no body */ }
      return new Response(JSON.stringify(await this.route(path, b || {}, req.headers.get('authorization') || '')), { headers: { 'content-type': 'application/json' } })
    } catch (e: any) {
      const f = e instanceof Fail ? e : new Fail(500, 'Server error')
      return new Response(JSON.stringify({ error: f.message }), { status: f.status, headers: { 'content-type': 'application/json' } })
    }
  }
  async session(name: string) {
    const t = rand(32); this.run('DELETE FROM sessions WHERE exp < ?', Date.now())
    this.run('INSERT INTO sessions VALUES(?,?,?)', await sha(t), name, Date.now() + 30 * DAY)
    this.run('DELETE FROM sessions WHERE name = ? AND th NOT IN (SELECT th FROM sessions WHERE name = ? ORDER BY exp DESC LIMIT 10)', name, name)
    return t
  }
  async who(auth: string): Promise<string> {
    const t = auth.replace(/^Bearer\s+/i, '').trim(); if (!t) throw new Fail(401, 'Not signed in')
    const s = this.one('SELECT name, exp FROM sessions WHERE th = ?', await sha(t)); if (!s || s.exp < Date.now()) throw new Fail(401, 'Not signed in')
    const u = this.one('SELECT seen FROM users WHERE name = ?', s.name); if (!u) throw new Fail(401, 'Not signed in')
    if (Date.now() - u.seen > 10000) this.run('UPDATE users SET seen = ? WHERE name = ?', Date.now(), s.name)
    return s.name
  }
  async route(path: string, b: any, auth: string): Promise<any> {
    switch (path) {
      case 'register': {
        const n = uname(b.username), pw = String(b.password ?? '')
        if (!validName(n)) throw new Fail(400, 'Username must be 3–20 letters, numbers or underscores.')
        if (pw.length < 8 || pw.length > 128) throw new Fail(400, 'Password must be 8–128 characters.')
        if (this.one('SELECT 1 x FROM users WHERE name = ?', n)) throw new Fail(409, 'That username is taken.')
        if (this.one('SELECT COUNT(*) c FROM users').c >= MAX_USERS) throw new Fail(503, 'This site is full.')
        const salt = rand(16); this.run('INSERT INTO users(name, salt, hash, created, seen) VALUES(?,?,?,?,?)', n, salt, await pbkdf2(pw, salt), Date.now(), Date.now())
        return { token: await this.session(n), username: n }
      }
      case 'login': {
        const n = uname(b.username), pw = String(b.password ?? '').slice(0, 128), u = this.one('SELECT * FROM users WHERE name = ?', n)
        if (u && u.lock > Date.now()) throw new Fail(429, `Too many wrong passwords. Try again in ${Math.ceil((u.lock - Date.now()) / 1000)} seconds.`)
        const salt = u?.salt || '00'.repeat(16), h = await pbkdf2(pw, salt) // always hash, so timing doesn't reveal which usernames exist
        if (!u || !same(h, u.hash)) {
          if (u) { const f = u.fails + 1; this.run('UPDATE users SET fails = ?, lock = ? WHERE name = ?', f, f >= 5 ? Date.now() + Math.min(900000, 30000 * 2 ** (f - 5)) : 0, n) }
          throw new Fail(401, 'Wrong username or password.')
        }
        this.run('UPDATE users SET fails = 0, lock = 0, seen = ? WHERE name = ?', Date.now(), n)
        return { token: await this.session(n), username: n }
      }
      case 'logout': { const t = auth.replace(/^Bearer\s+/i, '').trim(); if (t) this.run('DELETE FROM sessions WHERE th = ?', await sha(t)); return { ok: true } }
      case 'me': return { username: await this.who(auth) }
      case 'profile/get': { const me = await this.who(auth), p = this.one('SELECT profile FROM users WHERE name = ?', me).profile; return { profile: p ? JSON.parse(p) : null } }
      case 'profile/put': {
        const me = await this.who(auth), s = JSON.stringify(b.profile ?? null)
        if (!b.profile || typeof b.profile !== 'object' || Array.isArray(b.profile)) throw new Fail(400, 'Bad profile.')
        if (s.length > MAX_PROFILE) throw new Fail(413, 'Profile too large.')
        this.run('UPDATE users SET profile = ? WHERE name = ?', s, me); return { ok: true }
      }
      case 'friends': return this.social(await this.who(auth))
      case 'friends/request': {
        const me = await this.who(auth), to = uname(b.to)
        if (to === me) throw new Fail(400, 'That’s you!')
        if (!this.one('SELECT 1 x FROM users WHERE name = ?', to)) throw new Fail(404, 'No player with that username.')
        const ex = this.one('SELECT * FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me, to, to, me)
        if (ex?.status === 'accepted') throw new Fail(409, 'You’re already friends.')
        if (ex && ex.a === me) throw new Fail(409, 'Request already sent.')
        if (ex) { this.run('UPDATE friends SET status = ? WHERE a = ? AND b = ?', 'accepted', to, me); return { ok: true, accepted: true } } // they had already asked you
        if (this.one('SELECT COUNT(*) c FROM friends WHERE a = ? AND status = ?', me, 'pending').c >= MAX_PENDING) throw new Fail(429, 'Too many pending requests.')
        this.run('INSERT INTO friends VALUES(?,?,?)', me, to, 'pending'); return { ok: true }
      }
      case 'friends/accept': {
        const me = await this.who(auth), from = uname(b.from)
        if (this.one('SELECT COUNT(*) c FROM friends WHERE status = ? AND (a = ? OR b = ?)', 'accepted', me, me).c >= MAX_FRIENDS) throw new Fail(429, 'Friend list is full.')
        this.run('UPDATE friends SET status = ? WHERE a = ? AND b = ? AND status = ?', 'accepted', from, me, 'pending'); return { ok: true }
      }
      case 'friends/decline': { const me = await this.who(auth), from = uname(b.from); this.run('DELETE FROM friends WHERE a = ? AND b = ? AND status = ?', from, me, 'pending'); return { ok: true } }
      case 'friends/remove': { const me = await this.who(auth), o = uname(b.user); this.run('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me, o, o, me); return { ok: true } }
      case 'invite': {
        const me = await this.who(auth), to = uname(b.to), room = String(b.room ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
        if (!room) throw new Fail(400, 'Bad room code.')
        if (!this.one('SELECT 1 x FROM friends WHERE status = ? AND ((a = ? AND b = ?) OR (a = ? AND b = ?))', 'accepted', me, to, to, me)) throw new Fail(403, 'You can only invite friends.')
        this.run('DELETE FROM invites WHERE frm = ? AND too = ?', me, to); this.run('INSERT INTO invites(frm, too, room, ts) VALUES(?,?,?,?)', me, to, room, Date.now()); return { ok: true }
      }
      case 'invite/dismiss': { const me = await this.who(auth); this.run('DELETE FROM invites WHERE id = ? AND too = ?', +b.id || 0, me); return { ok: true } }
    }
    throw new Fail(404, 'Not found')
  }
  social(me: string) {
    const now = Date.now(); this.run('DELETE FROM invites WHERE ts < ?', now - 600000)
    const info = (n: string) => { const u = this.one('SELECT seen, profile FROM users WHERE name = ?', n); let r = {}; try { r = JSON.parse(u?.profile || '{}').r || {} } catch { /* none */ } return { name: n, online: !!u && now - u.seen < ONLINE, r } }
    const all = this.rows('SELECT * FROM friends WHERE a = ? OR b = ?', me, me)
    return {
      me,
      friends: all.filter(x => x.status === 'accepted').map(x => info(x.a === me ? x.b : x.a)).sort((p, q) => +q.online - +p.online || p.name.localeCompare(q.name)),
      incoming: all.filter(x => x.status === 'pending' && x.b === me).map(x => x.a),
      outgoing: all.filter(x => x.status === 'pending' && x.a === me).map(x => x.b),
      invites: this.rows('SELECT id, frm, room FROM invites WHERE too = ? ORDER BY ts DESC', me),
    }
  }
}
