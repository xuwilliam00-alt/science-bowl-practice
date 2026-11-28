import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Match, type BoardRow, type LogRow, type Opts } from './match'
import { Marked } from './marked'
import { Ability, PlacementPool, clamp, levelName, tops, topic, upd } from './engine'
import { Database, MetaEditor, PracticeSetup } from './browse'
import { Statistics } from './stats'
import { chemTodo, rjGet, rjSub, startRerate, stopRerate } from './rerate'
import { cancelScan, dismissJob, getScanPar, jobGet, jobSub, retryFailed, setScanPar, startScan } from './jobs'
import { askText, confirmBox, tell, toast } from './dialog'
import { Tex } from './tex'
import { History } from './history'
import { addGame, updateGame } from './hist'
import TeamGame from './team'
import { Icon, ModeToggle, Settings, AiStatusCard } from './settings'
import { coach, isMod, loadReport, lsSet, modSub, setMod, store } from './platform'
import { available, dismissInvite, friendAction, getProfile, putProfile, scheduleSave, signIn, signOut, social, useUser, verify, type Social } from './account'
import { pdfText } from './pdf'
import { TypedBox } from './typed'
import { ALL_SUBJECTS, newProfile, subName, type Profile, type Question, type Sub } from './types'

type Scr = { k: 'home' | 'profile' | 'upload' | 'friends' | 'db' | 'acct' | 'hist' | 'setup' | 'stats' } | { k: 'team'; code?: string } | { k: 'game'; o: Omit<Opts, 'getP' | 'mutate'> }

/** Fills in anything missing from a saved profile (older saves, or one loaded from an account). */
const normProfile = (s: any): Profile => { const d = newProfile(); return s ? { ...d, ...s, r: { ...d.r, ...s.r }, n: { ...d.n, ...s.n }, diag: typeof s.diag === 'boolean' ? { math: s.diag, physics: s.diag } : s.diag || {}, p: { ...d.p, ...s.p, botElo: { ...(s.p?.botElo || {}) }, subjs: s.p?.subjs || [] } } : d }
const short = (s: string) => subName(s).replace('Chemistry', 'Chem').replace('Earth & Space', 'Earth')

export default function App() {
  const [P, setP] = useState<Profile>(() => normProfile(store.load()))
  const ref = useRef(P); ref.current = P
  const adopt = (c: Profile) => { ref.current = c; setP(c); store.save(c) }
  const mutate = (f: (P: Profile) => void) => { const c = structuredClone(ref.current); f(c); adopt(c); scheduleSave(c) }
  const mod = useSyncExternalStore(modSub, isMod), [scr, setScr] = useState<Scr>({ k: 'home' }), [showSet, setShowSet] = useState(false)
  const job = useSyncExternalStore(jobSub, jobGet), rr = useSyncExternalStore(rjSub, rjGet), user = useUser(), [soc, setSoc] = useState<Social | null>(null)
  /** After signing in: an account's saved ratings replace this browser's (the old ones are kept as a backup); a brand-new account starts from what's here. */
  const authed = async (name: string) => {
    try { const sp = await getProfile()
      if (sp) { lsSet('bl-profile-backup', JSON.stringify(ref.current)); const n = normProfile(sp); if (!n.name) n.name = name; adopt(n) }
      else { const c = structuredClone(ref.current); if (!c.name) c.name = name; adopt(c); await putProfile(c) }
    } catch { /* offline: keep playing locally; it saves on the next change */ }
  }
  useEffect(() => { if (user) verify().then(ok => ok && authed(user)) }, [user])
  useEffect(() => { // friend list, requests, invites and our "online" heartbeat
    if (!user) return void setSoc(null); let dead = false
    const f = () => social().then(s => !dead && setSoc(s)).catch(() => {}); f(); const t = setInterval(f, 20000); return () => { dead = true; clearInterval(t) }
  }, [user])
  const home = () => setScr({ k: 'home' })
  const gk = useRef(0), bgMatch = useRef<Match | null>(null); const play = (o: Omit<Opts, 'getP' | 'mutate'>) => { gk.current++; bgMatch.current = (o.kind === 'bot' || o.kind === 'prac') ? new Match({ ...o, getP: () => ref.current, mutate, saveGame: g => addGame(user || '', g) }) : null; setScr({ k: 'game', o }) }
  const weak = () => { const t = tops(P); if (!t.length) return void tell('Not enough data yet', 'Play a few more questions first so I can find your weak spots.'); const [s, ...n] = t[0].k.split(':'); play({ kind: 'prac', fix: s as Sub, tp: n.join(':') }) }
  if (scr.k === 'game') return <Game key={gk.current} o={{ ...scr.o, getP: () => ref.current, mutate, saveGame: g => addGame(user || '', g) }} exit={home} existing={bgMatch.current} />
  const pct = job.files ? Math.round(job.filesDone / job.files * 100) : 0, rc = (...s: string[]) => job.rows.filter(r => s.includes(r.state)).length
  const banner = job.running ? <div className="card"><div className="row"><div className="mu" style={{ flex: 4 }}>Scanning {job.files} file(s) in the background: <b>{rc('done', 'partial', 'failed', 'skipped')} finished</b> · {rc('reading', 'scanning')} in progress · {rc('queued')} waiting{job.failed ? ` · ⚠ ${job.failed} failed` : ''} · {job.added} questions found. Keep this tab open; you can keep using the app.</div><button onClick={cancelScan}>Stop</button></div>{job.pauseUntil > Date.now() && <div className="mu" style={{ margin: '6px 0' }}>⏸ Groq’s rate limit was hit, so scanning is paused. It resumes by itself in <b><Countdown until={job.pauseUntil} /></b>.</div>}<div className="bar" style={{ marginTop: 6 }}><i style={{ width: pct + '%' }} /></div></div>
    : job.finished ? <div className="card ok"><b>✓ {job.msg}</b> <button style={{ marginLeft: 8 }} onClick={dismissJob}>Dismiss</button></div> : null
  const rrBanner = rr.running ? <div className="card mu">Rating question difficulty with the AI: <b>{rr.done.toLocaleString()}/{rr.total.toLocaleString()}</b>{rr.pauseUntil > Date.now() && <> · ⏸ Groq’s limit was hit, resuming in <b><Countdown until={rr.pauseUntil} /></b></>}. You can keep using the app.</div> : null
  const wrap = (el: JSX.Element) => <>{banner}{rrBanner}{el}</>
  if (scr.k === 'hist') return wrap(<History user={user || ''} exit={home} />)
  if (scr.k === 'profile') return wrap(<Profile_ P={P} exit={home} weak={weak} />)
  if (scr.k === 'upload') return wrap(<Upload exit={home} />)
  if (scr.k === 'db') return wrap(<Database play={play} exit={home} />)
  if (scr.k === 'stats') return wrap(<Statistics exit={home} user={user || ""} mine={P.r} wpm={P.p.wpm} />)
  if (scr.k === 'setup') return wrap(<PracticeSetup play={play} exit={home} />)
  if (scr.k === 'team') return wrap(<TeamGame key={scr.code || ''} P={P} user={user} auto={scr.code} getP={() => ref.current} mutate={mutate} exit={home} />)
  if (scr.k === 'acct') return wrap(<Account exit={home} done={async n => { await authed(n); home() }} />)
  if (scr.k === 'friends') return wrap(<Friends soc={soc} reload={() => social().then(setSoc).catch(() => {})} exit={home} join={code => setScr({ k: 'team', code })} />)
  const subs = store.subjects(), placed = subs.filter(s => P.diag[s]), can = placed.length > 0
  return wrap(<>
    <div className="head"><div className="brand"><svg className="brand-mark" viewBox="0 0 44 44" role="img" aria-label="Science Bowl Practice logo"><rect x="2" y="2" width="40" height="40" rx="11" /><circle cx="22" cy="22" r="9.5" fill="none" stroke="#fcfbf7" strokeWidth="2.5" /><path d="M22 12.5v-4M22 35.5v-4M12.5 22h-4M35.5 22h-4" fill="none" strokeWidth="2.5" strokeLinecap="round" /><circle cx="22" cy="22" r="3.6" fill="#e5a51d" /><circle cx="33" cy="11" r="2.6" fill="#1d9a91" /></svg><div><b>SCIENCE BOWL</b><div className="mu">buzzer trainer</div></div></div>
      <div className="hact">{user ? <span className="who mu">Signed in as <b>@{user}</b><button onClick={() => signOut()} style={{ padding: '6px 10px', fontSize: 14 }}>Sign out</button></span> : available ? <button className="p" onClick={() => setScr({ k: 'acct' })} style={{ padding: '8px 14px', fontSize: 14 }}>Sign in / Create account</button> : null}
        <ModeToggle /><button className="ibtn" onClick={() => setShowSet(true)}><Icon n="gear" />Settings</button></div></div>
    <div className="home">
      <div>
        <h2>Your ratings</h2>
        <div className="rgrid">{subs.map(s => <div className="card" key={s} style={{ textAlign: 'center' }}><div className="mu">{short(s)} rating</div><div className="big">{(P.r[s] ?? 5).toFixed(3)}</div><div className="mu">{P.diag[s] ? levelName(P.r[s] ?? 5) : 'Not placed yet'} · confidence {Math.round((P.confidence?.[s] ?? .5) * 100)}%</div>
          <button style={{ marginTop: 6 }} className={P.diag[s] ? '' : 'p'} onClick={() => play({ kind: 'place', fix: s })}>{P.diag[s] ? 'Retake placement' : 'Take placement test'}</button></div>)}</div>
        <input style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Your name" value={P.name} onChange={e => mutate(c => { c.name = e.target.value })} />
        <div className="mu" style={{ margin: '6px 0 10px' }}>Difficulty: 3.5–4.0 is average NSB High School Regionals; only middle-school level is 0–2, and basic high-school is about 2–2.5. Ratings are confidence-weighted.</div><div className="card"><b>AI connection</b><AiStatusCard /></div>
        {!can && <div className="card"><b>Take a placement test to unlock play.</b><div className="mu">Each subject has its own adaptive test (10–20 questions) that is read out like a real round and gets harder or easier based on your answers. You can press “I don’t know” instead of guessing. Questions marked 🤖 were written by AI.</div></div>}
      </div>
      <div>
        {soc && soc.invites.length > 0 && <div className="card">{soc.invites.map(i => <div className="row" key={i.id} style={{ margin: '4px 0' }}><span><b>@{i.frm}</b> invited you to team game <b>{i.room}</b></span><button className="p" onClick={() => { dismissInvite(i.id); setScr({ k: 'team', code: i.room }) }}>Join</button><button onClick={() => { dismissInvite(i.id).then(() => social().then(setSoc)) }}>Dismiss</button></div>)}</div>}
        <h2>Play</h2>
        <div className="row"><button className="p" disabled={!can} onClick={() => play({ kind: 'bot' })}>Play vs bot</button><button disabled={!can} onClick={() => play({ kind: 'prac' })}>Practice</button><button onClick={() => setScr({ k: 'setup' })}>Practice setup</button></div>
        {bgMatch.current && bgMatch.current.get().phase !== 'ended' && <button style={{ marginTop: 8 }} className="p" onClick={() => { gk.current++; setScr({ k: 'game', o: bgMatch.current!.o as any }) }}>Resume background match</button>}
        <div className="row" style={{ marginTop: 10 }}><button disabled={!can} onClick={weak}>Work on my weaknesses</button><button onClick={() => setScr({ k: 'profile' })}>Profile</button><button onClick={() => setScr({ k: 'hist' })}>History</button><button onClick={() => setScr({ k: 'stats' })}>Statistics</button></div>
        <div className="row" style={{ marginTop: 10 }}><button disabled={!can} onClick={() => setScr({ k: 'team' })}>Team game (online)</button><button onClick={() => setScr({ k: 'db' })}>Question database</button><button onClick={() => setScr({ k: 'upload' })}>Moderator tools</button></div>
        {mod && <div className="mu" style={{ marginTop: 8 }}>🛡 Moderator mode is on: you can see every subject. <button style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => setMod(false)}>Exit moderator mode</button></div>}
        {available && <div className="row" style={{ marginTop: 10 }}>{user ? <button onClick={() => setScr({ k: 'friends' })}>Friends{soc && soc.incoming.length + soc.invites.length > 0 ? <span className="bub r">{soc.incoming.length + soc.invites.length}</span> : null}</button> : <button onClick={() => setScr({ k: 'acct' })}>Sign in / create account</button>}</div>}
        <div className="mu">5 s to buzz after a toss-up is read, 20 s on bonuses. Correct toss-up = 4 pts, then a 10-pt bonus. A wrong interrupt costs you 4 and gives the opponent 4. Press W/X/Y/Z to answer, space to buzz.</div>
      </div>
    </div>
    {showSet && <Settings P={P} mutate={mutate} placed={placed} close={() => setShowSet(false)} />}</>)
}

/** Live seconds-remaining counter. */
function Countdown({ until }: { until: number }) { const [, t] = useState(0); useEffect(() => { const i = setInterval(() => t(x => x + 1), 500); return () => clearInterval(i) }, []); return <>{Math.max(0, Math.ceil((until - Date.now()) / 1000))}s</> }

/** Scoreboard in the style of bowl.science: one row per player, one column per question (what they scored on it), then totals. */
function Scoreboard({ board, log }: { board: BoardRow[]; log: LogRow[] }) {
  if (!board.length) return null
  return <div className="card" style={{ overflowX: 'auto', padding: 8 }}><table className="sbt"><thead><tr><th>Player</th>{log.map(l => <th key={l.n} title={subName(l.sub)}>Q{l.n}</th>)}<th>TU</th><th>Neg</th><th>Bonus</th><th className="tot">Total</th></tr></thead>
    <tbody>{board.map((r, i) => <tr key={r.name}><td>{r.name}</td>{log.map(l => <td key={l.n}>{l.cells[i]}</td>)}<td>{r.tu}</td><td>{r.neg}</td><td>{r.bonus}</td><td className="tot">{r.pts}</td></tr>)}</tbody></table></div>
}

function Game({ o, exit, existing }: { o: Opts; exit: () => void; existing?: Match | null }) {
  const m = useRef<Match>(); if (!m.current) m.current = existing || new Match(o); const M = m.current
  const v = useSyncExternalStore(M.sub, M.get)
  useEffect(() => {
    M.start()
    const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; const k = e.key.toUpperCase(); if (e.code === 'Space') { e.preventDefault(); M.buzz() } else if (k.length === 1 && 'WXYZ'.includes(k)) M.answer(k) }
    addEventListener('keydown', kd); return () => { removeEventListener('keydown', kd); if (mp || o.kind === 'place' || M.get().phase === 'ended') M.dispose() }
  }, [])
  const mp = o.kind === 'mp'
  const endMatch = async () => { if (await confirmBox('End this match?', 'Your answers so far are saved in History and your ratings are already updated.', 'End match')) M.end() }
  if (v.phase === 'ended' && v.ended) { const e = v.ended; return <div className="card" style={{ maxWidth: 560, margin: '30px auto' }}><h2 style={{ marginTop: 0 }}>{o.kind === 'bot' ? 'Match over' : 'Practice over'}</h2>
    {o.kind === 'bot' && <div className="big" style={{ textAlign: 'center' }}>You {v.sc[0]} – Bot {v.sc[1]}<div className="mu" style={{ fontSize: 15 }}>{v.sc[0] > v.sc[1] ? 'You win' : v.sc[0] < v.sc[1] ? 'The bot wins' : 'Tied'}</div></div>}
    <div className="rgrid" style={{ margin: '10px 0' }}><div className="card" style={{ margin: 0, textAlign: 'center' }}><div className="mu">Questions</div><b>{e.n}</b></div><div className="card" style={{ margin: 0, textAlign: 'center' }}><div className="mu">Correct</div><b>{e.ok}</b></div><div className="card" style={{ margin: 0, textAlign: 'center' }}><div className="mu">Negs</div><b>{e.neg}</b></div>{o.kind !== 'bot' && <div className="card" style={{ margin: 0, textAlign: 'center' }}><div className="mu">Points</div><b>{v.sc[0]}</b></div>}</div>
    <b>Rating changes</b>{e.subs.length ? e.subs.map(s => <div key={s.sub} className="row" style={{ margin: '4px 0' }}><span>{subName(s.sub)}</span><span>{s.from.toFixed(3)} → <b>{s.to.toFixed(3)}</b> <span style={{ color: s.to - s.from >= 0 ? 'var(--ok)' : 'var(--bad)' }}>({s.to - s.from >= 0 ? '+' : ''}{(s.to - s.from).toFixed(3)})</span></span></div>) : <div className="mu">No rated questions were answered, so your ratings didn’t change.</div>}
    <div className="mu" style={{ margin: '8px 0' }}>The match is saved in History, question by question.</div><button className="p" onClick={exit}>Back home</button></div> }
  if (v.phase === 'placed' && v.placed) return <><div className="card" style={{ textAlign: 'center', maxWidth: 560, margin: '30px auto' }}><div className="mu">{subName(o.fix || '')} placement complete</div><div className="big">{v.placed.r.toFixed(3)}</div><div><b>{levelName(v.placed.r)}</b></div>
    <div className="mu">{v.placed.ok}/{v.placed.n} correct · likely range {Math.max(0, v.placed.r - v.placed.sd * 1.5).toFixed(3)}–{Math.min(10, v.placed.r + v.placed.sd * 1.5).toFixed(3)}</div><div className="mu" style={{ marginTop: 6 }}>This test is saved in your History, question by question.</div><button className="p" style={{ marginTop: 10 }} onClick={exit}>Continue</button></div></>
  return <>
    <div className="row"><button onClick={exit}>← {mp || o.kind === 'place' ? 'Leave' : 'Minimize to home'}</button>{(o.kind === 'prac' || o.kind === 'bot') && <button onClick={endMatch}>End match</button>}{o.kind === 'place' && ['read','win','ans'].includes(v.phase) && <button onClick={() => M.togglePause()}>{v.paused ? 'Resume test' : 'Pause test'}</button>}
      <div className="mu" style={{ textAlign: 'right' }}>{mp ? v.scores.map(s => <span key={s.name}>{s.name} <b>{s.s}</b> · </span>) : o.kind === 'bot' ? <>You <b>{v.sc[0]}</b> – Bot <b>{v.sc[1]}</b> · </> : o.kind === 'place' ? <>Placement · {v.ss.ok}/{v.ss.tu} correct · </> : <>Score <b>{v.sc[0]}</b> · {v.ss.ok}/{v.ss.tu} correct · {v.ss.neg} neg · </>}Q{v.n}</div></div>
    {o.kind !== 'place' && o.kind !== 'mp' && <Scoreboard board={v.board} log={v.log} />}
    <div className="two"><div><div className="card"><div className="mu lbl">{v.tag}{M.q?.d!=null ? ` · difficulty ${Number(M.q.d).toFixed(3)}` : ''}</div><div className="q"><Tex s={v.text} /></div><div className="track"><i style={{ width: v.pct + '%' }} /></div><div className="mu">{v.status}</div></div>
    {v.canBuzz && <button className="p buzz" onClick={() => M.buzz()}>BUZZ (space)</button>}
    {o.kind === 'place' && ['read', 'win', 'ans'].includes(v.phase) && <button className="idk" onClick={() => M.dontKnow()}>I don’t know</button>}
    </div><div><div className="ch">{v.choices && Object.entries(v.choices).map(([k, t]) => <button key={k} disabled={v.correct !== null} className={v.correct === k ? 'ok' : v.pick === k ? 'no' : ''} onClick={() => M.answer(k)}>{k}) <Tex s={t as string} /></button>)}</div>
    {v.typing && <TypedBox key={v.typing} label={v.typing} onChange={t => M.setDraft(t)} onSubmit={t => M.answerText(t)} />}
    {v.sa && <button className="p buzz" onClick={() => M.submitSA()}>Submit answer (space)</button>}
    {v.mk && v.phase === 'done' && <div className="card"><b>Where you buzzed</b><Marked mk={v.mk} /></div>}
    {v.msg && <div className="card"><b><Tex s={v.msg} /></b>{v.note && <div className="note mu">{v.note}</div>}{v.phase === 'done' && v.canNext && <div className="row" style={{ marginTop: 8 }}><button className="p" onClick={() => M.next()}>Next question →</button></div>}</div>}
    {v.phase === 'error' && v.canNext && <button className="p" onClick={() => M.next()}>Retry</button>}
    {v.phase === 'done' && <button onClick={async () => { const reports = JSON.parse(localStorage.getItem('bl-question-reports') || '[]'); const keys = JSON.parse(localStorage.getItem('bl-reported-question-keys') || '[]'); if (keys.includes(M.q.tu)) { toast('This question is already reported.'); return } const note = await askText('Report this question', 'Describe the issue (incorrect answer, typo, ambiguity, difficulty, etc.).'); if (note === null) return; const rec = M.game.qs[M.game.qs.length - 1]; let reversed = 0; if (rec && rec.tu === M.q.tu && rec.rated && !rec.reported) { reversed = +(rec.e1 - rec.e0).toFixed(3); o.mutate(P => { P.r[rec.sub] = +((P.r[rec.sub] ?? rec.e1) - reversed).toFixed(3); P.n[rec.sub] = Math.max(0, (P.n[rec.sub] || 0) - 1); P.st.tu = Math.max(0, P.st.tu - 1); P.st.tm = Math.max(0, P.st.tm - (rec.speed || 0)); if (rec.ok) P.st.ok = Math.max(0, P.st.ok - 1); if (rec.neg) P.st.neg = Math.max(0, P.st.neg - 1); const tk = rec.sub + ':' + rec.topic, tp = P.t[tk]; if (tp) { tp.a = Math.max(0, tp.a - 1); if (rec.ok) tp.c = Math.max(0, tp.c - 1); if (!tp.a) delete P.t[tk] } }); rec.reported = true; rec.rated = false; M.persist(); updateGame(user || '', M.game); } reports.push({question: M.q.tu, answer: M.q.ans, source: M.q.pk || M.q.src || '', sub: M.q.sub, difficulty: M.q.d, at: Date.now(), note, gameId: M.game.id, ratingReversed: reversed}); keys.push(M.q.tu); localStorage.setItem('bl-question-reports', JSON.stringify(reports)); localStorage.setItem('bl-reported-question-keys', JSON.stringify(keys)); toast(reversed ? `Question reported; rating change of ${reversed >= 0 ? '+' : ''}${reversed.toFixed(3)} reversed.` : 'Question reported and excluded from future rating updates on this browser.') }}>Report this question</button>}{v.ex && <div className="card ex"><Tex s={v.ex} auto /></div>}</div></div>
  </>
}

function Profile_({ P, exit, weak }: { P: Profile; exit: () => void; weak: () => void }) {
  const [ex, setEx] = useState(''), t = tops(P), st = P.st
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>{P.name || 'Your'} profile</h1>
    <div className="card"><div>{store.subjects().map(s => <span key={s}>{subName(s)} <b>{(P.r[s] ?? 5).toFixed(3)}</b> ({P.n[s] || 0} rated) · </span>)}</div>
      <div className="mu">{st.tu} toss-ups · {st.tu ? Math.round(st.ok / st.tu * 100) : 0}% correct · {st.neg} negs · avg speed score {(st.tu ? st.tm / st.tu : 0).toFixed(2)}</div></div>
    <h2>Topics (weakest first)</h2><div className="card">{t.length ? t.map(x => <div className="tb" key={x.k}><span style={{ width: '45%' }}>{x.k.replace(':', ' · ')}</span><i style={{ width: Math.round(x.r * 40) + '%' }} /><span className="mu">{x.c}/{x.a}</span></div>) : <span className="mu">Answer a few questions per topic to see strengths and weaknesses.</span>}</div>
    <div className="row"><button className="p" onClick={async () => { setEx('Analyzing…'); try { await coach(`You coach a high-school Science Bowl player. Given their data, summarize strengths and weaknesses by topic, spot patterns (e.g. negging too much, slow buzzes), and give a concrete 3-step study plan. Under 220 words, plain text.\nRatings (0-10): ${JSON.stringify(P.r)}\nOverall: ${JSON.stringify(P.st)}\nTopics (a=attempts,c=correct): ${JSON.stringify(P.t)}`, setEx) } catch { setEx('AI analysis unavailable.') } }}>AI analysis</button><button onClick={weak}>Practice my weakest topic</button></div>
    {ex && <div className="card ex">{ex}</div>}</>
}

function Upload({ exit }: { exit: () => void }) {
  const [ok, setOk] = useState(isMod()), [subs, setSubs] = useState(store.subjects()), [paste, setPaste] = useState(''), [log, setLog] = useState(''), [par, setPar] = useState(getScanPar()), [note, setNote] = useState(''), [nq, setNq] = useState(''), [, tick] = useState(0)
  const job = useSyncExternalStore(jobSub, jobGet), rr = useSyncExternalStore(rjSub, rjGet)
  useEffect(() => { if (isMod()) return; askText('Moderator access', 'Enter the moderator code word.', 'password').then(w => { if ((w || '').trim().toLowerCase() === 'potato') { setMod(true); setOk(true) } else tell('Access denied', 'That code word is not correct.').then(exit) }) }, [])
  if (!ok) return null
  const bank = store.bank(), unpub = store.localBank().length, rated = bank.filter(q => q.dr).length
  const toggle = (s: string) => { const n = subs.includes(s) ? subs.filter(x => x !== s) : [...subs, s]; if (!n.length) return; setSubs(n); store.setSubjects(n) }
  /** Picking files starts the scan right away: files are opened one by one in the background, so hundreds can be queued at once. */
  const load = (fl: FileList | null, el: HTMLInputElement) => {
    const fs = [...(fl || [])].filter(f => /\.(pdf|txt|md|csv|tsv|json)$/i.test(f.name) && !/^\./.test(f.name)); el.value = ''
    if (!fs.length) return setLog('No supported files found (PDF, TXT, MD, CSV, JSON).')
    startScan(fs.map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), read: () => /\.pdf$/i.test(f.name) ? pdfText(f) : f.text(), note: note.trim() || undefined })))
    setLog(`${fs.length} file(s) added to the scan. Files that were already scanned are skipped. You can leave this screen; progress shows at the top of every page.`)
  }
  const go = () => { if (startScan([{ name: 'pasted-' + new Date().toISOString().slice(0, 10), read: async () => paste, note: note.trim() || undefined }])) { setPaste(''); setLog('Pasted text added to the scan.') } }
  const ICON: Record<string, string> = { queued: '🕑', reading: '📖', scanning: '⏳', done: '✅', partial: '⚠️', failed: '❌', skipped: '⏭️', stopped: '⏹️' }
  const LAB: Record<string, string> = { queued: 'waiting in line', reading: 'opening file', scanning: 'scanning', done: 'scanned', partial: 'scanned, but some parts failed', failed: 'failed', skipped: 'already scanned (skipped)', stopped: 'stopped' }
  const RANK: Record<string, number> = { scanning: 0, reading: 1, queued: 2, failed: 3, partial: 3, stopped: 4, done: 5, skipped: 6 }
  const cnt = (...s: string[]) => job.rows.filter(r => s.includes(r.state)).length
  /** One card of the moderator grid: numbered badge, title, one-line summary, then the body; the footer (buttons) always sits at the bottom so paired cards line up. */
  const M = (n: string, title: string, sub: ReactNode, body: ReactNode, foot?: ReactNode, wide = false) => <section className={'card mcard' + (wide ? ' wide' : '')}><div className="mhead"><span className="mnum">{n}</span><div><h3>{title}</h3><span className="mu">{sub}</span></div></div>{body}{foot ? <div className="mfoot">{foot}</div> : null}</section>
  const progress = job.rows.length > 0 && M('↻', 'Scan progress', `${job.rows.length} file(s) · ${job.added} questions found${job.running ? '' : ' · scan finished'}`, <>
    <div className="mu" style={{ marginBottom: 8 }}>✅ {cnt('done')} scanned · ⏳ {cnt('reading', 'scanning')} in progress · 🕑 {cnt('queued')} waiting · ⚠️ {cnt('partial', 'failed')} with problems · ⏭️ {cnt('skipped')} skipped</div>
    <div className="bar"><i style={{ width: (job.total ? Math.round(job.done / job.total * 100) : 0) + '%' }} /></div>
    <div className="scroll" style={{ marginTop: 10 }}>{[...job.rows].sort((a, b) => RANK[a.state] - RANK[b.state]).map(r => <div key={r.name} style={{ margin: '6px 0', fontSize: 14 }}>
      <div>{ICON[r.state]} <b>{r.name}</b> <span className="mu">— {LAB[r.state]}{r.parts ? ` · part ${r.partsDone}/${r.parts}` : ''}{r.added ? ` · ${r.added} questions` : ''}{r.badParts ? ` · ${r.badParts} failed part(s)` : ''}{r.note ? ` · ${r.note}` : ''}</span></div>
      {r.state === 'scanning' && r.parts > 0 && <div className="bar" style={{ height: 4 }}><i style={{ height: 4, width: Math.round(r.partsDone / r.parts * 100) + '%' }} /></div>}</div>)}</div></>, undefined, true)
  const failedCard = (job.bad.length > 0 || job.failed > 0) && M('!', 'Parts that still fail', job.bad.length > 0 ? 'These parts failed 3 times in a row (AI errors or rate limits). Retrying runs only these parts.' : `${job.failed} file(s) could not be opened or had no readable text (shown with ❌ above). Re-pick them to try again.`,
    job.bad.length > 0 ? <><div className="scroll" style={{ maxHeight: 180, fontSize: 14 }}>{job.bad.map((b, i) => <div key={i}>❌ {b.file} — part {b.part} of {b.of} <span className="mu">({b.err})</span></div>)}</div>
      <div className="mu" style={{ marginTop: 8 }}>If you reload the page this list is forgotten. Re-pick the same files and any file with failures is scanned again; files that fully succeeded are skipped.</div></> : null,
    job.bad.length > 0 ? <button className="p" onClick={() => retryFailed()}>Retry {job.bad.length} failed part(s)</button> : undefined, true)
  const exp = (onlyNew: boolean) => {
    const qs = (onlyNew ? store.localBank() : store.all()).map(q => q.dr ? q : (({ d, dr, ...r }) => r as typeof q)(q)), used = new Set(qs.map(q => q.pk)), all = store.notes()
    const out = { subjects: subs, notes: Object.fromEntries(Object.entries(all).filter(([k]) => used.has(k))), meta: Object.fromEntries(Object.entries(store.meta()).filter(([k]) => used.has(k))), qs }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = onlyNew ? `packets-${new Date().toISOString().slice(0, 10)}.json` : 'bank.json'; a.click()
  }
  const clear = async () => {
    if (!unpub) return void tell('Nothing to clear', 'There are no unpublished packets in this browser.')
    if (await confirmBox('Clear all unpublished packets?', `This permanently deletes ${unpub.toLocaleString()} scanned questions that are saved only in this browser. Packets published as .json files in the public folder are not touched.`, 'Delete them')) { store.clearLocal(); tick(x => x + 1); toast('Unpublished packets cleared.') }
  }
  const pks = [...new Set(bank.map(q => q.pk).filter(Boolean) as string[])].filter(p => !nq || p.toLowerCase().includes(nq.toLowerCase())).sort(), notes = store.notes()
  const buckets = Array.from({ length: 11 }, (_, k) => bank.filter(q => q.dr && Math.round(q.d) === k).length), top = Math.max(1, ...buckets)
  const mean = rated ? bank.filter(q => q.dr).reduce((a, q) => a + q.d, 0) / rated : null
  const stat = (k: string, v: string, note: string) => <div className="card modstat"><span className="lbl">{k}</span><div className="big">{v}</div><div className="mu">{note}</div></div>
  return <><div><button onClick={exit} style={{ flex: 'none' }}>← Home</button></div>
    <div className="modhero"><div><h1>Moderator tools</h1><div className="mu">Choose subjects, scan packets, rate difficulty and publish the question bank for everyone.</div></div>
      <span className="modbadge">Moderator mode on<button onClick={() => { setMod(false); exit() }}>Exit</button></span></div>
    <div className="modstats">{stat('Questions', bank.length.toLocaleString(), `${subs.length} of ${ALL_SUBJECTS.length} subjects on · ${(store.all().length - bank.length).toLocaleString()} miscellaneous (unrated)`)}{stat('Rated', rated.toLocaleString(), `${bank.length ? Math.round(rated / bank.length * 100) : 0}% of the bank`)}{stat('Unpublished', unpub.toLocaleString(), 'saved only in this browser')}{stat('Mean difficulty', mean === null ? '–' : mean.toFixed(3), 'across rated questions')}</div>
    <div className="modgrid">
      {M('01', 'Subjects you can use', 'Everyone else only gets Math and Physics. Each enabled subject gets its own rating and placement test.',
        <div>{ALL_SUBJECTS.map(([k, n]) => <label key={k} className="chk"><input type="checkbox" checked={subs.includes(k)} onChange={() => toggle(k)} />{n}<span className="mu">{bank.filter(q => q.sub === k).length.toLocaleString()} questions</span></label>)}</div>)}
      {M('02', 'Publish packets', 'Share the questions you scanned with everyone who opens the site.',
        <>{store.full() && <div className="no" style={{ border: 0, margin: '0 0 8px' }}>⚠ Browser storage is full: download your packets now, or they disappear when you close the tab.</div>}
          <ol className="mu">
            <li>Click <b>Download new packets</b> (only what isn’t published yet) or <b>Download everything</b>.</li>
            <li>On github.com open your repository, then the <b>public</b> folder. If there isn’t one: <b>Add file → Create new file</b>, type <code>public/readme.txt</code> and commit.</li>
            <li>Click <b>Add file → Upload files</b> and drag in the <code>.json</code> file(s). <b>Every readable .json question file in <code>public</code> is loaded automatically</b>, so you can add as many as you like. Click <b>Commit changes</b>.</li>
            <li>Wait about a minute for the green check under the <b>Actions</b> tab, then reload the site.</li></ol></>,
        <div className="row"><button className="p" disabled={!unpub} onClick={() => exp(true)}>Download new packets ({unpub.toLocaleString()})</button><button onClick={() => exp(false)}>Download everything ({bank.length.toLocaleString()})</button></div>)}
      {M('03', 'Scan packets', 'Pick files or a whole folder: scanning starts at once and runs in the background. PDF, TXT, MD, CSV and JSON work.',
        <>
          <label className="mu" style={{ display: 'block' }}>Note for the scanner (optional, saved with every packet you add next)<textarea rows={3} placeholder="Where these packets are from and how to read them, e.g. “NSB 2019 Regionals. Questions are labelled TOSS-UP and BONUS. Answers follow ANSWER:.”" style={{ width: '100%', boxSizing: 'border-box', marginTop: 4 }} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className="row" style={{ margin: '10px 0' }}><label className="mu">Files<input type="file" multiple accept=".pdf,.txt,.md,.csv,.tsv,.json" style={{ width: '100%', boxSizing: 'border-box' }} onChange={e => load(e.target.files, e.target)} /></label>
            <label className="mu">A whole folder<input type="file" multiple style={{ width: '100%', boxSizing: 'border-box' }} {...({ webkitdirectory: '' } as any)} onChange={e => load(e.target.files, e.target)} /></label></div>
          <label className="mu" style={{ display: 'block' }}>Speed: AI requests at once <select value={par} onChange={e => { setPar(+e.target.value); setScanPar(+e.target.value) }}>{[4, 6, 10, 16, 24].map(n => <option key={n}>{n}</option>)}</select> <span>(higher is faster; it slows itself down if the AI starts refusing requests)</span></label>
          <textarea rows={4} placeholder="…or paste packet text here" style={{ width: '100%', boxSizing: 'border-box', marginTop: 10 }} value={paste} onChange={e => setPaste(e.target.value)} /></>,
        <><button className="p" disabled={!paste.trim()} style={{ width: '100%' }} onClick={go}>{job.running ? 'Add pasted text to the queue' : 'Scan pasted text'}</button>{log && <div className="mu" style={{ marginTop: 8 }}>{log}</div>}</>)}
      {M('04', 'Rate question difficulty', 'The AI rates how hard each question is to answer, to the nearest thousandth, and marks the earliest realistic buzz point.',
        <><div className="mu" style={{ marginBottom: 10 }}>{rated.toLocaleString()} of {bank.length.toLocaleString()} questions are rated (0–10: about 2–4 is regionals level, 5 is the nationals bubble, 10 is best in the nation). It works 20 at a time and saves as it goes, so you can stop and continue later. <b>Fix chemistry notation</b> asks the AI whether digits like the 2 in H2O or Ca2+ are subscripts, charges or exponents (outside chemistry, x2 or w2 is always shown as an exponent).</div>
          {rated > 0 && <div className="hist" aria-label="Rated questions per difficulty level">{buckets.map((n, k) => <div className="tb" key={k}><span>{k}</span><div className="bar"><i style={{ width: n ? Math.max(1, Math.round(n / top * 100)) + '%' : 0 }} /></div><span className="mu">{n.toLocaleString()}</span></div>)}</div>}
          {rr.running && <><div className="bar" style={{ margin: '4px 0 8px' }}><i style={{ width: Math.round(rr.done / Math.max(1, rr.total) * 100) + '%' }} /></div><div className="mu">{rr.done.toLocaleString()} of {rr.total.toLocaleString()} checked · {rr.rated.toLocaleString()} rated{rr.failed ? ` · ${rr.failed.toLocaleString()} failed` : ''}{rr.pauseUntil > Date.now() && <> · ⏸ Groq’s rate limit was hit; resuming in <b><Countdown until={rr.pauseUntil} /></b></>}</div></>}
          {rr.msg && !rr.running && <div className="mu">{rr.msg}</div>}</>,
        <>{rr.running ? <button onClick={stopRerate} style={{ width: '100%' }}>Stop</button>
          : <div className="row"><button className="p" disabled={rated >= bank.length} onClick={() => startRerate('unrated')}>Rate the {(bank.length - rated).toLocaleString()} unrated</button><button className="no" onClick={async () => { if (await confirmBox('Delete all saved ratings?', 'This permanently clears every AI difficulty rating and buzz-point marking saved in this browser. Your question bank and player ratings are not deleted.', 'Delete all ratings')) { store.clearRates(); tick(x => x + 1); toast('All browser-saved question ratings deleted.') } }}>Delete all saved ratings</button><button disabled={!bank.some(q => !q.eb)} onClick={() => startRerate('eb')}>Mark buzz points ({bank.filter(q => !q.eb).length.toLocaleString()})</button><button disabled={!bank.some(chemTodo)} onClick={() => startRerate('chem')}>Fix chemistry notation ({bank.filter(chemTodo).length.toLocaleString()})</button></div>}
          <div className="mu" style={{ marginTop: 8 }}>Ratings are saved in this browser. To give them to everyone, use <b>Download everything</b> and upload that file to <code>public</code>.</div></>)}
      {progress}{failedCard}
      {M('05', 'Files in the public folder', 'Every readable .json question file in public/ is loaded automatically. Files the site couldn’t read are listed here.',
        <div className="scroll">{loadReport().length ? loadReport().map(x => <div key={x.file} style={{ fontSize: 14, margin: '4px 0' }}>{x.ok ? '✅' : '❌'} {x.file} <span className="mu">— {x.msg}</span></div>) : <div className="mu">None loaded.</div>}</div>)}
      {M('06', 'Clear unpublished packets', `Removes every packet scanned in this browser that isn’t published as a .json file yet (${unpub.toLocaleString()} questions). Published packets in the public folder are never touched.`, null,
        <button className="no" style={{ width: '100%' }} onClick={clear}>Clear unpublished packets…</button>)}
      {M('07', 'Edit database titles', <>Change the source, year, set or round shown for a packet. Edits apply at once in this browser; use <b>Download everything</b> to show them to everyone.</>, <MetaEditor />)}
      {M('08', 'Reported questions', 'Reports can be collected from players by exporting this JSON and importing it into a moderator browser. (This is portable, but not a central server inbox.)', <div><div className="row"><button onClick={()=>{const data=localStorage.getItem('bl-question-reports')||'[]';const blob=new Blob([data],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='science-bowl-question-reports.json';a.click();URL.revokeObjectURL(a.href)}}>Export reports</button><label className="button"><input type="file" accept=".json,application/json" style={{maxWidth:220}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;f.text().then(t=>{const incoming=JSON.parse(t);if(!Array.isArray(incoming))throw new Error('Expected a reports array');const existing=JSON.parse(localStorage.getItem('bl-question-reports')||'[]');localStorage.setItem('bl-question-reports',JSON.stringify([...existing,...incoming]));const keys=JSON.parse(localStorage.getItem('bl-reported-question-keys')||'[]');for(const r of incoming)if(r.question&&!keys.includes(r.question))keys.push(r.question);localStorage.setItem('bl-reported-question-keys',JSON.stringify(keys));tick(x=>x+1);toast('Imported reports and excluded reported questions from future rating updates in this browser.')}).catch(()=>toast('Could not import report file.'))}}/>Import reports</label></div>{(JSON.parse(localStorage.getItem('bl-question-reports') || '[]') as any[]).map((r,i)=><div className="card" key={i}><b>{r.sub} · {r.source}</b><div><Tex s={r.question}/></div><div className="mu">Answer: {r.answer} · {r.difficulty}</div><div className="mu">{r.note||'Player report'} · {new Date(r.at||0).toLocaleString()}</div><button onClick={()=>{const a=JSON.parse(localStorage.getItem('bl-question-reports')||'[]');const removed=a.splice(i,1)[0];localStorage.setItem('bl-question-reports',JSON.stringify(a));if(removed?.question){const keys=JSON.parse(localStorage.getItem('bl-reported-question-keys')||'[]').filter((k:string)=>k!==removed.question);localStorage.setItem('bl-reported-question-keys',JSON.stringify(keys))}tick(x=>x+1)}}>Dismiss report</button></div>)}</div>)}
      {M('09', 'Packet notes', 'Write where a packet is from and how to read it. The note is saved with the packet, shown in the Question database, and given to the AI whenever that packet is scanned.',
        <><input placeholder="Search packets" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} value={nq} onChange={e => setNq(e.target.value)} />
          <div className="scroll" style={{ maxHeight: 420 }}>{pks.slice(0, 40).map(p => <div key={p} style={{ margin: '8px 0' }}><div style={{ fontSize: 14 }}><b>{p}</b></div><textarea key={p + (notes[p] || '')} defaultValue={notes[p] || ''} rows={2} placeholder="Note…" style={{ width: '100%', boxSizing: 'border-box' }} onBlur={e => { if (e.target.value.trim() !== (notes[p] || '').trim()) { store.setNote(p, e.target.value); tick(x => x + 1) } }} /></div>)}{pks.length > 40 && <div className="mu">Showing 40 of {pks.length}. Search to narrow the list.</div>}</div></>)}
    </div></>
}

function Account({ exit, done }: { exit: () => void; done: (name: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'), [u, setU] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return
    if (mode === 'register' && pw !== pw2) return setErr('The two passwords don’t match.')
    setBusy(true); setErr('')
    try { await done(await signIn(mode, u, pw)) } catch (x: any) { setErr(x.message); setBusy(false) }
  }
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
    <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
      <div className="mu">An account saves your ratings and stats so they follow you to any device, and lets you add friends.</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <input placeholder="Username" autoComplete="username" autoCapitalize="none" maxLength={20} value={u} onChange={e => setU(e.target.value)} />
        <input type="password" placeholder="Password (8+ characters)" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={e => setPw(e.target.value)} />
        {mode === 'register' && <input type="password" placeholder="Repeat password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />}
        <button className="p" type="submit" disabled={busy || !u || !pw}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <div className="no" style={{ minHeight: 20, border: 0, fontSize: 14 }} role="alert">{err}</div>
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr('') }}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</button></div>
      <div className="mu" style={{ marginTop: 8 }}>Usernames are 3–20 letters, numbers or underscores. There’s no password recovery, so choose one you’ll remember.</div></form></>
}

function Friends({ soc, reload, exit, join }: { soc: Social | null; reload: () => void; exit: () => void; join: (room: string) => void }) {
  const [to, setTo] = useState(''), [msg, setMsg] = useState(''), [sure, setSure] = useState('')
  const act = async (a: 'request' | 'accept' | 'decline' | 'remove', who: string) => { setMsg(''); try { const r: any = await friendAction(a, who); if (a === 'request') { setTo(''); setMsg(r.accepted ? `You and @${who} are now friends.` : `Request sent to @${who}.`) } } catch (e: any) { setMsg(e.message) } setSure(''); reload() }
  useEffect(() => { reload() }, [])
  const sum = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${short(k)} ${(+v).toFixed(3)}`).join(' · ')
  return <><div className="row"><button onClick={exit}>← Home</button></div><h1>Friends</h1>
    <div className="home"><div>
      <div className="card"><b>Add a friend</b><form className="row" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); if (to.trim()) act('request', to.trim().toLowerCase()) }}><input placeholder="Their username" autoCapitalize="none" value={to} onChange={e => setTo(e.target.value)} style={{ flex: 3 }} /><button className="p" type="submit">Send request</button></form>
        {msg && <div className="mu" style={{ marginTop: 6 }}>{msg}</div>}</div>
      {soc && soc.invites.length > 0 && <div className="card"><b>Game invites</b>{soc.invites.map(i => <div className="row" key={i.id} style={{ margin: '6px 0' }}><span>@{i.frm} · room <b>{i.room}</b></span><button className="p" onClick={() => { dismissInvite(i.id); join(i.room) }}>Join</button><button onClick={() => dismissInvite(i.id).then(reload)}>Dismiss</button></div>)}</div>}
      {soc && soc.incoming.length > 0 && <div className="card"><b>Friend requests</b>{soc.incoming.map(n => <div className="row" key={n} style={{ margin: '6px 0' }}><span>@{n}</span><button className="p" onClick={() => act('accept', n)}>Accept</button><button onClick={() => act('decline', n)}>Decline</button></div>)}</div>}
      {soc && soc.outgoing.length > 0 && <div className="card"><b>Waiting for a reply</b>{soc.outgoing.map(n => <div className="row" key={n} style={{ margin: '6px 0' }}><span>@{n}</span><button onClick={() => act('remove', n)}>Cancel</button></div>)}</div>}
    </div><div>
      <div className="card"><b>Your friends{soc ? ` (${soc.friends.length})` : ''}</b>
        {!soc ? <div className="mu">Loading…</div> : !soc.friends.length ? <div className="mu" style={{ marginTop: 6 }}>No friends yet. Send a request with their username.</div> : soc.friends.map(f => <div key={f.name} className="row" style={{ margin: '8px 0' }}>
          <div style={{ flex: 3 }}><span style={{ color: f.online ? 'var(--ok)' : 'var(--mu)' }}>●</span> <b>@{f.name}</b><div className="mu">{f.online ? 'online' : 'offline'}{Object.keys(f.r).length ? ' · ' + sum(f.r) : ''}</div></div>
          <button onClick={() => sure === f.name ? act('remove', f.name) : setSure(f.name)}>{sure === f.name ? 'Sure?' : 'Remove'}</button></div>)}
        <div className="mu" style={{ marginTop: 8 }}>To play together, start a Team game and use <b>Invite friends</b> in the lobby. Friends who are online get an invite on their home screen.</div></div>
    </div></div></>
}
