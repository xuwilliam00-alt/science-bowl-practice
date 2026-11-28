import { useMemo, useState } from 'react'
import { botAcc, qMeta, sourceGroup, sourceMatches } from './engine'
import { planBot } from './botsim'
import { readText, readTimes } from './read'
import { store } from './platform'
import { subName, type Question, type QRec } from './types'
import { loadHist } from './hist'

const COL: Record<string, string> = { math: '#3b82f6', physics: '#f59e0b', biology: '#22c55e', chemistry: '#a855f7', 'earth-space': '#14b8a6', energy: '#ef4444' }
const col = (s: string) => COL[s] || '#888'
const rated = (q: Question) => !!q.dr || !!q.ai
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
const sd = (a: number[]) => { const m = mean(a); return m === null || a.length < 2 ? null : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) }
const f3 = (x: number | null) => x === null ? '–' : x.toFixed(3)
const BIN = .5, NB = 20

/** Horizontal bars: one per label. */
function Bars({ rows, fmt }: { rows: { label: string; v: number; color: string; note?: string }[]; fmt: (v: number) => string }) {
  const max = Math.max(...rows.map(r => r.v), 1e-9)
  return <div>{rows.map(r => <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0' }}>
    <span style={{ width: 110, flex: 'none' }}>{r.label}</span>
    <svg width="100%" height="18" style={{ flex: 1, minWidth: 80 }} role="img" aria-label={`${r.label} ${fmt(r.v)}`}><rect x="0" y="2" rx="3" height="14" width={Math.max(2, r.v / max * 100) + '%'} fill={r.color} /></svg>
    <span style={{ width: 150, flex: 'none', textAlign: 'right' }}>{fmt(r.v)}{r.note && <span className="mu"> {r.note}</span>}</span></div>)}</div>
}

/** Histogram of difficulty (0-10, half-point bins). `stack` = one colored segment per subject. */
function Hist({ qs, subs, stack }: { qs: Question[]; subs: string[]; stack: boolean }) {
  const W = 640, H = 190, L = 34, B = 22, T = 8, bw = (W - L - 6) / NB
  const bins = Array.from({ length: NB }, () => Object.fromEntries(subs.map(s => [s, 0])) as Record<string, number>)
  qs.forEach(q => { const i = Math.min(NB - 1, Math.floor(q.d / BIN)); if (bins[i][q.sub] !== undefined) bins[i][q.sub]++ })
  const tot = bins.map(b => Object.values(b).reduce((a, c) => a + c, 0)), mx = Math.max(...tot, 1), y = (n: number) => T + (H - T - B) * (1 - n / mx)
  return <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 420 }} role="img" aria-label="difficulty histogram">
    {[0, .5, 1].map(t => <g key={t}><line x1={L} x2={W - 4} y1={y(mx * t)} y2={y(mx * t)} stroke="var(--bd)" /><text x={L - 4} y={y(mx * t) + 4} textAnchor="end" fontSize="11" fill="currentColor">{Math.round(mx * t)}</text></g>)}
    {bins.map((b, i) => { let acc = 0; return <g key={i}>{(stack ? subs : ['all']).map(s => { const n = stack ? b[s] : tot[i]; if (!n) return null; const y0 = y(acc + n), h = y(acc) - y0; acc += n
      return <rect key={s} x={L + i * bw + 1} y={y0} width={bw - 2} height={h} fill={stack ? col(s) : 'var(--ac)'}><title>{`${(i * BIN).toFixed(1)}–${((i + 1) * BIN).toFixed(1)}: ${n}${stack ? ' ' + subName(s) : ''}`}</title></rect> })}</g> })}
    {[0, 2, 4, 6, 8, 10].map(t => <text key={t} x={L + t / BIN * bw} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor">{t}</text>)}</svg></div>
}

/** Least squares y = a + b·x; null when there are fewer than 3 points or x never varies. */
function ols(p: { x: number; y: number }[]) {
  if (p.length < 3) return null
  const mx = mean(p.map(t => t.x)) as number, my = mean(p.map(t => t.y)) as number, sxx = p.reduce((a, t) => a + (t.x - mx) ** 2, 0), sxy = p.reduce((a, t) => a + (t.x - mx) * (t.y - my), 0), syy = p.reduce((a, t) => a + (t.y - my) ** 2, 0)
  if (sxx < 1e-9) return null
  const b = sxy / sxx
  return { a: my - b * mx, b, r2: syy > 1e-9 ? sxy * sxy / (sxx * syy) : 0 }
}

/** Your own toss-up buzzes: X = question difficulty, Y = seconds after the earliest realistic buzz point. Solid line = fitted to your data; dashed line = what a practice bot of any rating you type in would do. */
function LagScatter({ user, subs, mine, wpm }: { user: string; subs: string[]; mine: Record<string, number>; wpm: number }) {
  const [sub, setSub] = useState('all'), [show, setShow] = useState(false), [rt, setRt] = useState('5.000')
  const all = loadHist(user).flatMap(g => g.qs) as QRec[]
  const pts = all.filter(q => q.lag !== undefined && q.rated && q.d !== null && Number.isFinite(q.d) && (sub === 'all' || q.sub === sub))
  const mineNow = sub === 'all' ? null : mine[sub]
  const r = Math.max(0, Math.min(10, Number.isFinite(+rt) ? +rt : 5))
  const own = ols(pts.map(q => ({ x: q.d as number, y: q.lag as number })))
  const W = 640, H = 280, L = 44, Rm = 12, T = 12, B = 34, ys = pts.map(q => q.lag as number)
  const ymin = Math.floor(Math.min(-2, ...ys)), ymax = Math.ceil(Math.max(2, ...ys))
  const X = (x: number) => L + x / 10 * (W - L - Rm), Y = (y: number) => T + (ymax - y) / (ymax - ymin) * (H - T - B)
  const clipY = (y: number) => Math.max(ymin, Math.min(ymax, y))
  const seg = (a: number, b: number, color: string, dash?: string) => { const f = (x: number) => a + b * x; let x0 = 0, x1 = 10
    if (Math.abs(b) > 1e-9) { const xa = (ymin - a) / b, xb = (ymax - a) / b, lo = Math.min(xa, xb), hi = Math.max(xa, xb); x0 = Math.max(0, lo); x1 = Math.min(10, hi) } else if (f(0) < ymin || f(0) > ymax) return null
    if (x0 >= x1) return null
    return <line x1={X(x0)} y1={Y(clipY(f(x0)))} x2={X(x1)} y2={Y(clipY(f(x1)))} stroke={color} strokeWidth="2.5" strokeDasharray={dash} /> }
  const yt: number[] = []; const step = Math.max(1, Math.ceil((ymax - ymin) / 8)); for (let v = ymin; v <= ymax; v += step) yt.push(v)
  const bank = useMemo(() => new Map(store.bank().map(q => [q.tu, q])), [])
  const pool = useMemo(() => { const seen = new Set<string>(), out: { q: Question; text: string; words: string[]; nq: number; times: number[] }[] = []
    for (const rec of all) { if (seen.has(rec.tu) || out.length >= 120) continue; seen.add(rec.tu); const q = bank.get(rec.tu) || ({ tu: rec.tu, choices: rec.choices || undefined } as Question), rt = readText(q.tu, q.choices); out.push({ q, text: rt.text, words: rt.words, nq: rt.nq, times: readTimes(rt.text, wpm) }) }
    return out }, [all.length, wpm]) // eslint-disable-line react-hooks/exhaustive-deps
  /** What the practice bot would do: for each difficulty, run its real buzzing plan (planBot) many times over the questions you've seen and average the seconds after the earliest realistic point at which it buzzes. */
  const bot = useMemo(() => { if (!show || !pool.length) return null
    const out: { x: number; y: number }[] = [], reps = Math.max(4, Math.ceil(2400 / pool.length))
    for (let d = 0; d <= 10.001; d += .5) { let sum = 0, n = 0
      for (const p of pool) for (let k = 0; k < reps; k++) { const pq = { ...p.q, d, dr: true, ai: false } as Question, plan = planBot(pq, r, botAcc(r, d), p.words, p.nq), t = (a: number) => (p.times[a - 1] ?? p.times[p.times.length - 1] ?? 0) / 1000
        if (plan.mode === 'none') continue
        const buzzT = plan.at === Infinity ? t(p.words.length) + plan.winT : t(plan.at); sum += buzzT - t(plan.earliest); n++ }
      if (n) out.push({ x: d, y: sum / n }) }
    return out.length > 1 ? out : null }, [show, pool, r])
  return <div className="card"><b>Buzz time vs question difficulty</b>
    <div className="mu" style={{ margin: '2px 0 8px' }}>Each dot is one of your toss-up buzzes in a rated question. Up = you buzzed later after the earliest realistic buzz point (negative = you buzzed before it). Difficulty is on the 0–10 scale.</div>
    <div className="row" style={{ justifyContent: 'flex-start', gap: 12, marginBottom: 8 }}>
      <label className="mu">Subject <select value={sub} onChange={e => { setSub(e.target.value); const m = e.target.value === 'all' ? undefined : mine[e.target.value]; if (m !== undefined) setRt(m.toFixed(3)) }}><option value="all">All subjects</option>{subs.map(s => <option key={s} value={s}>{subName(s)}</option>)}</select></label>
      <label className="mu"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Also show a bot rated <input type="number" min="0" max="10" step="0.001" style={{ width: 90 }} value={rt} onChange={e => setRt(e.target.value)} disabled={!show} />{mineNow !== null && mineNow !== undefined && <button style={{ marginLeft: 6, padding: '2px 8px', fontSize: 13 }} disabled={!show} onClick={() => setRt(mineNow.toFixed(3))}>use mine ({mineNow.toFixed(3)})</button>}</label></div>
    {pts.length < 2 ? <div className="mu">Play a few rated toss-ups first: this needs at least 2 buzzes on rated questions with a recorded earliest buzz point{sub !== 'all' ? ` in ${subName(sub)}` : ''}.</div> : <>
      <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 420 }} role="img" aria-label="Buzz time after the earliest realistic buzz point versus question difficulty">
        {yt.map(v => <g key={v}><line x1={L} x2={W - Rm} y1={Y(v)} y2={Y(v)} stroke="var(--bd)" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor">{v}</text></g>)}
        {ymin < 0 && ymax > 0 && <line x1={L} x2={W - Rm} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeDasharray="4 4" />}
        {[0, 2, 4, 6, 8, 10].map(t => <text key={t} x={X(t)} y={H - 16} textAnchor="middle" fontSize="11" fill="currentColor">{t}</text>)}
        <text x={(L + W - Rm) / 2} y={H - 2} textAnchor="middle" fontSize="11" fill="currentColor">question difficulty</text>
        <text transform={`translate(11 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="currentColor">seconds after earliest buzz point</text>
        {pts.map((q, i) => <circle key={i} cx={X(q.d as number)} cy={Y(clipY(q.lag as number))} r="3.5" fill={col(q.sub)} fillOpacity=".75"><title>{`${subName(q.sub)} · difficulty ${(q.d as number).toFixed(3)} · ${(q.lag as number) >= 0 ? '+' : '−'}${Math.abs(q.lag as number).toFixed(2)} s`}</title></circle>)}
        {own && seg(own.a, own.b, 'currentColor')}
        {show && bot && <polyline fill="none" stroke="var(--ac)" strokeWidth="2.5" strokeDasharray="7 4" points={bot.map(p => `${X(p.x)},${Y(clipY(p.y))}`).join(' ')} />}</svg></div>
      <div className="mu" style={{ marginTop: 4 }}>{pts.length.toLocaleString()} buzzes. {own ? <>Solid line (your data): buzz time = {own.a.toFixed(2)} {own.b >= 0 ? '+' : '−'} {Math.abs(own.b).toFixed(2)} × difficulty, R² {own.r2.toFixed(2)}.</> : 'Need at least 3 buzzes at different difficulties for your regression line.'}</div>
      {show && <div className="mu" style={{ marginTop: 2 }}>{bot ? <>Dashed line: a practice bot rated {r.toFixed(3)}. It is the average time after the earliest realistic buzz point at which that bot buzzes (it stays quiet on questions it doesn’t know), found by running the bot’s real buzzing logic many times on the questions you have played, at your reading speed.</> : 'Play at least one toss-up first so there are questions to run the bot on.'}</div>}</>}</div>
}

/** Statistics about the question bank you have gathered: subject mix, difficulty spread, and mean difficulty, for all sources or one. */
export function Statistics({ exit, user, mine, wpm }: { exit: () => void; user: string; mine: Record<string, number>; wpm: number }) {
  const bank = store.bank(), [src, setSrc] = useState('')
  const rawSrc = (q: Question) => qMeta(q).src, srcOf = (q: Question) => sourceGroup(rawSrc(q)), srcs = [...new Set(bank.map(srcOf))].sort()
  const qs = bank.filter(q => !src || sourceMatches(rawSrc(q), src)), subs = store.allowed().map(x => x[0]).filter(s => qs.some(q => q.sub === s))
  const rq = qs.filter(rated), unrated = qs.length - rq.length
  const per = subs.map(s => { const d = rq.filter(q => q.sub === s).map(q => q.d); return { s, n: qs.filter(q => q.sub === s).length, nr: d.length, m: mean(d), sd: sd(d) } })
  const all = rq.map(q => q.d)
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>Statistics</h1>
    <div className="mu">About the questions you have gathered from packets (your game results are under History). Difficulty is on the 0–10 scale and only rated questions count in the difficulty graphs.</div>
    <div className="card"><label className="mu">Source<select style={{ width: '100%' }} value={src} onChange={e => setSrc(e.target.value)}><option value="">All sources ({bank.length.toLocaleString()} questions)</option>{srcs.map(s => <option key={s} value={s}>{s} ({bank.filter(q => sourceMatches(rawSrc(q), s)).length.toLocaleString()})</option>)}</select></label></div>
    {!qs.length ? <div className="card mu">No questions yet. Scan packets under Moderator tools, or add a published .json file to <code>public</code>.</div> : <>
      <div className="card"><b>Questions by subject</b><div className="mu" style={{ margin: '2px 0 6px' }}>{qs.length.toLocaleString()} questions{src ? ` from ${src}` : ''}</div>
        <Bars rows={per.map(p => ({ label: subName(p.s), v: p.n, color: col(p.s), note: `(${Math.round(p.n / qs.length * 100)}%)` }))} fmt={v => v.toLocaleString()} /></div>
      <div className="card"><b>Difficulty distribution</b><div className="mu" style={{ margin: '2px 0 6px' }}>{rq.length.toLocaleString()} rated questions · mean {f3(mean(all))}{unrated ? ` · ${unrated.toLocaleString()} unrated (not shown)` : ''}</div><Hist qs={rq} subs={subs} stack={false} /></div>
      <div className="card"><b>Difficulty distribution by subject</b><div className="mu" style={{ margin: '2px 0 6px' }}>Each bar is split by subject.</div><Hist qs={rq} subs={subs} stack /><div className="row" style={{ marginTop: 6, justifyContent: 'flex-start', gap: 14 }}>{subs.map(s => <span key={s} className="mu"><svg width="12" height="12" style={{ verticalAlign: -1 }}><rect width="12" height="12" rx="2" fill={col(s)} /></svg> {subName(s)}</span>)}</div>
        <div style={{ marginTop: 10 }}>{per.map(p => <div key={p.s} style={{ margin: '8px 0' }}><div className="mu">{subName(p.s)} · {p.nr.toLocaleString()} rated</div><Hist qs={rq.filter(q => q.sub === p.s)} subs={[p.s]} stack /></div>)}</div></div>
      <div className="card"><b>Mean difficulty by subject</b><div className="mu" style={{ margin: '2px 0 6px' }}>Higher = harder. “±” is the standard deviation.</div>
        <Bars rows={per.filter(p => p.m !== null).map(p => ({ label: subName(p.s), v: p.m as number, color: col(p.s), note: `± ${f3(p.sd)} (${p.nr.toLocaleString()})` }))} fmt={v => v.toFixed(3)} />
        {!per.some(p => p.m !== null) && <div className="mu">No rated questions here yet. A moderator can rate them under Moderator tools.</div>}</div>
      <LagScatter user={user} subs={store.allowed().map(x => x[0])} mine={mine} wpm={wpm} />
      {!src && srcs.length > 1 && <div className="card" style={{ overflowX: 'auto' }}><b>Mean difficulty by source and subject</b>
        <table className="sbt" style={{ marginTop: 6 }}><thead><tr><th>Source</th>{subs.map(s => <th key={s}>{subName(s)}</th>)}<th>All</th><th>Questions</th></tr></thead>
          <tbody>{srcs.map(sc => { const b = bank.filter(q => sourceMatches(rawSrc(q), sc)), r = b.filter(rated); return <tr key={sc}><td>{sc}</td>{subs.map(s => <td key={s}>{f3(mean(r.filter(q => q.sub === s).map(q => q.d)))}</td>)}<td className="tot">{f3(mean(r.map(q => q.d)))}</td><td>{b.length.toLocaleString()}</td></tr> })}</tbody></table>
        <div className="mu" style={{ marginTop: 6 }}>Pick a source above to see all the graphs for just that source.</div></div>}</>}</>
}
