import { useEffect, useState } from 'react'
import { metaFromName, qMeta, type Meta, sourceGroup, sourceMatches } from './engine'
import { loadReport, store, isMod } from './platform'
import { qkey } from './read'
import { Tex } from './tex'
import { isMisc, subName, type Question } from './types'

export interface Row { q: Question; m: Meta }
export interface F { q: string; src: string; year: string; sub: string; flag: string; rnd: string; lo: string; hi: string; sort: 'asc' | 'desc' | 'packet' }
export const F0: F = { q: '', src: '', year: '', sub: '', flag: '', rnd: '', lo: '', hi: '', sort: 'asc' }
const flagOk = (q: Question, k: string) => k === 'gs' ? !!q.gs : k === 'sa' ? !q.choices : k === 'mc' ? !!q.choices : k === 'acc' ? !!(q.ax?.length || q.nx?.length || q.bx?.length || q.bnx?.length) : true
const ys = (m: Meta) => [m.year, m.set].filter(Boolean).join(' ') || 'Unknown'
/** Every question including Miscellaneous ones; Miscellaneous questions can only be seen here, never played. */
export const rowsOf = (): Row[] => store.all().map(q => ({ q, m: qMeta(q) }))
const rated = (q: Question) => !isMisc(q) && (!!q.dr || !!q.ai)
export const diffText = (q: Question) => isMisc(q) ? 'none (miscellaneous)' : rated(q) ? Number(q.d).toFixed(3) : 'unrated'
/** The subject filter: "misc" picks the Miscellaneous questions; a real subject excludes them. */
const subOk = (q: Question, s: string) => !s || (s === 'misc' ? isMisc(q) : !isMisc(q) && q.sub === s)

/** Filters and sorts. A difficulty range only keeps questions whose difficulty is known; unrated ones always sort last. */
export function filterRows(rows: Row[], f: F): Row[] {
  const lo = f.lo.trim() === '' ? null : +f.lo, hi = f.hi.trim() === '' ? null : +f.hi, text = f.q.toLowerCase()
  const out = rows.filter(({ q, m }) => (!f.src || sourceMatches(m.src, f.src)) && (!f.year || m.year === f.year) && (!f.rnd || m.rnd === f.rnd) && subOk(q, f.sub) && (!f.flag || flagOk(q, f.flag))
    && (!text || (q.pk + ' ' + q.topic + ' ' + q.tu).toLowerCase().includes(text)) && (lo === null || (rated(q) && q.d >= lo - 1e-9)) && (hi === null || (rated(q) && q.d <= hi + 1e-9)))
  const pk = (a: Row, b: Row) => String(a.q.pk).localeCompare(String(b.q.pk), undefined, { numeric: true }) || (a.q.ord || 0) - (b.q.ord || 0)
  if (f.sort === 'packet') return out.sort(pk)
  const dir = f.sort === 'asc' ? 1 : -1
  return out.sort((a, b) => (rated(a.q) === rated(b.q) ? (rated(a.q) ? (a.q.d - b.q.d) * dir : 0) : rated(a.q) ? -1 : 1) || pk(a, b))
}

/** Source / year / round pickers (rounds narrow down to the chosen source and year) + subject, flags, difficulty range and search. */
function FilterBar({ rows, f, set, sort = true, misc = false }: { rows: Row[]; f: F; set: (p: Partial<F>) => void; sort?: boolean; misc?: boolean }) {
  const scope = rows.filter(r => (!f.src || sourceMatches(r.m.src, f.src)) && (!f.year || r.m.year === f.year) && subOk(r.q, f.sub))
  const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
  const sel = (label: string, v: string, opts: [string, string][], on: (v: string) => void) => <label className="mu">{label}<select style={{ width: '100%' }} value={v} onChange={e => on(e.target.value)}><option value="">All</option>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
  return <div className="card"><div className="row">
    {sel('Source', f.src, uniq(rows.map(r => sourceGroup(r.m.src))).map(x => [x, x]), v => set({ src: v, rnd: '' }))}
    {sel('Year', f.year, uniq(rows.map(r => r.m.year)).map(x => [x, x]), v => set({ year: v, rnd: '' }))}
    {sel('Round', f.rnd, uniq(scope.map(r => r.m.rnd)).map(x => [x, x]), v => set({ rnd: v }))}
    {sel('Subject', f.sub, misc ? [...store.allowed(), ['misc', 'Miscellaneous']] : store.allowed(), v => set({ sub: v, rnd: '' }))}
    {sel('Type', f.flag, [['mc', 'Multiple choice'], ['sa', 'Short answer'], ['gs', 'General science'], ['acc', 'Has accepted / do-not-accept answers']], v => set({ flag: v }))}</div>
    <div className="row" style={{ marginTop: 8 }}>
      <label className="mu">Difficulty from<input type="number" min={0} max={10} step={0.5} placeholder="0" style={{ width: '100%', boxSizing: 'border-box' }} value={f.lo} onChange={e => set({ lo: e.target.value })} /></label>
      <label className="mu">to<input type="number" min={0} max={10} step={0.5} placeholder="10" style={{ width: '100%', boxSizing: 'border-box' }} value={f.hi} onChange={e => set({ hi: e.target.value })} /></label>
      {sort && <label className="mu">Sort by<select style={{ width: '100%' }} value={f.sort} onChange={e => set({ sort: e.target.value as F['sort'] })}><option value="asc">Difficulty: easiest first</option><option value="desc">Difficulty: hardest first</option><option value="packet">Packet order</option></select></label>}</div>
    <input style={{ width: '100%', boxSizing: 'border-box', marginTop: 8 }} placeholder="Search packet name, topic or question text" value={f.q} onChange={e => set({ q: e.target.value })} />
    <div className="mu" style={{ marginTop: 6, fontSize: 13 }}>A difficulty range only shows rated questions (miscellaneous questions have no rating). For questions “around 3”, use 2.5 to 3.5.</div></div>
}

/** One question with its labels. The answer and bonus stay folded away until you open them, so you can look at a question without spoiling it. */
function QCard({ r, play }: { r: Row; play: (o: any) => void }) {
  const [edit, setEdit] = useState(false), [axText,setAx] = useState((r.q.ax||[]).join('\n')), [nxText,setNx] = useState((r.q.nx||[]).join('\n')), [tick,setTick] = useState(0), moderator = isMod()
  const { q, m } = r, bch = q.bc || (/^[WXYZ]$/i.test(String(q.ba || '')) ? q.choices : null)
  return <div className="card"><div style={{ marginBottom: 6 }}>
    <span className="pill">{isMisc(q) ? 'Miscellaneous' : subName(q.sub)}</span>{isMisc(q) && <span className="pill" title="The subject stored in bank.json">subject: {subName(q.sub)}</span>}<span className="pill">difficulty {diffText(q)}</span><span className="pill">{q.choices ? 'Multiple choice' : 'Short answer'}</span>
    <span className="pill">{sourceGroup(m.src)}</span>{(m.year || m.set) && <span className="pill">{ys(m)}</span>}{m.rnd && <span className="pill">{m.rnd}</span>}
    {q.gs && <span className="pill">GS</span>}{q.ai && <span className="pill">🤖 AI</span>}<span className="pill" title="Topic">{q.topic}</span></div>
    <div className="q" style={{ minHeight: 0 }}><Tex s={q.tu} /></div>
    {moderator && q.fl?.length ? <div className="mu" style={{ marginTop: 6 }}>{q.fl.map((f, i) => <div key={i}>{f.k === 'math' ? '⚠ Possible math error' : f.k === 'format' ? 'Formatting fixed' : f.k === 'transcription' ? 'Transcription' : 'Scan quality'}: {f.n}</div>)}</div> : null}
    {q.choices && <div style={{ marginTop: 4 }}>{Object.entries(q.choices).map(([k, v]) => <div key={k}>{k}) <Tex s={v} /></div>)}</div>}
    <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }} className="mu">Show answer{q.bn ? ' and bonus' : ''}</summary>
      <div style={{ marginTop: 6 }}>Answer: <b><Tex s={q.choices ? `${q.ans}) ${q.choices[q.ans]}` : q.ans} /></b>{q.ax?.length ? <div className="mu">Also accept: <Tex s={q.ax.join('; ')} /></div> : null}{q.nx?.length ? <div className="mu">Do not accept: <Tex s={q.nx.join('; ')} /></div> : null}</div>
      {q.bn && <div style={{ marginTop: 8 }}><div className="mu">Bonus</div><Tex s={q.bn} />{bch && <div>{Object.entries(bch).map(([k, v]) => <div key={k}>{k}) <Tex s={v} /></div>)}</div>}<div>Answer: <b><Tex s={bch ? `${q.ba}) ${bch[q.ba!]}` : String(q.ba)} /></b></div></div>}</details>{moderator && <div style={{marginTop:8}}><button onClick={()=>setEdit(!edit)}>{edit?'Close answer editor':'🛡 Edit accepted/rejected answers'}</button>{edit&&<div className="card"><label className="mu">Additional accepted answers (one per line)<textarea rows={4} value={axText} onChange={e=>setAx(e.target.value)} /></label><label className="mu">Answers to reject (one per line)<textarea rows={4} value={nxText} onChange={e=>setNx(e.target.value)} /></label><button className="p" onClick={()=>{store.fix({[qkey(q)]:{ax:axText.split(/\n/).map(x=>x.trim()).filter(Boolean),nx:nxText.split(/\n/).map(x=>x.trim()).filter(Boolean)}});setTick(t=>t+1)}}>Save answer overrides</button><div className="mu">Overrides apply locally and are persisted for this browser.</div></div>}</div>}
    {!isMisc(q) && <div className="row" style={{ marginTop: 8 }}><button onClick={() => play({ kind: 'prac', pool: [q] })}>Play just this question</button></div>}</div>
}

const PAGE = 5
function Pager({ page, pages, go }: { page: number; pages: number; go: (p: number) => void }) {
  return <div className="row" style={{ margin: '8px 0', alignItems: 'center' }}><button disabled={page <= 0} onClick={() => go(page - 1)}>← Previous</button><div className="mu" style={{ textAlign: 'center' }}>Page {page + 1} of {pages}</div><button disabled={page >= pages - 1} onClick={() => go(page + 1)}>Next →</button></div>
}

const ORDERS: [string, ('src' | 'ys' | 'rnd')[]][] = [['Source → Year/Set → Round', ['src', 'ys', 'rnd']], ['Source → Round → Year/Set', ['src', 'rnd', 'ys']], ['Year/Set → Source → Round', ['ys', 'src', 'rnd']], ['Year/Set → Round → Source', ['ys', 'rnd', 'src']], ['Round → Source → Year/Set', ['rnd', 'src', 'ys']], ['Round → Year/Set → Source', ['rnd', 'ys', 'src']]]

export function Database({ play, exit }: { play: (o: any) => void; exit: () => void }) {
  const [view, setView] = useState<'packets' | 'questions'>('questions'), [ord, setOrd] = useState(0), [f, setF] = useState<F>(F0), [page, setPage] = useState(0), [inOrder, setInOrder] = useState(false)
  const rows = rowsOf(), shown = filterRows(rows, f), playable = shown.filter(r => !isMisc(r.q)), set = (p: Partial<F>) => { setF({ ...f, ...p }); setPage(0) }
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)), pg = Math.min(page, pages - 1)
  const val = (m: Meta, k: string) => (k === 'src' ? sourceGroup(m.src) : k === 'ys' ? ys(m) : m.rnd) || 'Unknown', levels = ORDERS[ord][1]
  const render = (items: Row[], lv: number): JSX.Element => {
    if (lv === 3) return <>{[...new Set(items.map(x => x.q.pk))].map(pk => { const qs = items.filter(x => x.q.pk === pk).map(x => x.q), n = qs.length, note = store.notes()[pk || '']; return <div className="row" key={pk} style={{ margin: '6px 0' }}><span>{pk} <span className="mu">({n} Q)</span> {qs.some(isMisc) && <span className="pill">Misc {qs.filter(isMisc).length}</span>}{qs.some(x => x.gs) && <span className="pill">GS {qs.filter(x => x.gs).length}</span>}{qs.some(x => !x.choices) && <span className="pill">SA {qs.filter(x => !x.choices).length}</span>}{note && <div className="mu" style={{ fontSize: 13 }}>📝 {note}</div>}</span><button className="p" onClick={() => play({ kind: 'prac', packet: pk })}>Play in order</button><button onClick={() => play({ kind: 'bot', packet: pk })}>Vs bot</button></div> })}</>
    const groups = new Map<string, Row[]>(); items.forEach(x => { const k = val(x.m, levels[lv]); groups.set(k, [...(groups.get(k) || []), x]) })
    return <>{[...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, g]) => <details key={k} open={lv === 0}><summary style={{ cursor: 'pointer', margin: '6px 0' }}><b>{k}</b> <span className="mu">({g.length} questions)</span></summary><div style={{ paddingLeft: 14 }}>{render(g, lv + 1)}</div></details>)}</>
  }
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>Question database</h1>
    <div className="mu">{rows.length.toLocaleString()} questions. Source, year, set and round are read from each packet when it is scanned (older uploads use the file name, e.g. <code>NSB_2024_Regionals_Round1.pdf</code>); a moderator can edit these titles.</div>
    {loadReport().some(r => !r.ok) && <div className="card no"><b>Some files in the public folder were skipped</b>{loadReport().filter(r => !r.ok).map(r => <div key={r.file} style={{ fontSize: 14 }}>❌ {r.file}: {r.msg}</div>)}</div>}
    <div className="row" style={{ margin: '10px 0' }}><button className={view === 'questions' ? 'p' : ''} onClick={() => setView('questions')}>Browse questions</button><button className={view === 'packets' ? 'p' : ''} onClick={() => setView('packets')}>By packet</button></div>
    <FilterBar rows={rows} f={f} set={set} sort={view === 'questions'} misc />
    <div className="card"><div className="row"><label className="mu" style={{ flex: 2 }}><input type="checkbox" checked={inOrder} onChange={e => setInOrder(e.target.checked)} /> Play in the order shown</label><button className="p" disabled={!playable.length} onClick={() => play({ kind: 'prac', pool: playable.map(r => r.q), ordered: inOrder })}>Practice these {playable.length.toLocaleString()} questions</button><button disabled={!playable.length} onClick={() => play({ kind: 'bot', pool: playable.map(r => r.q), ordered: inOrder })}>Vs bot</button></div>{playable.length < shown.length && <div className="mu" style={{ marginTop: 6, fontSize: 13 }}>{(shown.length - playable.length).toLocaleString()} miscellaneous question(s) are shown here but can’t be played.</div>}</div>
    {!shown.length ? <div className="card mu">No questions match. A moderator can scan packets under Moderator tools.</div>
      : view === 'packets' ? <><div className="row" style={{ margin: '8px 0' }}><label className="mu">Group by<select style={{ width: '100%' }} value={ord} onChange={e => setOrd(+e.target.value)}>{ORDERS.map(([l], i) => <option key={l} value={i}>{l}</option>)}</select></label></div>{render(shown, 0)}</>
      : <><div className="mu">{shown.length.toLocaleString()} questions · showing {pg * PAGE + 1}–{Math.min(shown.length, pg * PAGE + PAGE)}</div><Pager page={pg} pages={pages} go={setPage} />
        {shown.slice(pg * PAGE, pg * PAGE + PAGE).map((r, i) => <QCard key={pg + ':' + i + r.q.tu.slice(0, 30)} r={r} play={play} />)}<Pager page={pg} pages={pages} go={setPage} /></>}</>
}

/** Practice setup: pick subject, source, round and a difficulty range, then practice (or play the bot) on exactly those questions. */
export function PracticeSetup({ play, exit }: { play: (o: any) => void; exit: () => void }) {
  const [f, setF] = useState<F>({ ...F0, sort: 'packet' }), [random, setRandom] = useState(true), [ratedOnly, setRatedOnly] = useState(false)
  const rows = rowsOf().filter(r => !isMisc(r.q)), shown0 = filterRows(rows, f), shown = ratedOnly ? shown0.filter(r => rated(r.q)) : shown0, set = (p: Partial<F>) => setF({ ...f, ...p }), nr = shown.filter(r => rated(r.q)).length
  const go = (kind: 'prac' | 'bot') => play({ kind, pool: shown.map(r => r.q), ordered: !random })
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>Practice setup</h1>
    <div className="mu">Choose which questions to practice: a subject, a source, a specific round, a difficulty range, or any mix. Leave a box on “All” to include everything.</div>
    <FilterBar rows={rows} f={f} set={set} sort={false} />
    <div className="card"><b>{shown.length.toLocaleString()} questions match</b> <span className="mu">({nr.toLocaleString()} with a known difficulty)</span>
      <div className="row" style={{ marginTop: 8 }}><label className="mu"><input type="checkbox" checked={ratedOnly} onChange={e => setRatedOnly(e.target.checked)} /> Rated questions only</label><label className="mu"><input type="checkbox" checked={random} onChange={e => setRandom(e.target.checked)} /> Random order (untick to keep packet order)</label></div>
      <div className="row" style={{ marginTop: 8 }}><button className="p" disabled={!shown.length} onClick={() => go('prac')}>Start practice</button><button disabled={!shown.length} onClick={() => go('bot')}>Play vs bot</button></div>
      {!shown.length && <div className="mu" style={{ marginTop: 6 }}>Nothing matches these choices yet. Widen the difficulty range or pick “All”.</div>}</div></>
}

/** Moderators: rename how packets appear in the database for everyone (source, year, set, round). Download everything afterwards to publish the changes. */
export function MetaEditor() {
  const [, tick] = useState(0), [q, setQ] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [msg, setMsg] = useState('')
  const bank = store.all(), over = store.meta()
  const pk = new Map<string, { n: number; m: Meta }>(); bank.forEach(x => { const k = x.pk || 'Unknown', c = pk.get(k); if (c) c.n++; else pk.set(k, { n: 1, m: qMeta(x) }) })
  const srcs = [...new Set([...pk.values()].map(v => v.m.src))].sort(), list = [...pk].filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  useEffect(() => { if (!from && srcs.length) setFrom(srcs[0]) }, [srcs.length])
  const field = (k: string, name: keyof Meta, label: string, cur: string) => <label className="mu" style={{ fontSize: 12 }}>{label}<input key={k + name + cur} list={name === 'src' ? 'bl-srcs' : undefined} defaultValue={cur} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px' }}
    onBlur={e => { const v = e.target.value.trim(); if (v !== cur) { store.setMeta(k, { [name]: v }); tick(x => x + 1) } }} /></label>
  return <>
    <datalist id="bl-srcs">{srcs.map(s => <option key={s} value={s} />)}</datalist>
    <div className="row" style={{ margin: '8px 0' }}><label className="mu">Rename a source everywhere<select style={{ width: '100%' }} value={from} onChange={e => setFrom(e.target.value)}>{srcs.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="mu">New name<input style={{ width: '100%', boxSizing: 'border-box' }} value={to} onChange={e => setTo(e.target.value)} placeholder="e.g. NSB" /></label>
      <button disabled={!from || !to.trim()} onClick={() => { const n = store.renameSource(from, to); setMsg(`Renamed the source on ${n} packet(s).`); setFrom(to.trim()); setTo(''); tick(x => x + 1) }}>Rename</button></div>
    {msg && <div className="mu">{msg}</div>}
    <input placeholder="Search packets" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0' }} value={q} onChange={e => setQ(e.target.value)} />
    <div style={{ maxHeight: 420, overflow: 'auto' }}>{list.slice(0, 30).map(([k, v]) => <div key={k} style={{ margin: '10px 0', paddingBottom: 8, borderBottom: '1px solid var(--bd)' }}>
      <div style={{ fontSize: 14 }}><b>{k}</b> <span className="mu">({v.n} Q){over[k] && Object.keys(over[k]).length ? ' · edited' : ''}</span></div>
      <div className="row" style={{ marginTop: 4 }}>{field(k, 'src', 'Source', v.m.src)}{field(k, 'year', 'Year', v.m.year)}{field(k, 'set', 'Set', v.m.set)}{field(k, 'rnd', 'Round', v.m.rnd)}</div>
      {over[k] && Object.keys(over[k]).length > 0 && <button style={{ marginTop: 4, padding: '4px 8px', fontSize: 12 }} onClick={() => { store.setMeta(k, null); tick(x => x + 1) }}>Undo edits</button>}</div>)}
      {list.length > 30 && <div className="mu">Showing 30 of {list.length}. Search to narrow the list.</div>}{!list.length && <div className="mu">No packets found.</div>}</div></>
}
void metaFromName
