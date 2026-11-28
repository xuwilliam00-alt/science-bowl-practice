import { useState } from 'react'
import { clearHist, loadHist } from './hist'
import { Tex } from './tex'
import { Marked } from './marked'
import { readText } from './read'
import { confirmBox, toast } from './dialog'
import { levelName } from './engine'
import { subName, type GameRec, type QRec } from './types'

const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const pc = (x: number) => Math.round(x * 100) + '%'
const SUBJECTS = ['all','math','physics','chemistry','biology','earth-space','energy']
const sgn = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3)
const buzzed = (qs: QRec[]) => qs.filter(q => !q.noBuzz && !q.botWon && !q.idk)
function stats(qs: QRec[]) {
  const b = buzzed(qs), n = qs.length, ok = qs.filter(q => q.ok).length
  return { n, ok, neg: qs.filter(q => q.neg).length, idk: qs.filter(q => q.idk).length, none: qs.filter(q => q.noBuzz && !q.idk).length, bot: qs.filter(q => q.botWon).length, bonusN:qs.filter(q=>q.bonus).length, bonusOk:qs.filter(q=>q.bonus?.ok).length,
    avg: b.length ? b.reduce((a, q) => a + q.frac, 0) / b.length : null, fast: b.length ? Math.min(...b.map(q => q.at)) : null, early: b.filter(q => q.frac < .5 && q.frac < 1).length,
    net: qs.reduce((a, q) => a + (q.rated ? q.e1 - q.e0 : 0), 0), pts: qs.reduce((a, q) => a + q.pts, 0) }
}
function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null
  const w = 360, h = 70, lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="rating over the game"><polyline fill="none" stroke="var(--ac)" strokeWidth="2" points={v.map((y, i) => `${(i / (v.length - 1)) * w},${h - 4 - ((y - lo) / r) * (h - 8)}`).join(' ')} /></svg>
}
const Stat = ({ k, v }: { k: string; v: string }) => <div className="card" style={{ margin: 0, textAlign: 'center' }}><div className="mu">{k}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>

const lagFmt = (x: number | null) => x === null ? '–' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + ' s'
/** Average time between the earliest realistic buzz point and your buzz, by subject and question type. Bonuses are not counted. */
function LagTable({ qs }: { qs: QRec[] }) {
  const avg = (a: QRec[]) => a.length ? a.reduce((x, q) => x + (q.lag as number), 0) / a.length : null
  const subs = [...new Set(qs.filter(q => q.lag !== undefined).map(q => q.sub))]
  if (!subs.length) return null
  const row = (label: string, l: QRec[]) => <tr key={label}><td>{label}</td><td>{l.length}</td><td className="tot">{lagFmt(avg(l))}</td><td>{lagFmt(avg(l.filter(q => q.mc)))} <span className="mu">({l.filter(q => q.mc).length})</span></td><td>{lagFmt(avg(l.filter(q => q.mc === false)))} <span className="mu">({l.filter(q => q.mc === false).length})</span></td></tr>
  const all = qs.filter(q => q.lag !== undefined)
  return <div className="card" style={{ overflowX: 'auto' }}><b>How long after the earliest realistic buzz point do you buzz?</b>
    <div className="mu" style={{ margin: '4px 0 8px' }}>Average over your toss-up buzzes (bonuses aren’t counted). “+” means after the point, “−” means you buzzed before it (anticipating). Smaller is faster.</div>
    <table className="sbt"><thead><tr><th>Subject</th><th>Buzzes</th><th>Average</th><th>Multiple choice</th><th>Short answer</th></tr></thead><tbody>{subs.map(s => row(subName(s), all.filter(q => q.sub === s)))}{row('All subjects', all)}</tbody></table></div>
}


function LagRatingScatter({qs,custom}:{qs:QRec[];custom:number}) { const pts=qs.filter(q=>q.lag!==undefined&&q.rated).map(q=>({x:q.lag as number,y:q.d??0})); if(pts.length<2)return <div className="mu">Buzz-time/difficulty scatter needs at least two rated questions with recorded buzz points.</div>; const W=420,H=220,L=42,R=10,T=12,B=30,xmin=Math.min(-3,...pts.map(p=>p.x)),xmax=Math.max(3,...pts.map(p=>p.x)),ymin=0,ymax=10; const X=(x:number)=>L+(x-xmin)/(xmax-xmin)*(W-L-R),Y=(y:number)=>T+(ymax-y)/(ymax-ymin)*(H-T-B); const mx=pts.reduce((a,p)=>a+p.x,0)/pts.length,my=pts.reduce((a,p)=>a+p.y,0)/pts.length, slope=pts.reduce((a,p)=>a+(p.x-mx)*(p.y-my),0)/(pts.reduce((a,p)=>a+(p.x-mx)**2,0)||1),inter=my-slope*mx; return <div><div className="mu">X = seconds after the earliest realistic buzz point (negative anticipates it); Y = difficulty. Your entered rating is shown as a horizontal reference.</div><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Buzz lag versus question difficulty scatter plot">{[0,2,4,6,8,10].map(y=><g key={y}><line x1={L} x2={W-R} y1={Y(y)} y2={Y(y)} stroke="var(--bd)"/><text x={L-6} y={Y(y)+4} textAnchor="end" fontSize="11" fill="currentColor">{y}</text></g>)}<line x1={X(0)} x2={X(0)} y1={T} y2={H-B} stroke="var(--bd)" strokeDasharray="4 4"/><line x1={L} x2={W-R} y1={Y(custom)} y2={Y(custom)} stroke="var(--ac)" strokeDasharray="5 3"/><line x1={X(xmin)} y1={Y(inter+slope*xmin)} x2={X(xmax)} y2={Y(inter+slope*xmax)} stroke="currentColor" strokeWidth="2"/>{pts.map((p,i)=><circle key={i} cx={X(p.x)} cy={Y(p.y)} r="3.5" fill="var(--ac)"/>)}{[xmin,0,xmax].map(x=><text key={x} x={X(x)} y={H-8} textAnchor="middle" fontSize="11" fill="currentColor">{x.toFixed(1)}s</text>)}</svg><div className="mu">Regression line fitted to your recorded data; horizontal dashed line = entered reference rating.</div></div> }

/** Every game (including placement tests): list -> one game -> one question. */
export function History({ user, exit }: { user: string; exit: () => void }) {
  const [games, setGames] = useState(() => loadHist(user).sort((a, b) => b.ts - a.ts)), [gi, setGi] = useState<string | null>(null), [qi, setQi] = useState<number | null>(null), [filter,setFilter]=useState('all'), [customRating,setCustomRating]=useState(5)
  const g = games.find(x => x.id === gi)
  if (g && qi !== null && g.qs[qi]) return <QDetail g={g} i={qi} back={() => setQi(null)} />
  if (g) return <GameDetail g={g} open={setQi} back={() => setGi(null)} />
  const all = games.flatMap(x => x.qs), filtered=all.filter(q=>filter==='all'||q.sub===filter), t = stats(filtered)
  const clear = async () => { if (await confirmBox('Delete all history?', 'This removes every saved game from this browser. Your ratings are not changed.', 'Delete history')) { clearHist(user); setGames([]); toast('History cleared.') } }
  return <><div className="row"><button onClick={exit}>← Home</button><button onClick={clear} disabled={!games.length}>Clear history</button></div><h1>Your history</h1>
    <div className="mu">Every game you’ve played in this browser, including placement tests. Click a game to see its questions, and a question to see exactly how it affected your rating.</div><div className="card"><label>Filter statistics by subject <select value={filter} onChange={e=>setFilter(e.target.value)}>{SUBJECTS.map(s=><option value={s} key={s}>{s==='all'?'All subjects':subName(s)}</option>)}</select></label></div>
    {games.length > 0 && <div className="rgrid" style={{ margin: '12px 0' }}><Stat k="Games" v={String(games.length)} /><Stat k="Questions" v={String(t.n)} /><Stat k="Accuracy" v={t.n ? pc(t.ok / t.n) : '–'} /><Stat k="Negs" v={String(t.neg)} /><Stat k="Average buzz point" v={t.avg === null ? '–' : pc(t.avg) + ' in'} /><Stat k="Fastest buzz" v={t.fast === null ? '–' : t.fast.toFixed(1) + ' s'} /><Stat k="Early buzzes (before 50%)" v={String(t.early)} /><Stat k="Bonus conversion" v={t.bonusN?pc(t.bonusOk/t.bonusN):'–'} /></div>}
    {filtered.length > 0 && <><LagTable qs={filtered} /><div className="card"><b>Buzz-time vs difficulty</b><label className="mu" style={{display:'block',margin:'8px 0'}}>Reference rating (0–10): <input type="number" min="0" max="10" step="0.1" value={customRating} onChange={e=>setCustomRating(Math.max(0,Math.min(10,+e.target.value||0)))} /></label><LagRatingScatter qs={filtered} custom={customRating}/></div></>}
    {!games.length ? <div className="card mu">No games yet. Play a placement test or a practice round and it will show up here.</div> :
      <div className="card">{games.map(x => { const s = stats(x.qs); return <div className="hrow" key={x.id}>
        <div><b>{x.label}</b><div className="mu">{when(x.ts)} · {x.subs.map(subName).join(', ')}</div></div>
        <div>{s.ok}/{s.n} correct{s.neg ? <span className="mu"> · {s.neg} neg</span> : null}</div>
        <div className="mu">{s.avg === null ? 'no buzzes' : 'buzz ~' + pc(s.avg)}</div>
        <div>{x.mode === 'place' && x.end ? <b>{x.end.r.toFixed(3)}</b> : <span style={{ color: s.net >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{sgn(s.net)}</span>}</div>
        <button onClick={() => { setGi(x.id); setQi(null) }}>Open</button></div> })}</div>}</>
}

function GameDetail({ g, open, back }: { g: GameRec; open: (i: number) => void; back: () => void }) {
  const s = stats(g.qs), place = g.mode === 'place'
  return <><div className="row"><button onClick={back}>← All games</button></div><h1>{g.label}</h1><div className="mu">{when(g.ts)} · {g.subs.map(subName).join(', ')}</div>
    <div className="rgrid" style={{ margin: '12px 0' }}><Stat k="Correct" v={`${s.ok}/${s.n}`} /><Stat k="Negs" v={String(s.neg)} /><Stat k="“I don’t know”" v={String(s.idk)} /><Stat k="No buzz" v={String(s.none)} /><Stat k="Average buzz point" v={s.avg === null ? '–' : pc(s.avg) + ' in'} /><Stat k="Fastest buzz" v={s.fast === null ? '–' : s.fast.toFixed(1) + ' s'} />
      {place ? <Stat k="Final placement" v={g.end ? g.end.r.toFixed(3) : 'unfinished'} /> : <><Stat k="Points" v={String(s.pts)} /><Stat k="Rating change" v={sgn(s.net)} /></>}</div>
    {place && g.end && <div className="mu">{levelName(g.end.r)} · likely range {Math.max(0, g.end.r - g.end.sd * 1.5).toFixed(3)}–{Math.min(10, g.end.r + g.end.sd * 1.5).toFixed(3)}</div>}
    <div className="card"><b>{place ? 'Running estimate' : 'Rating'} across the game</b><Spark v={[g.qs[0]?.e0 ?? 0, ...g.qs.map(q => q.e1)]} /></div>
    <div className="card"><b>Questions</b>{g.qs.map((q, i) => <div className="hrow" key={i}>
      <div><span className="mu">#{i + 1}</span> <b>{subName(q.sub)}</b> · {q.topic}{q.ai && <span className="pill" style={{ marginLeft: 6 }}>🤖 AI</span>}<div className="mu" style={{ fontSize: 13 }}>{q.d == null ? 'unrated difficulty' : 'difficulty ' + q.d.toFixed(3)}</div></div>
      <div style={{ color: q.ok ? 'var(--ok)' : 'var(--bad)' }}><b>{q.ok ? '✓ correct' : q.idk ? '— skipped' : q.neg ? '✗ neg' : q.botWon ? '🤖 bot got it' : q.noBuzz ? '· no buzz' : '✗ wrong'}</b></div>
      <div className="mu">{q.noBuzz || q.botWon || q.idk ? '–' : `${q.at.toFixed(1)} s · ${q.tier}`}</div>
      <div style={{ color: q.e1 - q.e0 >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{q.rated ? sgn(q.e1 - q.e0) : <span className="mu">unrated</span>}</div>
      <button onClick={() => open(i)}>Details</button></div>)}</div></>
}

function QDetail({ g, i, back }: { g: GameRec; i: number; back: () => void }) {
  const q = g.qs[i], d = q.e1 - q.e0, b = q.bonus, place = g.mode === 'place', rt = readText(q.tu, q.choices || null)
  const choice = (k: string, v: string, mine: string | null) => <div key={k} className={k === q.ans ? 'ok' : k === mine ? 'no' : ''} style={{ padding: '3px 0' }}>{k}) <Tex s={v} />{k === q.ans ? '  ✓ correct answer' : k === mine ? '  ← your answer' : ''}</div>
  return <><div className="row"><button onClick={back}>← Back to game</button></div><h1>Question {i + 1}</h1>
    <div className="mu"><span className="pill">{subName(q.sub)}</span><span className="pill">{q.topic}</span><span className="pill">{q.d == null ? 'unrated' : 'difficulty ' + q.d.toFixed(3)}</span>{q.src && <span className="pill">{q.src}</span>}{q.ai && <span className="pill">🤖 AI-written</span>}</div>
    <div className="home" style={{ marginTop: 10 }}><div>
      <div className="card">{q.ei !== undefined ? <Marked mk={{ words: rt.words, starts: rt.starts, nq: q.nq ?? rt.nq, buzz: q.wi ?? null, ok: q.ok, early: q.ei }} /> : <div className="q"><Tex s={q.tu} /></div>}</div>
      <div className="card">{q.choices ? Object.entries(q.choices).map(([k, v]) => choice(k, v, q.given)) : <><div>Correct answer: <b><Tex s={q.ans} /></b></div></>}
        <div style={{ marginTop: 8 }}>{q.idk ? <b>You chose “I don’t know”.</b> : q.botWon ? <b>The bot buzzed first.</b> : q.noBuzz ? <b>You didn’t buzz.</b> : <>Your answer: <b>{q.given ? (q.choices && q.choices[q.given] ? <Tex s={`${q.given}) ${q.choices[q.given]}`} /> : <Tex s={q.given} />) : '(none given)'}</b> — <b style={{ color: q.ok ? 'var(--ok)' : 'var(--bad)' }}>{q.ok ? 'correct' : q.neg ? 'wrong (neg)' : 'wrong'}</b></>}</div></div>
      {b && <div className="card"><b>Bonus</b> — <span style={{ color: b.ok ? 'var(--ok)' : 'var(--bad)' }}>{b.ok ? 'correct (+10)' : 'missed'}</span><div className="q" style={{ minHeight: 0 }}><Tex s={b.bn} /></div>
        <div>Correct answer: <b><Tex s={b.choices ? `${b.ba}) ${b.choices[b.ba]}` : b.ba} /></b></div><div>Your answer: <b>{b.given ? <Tex s={b.choices && b.choices[b.given] ? `${b.given}) ${b.choices[b.given]}` : b.given} /> : '(none)'}</b></div>{b.rated && b.e0!==undefined && b.e1!==undefined && <div className="mu">Bonus rating (outcome only): {b.e0.toFixed(3)} → {b.e1.toFixed(3)} ({sgn(b.e1-b.e0)})</div>}</div>}
    </div><div>
      <div className="card"><b>When you buzzed</b>{q.noBuzz || q.botWon || q.idk ? <div className="mu">{q.botWon ? 'The bot buzzed before you.' : q.idk ? 'You skipped before answering.' : 'You did not buzz before time ran out.'}</div> :
        <><div style={{ fontSize: 22, fontWeight: 700 }}>{q.at.toFixed(1)} s in</div><div className="mu">{q.tier.includes('After the full read') ? 'After the whole question had been read' : q.frac >= 1 ? 'Before all the choices had been read (still an interrupt)' : `${pc(q.frac)} of the way through the question`} · <b>{q.tier}</b></div>
          {q.lag !== undefined && <div className="mu">{Math.abs(q.lag).toFixed(2)} s {q.lag >= 0 ? 'after' : 'before'} the earliest realistic buzz point</div>}
          <div className="bar" style={{ marginTop: 8 }}><i style={{ width: pc(q.frac) }} /></div></>}</div>
      <div className="card"><b>{place ? 'Effect on your placement estimate' : 'Effect on your rating'}</b>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{q.e0.toFixed(3)} → {q.e1.toFixed(3)}</div>
        {q.rated ? <div style={{ color: d >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{sgn(d)}</div> : <div className="mu">This question has no difficulty rating yet, so it didn’t change your rating.</div>}
        {q.rated && q.speed !== 0 && <div className="mu">Of that, {sgn(q.speed)} came from how early you buzzed.</div>}
        <div className="mu" style={{ marginTop: 6 }}>{place ? 'In a placement test every answer (and every “I don’t know”) moves the estimate; harder questions move it more.' : 'Earlier buzzes earn more rating when you’re right; wrong interrupts cost more.'}</div>
        {q.pts !== 0 && <div className="mu">Points: {q.pts > 0 ? '+' : ''}{q.pts}</div>}</div>
    </div></div></>
}
