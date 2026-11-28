import type { Question } from "./types"
/** Deterministic word-reveal schedule (ms from start for each word). Shared by the client and the Worker so both agree on where a buzz landed. */
/** Splits text into spoken "words"; a $...$ LaTeX formula stays in one piece so it is never shown half-drawn. */
export const tokenize = (s: string): string[] => String(s ?? '').match(/(?:\$[^$]*\$|\S)+/g) || []
/** Rough spoken length of a word (LaTeX commands count for less than their characters). */
export const spoken = (w: string) => w.includes('$') ? Math.max(3, w.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}$\\^_]/g, '').length * .7) : w.length
export function readTimes(text: string, wpm: number): number[] {
  let t = 400
  return tokenize(text).map(w => { t += 60000 / wpm * (1 + spoken(w) / 25) + (/[.?!]$/.test(w) ? 260 : /[,;:]$/.test(w) ? 130 : 0); return t })
}

export type Choices = Record<string, string>
/** What is read aloud: the stem, then each choice as "W) ...", all at the same pace. `nq` = words in the stem; `starts` = where each choice begins. */
export function readText(stem: string, choices?: Choices | null) {
  // Older packet imports embed W/X/Y/Z choices in the stem as well as in the choices object.
  // Strip that embedded tail so the choices are read exactly once from the structured choices.
  const cleanStem = choices ? String(stem).replace(/\s+W\)\s[\s\S]*$/i, '').trim() : stem
  const w = tokenize(cleanStem), words = [...w], starts: number[] = []
  if (choices) for (const [k, v] of Object.entries(choices)) { starts.push(words.length); words.push(k + ')', ...tokenize(String(v))) }
  return { words, nq: w.length, starts, text: words.join(' ') }
}
/** The first n words, with each choice on its own line. */
export const showWords = (w: string[], n: number, starts: number[]) => w.slice(0, n).map((x, i) => (starts.includes(i) ? '\n' : i ? ' ' : '') + x).join('')
/** A bonus is multiple choice if it has its own choices (older data: a letter answer that uses the toss-up's choices). null = short answer. */
export const bonusChoices = (q: any): Choices | null => q.bc || (/^[WXYZ]$/i.test(String(q.ba || '').trim()) ? q.choices || null : null)
/** Normalize common LaTeX answer notation into keyboard-friendly equivalents before grading. */
export const answerPlain = (s: string) => String(s ?? '').replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2').replace(/\\(?:sqrt)\s*\{([^{}]*)\}/g, 'sqrt($1)').replace(/\\(?:mathrm|text|operatorname|ce)\s*\{([^{}]*)\}/g, '$1').replace(/\\times/g, '*').replace(/\\cdot/g, '*').replace(/\\div/g, '/').replace(/\\pi/g, 'pi').replace(/\\degree/g, ' deg ').replace(/\\pm/g, '+/-').replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, '$1').replace(/[{}]/g, '').replace(/\\/g, '').replace(/\$+/g, '').replace(/\s+/g, ' ').trim()
export const norm = (s: string) => answerPlain(s).toLowerCase().replace(/\s+and\s+/g, ', ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.+\-/^*() ]/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim()
/** Forgiving comparison used when the AI judge is unavailable. */
export const loose = (typed: string, accepts: string[]) => { const t = norm(typed); return !!t && accepts.some(a => { const n = norm(a); return n === t || (t.length >= 4 && n.length >= 4 && (n.includes(t) || t.includes(n)) && Math.min(n.length, t.length) / Math.max(n.length, t.length) > .6) }) }
/** true/false when the answer is obvious (letter, exact text, or a different choice); null when an AI judge should decide. */
export function quickGrade(typed: string, accepts: string[], choices: Choices | null, key: string, rejects: string[] = []): boolean | null {
  const t = typed.trim(); if (!t) return false
  if (choices && /^[wxyz]\)?$/i.test(t)) return t[0].toUpperCase() === key
  const n = norm(t); if (!n) return false
  if (rejects.some(r => norm(r) === n)) return false
  if (accepts.some(a => norm(a) === n)) return true
  if (choices && Object.entries(choices).some(([k, v]) => k !== key && norm(v) === n)) return false
  return null
}

const ANN = /\s*[\(\[]?\s*(?:do not accept|don'?t accept|also accept|accept|either order|prompt on|prompt)\b[^\)\]]*(?:[\)\]]|$)/gi
/** Splits "ANSWER (also accept: X or Y) (do not accept: Z)" into the answer, extra accepted answers and rejected answers. */
export function splitAnswer(raw: string) {
  const ax: string[] = [], nx: string[] = []
  const ans = String(raw ?? '').replace(ANN, m => {
    const t = m.replace(/^[\s\(\[]+|[\)\]\s]+$/g, ''), kind = (t.match(/^(do not accept|don'?t accept|also accept|accept|either order|prompt on|prompt)/i) || [''])[0].toLowerCase()
    const list = t.slice(kind.length).replace(/^[\s:,-]+/, '').split(/\s+or\s+|;|,/i).map(s => s.trim()).filter(Boolean)
    if (/^(do not|don)/.test(kind)) nx.push(...list); else if (/accept/.test(kind)) ax.push(...list)
    return ''
  }).replace(/\s+/g, ' ').trim()
  return { ans, ax, nx }
}
const pickLetter = (a: string, ch: Choices) => {
  const m = a.match(/^([WXYZ])\s*[\)\.:]/i) || a.match(/^([WXYZ])$/i), L = m && m[1].toUpperCase(); if (L && ch[L] !== undefined) return L
  const body = norm(a.replace(/^[WXYZ]\s*[\)\.:]\s*/i, '')), hit = Object.entries(ch).find(([, v]) => norm(String(v)) === body); return hit ? hit[0] : null
}
/** A model that forgot to double its backslashes in JSON turns "\frac" into a form feed + "rac". Put those back. */
export const fixTex = (s: string) => s.replace(/\f/g, '\\f').replace(/\x08/g, '\\b').replace(/\v/g, '\\v')
/** Makes any stored question safe to use (or returns null if it can't be): fixes answers like "X) 5", splits "(do not accept …)" notes, keeps short-answer toss-ups and bonuses. */
export function sanitizeQ(q: any): any | null {
  if (!q || typeof q.tu !== 'string' || !q.tu.trim() || !['math', 'physics', 'biology', 'chemistry', 'earth-space', 'energy'].includes(q.sub)) return null
  const dn = Number(q.d), o: any = { ...q, energy: undefined, tu: fixTex(q.tu.trim()), dr: q.dr === true, d: Number.isFinite(dn) ? Math.round(Math.min(10, Math.max(0, dn)) * 1000) / 1000 : 5 }, rawAns = fixTex(String(q.ans ?? '').trim()); if (!rawAns) return null
  const ch: Choices | null = q.choices && typeof q.choices === 'object' && Object.keys(q.choices).length >= 2 ? q.choices : null
  if (ch) { const L = pickLetter(rawAns, ch); if (!L) return null; o.ans = L; delete o.ax; delete o.nx; o.choices = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, fixTex(String(v))])) }
  else { delete o.choices; const s = splitAnswer(rawAns); if (!s.ans) return null; o.ans = s.ans; const ax = [...(Array.isArray(q.ax) ? q.ax : []), ...s.ax].map(x => fixTex(String(x))), nx = [...(Array.isArray(q.nx) ? q.nx : []), ...s.nx].map(x => fixTex(String(x))); if (ax.length) o.ax = ax; else delete o.ax; if (nx.length) o.nx = nx; else delete o.nx }
  if (o.bn) {
    o.bn = fixTex(String(o.bn)); const ba = fixTex(String(q.ba ?? '').trim()), bch: Choices | null = q.bc && typeof q.bc === 'object' && Object.keys(q.bc).length >= 2 ? q.bc : null
    if (bch) { const L = pickLetter(ba, bch); if (L) { o.ba = L; o.bc = Object.fromEntries(Object.entries(bch).map(([k, v]) => [k, fixTex(String(v))])); delete o.bx; delete o.bnx } else { delete o.bn; delete o.bc; delete o.ba; delete o.bx; delete o.bnx } }
    else if (ch && /^[WXYZ]$/i.test(ba)) { o.ba = ba.toUpperCase(); delete o.bc; delete o.bx; delete o.bnx } // older data: a letter answer on the toss-up's own choices
    else { const s = splitAnswer(ba); if (s.ans) { o.ba = s.ans; delete o.bc; o.bx = [...(Array.isArray(q.bx) ? q.bx : []), ...s.ax].map(x => fixTex(String(x))).slice(0, 8); o.bnx = [...(Array.isArray(q.bnx) ? q.bnx : []), ...s.nx].map(x => fixTex(String(x))).slice(0, 8) } else { delete o.bn; delete o.bc; delete o.ba; delete o.bx; delete o.bnx } }
  } else { delete o.bc; delete o.ba; delete o.bx; delete o.bnx }
  if (q.misc === true || q.gs === true) { o.misc = true; o.dr = false; o.ai = false } else delete o.misc // miscellaneous = no rating; `sub` stays the original subject
  if (o.sub !== 'chemistry') { // PDFs lose superscripts: a variable like x2 or w2 means x squared. The id stays that of the original text so saved ratings still match.
    const tu = fixExp(o.tu); if (tu !== o.tu) { o.k = q.k || qkey({ sub: o.sub, tu: o.tu }); o.tu = tu }
    if (o.bn) o.bn = fixExp(o.bn)
    for (const f of ['choices', 'bc']) if (o[f]) o[f] = Object.fromEntries(Object.entries(o[f]).map(([k, v]) => [k, fixExp(String(v))]))
  }
  return o
}
const MATHRE = /(\$\$[\s\S]+?\$\$|\$[^$]*\$)/g
/** In text outside $...$, a lone lowercase variable followed by a digit 2-9 (x2, w2, y2) becomes an exponent ($x^{2}$). Not used for chemistry, where H2O-style digits are subscripts (see rerate.ts). */
export const fixExp = (s: string): string => String(s ?? '').split(MATHRE).map((p, i) => i % 2 ? p : p.replace(/(^|[^A-Za-z0-9\\^_{}])([a-z])([2-9])(?![0-9A-Za-z]|\.\d)/g, (_m, pre, l, d) => `${pre}$${l}^{${d}}$`)).join('')
/** True if text outside $...$ still has a letter glued to a digit (H2SO4, x2, Ca2+): lost sub/superscripts. */
export const hasPlainDigits = (s?: string | null): boolean => !!s && s.split(MATHRE).some((p, i) => i % 2 === 0 && /[A-Za-z][0-9]/.test(p))

export interface Meta { src: string; year: string; set: string; rnd: string }
/** Best-effort guess from a file name like NSB_2024_Regionals_Round1.pdf */
export function metaFromName(name: string): Meta {
  const t = name.replace(/\.[^.]+$/, '').split(/[\s_\-.]+/).filter(Boolean)
  const yi = t.findIndex(x => /^(19|20)\d{2}$/.test(x)), ri = t.findIndex(x => /^(r|rd|round)\d+$/i.test(x) || /^round$/i.test(x)), bare = ri >= 0 && /^round$/i.test(t[ri])
  const rnd = ri < 0 ? '' : (bare ? 'Round ' + (t[ri + 1] || '') : 'Round ' + t[ri].replace(/\D/g, '')).trim()
  return { src: t[0] || 'Unknown', year: yi >= 0 ? t[yi] : '', set: t.filter((_, i) => i !== 0 && i !== yi && i !== ri && !(bare && i === ri + 1)).join(' '), rnd }
}
/** Source / year / set / round of a stored question (older uploads fall back to the packet's file name). */
export const qMeta = (q: Question): Meta => q.src ? { src: q.src, year: q.year || '', set: q.set || '', rnd: q.rnd || '' } : metaFromName(q.pk || 'Unknown')

/** Short stable id for a question (subject + text). Ratings are attached to questions by this id. */
export function qkey(q: { sub: string; tu: string; k?: string }): string {
  if (q.k) return q.k
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; const s = q.sub + '|' + q.tu
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** How many opening words of `tu` the AI's "earliest buzz" prefix `eb` covers (0 if it doesn't match the question text). */
export function prefixCount(tu: string, eb?: string): number {
  if (!eb) return 0
  const a = tokenize(tu), b = tokenize(eb), n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''); let m = 0
  while (m < b.length && m < a.length && n(a[m]) === n(b[m])) m++
  return m >= Math.max(1, Math.floor(b.length * .8)) ? m : 0
}
