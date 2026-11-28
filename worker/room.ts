import { bonusChoices, loose, quickGrade, readText, readTimes } from '../src/read'
import { cleanRules, DEFAULT_RULES, rulesText, sameRules, type Rules } from '../src/rules'
type T = 'A' | 'B'
const other = (t: T): T => (t === 'A' ? 'B' : 'A')
const RUN = ['read', 'win', 'ans', 'bgap', 'bonus']
const cl = (v: any, a: number, b: number) => Math.min(b, Math.max(a, Math.round(+v || a)))
interface Pl { id: string; name: string; seat: string | null; ws: any }

/** One Durable Object per room code. It owns the game: seats, clocks, buzz order, scoring, pause/break rules, chat. */
export class Room {
  pl = new Map<string, Pl>(); host = ''; cfg = { sizeA: 5, sizeB: 5, halfMin: 8, wpm: 160 }
  phase = 'lobby'; half = 1; clock = 0; st = 'idle'; score = { A: 0, B: 0 }; qn = 0; note = ''
  q: any = null; ts = 0; rt: number[] = []; readEnd = 0; dl = 0; locked = new Set<T>(); buzzer = ''; turn: T | null = null; intr = false; bi = 0; won: T | null = null
  paused = false; pauseAt = 0; req: Record<string, Set<T>> = { pause: new Set(), resume: new Set(), proceed: new Set() }
  last = Date.now(); iv: any = null; tickN = 0; dirty = true
  ev: any[] = []; tuD = { A: 0, B: 0 }; bnD = { A: 0, B: 0 }; chFail = { A: 0, B: 0 }; reviewing = false; rq: Record<string, string | null> = { A: null, B: null }; repl: any = null
  nq = 0; typed = false; bsa = false; btyping = false; judging = false; ps: Record<string, { tu: number; neg: number; pts: number }> = {}; bp = { A: 0, B: 0 }; reread = false
  rules: Rules = { ...DEFAULT_RULES }; prop: { by: T; rules: Rules } | null = null
  constructor(public state: any, public env: any) {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new (globalThis as any).WebSocketPair(), [c, s] = Object.values(pair) as any[]
    this.attach(s, new URL(req.url).searchParams.get('n') || 'Player')
    return new Response(null, { status: 101, webSocket: c } as any)
  }
  send(p: Pl, m: any) { try { p.ws.send(JSON.stringify(m)) } catch { /* closed */ } }
  all(m: any, f?: (p: Pl) => boolean) { for (const p of this.pl.values()) if (!f || f(p)) this.send(p, m) }
  sys(text: string) { this.all({ t: 'chat', scope: 'main', sys: true, text }) }
  team(p: Pl): T | null { return p.seat ? (p.seat[0] as T) : null }
  cap(t: T) { return [...this.pl.values()].find(p => p.seat === t + '-C') }
  seated(t: T) { return [...this.pl.values()].some(p => p.seat?.[0] === t) }
  size(t: T) { return t === 'A' ? this.cfg.sizeA : this.cfg.sizeB }
  elapsed() { return (this.paused ? this.pauseAt : Date.now()) - this.ts }
  name(id: string) { return this.pl.get(id)?.name || 'Someone' }

  attach(ws: any, name: string) {
    ws.accept(); const id = crypto.randomUUID().slice(0, 8), p: Pl = { id, name: name.slice(0, 20) || 'Player', seat: null, ws }; this.pl.set(id, p)
    if (!this.host || !this.pl.has(this.host)) this.setHost(id)
    this.send(p, { t: 'hello', id }); this.sys(`${p.name} joined.`); this.dirty = true
    if (!this.iv) this.iv = setInterval(() => this.tick(), 250)
    ws.addEventListener('message', (e: any) => { try { this.msg(p, JSON.parse(e.data)) } catch { /* ignore bad message */ } })
    ws.addEventListener('close', () => this.drop(p)); ws.addEventListener('error', () => this.drop(p))
  }
  drop(p: Pl) {
    if (!this.pl.delete(p.id)) return
    this.sys(`${p.name} left.`); if (this.host === p.id) { const n = [...this.pl.keys()][0]; if (n) this.setHost(n) }
    if (!this.pl.size) { clearInterval(this.iv); this.iv = null } this.dirty = true
  }
  setHost(id: string) { this.host = id; if (this.st === 'load') this.need() }
  need(extra?: any) { const h = this.pl.get(this.host); if (h) this.send(h, { t: 'need', rules: this.rules, ...extra }) }
  add(kind: 'tu' | 'bn', t: T, pts: number) { this.score[t] += pts; (kind === 'tu' ? this.tuD : this.bnD)[t] += pts }

  msg(p: Pl, m: any) {
    const t = this.team(p), isCap = !!p.seat && p.seat.endsWith('-C'), host = p.id === this.host
    switch (m.t) {
      case 'ping': return this.send(p, { t: 'pong', c: m.c })
      case 'seat': {
        const [tm, r] = String(m.seat).split('-'); if ((tm !== 'A' && tm !== 'B') || !/^[C1-4]$/.test(r)) return
        if ((r === 'C' ? 0 : +r) >= this.size(tm as T) || [...this.pl.values()].some(x => x.seat === m.seat)) return
        p.seat = m.seat; this.dirty = true; return
      }
      case 'up': p.seat = null; this.dirty = true; return
      case 'cfg': {
        if (!host || this.phase !== 'lobby') return; const c = m.cfg || {}
        this.cfg = { sizeA: cl(c.sizeA, 1, 5), sizeB: cl(c.sizeB, 1, 5), halfMin: cl(c.halfMin, 1, 30), wpm: cl(c.wpm, 80, 320) }
        for (const x of this.pl.values()) if (x.seat && (x.seat[2] === 'C' ? 0 : +x.seat[2]) >= this.size(x.seat[0] as T)) x.seat = null
        this.dirty = true; return
      }
      case 'start':
        if (!host || this.phase !== 'lobby') return
        if (!this.cap('A') || !this.cap('B')) return this.send(p, { t: 'err', text: 'Both teams need a captain seated first.' })
        this.phase = 'play'; this.half = 1; this.clock = this.cfg.halfMin * 60000; this.score = { A: 0, B: 0 }; this.qn = 0; this.ps = {}; this.bp = { A: 0, B: 0 }; this.chFail = { A: 0, B: 0 }; this.sys('Game started. First half!'); return this.next()
      case 'q': if (host && this.st === 'load' && m.q?.tu) { this.q = m.q; this.begin() } return
      case 'ex': if (host) this.all({ t: 'ex', text: String(m.text || '').slice(0, 2500) }); return
      case 'buzz': return this.buzz(p)
      case 'ans': if (this.st === 'ans' && p.id === this.buzzer) this.answer(m); return
      case 'bans': if (this.st === 'bonus' && isCap && t === this.won && !this.bsa && !this.judging && Date.now() >= this.readEnd) this.bonusAns(typeof m.k === 'string' ? m.k : null); return
      case 'bsub': if (this.st === 'bonus' && isCap && t === this.won && this.bsa && !this.btyping && Date.now() >= this.readEnd) { this.btyping = true; this.dl = Date.now() + 6500; this.dirty = true } return
      case 'btxt': if (this.st === 'bonus' && isCap && t === this.won && this.bsa && this.btyping) this.bonusText(String(m.txt || '')); return
      case 'proceed':
        if (!isCap || this.reviewing || this.repl) return
        if (this.st === 'bgap' && t === this.won) this.startBonus()
        else if (this.st === 'gap') { this.req.proceed.add(t!); if (this.req.proceed.size === 2 || this.clock < 60000) this.afterGap(); else this.sys(`${t} captain is ready to move on.`) }
        this.dirty = true; return
      case 'pause':
        if (!isCap || this.paused || this.phase !== 'play') return
        this.req.pause.add(t!); this.sys(`${t} captain asks to pause.`)
        if (this.req.pause.size === 2) { this.paused = true; this.pauseAt = Date.now(); this.req.pause.clear(); this.sys('Game paused. Both captains must agree to resume.') }
        this.dirty = true; return
      case 'resume':
        if (!isCap || !this.paused) return
        this.req.resume.add(t!); this.sys(`${t} captain is ready to resume.`)
        if (this.req.resume.size === 2) { const d = Date.now() - this.pauseAt; this.ts += d; this.readEnd += d; this.dl += d; this.paused = false; this.req.resume.clear(); this.sys('Game resumed.') }
        this.dirty = true; return
      case 'brk': if (isCap && this.phase === 'break') this.startHalf(); return
      case 'challenge': this.challenge(p, m); return
      case 'replace': {
        if (!isCap || this.st !== 'gap' || this.reviewing || this.repl) return
        const kind = m.kind === 'bonus' ? 'bonus' : 'tu'; if (kind === 'bonus' && (!this.won || !this.q?.bn)) return
        this.rq[t!] = kind; this.sys(`${t} captain requests a replacement ${kind === 'tu' ? 'toss-up' : 'bonus'}.`)
        if (this.rq.A && this.rq.A === this.rq.B) { this.repl = { kind, until: Date.now() + 45000 }; this.sys('Both captains agreed. Finding a replacement…'); this.need({ replace: { kind, sub: this.q.sub, d: this.q.d, tu: this.q.tu } }) }
        this.dirty = true; return
      }
      case 'rules': { // captains agree on where questions come from: one proposes, the other accepts (or both propose the same thing)
        if (!isCap || !(this.phase === 'lobby' || this.phase === 'break' || this.paused)) return
        const r = cleanRules(m.rules)
        if (m.do === 'accept') { if (this.prop && this.prop.by !== t) { this.rules = this.prop.rules; this.prop = null; this.sys('Both captains agreed on question rules: ' + rulesText(this.rules)) } }
        else if (m.do === 'decline') { if (this.prop) { this.sys(`${t} captain ${this.prop.by === t ? 'withdrew' : 'declined'} the proposed question rules.`); this.prop = null } }
        else if (sameRules(r, this.rules)) return
        else if (this.prop && this.prop.by !== t && sameRules(this.prop.rules, r)) { this.rules = r; this.prop = null; this.sys('Both captains agreed on question rules: ' + rulesText(r)) }
        else { this.prop = { by: t!, rules: r }; this.sys(`${t} captain proposes question rules: ${rulesText(r)}`) }
        this.dirty = true; return
      }
      case 'rq': if (host && this.repl && m.q?.tu) this.applyRepl(m.q); return
      case 'chat': {
        const text = String(m.text || '').slice(0, 300).trim(); if (!text) return
        const scope = m.scope === 'team' ? 'team' : 'main', out = { t: 'chat', scope, from: p.name, seat: p.seat, team: t, text }
        if (scope === 'team') { if (t) this.all(out, x => this.team(x) === t) } else this.all(out)
      }
    }
  }
  // ---- flow ----
  next() {
    if (!this.cap('A') || !this.cap('B')) { this.st = 'wait'; this.note = 'Waiting for both captains to be seated…'; this.dirty = true; return }
    this.st = 'load'; this.note = 'Loading question…'; this.dirty = true; this.need()
  }
  begin() {
    this.qn++; this.reread = false; this.ev = []; this.tuD = { A: 0, B: 0 }; this.bnD = { A: 0, B: 0 }; this.rq = { A: null, B: null }; this.locked = new Set(); this.turn = null; this.buzzer = ''; this.won = null; this.note = ''; this.st = 'read'; this.ts = Date.now()
    const rx = readText(this.q.tu, this.q.choices); this.nq = rx.nq; this.typed = false; this.bsa = false; this.btyping = false; this.judging = false
    this.rt = readTimes(rx.text, this.cfg.wpm); this.readEnd = this.ts + (this.rt[this.rt.length - 1] || 0) + 300 // the choices are read after the stem, at the same pace
    const { tu, choices, sub, topic, ai } = this.q; this.all({ t: 'read', kind: 'tu', q: { tu, choices, sub, topic, ai } }); this.dirty = true
  }
  startBonus() {
    const bc = bonusChoices(this.q), rx = readText(this.q.bn, bc)
    this.st = 'bonus'; this.bsa = !bc; this.btyping = false; this.judging = false; this.ts = Date.now(); this.rt = readTimes(rx.text, this.cfg.wpm); this.readEnd = this.ts + (this.rt[this.rt.length - 1] || 0) + 300
    this.dl = this.readEnd + 20000 // the 20 seconds start only after the bonus and its choices have been read
    this.all({ t: 'read', kind: 'bonus', q: { tu: this.q.bn, choices: bc, sub: this.q.sub, topic: this.q.topic, ai: this.q.ai } }); this.dirty = true
  }
  buzz(p: Pl) {
    const t = this.team(p); if (!t || this.paused || !['read', 'win'].includes(this.st) || this.locked.has(t)) return
    this.buzzer = p.id; this.turn = t; this.intr = this.st === 'read' && !this.reread; this.typed = this.st === 'read' || !this.q.choices; this.bi = this.rt.filter(x => x <= Date.now() - this.ts).length
    this.st = 'ans'; this.judging = false; this.dl = Date.now() + (this.typed ? 9500 : 5000); this.all({ t: 'lock', name: p.name, team: t, typed: this.typed }); this.dirty = true
  }
  grade(k: string | null, okIn?: boolean) {
    const t = this.turn!, who = this.name(this.buzzer), ok = okIn ?? k === this.q.ans, neg = !ok && this.intr && k !== null
    this.all({ t: 'res', ok, k, neg, name: who, early: this.intr ? this.bi / Math.max(1, this.q.tu.split(/\s+/).length) : 1 })
    if (ok) {
      this.add('tu', t, 4); this.pstat(this.buzzer, 'tu', 4); this.ev.push({ id: 'tu' + this.ev.length, kind: 'tu', team: t, name: who, k, ok: true, neg: false }); this.won = t; this.sys(`${who} (${t}) got the toss-up! +4`)
      if (!this.q.bn) return this.endQ('Correct!'); this.st = 'bgap'; this.dl = Date.now() + 5000
    } else {
      if (neg) { this.add('tu', t, -4); this.add('tu', other(t), 4); this.pstat(this.buzzer, 'neg', -4) } if (k !== null) this.ev.push({ id: 'tu' + this.ev.length, kind: 'tu', team: t, name: who, k, ok: false, neg }); this.locked.add(t); this.sys(`${who} (${t}) ${k === null ? 'ran out of time' : neg ? 'negged (−4, opponents +4)' : 'missed'}.`)
      if (this.seated(other(t)) && !this.locked.has(other(t))) { if (neg) this.restartRead(); else { this.buzzer = ''; this.st = 'win'; this.dl = Date.now() + 5000 } } else return this.endQ('No correct answer.')
    }
    this.dirty = true
  }
  bonusAns(k: string | null, okIn?: boolean) { const ok = okIn ?? k === this.q.ba; if (ok) { this.add('bn', this.won!, 10); this.bp[this.won!] += 10 } if (k !== null) this.ev.push({ id: 'bn' + this.ev.length, kind: 'bn', team: this.won, name: this.cap(this.won!)?.name || 'Captain', k, ok, neg: false }); this.sys(`Bonus ${ok ? 'correct! +10' : 'missed.'}`); this.endQ(ok ? 'Bonus correct! +10' : 'Bonus missed.') }
  /** A toss-up answer typed because the buzz came before the choices were fully read. */
  async answer(m: any) {
    if (this.judging) return
    if (!this.typed) return this.grade(typeof m.k === 'string' ? m.k : null)
    const txt = String(m.txt ?? m.k ?? '').trim().slice(0, 120); if (!txt) return this.grade(null)
    this.judging = true; this.note = 'Checking the answer…'; this.dirty = true
    const ch = this.q.choices || null, acc = ch ? [ch[this.q.ans]] : [this.q.ans, ...(this.q.ax || [])]; let ok = quickGrade(txt, acc, ch, this.q.ans, this.q.nx || [])
    if (ok === null) ok = await this.judgeAI(this.q.tu, acc, txt, this.q.nx || [])
    this.judging = false; this.note = ''; if (this.st === 'ans') this.grade(txt, ok)
  }
  /** Short-answer bonus text from the captain. */
  async bonusText(raw: string) {
    if (this.judging) return; const txt = raw.trim().slice(0, 120); if (!txt) return this.bonusAns(null)
    this.judging = true; this.note = 'Checking the answer…'; this.dirty = true
    const acc = [this.q.ba, ...(this.q.bx || [])].map(String); let ok = quickGrade(txt, acc, null, '', this.q.bnx || []); if (ok === null) ok = await this.judgeAI(this.q.bn, acc, txt, this.q.bnx || [])
    this.judging = false; this.note = ''; if (this.st === 'bonus') this.bonusAns(txt, ok)
  }
  async judgeAI(stem: string, accepts: string[], typed: string, rejects: string[] = []): Promise<boolean> {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.env.GROQ_API_KEY },
        body: JSON.stringify({ model: this.env.GROQ_MODEL || 'openai/gpt-oss-120b', temperature: 0.1, max_completion_tokens: 1024, reasoning_effort: 'low', messages: [{ role: 'system', content: 'Reply with valid JSON only.' }, { role: 'user', content: `You are grading a Science Bowl response.\nQuestion: ${stem}\nOfficial answer(s): ${JSON.stringify(accepts)}${rejects.length ? '\nDo NOT accept: ' + JSON.stringify(rejects) : ''}\nStudent response: ${JSON.stringify(typed)}\nMark it correct only if it clearly means the same thing as an official answer (an equivalent form, synonym, equal number or expression, or a harmless spelling error). Reject answers that are only partly right, vague, or merely related. Return ONLY JSON {"correct":true|false}.` }] }) })
      if (!r.ok) throw new Error('upstream')
      const j: any = await r.json(); return JSON.parse(((j.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/) || ['{}'])[0]).correct === true
    } catch { return loose(typed, accepts) }
  }
  pstat(id: string, k: 'tu' | 'neg', pts: number) { const s = (this.ps[id] ||= { tu: 0, neg: 0, pts: 0 }); s[k]++; s.pts += pts }
  /** After an interrupt neg the whole question is read again for the other team (no neg possible on the reread), and they can still earn the bonus. */
  restartRead() {
    const rx = readText(this.q.tu, this.q.choices), { tu, choices, sub, topic, ai } = this.q
    this.buzzer = ''; this.reread = true; this.st = 'read'; this.ts = Date.now(); this.rt = readTimes(rx.text, this.cfg.wpm); this.readEnd = this.ts + (this.rt[this.rt.length - 1] || 0) + 300
    this.all({ t: 'read', kind: 'tu', reread: true, q: { tu, choices, sub, topic, ai } }); this.sys('The question is being reread for the other team.'); this.dirty = true
  }
  endQ(msg: string) { this.st = 'gap'; this.dl = Date.now() + 10000; this.req.proceed.clear(); this.all({ t: 'reveal', q: this.q, msg }); this.dirty = true }
  afterGap() { if (this.clock <= 0) return this.endHalf(); this.next() }
  endHalf() {
    this.st = 'idle'; this.dirty = true
    if (this.half === 1) { this.phase = 'break'; this.dl = Date.now() + 120000; this.sys(`First half over. A ${this.score.A} – B ${this.score.B}. 2-minute break; a captain can end it early.`) }
    else { this.phase = 'over'; this.sys(`Game over! A ${this.score.A} – B ${this.score.B}`) }
  }
  startHalf() { this.half = 2; this.chFail = { A: 0, B: 0 }; this.phase = 'play'; this.clock = this.cfg.halfMin * 60000; this.sys('Second half!'); this.next() }
  // ---- challenges & replacements ----
  async review(prompt: string): Promise<{ overturn: boolean; reason: string; err?: boolean }> {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.env.GROQ_API_KEY },
        body: JSON.stringify({ model: this.env.GROQ_MODEL || 'openai/gpt-oss-120b', temperature: 0.2, max_completion_tokens: 2048, reasoning_effort: 'medium', messages: [{ role: 'system', content: 'Reply with valid JSON only.' }, { role: 'user', content: prompt }] }) })
      if (!r.ok) throw new Error('upstream')
      const j: any = await r.json(), o = JSON.parse(((j.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/) || ['{}'])[0])
      return { overturn: o.overturn === true, reason: String(o.reason || 'No reason given.').slice(0, 300) }
    } catch { return { overturn: false, reason: '', err: true } }
  }
  async challenge(p: Pl, m: any) {
    const t = this.team(p)!, e = this.ev.find(x => x.id === m.id)
    if (!p.seat?.endsWith('-C') || this.st !== 'gap' || this.reviewing || this.repl || !e || e.ch || this.chFail[t] >= 2) return
    if (!((e.team === t && !e.ok) || (e.team !== t && e.ok))) return
    this.reviewing = true; const t0 = Date.now(), tu = e.kind === 'tu', q = this.q, ch = tu ? q.choices || {} : bonusChoices(q) || {}, key = tu ? q.ans : q.ba
    this.sys(`${t} captain challenges ${e.name}'s ${tu ? 'toss-up' : 'bonus'} ruling (${e.ok ? 'marked correct' : 'marked incorrect'}). The AI is reviewing…`); this.dirty = true
    const r = await this.review(`You are a strict, fair Science Bowl moderator ruling on a challenge.
Question: ${tu ? q.tu : q.bn}
Choices: ${JSON.stringify(ch)}
Answer key: ${key}
Answer given: ${ch[e.k] ? e.k + ' (' + ch[e.k] + ')' : e.k}, ruled ${e.ok ? 'CORRECT' : 'INCORRECT'}.
The ${t} captain challenges this ruling${m.reason ? ' and says: ' + String(m.reason).slice(0, 300) : ''}.
Overturn ONLY if the evidence shows the ruling was wrong: for an incorrect ruling, the given answer is also correct or the key is wrong; for a correct ruling, the given answer is actually not correct. Return ONLY JSON {"overturn":true|false,"reason":"one sentence"}.`)
    let bonusFor: T | null = null
    if (r.err) this.sys('The review service is unavailable. The ruling stands and this challenge does not count against you.')
    else if (r.overturn) {
      const kind = tu ? 'tu' : 'bn', win = tu ? 4 : 10
      if (!e.ok) { if (e.neg) { this.add('tu', e.team, 4); this.add('tu', other(e.team), -4) } this.add(kind, e.team, win); e.ok = true; if (tu) bonusFor = e.team }
      else { this.add(kind, e.team, -win); if (tu && this.ev.some(x => x.kind === 'bn' && x.team === e.team && x.ok)) this.add('bn', e.team, -10); e.ok = false }
      e.ch = 'sustained'; this.sys(`Challenge SUSTAINED: ${r.reason}`)
    } else {
      e.ch = 'denied'; this.chFail[t]++; const run = this.clock > 120000; if (run) this.clock = Math.max(0, this.clock - 10000)
      this.sys(`Challenge denied: ${r.reason} ${run ? '(10-second runoff.) ' : ''}Unsuccessful challenges this half: ${this.chFail[t]}/2.`)
    }
    this.reviewing = false; this.dirty = true
    if (bonusFor && q.bn) { // corrected toss-up: void the other team's credit and give this team the bonus
      for (const x of this.ev) { if (x.team !== bonusFor && x.ok && x.kind === 'tu') { this.add('tu', x.team, -4); x.ok = false; x.ch = 'voided' } if (x.team !== bonusFor && x.ok && x.kind === 'bn') { this.add('bn', x.team, -10); x.ok = false; x.ch = 'voided' } }
      this.won = bonusFor; this.sys(`Team ${bonusFor} gets the bonus for the corrected toss-up!`); return this.startBonus()
    }
    this.dl = Math.max(this.dl + (Date.now() - t0), Date.now() + 3000)
  }
  applyRepl(q: any) {
    const kind = this.repl.kind; this.repl = null; this.rq = { A: null, B: null }
    if (kind === 'tu') { for (const T of ['A', 'B'] as T[]) this.score[T] -= this.tuD[T] + this.bnD[T]; this.q = q; this.sys('Replacement toss-up! Results for the previous question are voided.'); this.begin() }
    else { for (const T of ['A', 'B'] as T[]) this.score[T] -= this.bnD[T]; this.bnD = { A: 0, B: 0 }; this.ev = this.ev.filter(x => x.kind !== 'bn'); this.q = { ...this.q, bn: q.bn || q.tu, bc: q.bn ? q.bc : q.choices, ba: q.bn ? q.ba : q.ans, bx: q.bn ? q.bx : undefined }; this.sys('Replacement bonus!'); this.startBonus() }
  }
  tick() {
    const now = Date.now(), dt = now - this.last; this.last = now; this.tickN++
    if (this.repl && now > this.repl.until) { this.repl = null; this.rq = { A: null, B: null }; this.dl = now + 5000; this.sys('No replacement question was available.'); this.dirty = true }
    if (!this.paused) {
      if (RUN.includes(this.st)) this.clock = Math.max(0, this.clock - dt)
      if (this.st === 'wait' && this.cap('A') && this.cap('B')) this.next()
      else if (this.st === 'read' && now >= this.readEnd) { this.st = 'win'; this.dl = now + 5000; this.dirty = true }
      else if (this.st === 'win' && now >= this.dl) this.endQ('No buzz.')
      else if (this.st === 'ans' && now >= this.dl && !this.judging) this.grade(null)
      else if (this.st === 'bgap' && now >= this.dl) this.startBonus()
      else if (this.st === 'bonus' && now >= this.dl && !this.judging) this.bonusAns(null)
      else if (this.st === 'gap' && !this.reviewing && !this.repl && now >= this.dl) this.afterGap()
      else if (this.phase === 'break' && now >= this.dl) this.startHalf()
    }
    if (this.dirty || this.tickN % 4 === 0) { this.dirty = false; this.broadcast() }
  }
  broadcast() {
    const now = Date.now()
    this.all({ t: 'state', phase: this.phase, half: this.half, clock: this.clock, run: !this.paused && RUN.includes(this.st), score: this.score, st: this.st, cfg: this.cfg, host: this.host, paused: this.paused, note: this.note, qn: this.qn, items: this.st === 'gap' ? this.ev.map(e => ({ id: e.id, kind: e.kind, team: e.team, name: e.name, ok: e.ok, ch: e.ch || null, sub: this.q?.sub })) : [], chFail: this.chFail, reviewing: this.reviewing, rq: this.rq, repl: !!this.repl, rules: this.rules, prop: this.prop,
      locked: [...this.locked], ps: this.ps, bp: this.bp, typed: this.typed, bsa: this.bsa, bt: this.btyping, judging: this.judging, rd: this.readEnd && this.ts ? this.readEnd - this.ts : 0, buzzer: this.buzzer, turn: this.turn, won: this.won, intr: this.intr, bi: this.bi, el: this.st === 'idle' || !this.ts ? 0 : this.elapsed(), rem: this.dl ? Math.max(0, (this.paused ? this.pauseAt : now) && this.dl - (this.paused ? this.pauseAt : now)) : 0,
      req: { pause: [...this.req.pause], resume: [...this.req.resume], proceed: [...this.req.proceed] }, players: [...this.pl.values()].map(p => ({ id: p.id, name: p.name, seat: p.seat })) })
  }
}
