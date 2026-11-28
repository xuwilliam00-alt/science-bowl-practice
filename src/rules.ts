import { subName, type Question } from './types'
// Keep this module Worker-safe: importing engine pulls browser platform/dialog code.
const NSB_HS_SAMPLE = 'NSB High School Sample'
const sourceGroup = (src: string) => /^HS Set(?:\s|$)/i.test(src.trim()) ? NSB_HS_SAMPLE : src
const sourceMatches = (src: string, selected: string) => selected === NSB_HS_SAMPLE ? sourceGroup(src) === NSB_HS_SAMPLE : src === selected
/** Question rules for team games. Shared by the client and the Worker so both sanitize and compare them the same way. */
export interface Rules { mode: 'both' | 'bank' | 'ai'; subs: string[]; srcs: string[]; ys: string[]; rounds: string[]; dMin: number; dMax: number }
export const DEFAULT_RULES: Rules = { mode: 'both', subs: [], srcs: [], ys: [], rounds: [], dMin: 1, dMax: 10 }
export const MODES: [Rules['mode'], string][] = [['both', 'AI + uploaded packets'], ['bank', 'Uploaded packets only'], ['ai', 'AI only']]
const KNOWN = ['math', 'physics', 'biology', 'chemistry', 'earth-space', 'energy']
const strs = (v: any): string[] => Array.isArray(v) ? [...new Set(v.map((x: any) => String(x ?? '').trim().slice(0, 40)).filter(Boolean))].sort().slice(0, 30) : []
const num = (v: any, d: number) => Math.min(10, Math.max(1, Math.round(+v || d)))
/** Always returns a valid, canonical (sorted) Rules object, whatever it is given. */
export function cleanRules(r: any): Rules {
  const o = r || {}, a = num(o.dMin, 1), b = num(o.dMax, 10)
  return { mode: o.mode === 'bank' || o.mode === 'ai' ? o.mode : 'both', subs: strs(o.subs).filter(s => KNOWN.includes(s)), srcs: strs(o.srcs), ys: strs(o.ys), rounds: strs(o.rounds), dMin: Math.min(a, b), dMax: Math.max(a, b) }
}
export const sameRules = (a: any, b: any) => JSON.stringify(cleanRules(a)) === JSON.stringify(cleanRules(b))
/** True when the captains asked for specific packets, so the AI should only be a last resort. */
export const picksPackets = (r: Rules) => !!(r.srcs.length || r.ys.length || r.rounds.length)
export const ysOf = (m: { year?: string; set?: string }) => [m.year, m.set].filter(Boolean).join(' ') || 'Unknown'
export function rulesText(r0: any): string {
  const r = cleanRules(r0), any = (a: string[], all: string) => a.length ? a.join(', ') : all
  return [MODES.find(m => m[0] === r.mode)![1], any(r.subs.map(subName), 'host’s subjects'), 'source: ' + any(r.srcs, 'any'), 'year/set: ' + any(r.ys, 'any'), 'round: ' + any(r.rounds, 'any'), `difficulty ${r.dMin}–${r.dMax}`].join(' · ')
}

/** First question in the bank that fits the rules, trying subjects in `order`. With specific packets chosen it plays them in packet order; otherwise it picks at random.
 *  `rep` (a replacement request) ignores the difficulty range and instead wants the same difficulty ±1.5, a different question, and a bonus if a bonus is being replaced. */
export function selectFromBank(R: Rules, bank: Question[], order: string[], used: Set<string>, meta: (q: Question) => { src: string; year?: string; set?: string; rnd?: string }, rep?: { kind: string; d: number; tu: string }): Question | undefined {
  for (const sub of order) {
    const c = bank.filter(q => { const m = meta(q); return q.sub === sub && !used.has(q.tu)
      && (rep ? q.tu !== rep.tu && !!q.dr && Math.abs(q.d - rep.d) <= 1.5 && (rep.kind === 'tu' || !!q.bn) : q.dr ? q.d >= R.dMin && q.d <= R.dMax : R.dMin <= 1 && R.dMax >= 10)
      && (!R.srcs.length || R.srcs.some(s => sourceMatches(m.src, s))) && (!R.ys.length || R.ys.includes(ysOf(m))) && (!R.rounds.length || R.rounds.includes(m.rnd || '')) })
    if (!c.length) continue
    if (rep) return c.sort((a, b) => Math.abs(a.d - rep.d) - Math.abs(b.d - rep.d))[0]
    return picksPackets(R) ? c.sort((a, b) => (a.pk || '').localeCompare(b.pk || '') || (a.ord || 0) - (b.ord || 0))[0] : c[Math.floor(Math.random() * c.length)]
  }
}
