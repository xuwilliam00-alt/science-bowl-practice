import { aiMeta, chunkText, extractChunk, type Meta } from './engine'
import { isRateLimit, lsGet, lsSet, store } from './platform'
import type { Question } from './types'
export type FileState = 'queued' | 'reading' | 'scanning' | 'done' | 'partial' | 'failed' | 'skipped' | 'stopped'
export interface FileRow { name: string; state: FileState; parts: number; partsDone: number; added: number; badParts: number; note: string }
export interface BadPart { file: string; part: number; of: number; err: string }
export interface Job { running: boolean; finished: boolean; done: number; total: number; added: number; files: number; filesDone: number; skipped: number; failed: number; msg: string; rows: FileRow[]; bad: BadPart[]; pauseUntil: number }
const mk = (name: string, state: FileState, note = ''): FileRow => ({ name, state, parts: 0, partsDone: 0, added: 0, badParts: 0, note })
export interface ScanItem { name: string; read: () => Promise<string>; note?: string }
const ZERO: Job = { running: false, finished: false, done: 0, total: 0, added: 0, files: 0, filesDone: 0, skipped: 0, failed: 0, msg: '', rows: [], bad: [], pauseUntil: 0 }
let S: Job = { ...ZERO }
const L = new Set<() => void>(), set = (p: Partial<Job>) => { S = { ...S, ...p }; L.forEach(f => f()) }
export const jobGet = () => S
export const jobSub = (f: () => void) => { L.add(f); return () => { L.delete(f) } }
export const dismissJob = () => set({ finished: false, msg: '' })

const READERS = 2, BUFFER = 30 // files opened at once; parts waiting before we stop opening more files
/** How many parts may be sent to the AI at once. `maxPar` is the moderator's setting; `par` is the live limit, which backs off when the AI starts refusing and creeps back up while it behaves. */
let maxPar = Math.min(24, Math.max(2, +(lsGet('bl-scan-par') || 10))), par = maxPar, okRun = 0
export const getScanPar = () => maxPar
export const setScanPar = (n: number) => { maxPar = Math.min(24, Math.max(2, n)); par = maxPar; lsSet('bl-scan-par', String(maxPar)); pump() }
interface File_ { name: string; note: string; n: number; left: number; bad: boolean; counted?: boolean; meta: () => Promise<Meta> }
const files: ScanItem[] = [], parts: { f: File_; c: string; ord: number; i: number; retry?: boolean }[] = []; let busy = 0, reading = 0, gen = 0
/** Parts that still failed after 3 tries. Kept in memory (with their text) so only those parts can be re-run. */
const fp: { f: File_; c: string; ord: number; i: number; err: string }[] = []
const pubBad = (): BadPart[] => fp.map(x => ({ file: x.f.name, part: x.i, of: x.f.n, err: x.err }))
const bump = (name: string, fn: (r: FileRow) => FileRow) => set({ rows: S.rows.map(r => r.name === name ? fn(r) : r) })
const failedNames = (): string[] => { try { return JSON.parse(lsGet('bl-scan-failed') || '[]') } catch { return [] } }
const markFailed = (n: string, bad: boolean) => { const s = new Set(failedNames()); bad ? s.add(n) : s.delete(n); lsSet('bl-scan-failed', JSON.stringify([...s].slice(-500))) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** The AI sometimes rate-limits or hiccups when many parts run at once, so each part gets 3 tries before it counts as failed. */
let pausedUntil = 0
/** Groq said "too many requests": stop sending anything for one minute, then carry on automatically. */
function pauseScan() {
  if (Date.now() < pausedUntil) return
  pausedUntil = Date.now() + 60_000; par = Math.max(2, Math.floor(par / 2)); okRun = 0; set({ pauseUntil: pausedUntil })
  setTimeout(() => { if (Date.now() >= pausedUntil) { set({ pauseUntil: 0 }); pump() } }, 60_500)
}
async function extract(c: string, note = ''): Promise<Question[]> {
  let tries = 0, limited = 0
  for (;;) {
    while (Date.now() < pausedUntil) await sleep(500)
    try { const r = await extractChunk(c, note); if (++okRun >= 10 && par < maxPar) { par++; okRun = 0 } return r }
    catch (e: any) {
      if (isRateLimit(e)) { if (++limited > 5) throw new Error('Groq kept rate-limiting this part (its limit may be used up for now).'); pauseScan(); continue } // not counted as a failed try: wait a minute and run it again
      par = Math.max(2, par - 1); okRun = 0; if (++tries > 2) throw e; await sleep(2000 * 3 ** (tries - 1))
    }
  }
}
const fileDone = (f: File_) => {
  f.bad = fp.some(x => x.f === f); markFailed(f.name, f.bad); bump(f.name, r => ({ ...r, state: r.badParts ? 'partial' : 'done' }))
  if (!f.counted) { f.counted = true; set({ filesDone: S.filesDone + 1 }) }
}
function finish() {
  if (files.length || parts.length || busy || reading || !S.running) return
  const m = `Scan finished: ${S.filesDone - S.skipped} file(s), ${S.added} questions added.` + (S.skipped ? ` ${S.skipped} already-scanned file(s) skipped.` : '') + (S.failed ? ` ⚠ ${S.failed} part(s)/file(s) failed. Open “Parts that still fail” in Moderator tools to retry them.` : '')
  set({ running: false, finished: true, msg: m + (store.full() ? ' ⚠ This browser’s storage is full, so these questions will be lost when you close the tab. Download bank.json now (Moderator tools).' : '') })
}
function pump() {
  while (reading < READERS && files.length && parts.length < BUFFER) { // read the next file in the background (PDFs are slow to open)
    const it = files.shift()!, my = gen; reading++; bump(it.name, r => ({ ...r, state: 'reading' }))
    it.read().then(text => {
      if (my !== gen) return
      if (!text.trim()) { set({ failed: S.failed + 1, filesDone: S.filesDone + 1 }); bump(it.name, r => ({ ...r, state: 'failed', note: 'No readable text (a scanned/image PDF needs OCR first).' })); markFailed(it.name, true); return }
      const cs = chunkText(text); let mp: Promise<Meta> | null = null, f: File_ = { name: it.name, note: it.note || '', n: cs.length, left: cs.length, bad: false, meta: () => (mp ||= aiMeta(it.name, text, it.note || '')) } // packet details are looked up once, when its first part runs
      parts.push(...cs.map((c, i) => ({ f, c, ord: i * 100, i: i + 1 }))); set({ total: S.total + cs.length }); bump(it.name, r => ({ ...r, state: 'scanning', parts: cs.length }))
    }).catch(() => { if (my === gen) { set({ failed: S.failed + 1, filesDone: S.filesDone + 1 }); bump(it.name, r => ({ ...r, state: 'failed', note: 'Couldn’t open this file.' })); markFailed(it.name, true) } }).finally(() => { if (my === gen) reading--; pump() })
  }
  while (busy < par && parts.length && Date.now() >= pausedUntil) {
    const t = parts.shift()!, my = gen; busy++
    t.f.meta().then(m => extract(t.c, t.f.note).then(qs => {
      if (my !== gen) return
      if (qs.length) { store.addBank(qs.map((q, j) => ({ ...q, pk: t.f.name, ord: t.ord + j, src: m.src, year: m.year, set: m.set, rnd: m.rnd }))); set({ added: S.added + qs.length }) }
      bump(t.f.name, r => ({ ...r, added: r.added + qs.length, partsDone: t.retry ? r.partsDone : r.partsDone + 1, badParts: t.retry ? Math.max(0, r.badParts - 1) : r.badParts }))
    }))
      .catch((e: any) => { if (my === gen) { fp.push({ f: t.f, c: t.c, ord: t.ord, i: t.i, err: String(e?.message || e).slice(0, 120) }); set({ failed: S.failed + 1, bad: pubBad() }); if (!t.retry) bump(t.f.name, r => ({ ...r, partsDone: r.partsDone + 1, badParts: r.badParts + 1 })) } })
      .finally(() => { if (my === gen) { busy--; set({ done: S.done + 1 }); if (--t.f.left === 0) fileDone(t.f) } pump(); finish() })
  }
  finish()
}
/** Queue any number of files. Each is read, split and sent to the AI in the background (several parts at once). Adding more while a scan runs just extends the queue.
 *  Files already scanned successfully (same name) are skipped, so re-selecting a folder only does the new ones. */
export function startScan(items: ScanItem[], rescan = false) {
  const have = new Set(store.all().map(q => q.pk)), bad = new Set(failedNames()), todo = rescan ? items : items.filter(i => !have.has(i.name) || bad.has(i.name)), skip = items.length - todo.length
  if (!items.length) return false
  if (!S.running) { S = { ...ZERO, running: true }; fp.length = 0 }
  const rows = [...S.rows.filter(r => !items.some(i => i.name === r.name)), ...items.map(i => todo.includes(i) ? mk(i.name, 'queued') : mk(i.name, 'skipped', 'Already scanned.'))]
  for (const i of todo) if (i.note !== undefined) store.setNote(i.name, i.note) // keep each packet's note with it
  files.push(...todo); set({ running: true, finished: false, rows, files: S.files + items.length, filesDone: S.filesDone + skip, skipped: S.skipped + skip, msg: '' }); pump(); return true
}
/** Stop reading and scanning. Questions already found are kept. */
export function cancelScan() { gen++; files.length = 0; parts.length = 0; busy = 0; reading = 0; set({ rows: S.rows.map(r => ['queued', 'reading', 'scanning'].includes(r.state) ? { ...r, state: 'stopped' as FileState } : r), running: false, finished: true, msg: `Scan stopped: ${S.added} questions were added before it stopped.` }) }
/** Re-run only the parts that still failed. (They are forgotten if the page is reloaded; re-picking the files retries any file that had failures.) */
export function retryFailed() {
  if (!fp.length) return false
  const list = fp.splice(0); if (!S.running) S = { ...S, running: true, finished: false, msg: '' }
  for (const x of list) { x.f.left++; parts.push({ f: x.f, c: x.c, ord: x.ord, i: x.i, retry: true }) }
  set({ running: true, finished: false, msg: '', total: S.total + list.length, failed: Math.max(0, S.failed - list.length), bad: pubBad(), rows: S.rows.map(r => list.some(x => x.f.name === r.name) ? { ...r, state: 'scanning' as FileState } : r) })
  pump(); return true
}
addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = '' } })
