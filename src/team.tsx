import { sourceGroup } from './engine'
import { useEffect, useRef, useState } from 'react'
import { bonusChoices, readText, readTimes, showWords } from './read'
import { TypedBox } from './typed'
import { Tex } from './tex'
import { Match } from './match'
import { meme } from './memes'
import { coach, getCode, setCode, store } from './platform'
import { gen, qMeta } from './engine'
import { cleanRules, DEFAULT_RULES, MODES, picksPackets, rulesText, selectFromBank, ysOf, type Rules } from './rules'
import type { Question } from './types'
import { askText } from './dialog'
import { invite, social, useUser, type Friend } from './account'
import { ALL_SUBJECTS, subName, type Profile } from './types'

const BASE = ((import.meta.env.VITE_AI_PROXY_URL as string) || '').replace(/^http/, 'ws').replace(/\/$/, '')
const ab: Record<string, string> = { math: 'math', physics: 'physics', biology: 'bio', chemistry: 'chem', 'earth-space': 'earth', energy: 'energy' }
const label = (s: string) => s.replace('-C', '-Captain')
const mm = (ms: number) => { const s = Math.ceil(Math.max(0, ms) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }

export default function TeamGame({ P, user, auto, getP, mutate, exit }: { P: Profile; user: string; auto?: string; getP: () => Profile; mutate: (f: (P: Profile) => void) => void; exit: () => void }) {
  const [rc, setRc] = useState(''), [go, setGo] = useState<{ code: string; name: string } | null>(null)
  const join = async (c: string) => {
    if (!getCode()) { const a = await askText('Access password', 'Enter the site password.', 'password'); if (!a) return; setCode(a) }
    let n = user || P.name; if (!n) n = (await askText('Your name', 'Shown to other players.')) || ''; if (!n) return
    setGo({ code: c.toUpperCase(), name: n })
  }
  useEffect(() => { if (auto) join(auto) }, [])
  if (go) return <Room {...go} getP={getP} mutate={mutate} exit={() => setGo(null)} />
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>Team game</h1>
    {!BASE ? <div className="card">Online team games need the Cloudflare server. Set the <code>AI_PROXY_URL</code> repository variable and redeploy.</div> :
      <div className="card"><div className="mu">Create a room and share the code, or enter one. Everyone can be on a different device. Up to 5 per team; the host sets team sizes and half length.</div>
        <div className="row" style={{ marginTop: 10 }}><button className="p" onClick={() => join(Math.random().toString(36).slice(2, 6))}>Create room</button><input placeholder="Room code" maxLength={8} value={rc} onChange={e => setRc(e.target.value)} /><button onClick={() => rc && join(rc)}>Join</button></div></div>}</>
}

function Room({ code, name, getP, mutate, exit }: { code: string; name: string; getP: () => Profile; mutate: (f: (P: Profile) => void) => void; exit: () => void }) {
  const ws = useRef<WebSocket>(), [me, setMe] = useState(''), [S, setS] = useState<any>(null), [pv, setPv] = useState<any>(null), [rv, setRv] = useState<any>(null)
  const [ex, setEx] = useState(''), [ping, setPing] = useState(0), [err, setErr] = useState(''), [chat, setChat] = useState<any[]>([]), [text, setText] = useState(''), [, tk] = useState(0), [panel, setPanel] = useState<string | null>(null)
  const [tab, setTab] = useState<'main' | 'team'>('main'), user = useUser(), [un, setUn] = useState({ main: 0, team: 0, mm: 0, tm: 0 })
  const recv = useRef(performance.now()), R = useRef<any>({}), src = useRef<Match>()
  R.current = { S, me, tab }
  const send = (m: any) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m)) }
  const used = useRef(new Set<string>()), cnt = useRef(0), aiq = useRef<Record<string, Question[]>>({})
  /** Host's browser picks the next question from the rules both captains agreed on. */
  const pickQ = async (R: Rules, rep?: any): Promise<Question | undefined> => {
    const ok = store.allowed().map(x => x[0]), want = R.subs.filter(s => ok.includes(s)), subs = rep ? [rep.sub] : want.length ? want : store.subjects(), sub0 = subs[cnt.current++ % subs.length]
    const order = [sub0, ...subs.filter(s => s !== sub0)], useBank = R.mode === 'bank' || picksPackets(R) || !!rep || Math.random() < .5
    const hit = useBank && !(R.mode === 'ai' && !rep) ? selectFromBank(R, store.bank(), order, used.current, qMeta, rep) : undefined
    if (hit) return hit
    // nothing in the bank fits (or AI-only): have the AI write one at the requested difficulty (flagged 🤖)
    const sub = sub0, full = R.dMin <= 1 && R.dMax >= 10, mid = Math.round((R.dMin + R.dMax) / 2)
    const diffs = rep ? [Math.round(rep.d)] : full ? (src.current ||= new Match({ kind: 'prac', getP, mutate })).diffs(sub) : [R.dMin, mid, mid, R.dMax], key = sub + R.dMin + R.dMax
    if (rep) return (await gen(sub, diffs))[0]
    const Q = (aiq.current[key] ||= []); if (!Q.length) Q.push(...await gen(sub, diffs)); else if (Q.length < 2) gen(sub, diffs).then(a => Q.push(...a)).catch(() => {})
    return Q.shift()
  }
  const hostNeed = async (rules?: any, rep?: any) => {
    setErr(''); let q: any = null
    try { q = await pickQ(cleanRules(rules || R.current.S?.rules), rep) } catch { /* handled below */ }
    if (q) { used.current.add(q.tu); send({ t: rep ? 'rq' : 'q', q }) } else setErr('Couldn’t get a question (check your connection / Groq setup).')
  }
  const mine = (txt: string) => { const { S: s, me: id } = R.current, seat = s?.players.find((p: any) => p.id === id)?.seat, tags = [name.toLowerCase(), name.split(' ')[0].toLowerCase(), seat ? label(seat).toLowerCase() : ''].filter(Boolean)
    return [...txt.toLowerCase().matchAll(/@([\w-]+)/g)].some(x => tags.includes(x[1])) }
  useEffect(() => {
    const w = new WebSocket(`${BASE}/room/${code}?c=${encodeURIComponent(getCode() || '')}&n=${encodeURIComponent(name)}`); ws.current = w
    w.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.t === 'hello') setMe(m.id)
      else if (m.t === 'state') { recv.current = performance.now(); setS(m) }
      else if (m.t === 'read') { setPv(m); setRv(null); setEx('') }
      else if (m.t === 'reveal') { setRv(m); const { S: s, me: id } = R.current
        if (s?.host === id) coach(`Explain to a high-school Science Bowl student how to solve this ${m.q.sub} question step by step, with a speed tip. Write formulas as $...$ LaTeX and everything else as plain text, under 150 words.\nQuestion: ${m.q.tu}\nChoices: ${JSON.stringify(m.q.choices)}\nCorrect: ${m.q.ans}\nReference: ${m.q.ex || ''}`).then(t => send({ t: 'ex', text: t })).catch(() => {}) }
      else if (m.t === 'res') { if (m.neg) meme('neg', m.name); else if (m.ok && m.early < 1) meme(m.early < .3 ? 'fast' : 'interrupt', m.name) }
      else if (m.t === 'ex') setEx(m.text)
      else if (m.t === 'err') setErr(m.text)
      else if (m.t === 'need') hostNeed(m.rules, m.replace)
      else if (m.t === 'pong') setPing(Math.round(performance.now() - m.c))
      else if (m.t === 'chat') { setChat(c => [...c.slice(-200), m]); if (R.current.tab !== m.scope) setUn(u => ({ ...u, [m.scope]: u[m.scope as 'main'] + 1, ...(mine(m.text) ? { [m.scope === 'main' ? 'mm' : 'tm']: u[m.scope === 'main' ? 'mm' : 'tm'] + 1 } : {}) })) }
    }
    w.onclose = () => setErr('Couldn’t connect or the connection dropped. Check the password and that this site is allowed in wrangler.toml.')
    const a = setInterval(() => send({ t: 'ping', c: performance.now() }), 3000), b = setInterval(() => tk(x => x + 1), 100)
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); send({ t: 'buzz' }) } }
    addEventListener('keydown', kd); return () => { clearInterval(a); clearInterval(b); removeEventListener('keydown', kd); w.close() }
  }, [])
  if (!S) return <><div className="row"><button onClick={exit}>← Leave</button></div><div className="card mu">{err || 'Connecting…'}</div></>
  const pl: any[] = S.players, my = pl.find(p => p.id === me), seat: string | null = my?.seat || null, mt = seat?.[0], isCap = !!seat?.endsWith('-C'), isHost = S.host === me
  const running = ['read', 'win', 'ans', 'bgap', 'bonus'].includes(S.st) && !S.paused
  const el = S.el + (running ? performance.now() - recv.current : 0), clock = S.clock - (S.run ? performance.now() - recv.current : 0)
  const rx = readText(pv?.q.tu || '', pv?.q.choices || null), words = rx.words, times = readTimes(rx.text, S.cfg.wpm)
  const n = S.st === 'ans' && S.intr ? S.bi : S.st === 'read' || S.st === 'bonus' ? times.filter(x => x <= el).length : words.length
  const shown = ['read', 'win', 'ans', 'bgap', 'bonus', 'gap'].includes(S.st) ? showWords(words, n, rx.starts) : ''
  const canBuzz = !!seat && ['read', 'win'].includes(S.st) && !S.locked.includes(mt) && !S.paused
  const cfg = (k: string, v: number) => send({ t: 'cfg', cfg: { ...S.cfg, [k]: v } })
  const dot = ping < 100 ? '#2fb344' : ping < 250 ? '#e0a800' : '#d64545'
  const seatsOf = (T: string) => Array.from({ length: T === 'A' ? S.cfg.sizeA : S.cfg.sizeB }, (_, i) => T + '-' + (i || 'C'))
  const ans = (k: string) => send({ t: S.st === 'bonus' ? 'bans' : 'ans', k })
  const amAns = S.st === 'ans' && S.buzzer === me, capBonus = S.st === 'bonus' && isCap && mt === S.won, readDone = el >= (S.rd || 0)
  const elig = (S.items || []).filter((it: any) => !it.ch && ((it.team === mt && !it.ok) || (it.team !== mt && it.ok)))
  const doChallenge = async (it: any) => { const reason = await askText('Challenge', 'Briefly say why this ruling is wrong (optional).'); if (reason !== null) { send({ t: 'challenge', id: it.id, reason }); setPanel(null) } }
  const chPanel = <div style={{ marginTop: 8 }}>{S.reviewing ? <span className="mu">⚖ The AI is reviewing a challenge…</span> : elig.length ? elig.map((it: any) => <button key={it.id} className="seatbtn" style={{ borderColor: it.team === 'A' ? 'var(--ta)' : 'var(--tb)', color: it.team === 'A' ? 'var(--ta)' : 'var(--tb)' }} onClick={() => doChallenge(it)}>{ab[it.sub] || it.sub} {it.kind === 'tu' ? 't/u' : 'bonus'} · {it.team === mt ? 'your team’s' : `Team ${it.team}’s`} answer ({it.ok ? 'marked correct' : 'marked incorrect'})</button>) : <span className="mu">Nothing to challenge. You can challenge your team’s incorrect answers or the other team’s correct ones.</span>}</div>
  const rpPanel = <div style={{ marginTop: 8 }}><div className="row"><button onClick={() => send({ t: 'replace', kind: 'tu' })}>Replace toss-up</button><button disabled={!S.won} onClick={() => send({ t: 'replace', kind: 'bonus' })}>Replace bonus</button></div><div className="mu" style={{ marginTop: 6 }}>Both captains must pick the same one. Team A: {S.rq.A || '—'} · Team B: {S.rq.B || '—'}{S.repl ? ' · finding a question…' : ''}</div></div>
  const msgs = chat.filter(c => c.scope === tab), pick = (t: 'main' | 'team') => { setTab(t); setUn(u => ({ ...u, [t]: 0, [t === 'main' ? 'mm' : 'tm']: 0 })) }
  const bub = (a: number, r: number) => <>{a > 0 && <span className="bub y">{a}</span>}{r > 0 && <span className="bub r">{r}</span>}</>
  return <>
    <div className="row"><button onClick={exit}>← Leave</button><div className="mu" style={{ textAlign: 'right' }}>Room <b>{code.toUpperCase()}</b> · <span style={{ color: dot }}>●</span> {ping || '…'} ms</div></div>
    {err && <div className="card no">{err} {isHost && S.st === 'load' && <button onClick={() => hostNeed()}>Retry question</button>}</div>}
    <div className="two"><div>
      <div className="card"><div className="row" style={{ textAlign: 'center' }}><div style={{ color: 'var(--ta)' }}><div className="big">{S.score.A}</div>Team A</div><div><div className="big">{S.phase === 'lobby' ? 'Lobby' : S.phase === 'over' ? 'Final' : mm(S.phase === 'break' ? S.rem : clock)}</div><div className="mu">{S.phase === 'play' ? `Half ${S.half}` : S.phase === 'break' ? 'Break' : ''}{S.paused ? ' · PAUSED' : ''}</div></div><div style={{ color: 'var(--tb)' }}><div className="big">{S.score.B}</div>Team B</div></div></div>
      {S.phase !== 'lobby' && S.ps && <div className="card" style={{ overflowX: 'auto', padding: 8 }}><table className="sbt"><thead><tr><th>Player</th><th>TU</th><th>Neg</th><th>Pts</th></tr></thead><tbody>
        {(['A', 'B'] as const).map(T => [<tr key={T} style={{ color: T === 'A' ? 'var(--ta)' : 'var(--tb)' }}><td>Team {T}</td><td colSpan={2}>bonus pts {S.bp?.[T] || 0}</td><td className="tot">{S.score[T]}</td></tr>,
          ...pl.filter((p: any) => p.seat?.[0] === T).map((p: any) => <tr key={p.id}><td>{label(p.seat)} {p.name}</td><td>{S.ps[p.id]?.tu || 0}</td><td>{S.ps[p.id]?.neg || 0}</td><td>{S.ps[p.id]?.pts || 0}</td></tr>)])}</tbody></table></div>}
      {S.phase === 'lobby' && <div className="card"><b>Game setup</b>{isHost ? <><div className="row" style={{ margin: '8px 0' }}>
        {([['sizeA', 'Team A size', [1, 2, 3, 4, 5]], ['sizeB', 'Team B size', [1, 2, 3, 4, 5]], ['halfMin', 'Half (min)', [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20]], ['wpm', 'Words/min', [100, 130, 160, 190, 220, 260]]] as [string, string, number[]][]).map(([k, l, o]) => <label key={k} className="mu">{l}<select style={{ width: '100%' }} value={S.cfg[k]} onChange={e => cfg(k, +e.target.value)}>{o.map(v => <option key={v}>{v}</option>)}</select></label>)}</div>
        <button className="p" onClick={() => send({ t: 'start' })}>Start game</button><div className="mu" style={{ marginTop: 6 }}>Both captains must be seated first.</div></> : <div className="mu">{S.cfg.sizeA}v{S.cfg.sizeB} · two {S.cfg.halfMin}-minute halves · {S.cfg.wpm} wpm. Waiting for the host to start…</div>}</div>}
      {user && S.phase === 'lobby' && <Invite code={code} />}
      {(S.phase === 'lobby' || S.phase === 'break' || S.paused) && <RulesCard S={S} isCap={isCap} mt={mt} send={send} />}
      {S.phase !== 'lobby' && <div className="card"><div className="mu">{pv ? `${subName(pv.q.sub)} · ${pv.q.topic}${pv.q.ai ? ' · 🤖 AI-generated' : ''} · ${pv.kind === 'bonus' ? 'bonus 10 pts' : 'toss-up 4 pts'}` : ''}</div>
        <div className="q"><Tex s={shown} /></div><div className="mu">{S.note || (S.st === 'ans' ? `${pl.find(p => p.id === S.buzzer)?.name || ''} is answering… ${Math.ceil(S.rem / 1000)}s` : S.st === 'win' ? `Buzz now! ${Math.ceil(S.rem / 1000)}s` : S.st === 'bgap' ? `Bonus for Team ${S.won} in ${Math.ceil(S.rem / 1000)}s` : S.st === 'gap' ? `Next question in ${Math.ceil(S.rem / 1000)}s` : S.st === 'bonus' && !(isCap && mt === S.won) ? `Team ${S.won} captain is answering the bonus` : '')}</div></div>}
      {canBuzz && <button className="p buzz" onClick={() => send({ t: 'buzz' })}>BUZZ (space)</button>}
      {amAns && !S.typed && pv?.q.choices && <div className="ch">{Object.entries(pv.q.choices).map(([k, v]) => <button key={k} onClick={() => send({ t: 'ans', k })}>{k}) <Tex s={v as string} /></button>)}</div>}
      {amAns && S.typed && !S.judging && <TypedBox key={S.qn + 'a' + S.buzzer} label={pv?.q.choices ? 'You buzzed before the choices were fully read. Type your answer (or the letter).' : 'Type your answer.'} auto={7.8} onSubmit={t => send({ t: 'ans', txt: t })} />}
      {capBonus && !S.bsa && readDone && <div className="ch">{Object.entries(pv.q.choices || {}).map(([k, v]) => <button key={k} onClick={() => send({ t: 'bans', k })}>{k}) <Tex s={v as string} /></button>)}</div>}
      {capBonus && S.bsa && readDone && !S.bt && <button className="p buzz" onClick={() => send({ t: 'bsub' })}>Submit answer ({Math.ceil(S.rem / 1000)}s left to press)</button>}
      {capBonus && S.bsa && S.bt && !S.judging && <TypedBox key={S.qn + 'b'} label="Type your answer. You have 5 seconds!" auto={5} onSubmit={t => send({ t: 'btxt', txt: t })} />}
      {rv && S.st === 'gap' && <div className="card"><b>{rv.msg}</b> <Tex s={'Answer: ' + (rv.q.choices ? `${rv.q.ans}) ${rv.q.choices[rv.q.ans]}` : rv.q.ans)} />{rv.q.bn && S.won ? ` · Bonus answer: ${bonusChoices(rv.q) ? rv.q.ba + ') ' + bonusChoices(rv.q)![rv.q.ba] : rv.q.ba}` : ''}</div>}
      {S.reviewing && <div className="card">⚖ Challenge under review…</div>}
      {ex && <div className="card ex"><Tex s={ex} auto /></div>}
      {isCap && S.phase !== 'lobby' && S.phase !== 'over' && <div className="card"><b>Captain controls</b><div className="row" style={{ marginTop: 8 }}>
        {S.st === 'bgap' && mt === S.won && <button className="p" onClick={() => send({ t: 'proceed' })}>Go to bonus now</button>}
        {S.st === 'gap' && <button className="p" onClick={() => send({ t: 'proceed' })}>Next question now ({S.req.proceed.length}/2 captains ready)</button>}
        {S.phase === 'break' && <button className="p" onClick={() => send({ t: 'brk' })}>End break</button>}
        {S.phase === 'play' && !S.paused && <button onClick={() => send({ t: 'pause' })}>Pause ({S.req.pause.length}/2 agree)</button>}
        {S.paused && <button className="p" onClick={() => send({ t: 'resume' })}>Resume ({S.req.resume.length}/2 agree)</button>}
        {S.st === 'gap' && <><button onClick={() => setPanel(panel === 'ch' ? null : 'ch')}>Challenge ({S.chFail[mt]}/2 failed)</button><button onClick={() => setPanel(panel === 'rp' ? null : 'rp')}>Replace</button></>}</div>
        {S.st === 'gap' && panel === 'ch' && chPanel}{S.st === 'gap' && panel === 'rp' && rpPanel}</div>}
    </div><div>
      <div className="row" style={{ alignItems: 'stretch' }}>{(['A', 'B'] as const).map(T => <div key={T} className={`card tcol tm-${T.toLowerCase()}`} style={{ margin: 0 }}><b style={{ color: 'var(--tc)' }}>Team {T} {T === 'A' ? '(red)' : '(blue)'}</b>
        {seatsOf(T).map(id => { const o = pl.find(p => p.seat === id); return <button key={id} className="seatbtn" disabled={!!o && o.id !== me} onClick={() => send({ t: o?.id === me ? 'up' : 'seat', seat: id })}>{label(id)}: {o ? (o.id === me ? 'You · get up' : o.name) : 'Open'}</button> })}</div>)}</div>
      {pl.filter(p => !p.seat).length > 0 && <div className="mu" style={{ margin: '6px 0' }}>Watching: {pl.filter(p => !p.seat).map(p => p.name).join(', ')}</div>}
      <div className="card"><div className="row"><button className={tab === 'main' ? 'p' : ''} onClick={() => pick('main')}>Main chat{bub(un.main, un.mm)}</button><button className={tab === 'team' ? 'p' : ''} disabled={!mt} onClick={() => pick('team')}>Team chat{bub(un.team, un.tm)}</button></div>
        <div className="chat">{msgs.map((c, i) => <div key={i} className={c.sys ? 'mu' : ''} style={c.team ? { color: 'inherit' } : {}}>{c.sys ? c.text : <><b style={{ color: c.team === 'A' ? 'var(--ta)' : c.team === 'B' ? 'var(--tb)' : 'inherit' }}>{c.seat ? label(c.seat) + ' ' : ''}{c.from}:</b> {c.text}</>}</div>)}</div>
        <form className="row" onSubmit={e => { e.preventDefault(); if (text.trim()) { send({ t: 'chat', scope: tab, text }); setText('') } }}><input value={text} onChange={e => setText(e.target.value)} placeholder={tab === 'team' ? 'Message your team… (@A-1, @name)' : 'Message everyone… (@A-1, @name)'} style={{ flex: 3 }} /><button type="submit">Send</button></form></div>
    </div></div></>
}

function Multi({ label, opts, val, on }: { label: string; opts: [string, string][]; val: string[]; on: (v: string[]) => void }) {
  return <details className="dd"><summary>{label}: {val.length ? val.map(v => opts.find(o => o[0] === v)?.[1] || v).join(', ') : 'any'} ▾</summary>
    <div className="pop">{opts.length ? opts.map(([k, n]) => <label key={k}><input type="checkbox" checked={val.includes(k)} onChange={() => on(val.includes(k) ? val.filter(x => x !== k) : [...val, k])} /> {n}</label>) : <label className="mu">None available</label>}</div></details>
}
/** Captains agree on where questions come from: one proposes, the other accepts. Everyone can see the current rules. */
export function RulesCard({ S, isCap, mt, send }: { S: any; isCap: boolean; mt?: string; send: (m: any) => void }) {
  const [d, setD] = useState<Rules | null>(null), rules: Rules = S.rules || DEFAULT_RULES, prop = S.prop as { by: string; rules: Rules } | null
  const rows = store.bank().map(qMeta), opts = (a: string[], cur: string[]) => [...new Set([...a, ...cur].filter(Boolean))].sort().map(x => [x, x] as [string, string])
  const set = (p: Partial<Rules>) => setD({ ...d!, ...p }), lv = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  return <div className="card"><b>Question rules</b>
    <div className="mu" style={{ margin: '4px 0' }}>{rulesText(rules)}</div>
    {prop && <div className="card" style={{ borderColor: prop.by === 'A' ? 'var(--ta)' : 'var(--tb)' }}><div className="mu">Team {prop.by} captain proposes: {rulesText(prop.rules)}</div>
      {isCap && <div className="row" style={{ marginTop: 6 }}>{prop.by !== mt && <button className="p" onClick={() => send({ t: 'rules', do: 'accept' })}>Accept</button>}<button onClick={() => send({ t: 'rules', do: 'decline' })}>{prop.by === mt ? 'Withdraw' : 'Decline'}</button></div>}</div>}
    {isCap && !d && <button onClick={() => setD(rules)}>Propose different rules</button>}
    {!isCap && <div className="mu">Only the two captains can change these, and both have to agree.</div>}
    {isCap && d && <div><div className="row" style={{ margin: '6px 0' }}>
      <select value={d.mode} onChange={e => set({ mode: e.target.value as Rules['mode'] })}>{MODES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <Multi label="Subjects" opts={store.allowed()} val={d.subs} on={v => set({ subs: v })} /></div>
      <div className="row" style={{ margin: '6px 0' }}>
        <Multi label="Source" opts={opts(rows.map(m => sourceGroup(m.src)), d.srcs)} val={d.srcs} on={v => set({ srcs: v })} />
        <Multi label="Year/set" opts={opts(rows.map(ysOf), d.ys)} val={d.ys} on={v => set({ ys: v })} />
        <Multi label="Round" opts={opts(rows.map(m => m.rnd), d.rounds)} val={d.rounds} on={v => set({ rounds: v })} /></div>
      <div className="row" style={{ margin: '6px 0' }}><label className="mu">Easiest<select style={{ width: '100%' }} value={d.dMin} onChange={e => set({ dMin: +e.target.value })}>{lv.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="mu">Hardest<select style={{ width: '100%' }} value={d.dMax} onChange={e => set({ dMax: +e.target.value })}>{lv.map(x => <option key={x}>{x}</option>)}</select></label></div>
      <div className="row"><button className="p" onClick={() => { send({ t: 'rules', rules: d }); setD(null) }}>Send proposal</button><button onClick={() => setD(null)}>Close</button></div>
      <div className="mu" style={{ marginTop: 6 }}>Choices come from your question bank; the host’s browser picks the questions. If no uploaded question fits, an AI-written one (🤖) is used instead.</div></div>}
  </div>
}

/** Lets a signed-in player invite friends; they see it on their home screen (invites expire after 10 minutes). */
function Invite({ code }: { code: string }) {
  const [fr, setFr] = useState<Friend[] | null>(null), [sent, setSent] = useState<string[]>([]), [err, setErr] = useState('')
  const load = () => social().then(s => { setFr(s.friends); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const send = async (n: string) => { try { await invite(n, code); setSent(x => [...x, n]) } catch (e: any) { setErr(e.message) } }
  return <details className="card"><summary style={{ cursor: 'pointer' }}><b>Invite friends</b></summary>
    {err && <div className="no" style={{ border: 0, fontSize: 14 }}>{err}</div>}
    {!fr ? <div className="mu">Loading…</div> : !fr.length ? <div className="mu">You have no friends added yet. Add some from the Friends screen on the home page.</div> : fr.map(f => <div key={f.name} className="row" style={{ margin: '6px 0' }}><span style={{ flex: 3 }}><span style={{ color: f.online ? 'var(--ok)' : 'var(--mu)' }}>●</span> @{f.name} <span className="mu">{f.online ? 'online' : 'offline'}</span></span><button disabled={sent.includes(f.name)} onClick={() => send(f.name)}>{sent.includes(f.name) ? 'Invited' : 'Invite'}</button></div>)}
    <button style={{ marginTop: 6 }} onClick={load}>Refresh</button></details>
}
