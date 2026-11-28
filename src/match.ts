import { coach, store, type Room } from './platform'
import { meme } from './memes'
import { earliestIndex, planBot, type BotPlan } from './botsim'
import type { Mk } from './marked'
import { Ability, PlacementPool, botAcc, botElo, clamp, expected, gen, judge, topic, upd } from './engine'
import { bonusChoices, quickGrade, readText, readTimes, showWords, tokenize } from './read'
import { subName, type GameRec, type Profile, type QRec, type Question, type Sub } from './types'

/** A question counts toward ratings only if its difficulty is known: rated on the current scale, or AI-written at a requested level. */
export const isRated = (q: Question) => { try { const excluded = JSON.parse(localStorage.getItem('bl-reported-question-keys') || '[]') as string[]; if (excluded.includes(q.tu)) return false } catch {} return !!(q.dr || q.ai) }
export interface Opts { kind: 'bot' | 'prac' | 'mp' | 'place'; getP(): Profile; mutate(f: (P: Profile) => void): void; saveGame?: (g: GameRec) => void; fix?: Sub; tp?: string; packet?: string; pool?: Question[]; ordered?: boolean; room?: Room; host?: boolean }
export interface View {
  phase: 'idle' | 'loading' | 'read' | 'win' | 'ans' | 'bonus' | 'done' | 'error' | 'placed' | 'ended'
  tag: string; text: string; status: string; pct: number; choices: Record<string, string> | null
  pick: string | null; correct: string | null; msg: string; ex: string; n: number
  sc: [number, number]; ss: { tu: number; ok: number; neg: number }; scores: { name: string; s: number }[]
  canBuzz: boolean; canNext: boolean; typing: string | null; sa: boolean; note: string; placed: null | { r: number; sd: number; n: number; ok: number }
  mk: Mk | null; board: BoardRow[]; log: LogRow[]; paused: boolean
  ended: null | { n: number; ok: number; neg: number; subs: { sub: string; from: number; to: number; n: number }[] } // summary after "End match"
}
/** Scoreboard: one row per player (totals) and one entry per question (what each player scored on it). */
export interface BoardRow { name: string; tu: number; neg: number; bonus: number; pts: number }
export interface LogRow { n: number; sub: string; cells: string[] }
const ansText = (q: Question) => q.choices ? `${q.ans}) ${q.choices[q.ans]}` : q.ans
const bAns = (q: Question) => { const c = bonusChoices(q); return c ? `${q.ba}) ${c[q.ba!]}` : String(q.ba) }
const V0: View = { phase: 'idle', tag: '', text: '', status: '', pct: 100, choices: null, pick: null, correct: null, msg: '', ex: '', n: 0, sc: [0, 0], ss: { tu: 0, ok: 0, neg: 0 }, scores: [], canBuzz: false, canNext: false, typing: null, sa: false, note: '', placed: null, mk: null, board: [], log: [], paused: false, ended: null }

/** One match: solo practice, vs bot, or a multiplayer room (host-authoritative). UI subscribes via useSyncExternalStore. */
export class Match {
  v: View = { ...V0 }; L = new Set<() => void>()
  tm: any; rd = 0; n = 0; q!: Question; w: string[] = []; N = 0; i = 0; ph = ''; who = ''; intr = false; bi = 0; el = 0; bf = 1; bot = 5; plan: BotPlan = { mode: 'none', at: Infinity, winT: Infinity, correct: false, earliest: 0 }
  Qs: Record<string, Question[]> = {}; used = new Set<string>(); cb: ((k: string | null) => void) | null = null
  paused = false; queuedPlace?: Question; outs = new Set<string>(); lockedBy = ''; lk: any = null; done1 = false; at: any; mpSc: Record<string, number> = {}; nq = 0; starts: number[] = []; ab?: Ability; pool?: PlacementPool; winSec = 5; game: GameRec; idk = false; t0 = 0; buzzAt = 0; lastBonusPick: string | null = null; draft = ''; tcb: ((t: string | null) => void) | null = null; saGo: (() => void) | null = null; times: number[] = []; ei = 0; second = false; rereadMode = false; lastOk: boolean | null = null; cur: { me: string[]; bot: string[] } = { me: [], bot: [] }
  constructor(public o: Opts) {
    const label = o.kind === 'place' ? `${subName(o.fix || '')} placement test` : o.kind === 'bot' ? 'Vs bot' + (o.packet ? ` · ${o.packet}` : '') : o.packet ? `Packet: ${o.packet}` : o.pool ? 'Filtered questions' : o.tp ? `Weak spot: ${o.tp}` : 'Practice'
    this.v = { ...this.v, board: [{ name: o.kind === 'place' ? 'You' : 'You', tu: 0, neg: 0, bonus: 0, pts: 0 }, ...(o.kind === 'bot' ? [{ name: 'Bot', tu: 0, neg: 0, bonus: 0, pts: 0 }] : [])] }
    this.game = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), ts: Date.now(), mode: o.kind === 'place' ? 'place' : o.kind === 'bot' ? 'bot' : 'prac', label, subs: [], qs: [] }
  }
  sub = (f: () => void) => { this.L.add(f); return () => { this.L.delete(f) } }
  get = () => this.v
  set(p: Partial<View>) { this.v = { ...this.v, ...p }; this.L.forEach(f => f()) }
  stop() { this.rd++; clearInterval(this.tm); clearTimeout(this.at); this.cb = null; this.tcb = null; this.saGo = null }
  dispose() { this.stop(); this.o.room?.leave() }
  /** Ends a practice or bot match right now and shows a summary. Everything answered so far is already saved in History, and the ratings already moved as you answered. */
  end() {
    if (this.mp || this.o.kind === 'place' || this.ph === 'ended') return
    this.stop(); this.ph = 'ended'
    const qs = this.game.qs, by = new Map<string, { sub: string; from: number; to: number; n: number }>()
    for (const q of qs) if (q.rated) { const s = by.get(q.sub) || { sub: q.sub, from: q.e0, to: q.e1, n: 0 }; s.to = q.e1; s.n++; by.set(q.sub, s) }
    this.persist()
    this.set({ phase: 'ended', canBuzz: false, canNext: false, choices: null, typing: null, sa: false, status: '', pct: 0, ended: { n: qs.length, ok: qs.filter(q => q.ok).length, neg: qs.filter(q => q.neg).length, subs: [...by.values()] } })
  }
  get mp() { return this.o.kind === 'mp' }
  get me() { return this.o.room!.id }
  nm(id: string) { return this.o.room!.peers().find(p => p.id === id)?.name || 'Player' }
  scoreboard() { if (this.mp) this.set({ scores: this.o.room!.peers().map(p => ({ name: p.name, s: this.mpSc[p.id] || 0 })) }) }

  started = false
  start() {
    if (this.started) return; this.started = true
    if (this.o.kind === 'place') return void this.startPlace()
    if (!this.mp) return void this.round()
    const r = this.o.room!, on = (t: string, f: (d: any, from: string) => void) => r.on(t, f)
    r.onPeers(() => this.scoreboard()); this.scoreboard()
    on('q', d => this.mpQ(d)); on('lock', d => this.onLock(d)); on('res', d => this.onRes(d)); on('unlock', d => this.onUnlock(d)); on('bonus', d => this.onBonus(d))
    on('end', d => this.fin(d.msg)); on('buzz', (_, f) => this.o.host && this.hostBuzz(f)); on('ans', (d, f) => this.o.host && this.hostAns(f, d.k))
    on('bres', (d, f) => this.o.host ? this.hostBres(f, d.ok) : d.sc && this.onBres(d))
    if (this.o.host) { r.emit('start'); setTimeout(() => this.mpRound(), 1500) } else this.set({ status: 'Waiting for the host…' })
  }
  // ---- helpers ----
  read(text: string, onIdx: (i: number) => void, done: () => void) {
    const my = ++this.rd, w = tokenize(text), times = readTimes(text, this.o.getP().p.wpm), t0 = performance.now(); let i = 0 // same schedule as team games, with pauses at punctuation
    const waitStep = (delay: number) => setTimeout(() => { if (this.rd !== my) return; if (this.paused && this.o.kind === 'place') return waitStep(100); step() }, Math.max(0, delay))
    const step = () => { if (this.rd !== my) return; onIdx(++i); if (i >= w.length) return done(); waitStep(Math.max(0, times[i] - times[i - 1])) }
    waitStep(Math.max(0, times[0]))
  }
  timer(sec: number, fn: ((t: number) => void) | null, end: () => void) {
    clearInterval(this.tm); let elapsed = 0, last = performance.now()
    this.tm = setInterval(() => { const now = performance.now(); if (!(this.paused && this.o.kind === 'place')) elapsed += (now - last) / 1000; last = now; const t = elapsed; this.el = t; this.set({ pct: Math.max(0, 100 - t / sec * 100) }); fn?.(t); if (t >= sec) { clearInterval(this.tm); end() } }, 80)
  }
  ask(c: Record<string, string>, sec: number, cb: (k: string | null) => void) {
    this.cb = k => { this.cb = null; clearInterval(this.tm); cb(k) }
    this.set({ choices: c, pick: null, correct: null }); this.timer(sec, null, () => this.cb?.(null))
  }
  answer(k: string) { this.cb?.(k) }
  /** Free-text answer with a countdown. Submits whatever is typed when time runs out. */
  askType(label: string, sec: number, cb: (t: string | null) => void) {
    this.draft = ''; this.tcb = t => { this.tcb = null; clearInterval(this.tm); this.set({ typing: null }); cb(t && t.trim() ? t.trim().slice(0, 120) : null) }
    this.set({ typing: label, choices: null, correct: null, pick: null }); this.timer(sec, null, () => this.tcb?.(this.draft))
  }
  setDraft(t: string) { this.draft = t }
  answerText(t: string) { this.tcb?.(t) }
  submitSA() { if (this.v.sa && this.saGo) { const g = this.saGo; this.saGo = null; g() } }
  diffs(sub: Sub) { const r = Math.round(this.o.getP().r[sub] ?? 5); return [-1, 0, 0, 1].map(o => clamp(r + o, 1, 10)) }
  async nextQ(sub: Sub): Promise<Question | undefined> {
    const m: any = this; if (this.o.pool) return (m.plq ||= this.o.ordered ? [...this.o.pool] : [...this.o.pool].sort(() => Math.random() - .5)).shift(); if (this.o.packet) return (m.pkq ||= store.bank().filter(x => x.pk === this.o.packet).sort((a, b) => (a.ord || 0) - (b.ord || 0))).shift()
    const src = this.o.getP().p.src
    if (src !== 'ai' && !this.o.tp && !(src === 'both' && Math.random() < .5)) {
      const r = this.o.getP().r[sub] ?? 5, c = store.bank().filter(x => x.sub === sub && !this.used.has(x.tu)).sort((x, y) => (isRated(x) ? Math.abs(x.d - r) : 1.5) - (isRated(y) ? Math.abs(y.d - r) : 1.5))
      if (c.length) { const q = c[Math.floor(Math.random() * Math.min(5, c.length))]; this.used.add(q.tu); return q }
    }
    const Q = (this.Qs[sub] ||= [])
    if (!Q.length) Q.push(...await gen(sub, this.diffs(sub), this.o.tp)); else if (Q.length < 2) gen(sub, this.diffs(sub), this.o.tp).then(a => Q.push(...a)).catch(() => {})
    return Q.shift()
  }
  pickSub(): Sub { const P = this.o.getP(), all = store.subjects(), L0 = all.filter(s => P.diag[s]), L = L0.length ? L0 : all, sel = (P.p.subjs || []).filter(s => L.includes(s)), pool = sel.length ? sel : L; return this.o.fix || pool[(this.n - 1) % pool.length] }
  present(q: Question, winEnd: () => void) {
    const rt = readText(q.tu, q.choices) // the stem, then the choices, read at the same pace
    this.times = readTimes(rt.text, this.o.getP().p.wpm); this.ei = earliestIndex(q, rt.words, rt.nq).at
    this.q = q; this.w = rt.words; this.nq = rt.nq; this.starts = rt.starts; this.N = rt.words.length; this.i = 0; this.who = ''; this.idk = false; this.buzzAt = 0; this.t0 = performance.now(); if (!this.game.subs.includes(q.sub)) this.game.subs.push(q.sub); this.ph = 'read'; this.outs = new Set(); this.lockedBy = ''; this.done1 = false; this.second = false; this.rereadMode = false; this.lastOk = null; this.cur = { me: [], bot: [] }
    this.set({ mk: null, phase: 'read', tag: `${subName(q.sub)} · ${q.topic} · toss-up${q.ai ? ' · 🤖 AI-generated' : ''} ${this.o.kind === 'place' ? '· placement question' : '· 4 pts'}`, text: '', status: 'Reading…', pct: 100, choices: null, correct: null, pick: null, msg: '', ex: '', canBuzz: true, canNext: false, n: this.n, typing: null, sa: false, note: '' })
    const bot = this.o.kind === 'bot'
    if (bot) this.plan = planBot(q, this.bot, botAcc(this.bot, q.dr || q.ai ? Number(q.d) : 5), rt.words, rt.nq) // realistic: never before the numbers (or choices) have been given
    this.read(rt.text, i => { this.i = i; this.set({ text: showWords(this.w, i, this.starts) }); if (bot && !this.who && this.ph === 'read' && i >= this.plan.at) this.botBuzz() }, () => {
      if (this.ph !== 'read') return; this.ph = 'win'; this.set({ phase: 'win', status: this.o.kind === 'place' ? `${this.winSec} seconds to buzz, or press “I don’t know”…` : '5 seconds to buzz…' })
      this.timer(this.winSec, t => { if (bot && !this.who && t >= this.plan.winT) this.botBuzz() }, winEnd)
    })
  }
  // ---- solo / bot ----
  async startPlace() {
    this.ab = new Ability(); this.pool = new PlacementPool(this.o.fix!)
    this.set({ phase: 'loading', status: `Building your ${subName(this.o.fix!)} placement test…`, text: '' })
    try { await this.pool.warm() } catch { /* questions are generated on demand instead */ }
    this.round()
  }
  async round() {
    this.stop(); const place = this.o.kind === 'place'
    if (place && this.n >= 10 && (this.ab!.sd < .4 || this.n >= 20)) return this.finishPlace() // confident enough, or 20 asked
    this.n++; const sub = place ? this.o.fix! : this.pickSub()
    this.set({ phase: 'loading', status: place ? `Choosing question ${this.n}…` : this.n < 2 ? 'Writing your first packet…' : 'Writing a question…', text: '', choices: null, canBuzz: false, canNext: false, msg: '', ex: '', note: '', typing: null, sa: false, n: this.n })
    let q: Question | undefined; try { q = place ? (this.queuedPlace || await this.pool!.next(clamp(this.ab!.mean + .3, 0, 10))) : await this.nextQ(sub); if (place) this.queuedPlace = undefined } catch (e: any) { q = undefined }
    if (!q) { if (place && this.ab!.n >= 6) return this.finishPlace(); return void this.set({ phase: 'error', status: (this.o.packet || this.o.pool) ? 'Packet finished! 🎉' : 'Couldn’t get a question (check your key / connection).', canNext: !(this.o.packet || this.o.pool) }) }
    this.winSec = place ? (q.d >= 7 ? 60 : q.d >= 5 ? 45 : 30) : 5
    if (this.o.kind === 'bot') this.bot = botElo(this.o.getP(), q.sub)
    this.present(q, () => this.noBuzz())
  }
  finishPlace() {
    const ab = this.ab!, sub = this.o.fix!, r = +ab.mean.toFixed(3), ok = this.game.qs.filter(x => x.ok).length
    this.stop(); this.o.mutate(P => { P.r[sub] = r; P.n[sub] = ab.n; P.diag[sub] = true; P.confidence ||= {}; const qs=this.game.qs, total=qs.length, skipped=qs.filter(x=>x.idk||x.noBuzz).length, accuracy=total?qs.filter(x=>x.ok).length/total:.5; const sample=Math.min(.035, Math.max(0,total-8)*.0025), signal=(accuracy-.5)*.035, skipPenalty=(total?skipped/total:0)*.045; P.confidence[sub]=clamp(.5+Math.min(.045,Math.max(0,total-8)*.0025)+Math.max(-.025,Math.min(.025,(accuracy-.5)*.05))-Math.min(.04, (total?skipped/total:0)*.06), .46, .57) })
    this.game.end = { r, sd: +ab.sd.toFixed(3) }; this.persist()
    this.set({ phase: 'placed', placed: { r, sd: ab.sd, n: ab.n, ok }, text: '', choices: null, typing: null, sa: false, canBuzz: false, status: '', msg: '', note: '' })
  }
  tierOf(frac: number, buzzed: boolean, early = false) { return !buzzed ? 'No buzz' : frac >= 1 ? (early ? '⚡ During the choices (an interrupt)' : 'After the full read') : frac < .25 ? '⚡ Lightning' : frac < .5 ? 'Fast' : frac < .75 ? 'Steady' : 'Late' }
  /** Adds this toss-up to the saved game history (when you buzzed, how it moved your rating, and so on). */
  record(r: { ok: boolean; neg: boolean; given: string | null; e0: number; e1: number; pts: number; rated: boolean; botWon?: boolean; sp?: number; noBuzz?: boolean }) {
    const q = this.q, buzzed = !r.noBuzz && !r.botWon, frac = buzzed ? (this.intr ? Math.min(1, this.bi / Math.max(1, this.nq)) : 1) : 1
    this.game.qs.push({ sub: q.sub, topic: q.topic, d: isRated(q) ? q.d : null, ai: q.ai, src: q.src, tu: q.tu, choices: q.choices || null, ans: q.ans, given: r.given, ok: r.ok, neg: r.neg, idk: this.idk || undefined, noBuzz: r.noBuzz || undefined, botWon: r.botWon || undefined,
      at: buzzed ? +this.buzzAt.toFixed(2) : 0, frac: +frac.toFixed(3), tier: this.tierOf(frac, buzzed, this.intr), e0: +r.e0.toFixed(3), e1: +r.e1.toFixed(3), speed: r.sp ?? 0, pts: r.pts, rated: r.rated, wi: buzzed ? (this.intr ? this.bi : this.N) : undefined, ei: this.ei, nq: this.nq, mc: !!q.choices,
      lag: buzzed && !this.idk && this.times[this.ei - 1] !== undefined ? +(this.buzzAt - this.times[this.ei - 1] / 1000).toFixed(2) : undefined } as QRec) // lag = seconds between the earliest realistic buzz point and your buzz
    this.persist()
  }
  persist() { if (this.o.kind !== 'mp' && this.game.qs.length) this.o.saveGame?.({ ...this.game }) }
  next() { if (this.o.kind === 'place' && this.v.phase === 'done' && this.v.canNext) { this.set({ canNext: false, msg: '', paused: false }); this.paused = false; return void this.round() } this.mp ? this.o.host && this.mpRound() : this.round() }
  togglePause() { if (this.o.kind !== 'place' || !['read','win','ans'].includes(this.v.phase)) return; this.paused = !this.paused; this.set({ paused: this.paused, status: this.paused ? 'Paused — press Resume when you’re ready.' : (this.v.phase === 'read' ? 'Reading…' : this.v.phase === 'win' ? `${this.winSec} seconds to buzz, or press “I don’t know”…` : 'Answer when ready.') }) }
  buzz() {
    if (this.v.sa) return this.submitSA()
    if (this.mp) return this.mpBuzz()
    if (this.who || !['read', 'win'].includes(this.ph)) return
    const early = this.ph === 'read'; this.who = 'me'; this.intr = early && !this.rereadMode; this.bi = this.i; this.buzzAt = (performance.now() - this.t0) / 1000; this.rd++; clearInterval(this.tm); this.ph = 'ans'
    this.set({ phase: 'ans', canBuzz: false })
    if (early || !this.q.choices) { this.set({ status: this.q.choices ? 'You buzzed before the choices were fully read. Type your answer (8 seconds).' : 'Type your answer (8 seconds).' }); this.askType(this.q.choices ? 'Type your answer (or the letter if you caught it)' : 'Type your answer', 8, t => this.gradeText(t)) }
    else { this.set({ status: 'Answer! 5 seconds' }); this.ask(this.q.choices!, 5, k => this.grade(k)) }
  }
  /** Placement tests only: "I don't know" at any point. No penalty, and no lucky guess can count. */
  dontKnow() {
    if (this.o.kind !== 'place' || !['read', 'win', 'ans'].includes(this.ph)) return
    this.idk = true; if (!this.who) { this.who = 'me'; this.intr = this.ph === 'read'; this.bi = this.i; this.buzzAt = (performance.now() - this.t0) / 1000 }
    this.rd++; clearInterval(this.tm); this.cb = null; this.tcb = null; this.ph = 'ans'; this.set({ phase: 'ans', canBuzz: false, typing: null, sa: false })
    this.placeGrade(false, null)
  }
  placeGrade(ok: boolean, given: string | null) {
    const q = this.q, ab = this.ab!, e0 = ab.mean; ab.update(q.d, ok, this.idk, !!q.choices); const e1 = ab.mean
    this.o.mutate(P => { topic(P, q.sub, q.topic, ok) })
    this.bump(ok, false); this.record({ ok, neg: false, given, e0, e1, pts: 0, rated: true, noBuzz: !this.who })
    this.set({ note: `${this.idk ? 'Skipped' : this.tierOf(this.intr ? Math.min(1, this.bi / Math.max(1, this.nq)) : 1, !!this.who, this.intr)} · estimate ${e0.toFixed(3)} → ${e1.toFixed(3)}` })
    this.fin(this.idk ? (this.who && !given && this.ph !== 'ans' ? '' : '') + 'You skipped this one (I don’t know). Answer: ' + ansText(q) + '.' : ok ? 'Correct.' : (given ? 'Incorrect. ' : 'Time. ') + 'Answer: ' + ansText(q) + '.')
  }
  async gradeText(t: string | null) {
    const q = this.q; if (t === null) return this.grade(null)
    const accepts = q.choices ? [q.choices[q.ans]] : [q.ans, ...(q.ax || [])]; let ok = quickGrade(t, accepts, q.choices || null, q.ans, q.nx)
    if (ok === null) { this.set({ status: 'Checking your answer…' }); ok = await judge(q.tu, accepts, t, q.nx || []) }
    if (this.ph === 'ans') this.grade(t, ok)
  }
  botBuzz() {
    this.who = 'bot'; this.rd++; clearInterval(this.tm); const early = this.ph === 'read'; this.ph = 'ans'
    this.set({ phase: 'ans', canBuzz: false, status: early && this.i < this.N ? `🤖 Bot buzzed ${Math.round(Math.min(1, this.i / Math.max(1, this.nq)) * 100)}% of the way through the question…` : '🤖 Bot buzzed…' })
    const q = this.q, p = botAcc(this.bot, q.dr || q.ai ? Number(q.d) : 5)
    setTimeout(() => {
      const r0 = this.o.getP().r[q.sub] ?? 5
      if (this.plan.correct) {
        let e0=r0,e1=r0; this.o.mutate(P=>{if(isRated(q)){e0=P.r[q.sub]??5; const k=.18/(1+(P.n[q.sub]||0)/25); upd(P,q.sub,q.d,-.16,k); e1=P.r[q.sub]??5}}); this.record({ ok: false, neg: false, given: null, e0, e1, pts: 0, rated: isRated(q), botWon: true })
        this.award('bot', 'tu', 4); const bn = !!q.bn && Math.random() < p; if (bn) this.award('bot', 'bonus', 10) // the bot's bonus is just decided by chance, from its strength against the difficulty
        this.fin('Bot answered correctly' + (bn ? ' and got the bonus' : '') + '. Answer: ' + ansText(q) + '.')
      } else {
        if (early) { this.award('me', 'pen', 4) }
        this.rereadForPlayer(early ? 'The bot negged! You get 4 points, and the question is reread for you.' : 'The bot was wrong. You get 5 seconds to buzz.', early)
      }
    }, 1300)
  }
  /** After the bot gets it wrong the question is NOT over: you get a reread (after an interrupt neg, with no neg possible) or a fresh 5 seconds (after a wrong answer once the read was finished), and you still get the bonus. */
  rereadForPlayer(msg: string, reread: boolean) {
    const q = this.q, rt = readText(q.tu, q.choices); this.second = true; this.rereadMode = reread; this.who = ''; this.idk = false; this.lastOk = null
    this.set({ msg, choices: null, correct: null, pick: null, typing: null, sa: false })
    const win = () => { this.ph = 'win'; this.set({ phase: 'win', canBuzz: true, status: '5 seconds to buzz…' }); this.timer(5, null, () => this.noBuzz()) }
    if (!reread) return void win()
    this.ph = 'read'; this.t0 = performance.now(); this.buzzAt = 0; this.i = 0; this.times = readTimes(rt.text, this.o.getP().p.wpm)
    this.set({ phase: 'read', canBuzz: true, text: '', status: '🔁 The question is being reread for you. Buzz any time; there is no neg on a reread.' })
    this.read(rt.text, i => { this.i = i; this.set({ text: showWords(this.w, i, this.starts) }) }, () => { if (this.ph === 'read') win() })
  }
  /** After YOU get it wrong the bot gets its turn (reread after an interrupt neg, otherwise a fresh 5 seconds). */
  botSecond(neg: boolean, base: string) {
    const q = this.q, p = botAcc(this.bot, q.dr || q.ai ? Number(q.d) : 5), knows = Math.random() < p; this.second = true
    this.set({ msg: base, canBuzz: false, typing: null, sa: false })
    const answer = () => {
      if (knows) { this.award('bot', 'tu', 4); const bn = !!q.bn && Math.random() < p; if (bn) this.award('bot', 'bonus', 10); this.fin(`${base}The bot got it${bn ? ' and the bonus' : ''}. Answer: ${ansText(q)}.`) }
      else this.fin(`${base}The bot didn’t get it either. Answer: ${ansText(q)}.`)
    }
    const window = () => { this.ph = 'win'; this.set({ phase: 'win', status: '🤖 5 seconds for the bot to buzz…' }); const winT = .4 + Math.random() * 2.6 * (1 - this.bot / 14); this.timer(5, t => { if (knows && t >= winT) { clearInterval(this.tm); answer() } }, answer) }
    if (neg) { this.ph = 'bot2'; this.set({ phase: 'read', status: '🔁 The question is reread for the bot…', text: '' }); this.read(readText(q.tu, q.choices).text, i => this.set({ text: showWords(this.w, i, this.starts) }), window) }
    else window()
  }
  /** Adds points to a player (or the bot) and to the scoreboard. kind: tu = toss-up, neg = interrupt neg, bonus, pen = points received from the other side's neg. */
  award(who: 'me' | 'bot', kind: 'tu' | 'neg' | 'bonus' | 'pen', pts: number) {
    const i = who === 'me' ? 0 : 1, rows = this.v.board.map(r => ({ ...r })), r = rows[i]; if (!r) return
    r.pts += pts; if (kind === 'tu') r.tu++; if (kind === 'neg') r.neg++; if (kind === 'bonus') r.bonus += pts
    this.cur[who].push((pts >= 0 ? '+' : '−') + Math.abs(pts))
    const sc = [...this.v.sc] as [number, number]; sc[i] += pts; this.set({ board: rows, sc })
  }
  mkData(): Mk { return { words: this.w, starts: this.starts, nq: this.nq, buzz: this.who === 'me' && !this.idk ? (this.intr ? this.bi : this.N) : null, ok: this.lastOk, early: this.ei } }
  noBuzz() {
    const q = this.q
    if (this.o.kind === 'place') { this.idk = true; return this.placeGrade(false, null) } // thinking time ran out: counts like "I don't know"
    let e0 = 0, e1 = 0
    this.o.mutate(P => { e0 = P.r[q.sub] ?? 5; if (isRated(q)) upd(P, q.sub, q.d, .15, .6); topic(P, q.sub, q.topic, false); P.st.tu++; e1 = P.r[q.sub] ?? 5 })
    this.bump(false, false); this.record({ ok: false, neg: false, given: null, e0, e1, pts: 0, rated: isRated(q), noBuzz: true })
    this.set({ note: `No buzz · rating ${e0.toFixed(3)} → ${e1.toFixed(3)}${!isRated(q) ? ' (unrated question: rating unchanged)' : ''}` })
    this.fin('No buzz. Answer: ' + ansText(q) + '.')
  }
  bump(ok: boolean, neg: boolean) { const s = this.v.ss; this.set({ ss: { tu: s.tu + 1, ok: s.ok + +ok, neg: s.neg + +neg } }) }
  grade(pick: string | null, okIn?: boolean) {
    const q = this.q, ok = okIn ?? pick === q.ans, frac = this.intr ? Math.min(1, this.bi / Math.max(1, this.nq)) : 1
    const sp = this.intr ? .55 + .45 * (1 - frac) : .4 * (1 - this.el / this.winSec), neg = !ok && this.intr && pick !== null // earlier buzz = higher speed score = more rating
    this.set({ correct: q.choices ? q.ans : null, pick: /^[WXYZ]$/.test(pick || '') ? pick : null }); this.lastOk = ok
    if (this.o.kind === 'place') return this.placeGrade(ok, pick)
    let pts = 0
    if (neg) meme('neg'); else if (ok && this.intr) meme(frac < .3 ? 'fast' : 'interrupt')
    if (ok) pts = 4; else if (neg) pts = -4
    let e0 = 0, e1 = 0
    this.o.mutate(P => { P.st.tu++; P.st.tm += sp; if (ok) P.st.ok++; if (neg) P.st.neg++; topic(P, q.sub, q.topic, ok); e0 = P.r[q.sub] ?? 5; if (isRated(q)) { const n = P.n[q.sub] || 0; const k = .6 / (1 + n / 18); if (ok) upd(P, q.sub, q.d, Math.max(expected(P.r[q.sub] ?? 5, q.d), .55 + .45 * sp), k); else upd(P, q.sub, q.d, neg ? -.12 : .05, k); P.confidence ||= {}; P.confidence[q.sub] = Math.min(.98, .5 + (1 - Math.exp(-n / 18)) * .48) } e1 = P.r[q.sub] ?? 5 })
    const sb = ok && isRated(q) ? .6 * .45 * (sp - .6) : 0 // the part of the rating change that came from buzzing faster (or slower) than a steady buzz
    this.set({ note: `${this.tierOf(frac, true, this.intr)} · buzzed at ${this.buzzAt.toFixed(1)} s (${Math.round(frac * 100)}% of the question)${sb ? ` · speed ${sb >= 0 ? '+' : ''}${sb.toFixed(3)}` : ''} · rating ${e0.toFixed(3)} → ${e1.toFixed(3)}${!isRated(q) ? ' (unrated question: rating unchanged)' : ''}` })
    this.bump(ok, neg); this.record({ ok, neg, given: pick, e0, e1, pts, rated: isRated(q), sp: +sb.toFixed(3) })
    if (ok) this.award('me', 'tu', 4); else if (neg) { this.award('bot', 'pen', 4) }
    if (!ok) {
      const base = (pick ? 'Incorrect. ' : 'Time. ') + (pick && !/^[WXYZ]$/.test(pick) ? `You said “${pick}”. ` : '') + (neg ? 'Neg (−4). ' : '')
      if (this.o.kind === 'bot' && !this.second) return void this.botSecond(neg, base) // the question isn't over: the bot gets its turn
      return void this.fin(base + 'Answer: ' + ansText(q) + '.')
    }
    if (!q.bn) return void this.fin('Correct! +' + pts)
    this.set({ msg: `Correct! +${pts}. Bonus (10 pts):` })
    setTimeout(() => this.bonus(this.me2, k => {
      if (k) this.award('me', 'bonus', 10)
      // Bonus ELO is outcome-only (no timing), and deliberately smaller than toss-up ELO.
      let be0: number | undefined, be1: number | undefined, br = false
      if (isRated(q)) this.o.mutate(P => { be0 = P.r[q.sub] ?? 5; const n = P.n[q.sub] || 0, e = expected(be0, q.d); P.r[q.sub] = +clamp(be0 + (.42 / (1 + n / 25)) * ((k ? .78 : -.22) - e), 0, 10).toFixed(3); be1 = P.r[q.sub]; br = true })
      const last = this.game.qs[this.game.qs.length - 1]; if (last) { last.bonus = { ok: k, given: this.lastBonusPick, ba: q.ba!, bn: q.bn!, choices: bonusChoices(q), e0: be0, e1: be1, rated: br }; this.persist() }
      this.fin(k ? 'Bonus correct! +10' : 'Bonus missed. Answer: ' + bAns(q) + '.', true)
    }), 900)
  }
  get me2() { return '' }
  /** Shared bonus: read it and its choices, THEN start the 20 s clock. Multiple choice: click a choice. Short answer: press Submit answer within 20 s, then type within 5 s. `done(ok)` is called once. */
  bonus(_who: string, done: (ok: boolean) => void, answering = true, label = '') {
    const q = this.q, ch = bonusChoices(q), rt = readText(q.bn!, ch); this.ph = 'bonus'
    this.set({ phase: 'bonus', canBuzz: false, choices: null, correct: null, pick: null, text: '', typing: null, sa: false, status: label || 'Reading bonus…' })
    this.read(rt.text, i => this.set({ text: showWords(rt.words, i, rt.starts) }), () => {
      this.set({ text: showWords(rt.words, rt.words.length, rt.starts), status: answering ? (ch ? '20 seconds to answer…' : '') : label })
      if (!answering) return
      if (ch) this.ask(ch, 20, k => { this.lastBonusPick = k; this.set({ correct: q.ba!, pick: k }); done(k === q.ba) })
      else this.startSA(q, done)
    })
  }
  startSA(q: Question, done: (ok: boolean) => void) {
    const accepts = [q.ba!, ...(q.bx || [])]
    const finish = async (t: string | null) => {
      let ok = false
      this.lastBonusPick = t; if (t) { let r = quickGrade(t, accepts, null, '', q.bnx); if (r === null) { this.set({ status: 'Checking your answer…' }); r = await judge(q.bn!, accepts, t, q.bnx || []) } ok = r }
      done(ok)
    }
    this.set({ sa: true, status: 'Press “Submit answer” within 20 seconds. Then you get 5 more seconds to type.' })
    this.timer(20, null, () => { this.saGo = null; this.set({ sa: false }); finish(null) })
    this.saGo = () => { this.set({ sa: false, status: '' }); this.askType('Type your answer (5 seconds)', 5, finish) }
  }
  async fin(msg: string, b = false) {
    this.stop(); this.ph = 'done'; const q = this.q
    if (this.o.kind !== 'place' && this.o.kind !== 'mp') this.set({ log: [...this.v.log, { n: this.n, sub: q.sub, cells: this.v.board.map((_, i) => (i ? this.cur.bot : this.cur.me).join(' ') || '–') }] })
    this.set({ mk: this.o.kind === 'mp' ? null : this.mkData(), phase: 'done', text: b ? q.bn! : q.tu, msg, pct: 0, status: '', canBuzz: false, canNext: !this.mp || !!this.o.host, choices: b ? bonusChoices(q) : q.choices || null, typing: null, sa: false, correct: this.v.correct || (b ? (bonusChoices(q) ? q.ba! : null) : q.choices ? q.ans : null), ex: this.o.kind === 'place' ? '' : 'Explaining…' })
    if (this.o.kind === 'place') {
      if (this.n >= 20 || (this.n >= 10 && this.ab!.sd < .4)) { this.finishPlace(); return }
      this.set({ canNext: false, status: 'Preparing your next question…' })
      this.pool!.next(clamp(this.ab!.mean + .3, 0, 10)).then(qn => { this.queuedPlace = qn; if (this.v.phase === 'done') this.set({ canNext: true, status: qn ? 'Next question ready.' : 'Could not prepare the next question. Click Next question to retry.' }) }).catch(() => { if (this.v.phase === 'done') this.set({ canNext: true, status: 'Could not prepare the next question. Click Next question to retry.' }) })
      return
    }
    try { await coach(`Explain to a high-school Science Bowl student how to solve this ${q.sub} question, step by step, with a tip for solving it faster under time pressure. Use short numbered steps. Write ALL math, chemistry and physics (every equation, formula, and number with its units) in LaTeX inside $...$, and put the key equations on their own line in $$...$$. Everything else is plain text. Under 170 words.\nQuestion: ${b ? q.bn : q.tu}\nChoices: ${JSON.stringify(b ? q.bc : q.choices)}\nCorrect: ${b ? q.ba : q.ans}\nReference solution: ${q.ex || ''}`, t => this.set({ ex: t })) } catch { this.set({ ex: q.ex || '' }) }
  }
  // ---- multiplayer (host decides who buzzed first and scores) ----
  async mpRound() {
    this.n++; this.set({ phase: 'loading', status: 'Loading…', choices: null, msg: '', ex: '', canNext: false })
    let q: Question | undefined; try { q = await this.nextQ(this.pickSub()) } catch { /* handled below */ }
    if (!q) return void this.set({ status: 'Couldn’t get a question — press Next to retry.', canNext: true })
    const d = { q, n: this.n }; this.o.room!.emit('q', d); this.mpQ(d)
  }
  mpQ(d: { q: Question; n: number }) { this.stop(); this.n = d.n; this.present(d.q, () => { if (this.o.host && this.ph === 'win') this.hostEnd('No buzz. Answer: ' + this.q.ans + '.') }) }
  mpBuzz() { if (!['read', 'win'].includes(this.ph) || this.outs.has(this.me)) return; this.set({ canBuzz: false }); this.o.host ? this.hostBuzz(this.me) : this.o.room!.emit('buzz') }
  hostBuzz(p: string) { if (this.lockedBy || this.outs.has(p) || !['read', 'win'].includes(this.ph)) return; const d = { p, intr: this.ph === 'read', i: this.i }; this.o.room!.emit('lock', d); this.onLock(d) }
  onLock(d: any) {
    this.rd++; clearInterval(this.tm); this.ph = 'ans'; this.lk = d; this.lockedBy = d.p; this.done1 = false; this.set({ phase: 'ans', canBuzz: false })
    if (d.p === this.me) { this.set({ status: 'Answer! 5 seconds' }); this.ask(this.q.choices, 5, k => this.o.host ? this.hostAns(this.me, k) : this.o.room!.emit('ans', { k })) }
    else { this.set({ status: this.nm(d.p) + ' buzzed…' }); if (this.o.host) this.at = setTimeout(() => this.hostAns(d.p, null), 6500) }
  }
  hostAns(p: string, k: string | null) {
    if (this.lockedBy !== p || this.done1) return; clearTimeout(this.at); this.done1 = true
    const q = this.q, lk = this.lk, ok = k === q.ans, neg = lk.intr && k !== null
    const pts = ok ? 4 : neg ? -4 : 0
    this.mpSc[p] = (this.mpSc[p] || 0) + pts; const d = { p, ok, k, neg, pts, sc: this.mpSc }; this.o.room!.emit('res', d); this.onRes(d)
    setTimeout(() => {
      if (ok) { if (!q.bn) return this.hostEnd('Correct! Answer: ' + q.ans + '.'); const b = { p }; this.o.room!.emit('bonus', b); this.onBonus(b) }
      else { this.outs.add(p); if (this.outs.size >= this.o.room!.peers().length) this.hostEnd('Everyone is locked out. Answer: ' + q.ans + '.'); else { const u = { outs: [...this.outs] }; this.o.room!.emit('unlock', u); this.onUnlock(u) } }
    }, 1500)
  }
  onRes(d: any) {
    this.mpSc = d.sc; this.scoreboard(); const q = this.q
    this.set({ correct: q.ans, pick: d.k, msg: `${this.nm(d.p)}: ${d.ok ? 'correct +' + d.pts : d.neg ? 'neg −4' : 'no answer'}` })
    if (d.p === this.me) { const lk = this.lk, sp = lk.intr ? .5 + .5 * (1 - lk.i / this.N) : .2
      this.o.mutate(P => { P.st.tu++; if (d.ok) P.st.ok++; if (d.neg) P.st.neg++; topic(P, q.sub, q.topic, d.ok); if (isRated(q)) { const k = .6 / (1 + (P.n[q.sub] || 0) / 18); if (d.ok) upd(P, q.sub, q.d, Math.max(expected(P.r[q.sub] ?? 5, q.d), .65 + .35 * sp), k); else upd(P, q.sub, q.d, d.neg ? -.12 : .05, k); P.confidence ||= {}; P.confidence[q.sub] = Math.min(.98, .5 + (1 - Math.exp(-(P.n[q.sub] || 0) / 18)) * .48) } }) }
  }
  onUnlock(d: any) {
    this.outs = new Set(d.outs); this.lockedBy = ''; this.ph = 'win'; this.cb = null
    this.set({ phase: 'win', choices: null, correct: null, msg: '', canBuzz: !this.outs.has(this.me), status: 'Rebound: 5 seconds to buzz…' })
    this.timer(5, null, () => { if (this.o.host && this.ph === 'win') this.hostEnd('No buzz. Answer: ' + this.q.ans + '.') })
  }
  hostEnd(msg: string) { this.o.room!.emit('end', { msg }); this.fin(msg) }
  onBonus(d: { p: string }) { const mine = d.p === this.me; this.bonus(d.p, ok => this.o.host ? this.hostBres(this.me, ok) : this.o.room!.emit('bres', { ok }), mine, `${this.nm(d.p)} is answering the bonus…`) }
  hostBres(p: string, ok: boolean) { if (ok) this.mpSc[p] = (this.mpSc[p] || 0) + 10; const d = { p, ok, sc: this.mpSc }; this.o.room!.emit('bres', d); this.onBres(d) }
  onBres(d: any) { this.mpSc = d.sc; this.scoreboard(); this.fin(`${this.nm(d.p)}: bonus ${d.ok ? 'correct +10' : 'missed'}. Answer: ${this.q.ba}.`, true) }
}
