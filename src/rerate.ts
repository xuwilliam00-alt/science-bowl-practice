import { RUBRIC } from './engine'
import { aiJson, isRateLimit, store } from './platform'
import { hasPlainDigits, prefixCount, qkey } from './read'
import type { Question } from './types'

export interface RJob { running: boolean; total: number; done: number; rated: number; failed: number; pauseUntil: number; msg: string }
export type RMode = 'unrated' | 'all' | 'eb' | 'chem'
let S: RJob = { running: false, total: 0, done: 0, rated: 0, failed: 0, pauseUntil: 0, msg: '' }
const L = new Set<() => void>(); let stopped = false, pausedUntil = 0
const set = (p: Partial<RJob>) => { S = { ...S, ...p }; L.forEach(f => f()) }
export const rjGet = () => S
export const rjSub = (f: () => void) => { L.add(f); return () => { L.delete(f) } }
export const stopRerate = () => { stopped = true }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const BATCH = 20, PAR = 3

const brief = (q: Question, i: number) => ({ i, subject: q.sub, topic: q.topic, question: q.tu.slice(0, 700), answer: q.choices ? `${q.ans}) ${q.choices[q.ans]}` : q.ans, ...(q.choices ? { choices: Object.values(q.choices).join(' | ').slice(0, 300) } : {}) })
type Out = { d?: number; eb?: string; m?: boolean }
const textOf = (q: Question) => [q.tu, q.bn, ...Object.values(q.choices || {}), ...Object.values(q.bc || {})]
/** Chemistry questions where a letter is still glued to a digit (H2SO4, Ca2+, x2): the AI has not yet decided subscript or exponent. */
export const chemTodo = (q: Question) => q.sub === 'chemistry' && !store.fixed()[qkey(q)] && textOf(q).some(hasPlainDigits)
const core = (s: string) => s.replace(/\\[a-zA-Z]+/g, '').replace(/[$^_{}\\\s]/g, '')
/** The AI may only add LaTeX: if the letters, digits and symbols differ from the original it reworded the question, and the change is thrown away. */
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && core(a) === core(b)

async function fixBatch(b: Question[]): Promise<Record<string, any>> {
  const items = b.map((q, i) => ({ i, tu: q.tu, ...(q.eb ? { eb: q.eb } : {}), ...(q.choices ? { choices: q.choices } : {}), ...(q.bn ? { bn: q.bn } : {}), ...(q.bc ? { bc: q.bc } : {}) }))
  const prompt = `These Science Bowl CHEMISTRY questions were copied from PDFs, which lost subscripts and superscripts, so formulas appear as H2SO4, Ca2+, 6.02x1023, x2 or 10-3. Rewrite only the text that needs it as LaTeX inside $...$. Decide from the chemistry context whether each digit is a subscript (H2O: $\\ce{H2O}$), an ion charge (Ca2+: $\\ce{Ca^2+}$), or an exponent (a squared term or 10-3: $10^{-3}$, $k[\\ce{A}]^{2}$). Do not change, add, reorder or remove any word, number or punctuation, and leave anything already inside $...$ alone. "eb" is the opening words of "tu": rewrite it the same way so it is still the start of "tu". Because the reply is JSON, double every backslash. Items: ${JSON.stringify(items)}. Return ONLY a JSON array with one object per item: {"i":index and the same fields it was given, rewritten}.`
  let tries = 0, limited = 0
  for (;;) {
    while (Date.now() < pausedUntil) await sleep(500)
    try {
      const a = await aiJson<any[]>(prompt), out: Record<string, any> = {}
      for (const x of Array.isArray(a) ? a : []) {
        const q = b[+x?.i]; if (!q) continue
        const o: any = {}; let bad = !same(x.tu, q.tu)
        if (!bad) { o.tu = x.tu; if (q.eb && same(x.eb, q.eb) && prefixCount(x.tu, x.eb) > 0) o.eb = x.eb; if (q.bn) { if (same(x.bn, q.bn)) o.bn = x.bn; else bad = true }
          for (const f of ['choices', 'bc'] as const) if (q[f]) { const n = x[f], old = q[f]!; if (n && typeof n === 'object' && Object.keys(old).every(k => same(n[k], old[k]))) o[f] = Object.fromEntries(Object.keys(old).map(k => [k, n[k]])); else bad = true } }
        if (!bad) out[qkey(q)] = o
      }
      if (!Object.keys(out).length) throw new Error('no usable rewrites in the reply')
      return out
    } catch (e: any) {
      if (isRateLimit(e)) { if (++limited > 5) throw e; if (Date.now() >= pausedUntil) { pausedUntil = Date.now() + 60_000; set({ pauseUntil: pausedUntil }); setTimeout(() => set({ pauseUntil: 0 }), 60_500) } continue }
      if (++tries > 2) throw e; await sleep(2000 * 3 ** (tries - 1))
    }
  }
}

async function rateBatch(b: Question[]): Promise<Record<string, Out>> {
  const prompt = `You are rating Science Bowl toss-up questions using ONLY the current calibrated scale below. ${RUBRIC}. The anchor points in this rubric are authoritative: do not use an older scale or the outdated assumption that an average Regionals question is rated 2-4. In particular, average NSB high-school Regionals difficulty is 3.5-4.0; 2.0-2.5 is basic high school; 4.5-5 is the nationals-qualification bubble; 6-7 is solid nationals contender; 8 is nationals playoff; 9 is national finals; 10 is best-in-the-nation finals-clinching. Rate the actual knowledge and reasoning required to answer correctly, not question length, writing style, or how difficult the question sounds. For skill-based subjects, concept level matters even if the calculation is short; for knowledge-based subjects, judge how obscure or specialized the required fact is. Do not anchor on any previous rating. For each question give (1) "d": how hard it is to ANSWER CORRECTLY for competitors, as a number rounded to the nearest tenth (e.g. 3.5, 4.2, 7.8). Store that tenth-value but display it with three decimal places (e.g. 3.500, 4.200, 7.800). Never use finer rating distinctions than one tenth. Compare the questions in the batch against each other so the ratings stay consistent. (2) "eb": the exact words of the question text copied from its very beginning, up to and including the first word at which a strong competitor could realistically buzz: after ALL the numbers and information needed to determine the answer have been given (they may buzz before a closing "what is…" or "name this…" phrase), and never earlier unless it is a stock, easy question whose answer is clear from the opening clue. If the question cannot be answered until its choices are heard, give the whole question text. Math and chemistry may contain LaTeX in $...$. (3) "m": true ONLY for a Miscellaneous question: General Science, or one that genuinely fits none of the subjects (it spans several or tests general scientific knowledge). Be conservative: a question that clearly belongs to its subject is never Miscellaneous. Miscellaneous questions get no "d" and no "eb". Questions: ${JSON.stringify(b.map(brief))}. Return ONLY a JSON array of {"i":index,"d":number 0-10 with exactly three decimals (e.g. 4.317),"eb":"exact opening words"} or {"i":index,"m":true}, one entry per question.`
  let tries = 0, limited = 0
  for (;;) {
    while (Date.now() < pausedUntil) await sleep(500)
    try {
      const a = await aiJson<any[]>(prompt), out: Record<string, Out> = {}
      for (const x of Array.isArray(a) ? a : []) {
        const q = b[+x?.i]; if (!q) continue
        const d = +x?.d, o: Out = {}
        if (x?.m === true) { out[qkey(q)] = { m: true }; continue }
        if (Number.isFinite(d)) o.d = Math.round(Math.min(10, Math.max(0, d)) * 10) / 10
        if (typeof x?.eb === 'string' && prefixCount(q.tu, x.eb) > 0) o.eb = x.eb // only kept if it really is the start of the question
        if (o.d !== undefined || o.eb) out[qkey(q)] = o
      }
      if (!Object.keys(out).length) throw new Error('no usable ratings in the reply')
      return out
    } catch (e: any) {
      if (isRateLimit(e)) { if (++limited > 5) throw e; if (Date.now() >= pausedUntil) { pausedUntil = Date.now() + 60_000; set({ pauseUntil: pausedUntil }); setTimeout(() => set({ pauseUntil: 0 }), 60_500) } continue } // Groq's limit: wait a minute, then run the same batch again
      if (++tries > 2) throw e; await sleep(2000 * 3 ** (tries - 1))
    }
  }
}

/** Rates difficulty AND marks the earliest realistic buzz point, 20 questions at a time, saving as it goes. 'unrated' = questions without a rating, 'eb' = questions without a buzz point, 'all' = everything. Safe to stop and restart. */
export async function startRerate(mode: RMode) {
  if (S.running) return
  const todo = store.bank().filter(q => mode === 'chem' ? chemTodo(q) : mode === 'all' || (mode === 'unrated' ? !q.dr : !q.eb)); if (!todo.length) return void set({ msg: 'Nothing left to do.' })
  stopped = false; pausedUntil = 0
  const batches: Question[][] = []; const size = mode === 'chem' ? 8 : BATCH; for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size))
  set({ running: true, total: todo.length, done: 0, rated: 0, failed: 0, pauseUntil: 0, msg: '' })
  let next = 0
  const worker = async () => {
    while (!stopped && next < batches.length) {
      const b = batches[next++], by = new Map(b.map(q => [qkey(q), q]))
      try {
        if (mode === 'chem') { const r = await fixBatch(b); store.fix(r); set({ rated: S.rated + Object.keys(r).length, done: S.done + b.length }); continue }
        const r = await rateBatch(b), save: Record<string, Out> = {}
        for (const [k, v] of Object.entries(r)) save[k] = v.m ? { m: true } : { ...(v.d !== undefined && (mode === 'all' || !by.get(k)?.dr) ? { d: v.d } : {}), ...(v.eb ? { eb: v.eb } : {}) }
        store.rate(save); set({ rated: S.rated + Object.keys(r).length, done: S.done + b.length })
      } catch { set({ failed: S.failed + b.length, done: S.done + b.length }) }
    }
  }
  await Promise.all(Array.from({ length: PAR }, worker))
  set({ running: false, pauseUntil: 0, msg: stopped ? `Stopped. ${S.rated.toLocaleString()} done so far; press the button again to continue with the rest.` : `Finished: ${S.rated.toLocaleString()} done${S.failed ? `, ${S.failed.toLocaleString()} failed (run it again to retry just those)` : ''}.` })
}
