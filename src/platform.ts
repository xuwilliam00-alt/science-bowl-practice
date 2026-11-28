import type { Profile, Question } from './types'
import { askText, toast } from './dialog'
import { qkey, qMeta, sanitizeQ, type Meta } from './read'
import { ALL_SUBJECTS, isMisc } from './types'
const mem: Record<string, string> = {}
export const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return mem[k] ?? null } }
export const lsSet = (k: string, v: string) => { mem[k] = v; try { localStorage.setItem(k, v) } catch { /* blocked (e.g. some iframes) */ } }
const rd = (k: string) => { try { return JSON.parse(lsGet(k) || 'null') } catch { return null } }
const wr = (k: string, v: unknown) => lsSet(k, JSON.stringify(v))
export const setCode = (c: string) => { mem['bl-code'] = c; try { sessionStorage.setItem('bl-code', c) } catch { /* ignore */ } }
export const getCode = () => { try { const c = sessionStorage.getItem('bl-code'); if (c) return c } catch { /* ignore */ } return mem['bl-code'] ?? null }
const PROXY = import.meta.env.VITE_AI_PROXY_URL as string | undefined
export const usesProxy = !!PROXY
export const API = (PROXY || '').replace(/\/$/, '')
/** The site password the Worker checks on every request. Asked for once per session if the password screen is off. */
export async function verifyAccessCode(code: string): Promise<boolean> {
  if (!API) return false
  const r = await fetch(`${API}/api/verify-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': code },
    body: '{}'
  })
  return r.ok
}
export async function accessCode(): Promise<string> {
  const code = getCode() || await askText('Access password', 'Enter the site password.', 'password') || ''
  if (!code) throw new Error('no password'); setCode(code); return code
}
// ---- appearance: light / dark mode × theme, plus themes the user adds ----
export type Mode = 'auto' | 'light' | 'dark'
/** `mode` is light, dark, or auto (follows the device). `pal` is a built-in theme id or the id of a theme the user added. */
export interface Theme { v: 2; mode: Mode; pal: string }
export interface Seed { bg: string; tx: string; ac: string }
/** A theme the user made: three colors for light mode and three for dark mode; every other color is worked out from them. */
export interface CustomTheme { id: string; name: string; light: Seed; dark: Seed }
/** Built-in themes. Each has a light and a dark version, drawn in design.css as [data-theme][data-mode]. */
export const THEMES: [string, string, string][] = [['parchment', 'Parchment', 'Warm paper by day, espresso by night'], ['slate-pine', 'Slate pine', 'Sage paper by day, deep pine by night'], ['kyoto-washi', 'Kyoto washi', 'Cool washi by day, indigo by night']]
export const DEFAULT_SEEDS: { light: Seed; dark: Seed } = { light: { bg: '#f6f2e9', tx: '#1d1b18', ac: '#1d4ed8' }, dark: { bg: '#1c1917', tx: '#f5f5f4', ac: '#f59e0b' } }
const CK = 'bl-themes'
let customs: CustomTheme[] = (() => { const a = rd(CK); return Array.isArray(a) ? a.filter((c: any) => c && typeof c.id === 'string' && c.light && c.dark) : [] })()
/** Older saves stored one of four palettes (or "auto"): each maps onto a theme + mode. */
const LEGACY: Record<string, [string, Mode]> = { parchment: ['parchment', 'light'], 'slate-pine': ['slate-pine', 'dark'], 'kyoto-washi': ['kyoto-washi', 'light'], 'espresso-brass': ['parchment', 'dark'], auto: ['parchment', 'auto'] }
const hasPal = (id: string) => THEMES.some(t => t[0] === id) || customs.some(c => c.id === id)
export const loadTheme = (): Theme => {
  const o = rd('bl-theme') || {}
  if (o.v === 2 && ['auto', 'light', 'dark'].includes(o.mode) && hasPal(o.pal)) return { v: 2, mode: o.mode, pal: o.pal }
  if (o.v !== 2 && o.pal && LEGACY[o.pal]) { const [pal, m] = LEGACY[o.pal]; return { v: 2, pal, mode: o.pal === 'auto' ? (o.mode === 'light' || o.mode === 'dark' ? o.mode : 'auto') : m } }
  return { v: 2, mode: 'auto', pal: 'parchment' }
}
const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
export const resolveMode = (t: Theme): 'light' | 'dark' => t.mode === 'auto' ? (dark() ? 'dark' : 'light') : t.mode
// small hex-color helpers, used to work out a whole theme from three colors
const rgb = (h: string): [number, number, number] => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()) || /^#?([0-9a-f]{3})$/i.exec(h.trim()); let x = m ? m[1] : '808080'; if (x.length === 3) x = x.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)) as [number, number, number] }
const hex = (c: number[]) => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)) }
const lum = (h: string) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * r + .7152 * g + .0722 * b }
/** WCAG contrast ratio between two colors (4.5 or more is comfortable for body text). */
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
/** Every CSS color of a theme, worked out from its paper, ink and accent colors. */
export function deriveVars(s: Seed, isDark: boolean): Record<string, string> {
  const { bg, tx, ac } = s, onAc = contrast(ac, '#fcfbf7') >= contrast(ac, '#14110f') ? '#fcfbf7' : '#14110f'
  return {
    '--bg': bg, '--dot': mix(bg, tx, isDark ? .08 : .1), '--sf': mix(bg, isDark ? '#ffffff' : '#ffffff', isDark ? .06 : .6), '--sub': mix(bg, tx, .035), '--sub2': mix(bg, tx, .1),
    '--bd': mix(bg, tx, .18), '--strong': mix(bg, tx, .36), '--shadow': mix(bg, '#000000', isDark ? .5 : .15), '--tx': tx, '--mu': mix(tx, bg, .3), '--mu2': mix(tx, bg, .55),
    '--btn': ac, '--btn-h': mix(ac, isDark ? '#ffffff' : '#000000', .14), '--btn-tx': onAc, '--ac': ac,
    '--ok': isDark ? '#4ade80' : '#15803d', '--bad': isDark ? '#f87171' : '#b91c1c', '--warn': isDark ? '#fbbf24' : '#b45309',
    '--okbg': isDark ? 'rgba(74,222,128,.14)' : '#dcfce7', '--badbg': isDark ? 'rgba(248,113,113,.16)' : '#fee2e2', '--ta': isDark ? '#f87171' : '#b91c1c', '--tb': isDark ? '#60a5fa' : '#1d4ed8',
    '--backdrop': isDark ? 'rgba(8,8,10,.74)' : 'rgba(20,20,24,.5)',
  }
}
let applied: string[] = []
export const applyTheme = (t: Theme) => {
  const e = document.documentElement, m = resolveMode(t), c = customs.find(x => x.id === t.pal)
  applied.forEach(k => e.style.removeProperty(k)); applied = []; e.style.removeProperty('color-scheme')
  e.setAttribute('data-mode', m)
  if (c) { e.setAttribute('data-theme', 'custom'); const v = deriveVars(c[m], m === 'dark'); for (const [k, x] of Object.entries(v)) { e.style.setProperty(k, x); applied.push(k) } e.style.setProperty('color-scheme', m); applied.push('color-scheme') }
  else e.setAttribute('data-theme', t.pal)
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', getComputedStyle(e).getPropertyValue('--bg').trim() || '#f6f2e9')
}
// one tiny store so the header toggle, Settings and the theme picker always agree
let cur: Theme = loadTheme(); const TL = new Set<() => void>(); let osWatch = false
export const themeGet = () => cur
export const customGet = () => customs
export const themeSub = (f: () => void) => { TL.add(f); return () => { TL.delete(f) } }
export const saveTheme = (t: Theme) => { cur = { ...t, v: 2 }; wr('bl-theme', cur); applyTheme(cur); TL.forEach(f => f()) }
export const saveCustom = (list: CustomTheme[]) => { customs = list; wr(CK, list); if (!hasPal(cur.pal)) cur = { ...cur, pal: 'parchment' }; wr('bl-theme', cur); applyTheme(cur); TL.forEach(f => f()) }
/** Starts following the device's light/dark setting while mode is "auto". Call once at start-up. */
export const startTheme = () => { applyTheme(cur); if (!osWatch && typeof matchMedia === 'function') { osWatch = true; matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (cur.mode === 'auto') { applyTheme(cur); TL.forEach(f => f()) } }) } }
export const setKey = (k: string) => lsSet('bl-groq-key', k)
// ---- moderator mode: only moderators can see Biology, Chemistry and Earth & Space (kept for this tab session) ----
const OPEN = ['math', 'physics']
let modOn: boolean | null = null; const modL = new Set<() => void>()
export const isMod = (): boolean => { if (modOn === null) { try { modOn = sessionStorage.getItem('bl-mod') === '1' } catch { modOn = mem['bl-mod'] === '1' } } return modOn }
export const setMod = (on: boolean) => { modOn = on; mem['bl-mod'] = on ? '1' : ''; try { on ? sessionStorage.setItem('bl-mod', '1') : sessionStorage.removeItem('bl-mod') } catch { /* ignore */ } cache = null; modL.forEach(f => f()) }
export const modSub = (f: () => void) => { modL.add(f); return () => { modL.delete(f) } }
/** Moderator-edited source / year / set / round titles per packet. Published ones come from the `meta` of a .json file; this browser's edits win field by field. */
let sharedMeta: Record<string, Partial<Meta>> = {}, metaLoc: Record<string, Partial<Meta>> | null = null
const ML = () => (metaLoc ||= rd('bl-meta') || {})
const metaOf = (pk: string): Partial<Meta> => ({ ...(sharedMeta[pk] || {}), ...(ML()[pk] || {}) })
const withMeta = (q: Question): Question => { const o = metaOf(q.pk || ''); if (!Object.keys(o).length) return q; const m = { ...qMeta(q), ...o }; return { ...q, src: m.src, year: m.year, set: m.set, rnd: m.rnd } }
let shared: { subjects?: string[]; qs: Question[] } = { qs: [] }
export interface LoadReport { file: string; ok: boolean; n: number; msg: string }
let report: LoadReport[] = [], sharedNotes: Record<string, string> = {}
export const loadReport = () => report
/** Loads every .json file in the site's public folder (listed in banks-manifest.json at build time). A file that is unreadable or isn't a question list is skipped and shown in the report. */
export async function loadShared() {
  report = []; const qs: any[] = [], subs = new Set<string>(); sharedNotes = {}; sharedMeta = {}
  let files: string[] = []
  try { const r = await fetch('./banks-manifest.json', { cache: 'no-store' }); if (r.ok) files = (await r.json()).files || [] } catch { /* older deploy: fall back to bank.json */ }
  if (!files.length) files = ['bank.json']
  await Promise.all(files.map(async f => {
    try {
      const r = await fetch('./' + f.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status)
      let j: any; try { j = JSON.parse(await r.text()) } catch { throw new Error('not valid JSON') }
      const arr = Array.isArray(j) ? j : Array.isArray(j?.qs) ? j.qs : Array.isArray(j?.questions) ? j.questions : null
      if (!arr) throw new Error('no question list found (expected an array, {"qs":[…]} or {"questions":[…]})')
      const pk = f.replace(/^.*\//, '').replace(/\.json$/i, ''); let good = 0
      for (const q of arr) { const s = sanitizeQ({ ...q, pk: q?.pk || pk }); if (s) { qs.push(s); good++ } }
      if (!good) throw new Error('0 usable questions out of ' + arr.length)
      if (Array.isArray(j?.subjects)) j.subjects.forEach((x: string) => subs.add(x))
      if (j?.notes && typeof j.notes === 'object') Object.assign(sharedNotes, j.notes)
      if (j?.meta && typeof j.meta === 'object') Object.assign(sharedMeta, j.meta)
      report.push({ file: f, ok: true, n: good, msg: `${good} of ${arr.length} questions usable` })
    } catch (e: any) { report.push({ file: f, ok: false, n: 0, msg: e.message || 'unreadable' }) }
  }))
  report.sort((a, b) => a.file.localeCompare(b.file)); shared = { subjects: subs.size ? [...subs] : undefined, qs }; cache = null
}
const dedupe = (a: Question[]) => { const s = new Set<string>(); return a.filter(q => !s.has(q.sub + q.tu) && s.add(q.sub + q.tu)) }
type Rate = number | { d?: number; eb?: string; m?: boolean }
let pbSrc: Question[] | null = null, pb: Question[] = []
let rates: Record<string, Rate> | null = null, fixes: Record<string, any> | null = null
const FX = () => fixes ||= rd('bl-fixes') || {}
const R = () => rates ||= rd('bl-rates') || {}
let local: Question[] | null = null, wt: any, storageFull = false, cache: Question[] | null = null
const loc = () => (local ||= rd('bl-bank') || [])
/** Scans add thousands of questions, so writes are batched instead of re-saving the whole bank for every part. */
function flushBank() { clearTimeout(wt); if (!local) return; const j = JSON.stringify(local); mem['bl-bank'] = j; try { localStorage.setItem('bl-bank', j); storageFull = false } catch { storageFull = true } }
addEventListener('pagehide', flushBank)
/** Profile + local bank live in this browser. Published bank.json is merged in for everyone. */
export const store = {
  load: (): Profile | null => rd('bl-profile'), save: (p: Profile) => wr('bl-profile', p),
  /** Every question passes through sanitizeQ, so one malformed entry can never break the app. */
  /** Every question, including Miscellaneous ones (for the question database and for publishing). */
  all: (): Question[] => cache ||= dedupe([...(shared.qs || []), ...loc()].map(sanitizeQ).filter(Boolean) as Question[]).filter(q => isMod() || OPEN.includes(q.sub))
    .map(q => { const f = FX()[qkey(q)]; return f && f.tu ? { ...q, k: qkey(q), tu: f.tu, ...(f.eb ? { eb: f.eb } : {}), ...(f.choices ? { choices: f.choices } : {}), ...(f.bn ? { bn: f.bn } : {}), ...(f.bc ? { bc: f.bc } : {}), ...(Array.isArray(f.ax) ? { ax: f.ax } : {}), ...(Array.isArray(f.nx) ? { nx: f.nx } : {}), ...(Array.isArray(f.bx) ? { bx: f.bx } : {}), ...(Array.isArray(f.bnx) ? { bnx: f.bnx } : {}) } : q }) // AI-corrected notation (chemistry)
    .map(q => { const o = R()[qkey(q)]; if (o === undefined) return q; const r = typeof o === 'number' ? { d: o } : o; return { ...q, ...(r.m || isMisc(q) ? { misc: true, dr: false } : r.d !== undefined ? { d: Math.round(Number(r.d) * 10) / 10, dr: true } : {}), ...(r.eb ? { eb: r.eb } : {}) } }).map(withMeta), // AI difficulty ratings (and Miscellaneous flags) are layered on top of every question
  /** The questions that can be played, rated and counted: everything except Miscellaneous. */
  bank: (): Question[] => { const a = store.all(); if (pbSrc !== a) { pbSrc = a; pb = a.filter(q => !isMisc(q)) } return pb },
  /** Saves difficulty ratings ({question id: 0-10}). They survive reloads and apply to published and unpublished questions alike. */
  rate: (m: Record<string, Rate>) => { const cur = R(); for (const [k, v] of Object.entries(m)) { const o = typeof v === 'number' ? { d: v } : v, p = cur[k], po = typeof p === 'number' ? { d: p } : p || {}; cur[k] = { ...po, ...o } } rates = cur; wr('bl-rates', rates); cache = null },
  /** Chemistry notation fixes ({question id: new text}); an empty object marks a question the AI checked and left alone. */
  fixed: (): Record<string, any> => FX(),
  fix: (m: Record<string, any>) => { fixes = { ...FX(), ...m }; wr('bl-fixes', fixes); cache = null },
  clearRates: () => { rates = {}; wr('bl-rates', rates); cache = null },
  /** Only the packets scanned in this browser that are not yet published. */
  localBank: (): Question[] => dedupe(loc().map(sanitizeQ).filter(Boolean) as Question[]).map(withMeta),
  /** Removes every unpublished packet saved in this browser. Published packets (the .json files in public/) are untouched. */
  clearLocal: () => { local = []; cache = null; flushBank(); lsSet('bl-scan-failed', '[]'); const keep = new Set(shared.qs.map(q => q.pk)), n = rd('bl-notes') || {}; for (const k of Object.keys(n)) if (!keep.has(k)) delete n[k]; wr('bl-notes', n) },
  /** Moderator notes about each packet (how to read it, which tournament it is from). */
  notes: (): Record<string, string> => ({ ...sharedNotes, ...(rd('bl-notes') || {}) }),
  setNote: (pk: string, t: string) => { const n = rd('bl-notes') || {}; if (t.trim()) n[pk] = t.trim().slice(0, 1500); else delete n[pk]; wr('bl-notes', n) },
  addBank: (qs: Question[]) => { local = dedupe([...loc(), ...qs]); cache = null; clearTimeout(wt); wt = setTimeout(flushBank, 1500) },
  /** True when the browser refused to save the scanned questions (storage full or blocked). They stay in memory until the tab closes, so download bank.json first. */
  full: () => storageFull,
  /** Subjects this person can use: Math and Physics for everyone; moderators get the others too (they choose which in Moderator tools). */
  subjects: (): string[] => isMod() ? (rd('bl-subjects') || ALL_SUBJECTS.map(x => x[0])).filter((s: string) => ALL_SUBJECTS.some(x => x[0] === s)) : [...OPEN],
  /** Every subject this person is allowed to see (for filters and pickers). */
  allowed: (): [string, string][] => isMod() ? ALL_SUBJECTS : ALL_SUBJECTS.filter(x => OPEN.includes(x[0])),
  /** Edited titles (source / year / set / round) per packet, as shown to everyone once published. */
  meta: (): Record<string, Partial<Meta>> => { const o: Record<string, Partial<Meta>> = {}; for (const k of new Set([...Object.keys(sharedMeta), ...Object.keys(ML())])) o[k] = metaOf(k); return o },
  setMeta: (pk: string, patch: Partial<Meta> | null) => { const m = ML(); if (patch === null) delete m[pk]; else m[pk] = { ...(m[pk] || {}), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 60)])) }; metaLoc = m; wr('bl-meta', m); cache = null },
  /** Renames a source on every packet that has it. */
  renameSource: (from: string, to: string) => { const m = ML(), t = to.trim().slice(0, 60); if (!t) return 0; let n = 0; for (const pk of new Set(store.all().filter(q => qMeta(q).src === from).map(q => q.pk || ''))) { m[pk] = { ...(m[pk] || {}), src: t }; n++ } metaLoc = m; wr('bl-meta', m); cache = null; return n },
  setSubjects: (s: string[]) => wr('bl-subjects', s),
}
export const MODEL = 'openai/gpt-oss-120b' // any chat model id from console.groq.com/docs/models
// ---- AI connection status: updated by every AI call, shown in Settings ----
export interface AiStatus { state: 'unknown' | 'checking' | 'ok' | 'bad'; msg: string; at: number }
let AS: AiStatus = { state: 'unknown', msg: '', at: 0 }
const AL = new Set<() => void>()
const setAs = (state: AiStatus['state'], msg: string) => {
  const was = AS.state; AS = { state, msg, at: Date.now() }; AL.forEach(f => f())
  if (state === 'bad' && was !== 'bad') toast(msg, false); else if (state === 'ok' && was === 'bad') toast('AI connection restored.') // announced once, not per request
}
export const aiGet = () => AS
export const aiSub = (f: () => void) => { AL.add(f); return () => { AL.delete(f) } }
export const keyHint = () => { const k = lsGet('bl-groq-key'); return k ? '••••' + k.slice(-4) : '' }
let asking: Promise<string> | null = null, announce = false
/** Asks for the key once, even if many requests (like a scan) need it at the same moment. */
const getKey = async (): Promise<string> => {
  const k = lsGet('bl-groq-key'); if (k) return k
  asking ||= (async () => { const v = ((await askText('Groq API key', 'Paste your key from console.groq.com. It is stored only in this browser.', 'password')) || '').trim(); asking = null; if (v) { lsSet('bl-groq-key', v); announce = true } return v })()
  return asking
}
/** All AI (question writing, packet filtering, coach) runs on Groq. Key is stored in localStorage; use the Worker proxy for a public site. */
async function groq(prompt: string, json = false, effort: 'low' | 'medium' = 'low', temp?: number): Promise<string> {
  if (PROXY) { // key lives on the server; the access password is checked there
    const code = await accessCode()
    let r: Response; try { r = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': code }, body: JSON.stringify({ prompt, json, effort, temp }) }) } catch { const m = 'Couldn’t reach the AI server. Check your connection and the AI_PROXY_URL setting.'; setAs('bad', m); throw new Error(m) }
    if (!r.ok) {
      if (r.status === 401) setCode('')
      const m = r.status === 401 ? 'The AI server rejected the access password.' : r.status === 403 ? 'This website isn’t on the AI server’s allowed list (ALLOWED_ORIGINS in wrangler.toml).' : r.status === 429 ? 'Groq is rate-limiting requests right now. The key is fine; try again in a moment.' : 'The AI server is running, but Groq refused the request. Re-run “npx wrangler secret put GROQ_API_KEY” with a valid key.'
      setAs(r.status === 429 ? 'ok' : 'bad', m); throw Object.assign(new Error(m), { status: r.status })
    }
    const t = (await r.json()).text; setAs('ok', 'Connected through the AI server. Its Groq key works.'); if (!t?.trim()) throw new Error('The AI returned an empty reply. Try again.'); return t
  }
  const key = await getKey(); if (!key) throw new Error('no key')
  let r: Response; try { r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: MODEL, temperature: temp ?? (json ? .3 : .6), max_completion_tokens: 8192, reasoning_effort: effort, messages: [...(json ? [{ role: 'system', content: 'Reply with valid JSON only: no prose and no markdown fences.' }] : []), { role: 'user', content: prompt }] }) }) } catch { const m = 'Couldn’t reach Groq. Check your connection.'; setAs('bad', m); throw new Error(m) }
  if (!r.ok) {
    if (r.status === 401) { lsSet('bl-groq-key', ''); announce = false; const m = 'Groq rejected this key. Check that it was copied in full, then enter it again.'; setAs('bad', m); throw new Error(m) }
    if (r.status === 429) setAs('ok', 'Key accepted, but Groq is rate-limiting right now.'); else setAs('bad', 'Groq returned error ' + r.status + '.')
    throw Object.assign(new Error(await r.text()), { status: r.status })
  }
  if (announce) { announce = false; toast('Groq key accepted and saved.') }
  setAs('ok', 'Connected. Your Groq key (' + keyHint() + ') works.')
  const out: string = (await r.json()).choices?.[0]?.message?.content || ''
  if (!out.trim()) throw new Error('The AI returned an empty reply. Try again.')
  return out
}
export const isRateLimit = (e: any) => e?.status === 429
/** Sends a tiny test request and reports whether AI is actually working. */
export async function testAI(): Promise<{ ok: boolean; msg: string }> {
  setAs('checking', 'Checking…')
  try { await groq('Reply with the single word OK.') } catch (e: any) { if (AS.state === 'checking') setAs('unknown', 'Check cancelled.') }
  return { ok: AS.state === 'ok', msg: AS.msg }
}
/** Saves a pasted key, verifies it with a live request, and removes it again if Groq rejects it. */
export async function registerKey(k: string) { lsSet('bl-groq-key', k.trim()); announce = false; const r = await testAI(); if (!r.ok) lsSet('bl-groq-key', ''); return r }
export async function ai(prompt: string, onText?: (t: string) => void): Promise<string> { const t = await groq(prompt); onText?.(t); return t }
export const coach = ai
/** Pulls the JSON out of a reply even if the model wrapped it in prose or code fences. */
export const parseJson = (t: string) => { const c = t.replace(/```json|```/g, ''), i = c.search(/[\[{]/), j = Math.max(c.lastIndexOf(']'), c.lastIndexOf('}')); return JSON.parse(i >= 0 && j > i ? c.slice(i, j + 1) : c.trim()) }
export async function aiJson<T>(p: string, effort: 'low' | 'medium' = 'low', temp?: number): Promise<T> { return parseJson(await groq(p, true, effort, temp)) }

export interface Peer { id: string; name: string }
export interface Room { id: string; peers(): Peer[]; onPeers(f: () => void): void; on(t: string, f: (d: any, from: string) => void): void; emit(t: string, d?: any): void; leave(): void }
/** Room backed by BroadcastChannel: works across tabs/windows of ONE browser. For real multi-device play, implement the same `Room` interface over WebSockets (see README). */
export function joinRoom(code: string, name: string): Room {
  const ch = new BroadcastChannel('bl-' + code), id = crypto.randomUUID(), peers = new Map<string, string>([[id, name]])
  const hs = new Map<string, ((d: any, from: string) => void)[]>(); let pf = () => {}
  const send = (t: string, d?: any) => ch.postMessage({ t, d, from: id })
  ch.onmessage = e => {
    const { t, d, from } = e.data
    if (t === '_hi') { peers.set(from, d.name); pf(); if (!d.re) send('_hi', { name, re: 1 }) }
    else if (t === '_bye') { peers.delete(from); pf() }
    else hs.get(t)?.forEach(f => f(d, from))
  }
  send('_hi', { name })
  const bye = () => send('_bye'); addEventListener('beforeunload', bye)
  return { id, peers: () => [...peers].map(([id, name]) => ({ id, name })), onPeers: f => { pf = f },
    on: (t, f) => { hs.set(t, [...(hs.get(t) || []), f]) }, emit: send,
    leave: () => { bye(); removeEventListener('beforeunload', bye); ch.close() } }
}

