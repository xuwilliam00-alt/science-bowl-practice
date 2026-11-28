import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_SEEDS, THEMES, aiGet, aiSub, contrast, customGet, deriveVars, keyHint, registerKey, resolveMode, saveCustom, saveTheme, testAI, themeGet, themeSub, usesProxy, type CustomTheme, type Mode, type Seed } from './platform'
import { askText, confirmBox, tell } from './dialog'
import { memesOn, setMemes } from './memes'
import { subName, type Profile } from './types'

const short = (s: string) => subName(s).replace('Chemistry', 'Chem').replace('Earth & Space', 'Earth')
export const useTheme = () => useSyncExternalStore(themeSub, themeGet)
const useCustom = () => useSyncExternalStore(themeSub, customGet)
const MAX_CUSTOM = 12

const PATHS: Record<string, JSX.Element> = {
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" />,
  auto: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>,
}
export const Icon = ({ n }: { n: 'gear' | 'sun' | 'moon' | 'auto' }) => <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[n]}</svg>

/** Header button: flips between light and dark in one click. */
export function ModeToggle() {
  const t = useTheme(), m = resolveMode(t), next = m === 'dark' ? 'light' : 'dark'
  return <button className="ibtn sq" title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`} onClick={() => saveTheme({ ...t, mode: next })}><Icon n={m === 'dark' ? 'sun' : 'moon'} /></button>
}

/** Both versions of a theme side by side (left light, right dark). Built-in themes are drawn by design.css; ones the user added carry their colors inline. */
function Swatch({ id, size = 'sm' }: { id: string; size?: 'sm' | 'lg' }) {
  const c = useCustom().find(x => x.id === id)
  return <div className={'sw ' + size} aria-hidden="true">{(['light', 'dark'] as const).map(m => c ? <span key={m} data-mode={m} style={deriveVars(c[m], m === 'dark') as any} /> : <span key={m} data-theme={id} data-mode={m} />)}</div>
}

/** Shows whether AI is connected, lets you enter/replace the Groq key, and verifies it with a live test. */
export function AiStatusCard() {
  const s = useSyncExternalStore(aiSub, aiGet), [busy, setBusy] = useState(false), hint = keyHint()
  const check = async () => { setBusy(true); const r = await testAI(); setBusy(false); tell(r.ok ? '✓ AI connection works' : '✗ AI connection problem', r.msg) }
  const enter = async () => {
    const k = await askText('Groq API key', 'Paste your key from console.groq.com. It is stored only in this browser.', 'password'); if (!k) return
    setBusy(true); const r = await registerKey(k); setBusy(false); tell(r.ok ? '✓ Key saved and verified' : '✗ Key not accepted', r.ok ? r.msg : r.msg + ' The key was not saved.')
  }
  const badge = s.state === 'ok' ? '✅ Connected' : s.state === 'bad' ? '❌ Not working' : s.state === 'checking' ? '⏳ Checking…' : '⚪ Not checked yet'
  return <div><div><b>{badge}</b></div>
    <div className="mu" style={{ marginTop: 2 }}>{s.msg || (usesProxy ? 'Uses the AI server. Press “Check connection” to test it.' : hint ? `A Groq key (${hint}) is saved in this browser. Press “Check connection” to verify it.` : 'No Groq key saved yet.')}{s.at ? ` · last checked ${new Date(s.at).toLocaleTimeString()}` : ''}</div>
    <div className="row" style={{ marginTop: 10 }}>{!usesProxy && <button disabled={busy} onClick={enter}>{hint ? 'Replace Groq key' : 'Enter Groq key'}</button>}<button disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check connection'}</button></div></div>
}

/** Pick a built-in theme or one you added, or make a new one. */
function Themes() {
  const t = useTheme(), cs = useCustom(), [edit, setEdit] = useState<CustomTheme | 'new' | null>(null)
  if (edit) return <Editor start={edit === 'new' ? null : edit} done={() => setEdit(null)} />
  const pick = (pal: string) => saveTheme({ ...t, pal })
  const del = async (c: CustomTheme) => { if (await confirmBox(`Delete “${c.name}”?`, 'This removes the theme from this browser.', 'Delete')) saveCustom(cs.filter(x => x.id !== c.id)) }
  return <>
    <div className="mu">Every theme has a light and a dark version, so it follows the mode you choose in Settings. Pick one, or add your own.</div>
    <div className="tgrid">
      {THEMES.map(([id, name, note]) => <button key={id} className="tcard" aria-pressed={t.pal === id} onClick={() => pick(id)}><Swatch id={id} size="lg" /><span><b>{name}{t.pal === id ? ' ✓' : ''}</b><span className="mu" style={{ display: 'block' }}>{note}</span></span></button>)}
      {cs.map(c => <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="tcard" aria-pressed={t.pal === c.id} onClick={() => pick(c.id)}><Swatch id={c.id} size="lg" /><span><b>{c.name}{t.pal === c.id ? ' ✓' : ''}</b><span className="mu" style={{ display: 'block' }}>Your theme</span></span></button>
        <div className="tacts"><button onClick={() => setEdit(c)}>Edit</button><button className="no" onClick={() => del(c)}>Delete</button></div></div>)}
      {cs.length < MAX_CUSTOM && <button className="tcard add" onClick={() => setEdit('new')}><span className="plus">＋</span><b>Add theme</b><span className="mu">Choose your own colors</span></button>}
    </div></>
}

const SEED_FIELDS: [keyof Seed, string][] = [['bg', 'Paper'], ['tx', 'Ink'], ['ac', 'Accent']]
function Editor({ start, done }: { start: CustomTheme | null; done: () => void }) {
  const t = useTheme(), cs = useCustom()
  const [name, setName] = useState(start?.name || ''), [light, setLight] = useState<Seed>(start?.light || DEFAULT_SEEDS.light), [dk, setDk] = useState<Seed>(start?.dark || DEFAULT_SEEDS.dark)
  const save = () => {
    const nm = name.trim().slice(0, 24) || 'My theme', id = start?.id || 'c-' + Date.now().toString(36), c: CustomTheme = { id, name: nm, light, dark: dk }
    saveCustom(start ? cs.map(x => x.id === id ? c : x) : [...cs, c]); saveTheme({ ...t, pal: id }); done()
  }
  const side = (label: string, s: Seed, set: (s: Seed) => void, isDark: boolean) => {
    const low = contrast(s.tx, s.bg) < 4.5, faint = contrast(s.ac, s.bg) < 2.2
    return <fieldset><legend>{label}</legend>
      {SEED_FIELDS.map(([k, l]) => <label key={k}>{l}<input type="color" value={s[k]} onChange={e => set({ ...s, [k]: e.target.value })} /></label>)}
      <div className="cwarn" role="status">{low ? 'Ink and paper are close in brightness, so text may be hard to read.' : faint ? 'The accent is hard to see against the paper.' : ''}</div>
      <div className="pv" style={deriveVars(s, isDark) as any}><div className="pc"><small>Toss-up</small><div>Which element has the highest electronegativity?</div></div><span className="pb">BUZZ</span></div></fieldset>
  }
  return <>
    <label className="fld" style={{ marginTop: 0 }}><span className="mu">Theme name</span><input style={{ width: '100%', boxSizing: 'border-box' }} maxLength={24} placeholder="My theme" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
    <div className="mu" style={{ margin: '10px 0' }}>Pick three colors for light mode and three for dark mode. Everything else (cards, borders, buttons, text shades) is worked out from them.</div>
    <div className="colors">{side('Light mode', light, setLight, false)}{side('Dark mode', dk, setDk, true)}</div>
    <div className="row" style={{ marginTop: 14 }}><button onClick={done}>Cancel</button><button className="p" onClick={save}>{start ? 'Save changes' : 'Add theme'}</button></div></>
}

/** The Settings sheet: practice, bot, appearance and AI connection in one place. */
export function Settings({ P, mutate, placed, close }: { P: Profile; mutate: (f: (P: Profile) => void) => void; placed: string[]; close: () => void }) {
  const t = useTheme(), cs = useCustom(), [view, setView] = useState<'main' | 'themes'>('main'), [memes, setMemesS] = useState(memesOn())
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') view === 'themes' ? setView('main') : close() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [view])
  const set = (k: string, v: any) => mutate(c => { (c.p as any)[k] = v })
  const themeName = THEMES.find(x => x[0] === t.pal)?.[1] || cs.find(c => c.id === t.pal)?.name || 'Parchment'
  const modes: [Mode, string, 'auto' | 'sun' | 'moon'][] = [['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]
  const opt = (v: string, l: string) => <option key={v} value={v}>{l}</option>
  return <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label={view === 'main' ? 'Settings' : 'Themes'}>
      <header>{view === 'themes' && <button className="ibtn" onClick={() => setView('main')}>← Back</button>}<h2>{view === 'main' ? 'Settings' : 'Themes'}</h2><button onClick={close}>Done</button></header>
      <div className="body">{view === 'themes' ? <Themes /> : <>
        <div className="sec"><span className="mu lbl">Practice</span>
          <label className="mu">Reading speed: <b>{P.p.wpm}</b> words/min</label>
          <input type="range" min={80} max={320} step={10} value={P.p.wpm} style={{ width: '100%', padding: 0 }} onChange={e => set('wpm', +e.target.value)} />
          <label className="fld"><span className="mu">Question source</span><select style={{ width: '100%' }} value={P.p.src} onChange={e => set('src', e.target.value)}>{[opt('ai', 'AI questions'), opt('bank', 'Uploaded packets'), opt('both', 'Both')]}</select></label>
          <div className="fld"><span className="mu">Subjects to practice {P.p.subjs.length ? '' : '(all placed subjects)'}</span>
            {placed.length ? placed.map(s => <label key={s} className="chk"><input type="checkbox" checked={P.p.subjs.includes(s)} onChange={() => set('subjs', P.p.subjs.includes(s) ? P.p.subjs.filter(x => x !== s) : [...P.p.subjs, s])} />{subName(s)}</label>) : <div className="mu">Take a placement test first.</div>}</div></div>
        <div className="sec"><span className="mu lbl">Bot opponent</span>
          <select style={{ width: '100%' }} value={P.p.bot} onChange={e => set('bot', e.target.value)}>{[opt('easy', 'Regionals (3.000)'), opt('medium', 'Nationals bubble (5.000)'), opt('hard', 'Elite nationals (8.000)'), opt('top', 'Best in nation (10.000)'), opt('match', 'Matches my rating'), opt('custom', 'Custom rating')]}</select>
          {P.p.bot === 'custom' && (placed.length ? placed.map(s => <label key={s} className="mu" style={{ display: 'block', marginTop: 8 }}>{short(s)} bot rating: <b>{(P.p.botElo[s] ?? 5).toFixed(3)}</b><input type="range" min={0} max={10} step={.001} value={P.p.botElo[s] ?? 5} style={{ width: '100%', padding: 0 }} onChange={e => mutate(c => { c.p.botElo = { ...c.p.botElo, [s]: +(+e.target.value).toFixed(3) } })} /></label>) : <div className="mu" style={{ marginTop: 8 }}>Take a placement test first.</div>)}</div>
        <div className="sec"><span className="mu lbl">Appearance</span>
          <div className="seg" role="group" aria-label="Light or dark mode">{modes.map(([m, l, ic]) => <button key={m} aria-pressed={t.mode === m} onClick={() => saveTheme({ ...t, mode: m })}><Icon n={ic} />{l}</button>)}</div>
          <div className="mu" style={{ margin: '6px 0 10px' }}>{t.mode === 'auto' ? 'Auto follows your device’s light or dark setting.' : `Always ${t.mode}.`}</div>
          <button className="rowbtn" onClick={() => setView('themes')}><Swatch id={t.pal} /><span className="grow"><b>Theme</b><span className="mu">{themeName}</span></span><span className="mu">Change or add</span><span className="chev" aria-hidden="true">›</span></button>
          <label className="chk" style={{ marginTop: 12 }}><input type="checkbox" checked={memes} onChange={e => { setMemesS(e.target.checked); setMemes(e.target.checked) }} />Show memes (neg and fast-buzz reactions)</label></div>
        <div className="sec"><span className="mu lbl">AI connection</span><AiStatusCard /></div></>}</div></div></div>
}
