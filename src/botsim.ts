import { prefixCount } from './read'
import type { Question } from './types'

const NUMBER_WORDS = new Set('zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half third quarter double triple twice'.split(' '))
/** A word that carries a quantity: a digit, a formula, or a number word. */
const isQuant = (w: string) => /\d/.test(w) || w.includes('$') || w.toLowerCase().split(/[-\s]/).some(p => NUMBER_WORDS.has(p.replace(/[^a-z]/g, '')))
/** The stem points at the choices ("which of the following"), so it cannot be answered until they have been read. */
const NEEDS_CHOICES = /\b(?:of the following|of these|select|choose|which one of|which\s+(?:statement|equation|expression|formula|graph|diagram|compound|molecule|element|option|choice)s?)\b/i

/**
 * The earliest point (as a count of words read) at which a realistic competitor could buzz:
 *  - choice-based questions ("which of the following"): only once the choices have been read,
 *  - questions with numbers: only once the last number or formula has been given (they may buzz before the "what is…" at the end),
 *  - otherwise: after enough of the stem to know what is being described (earlier for easy, stock questions).
 */
export function earliestIndex(q: Pick<Question, 'tu' | 'd' | 'dr' | 'ai' | 'eb'>, words: string[], nq: number): { at: number; needsChoices: boolean } {
  const total = words.length, stem = words.slice(0, nq), rated = !!(q.dr || q.ai), d = rated ? Number(q.d) : 5
  if (NEEDS_CHOICES.test(stem.join(' ')) && total > nq) return { at: Math.max(1, total - 1), needsChoices: true }
  const easy = rated && d <= 2.5, hard = rated && d >= 6
  let last = -1; stem.forEach((w, i) => { if (isQuant(w)) last = i })
  const k = prefixCount(q.tu, q.eb) // the AI's own estimate of the earliest buzz point; never allowed before the last number
  if (k > 0) return { at: Math.min(nq, Math.max(k, last + 1, 1)), needsChoices: false }
  const frac = last >= 0 ? (easy ? .3 : hard ? .8 : .6) : (easy ? .35 : hard ? .85 : .65) // how much of the stem is needed even after the numbers
  const at = Math.max(last + 1, Math.ceil(frac * nq), 1)
  return { at: Math.min(at, nq), needsChoices: false }
}

export interface BotPlan { mode: 'know' | 'gamble' | 'none'; at: number; winT: number; correct: boolean; earliest: number }
/**
 * Decides, once per question, what the bot does.
 *  - Knowledge decides whether it can answer at all (`acc` = chance it knows this question).
 *  - A bot that knows buzzes somewhere between the earliest realistic point and the end of the stem; the stronger it is, the closer to the earliest point.
 *  - A bot that doesn't know usually stays quiet, but weaker bots sometimes gamble late and usually neg.
 */
export function planBot(q: Pick<Question, 'tu' | 'd' | 'dr' | 'ai' | 'eb'>, elo: number, acc: number, words: string[], nq: number): BotPlan {
  const { at: earliest, needsChoices } = earliestIndex(q, words, nq), total = words.length
  const knows = Math.random() < acc, gamble = !knows && Math.random() < .08 + (10 - elo) * .012
  if (!knows && !gamble) return { mode: 'none', at: Infinity, winT: Infinity, correct: false, earliest }
  const end = needsChoices ? total : nq
  const u = knows ? Math.pow(Math.random(), .35 + elo * .25) : .55 + .45 * Math.random() // 0 = right at the earliest point, 1 = at the end
  let at = Math.round(earliest + (end - earliest) * u)
  const waits = knows && Math.random() < .3 * (1 - elo / 10) // cautious bots sometimes wait until everything has been read
  if (at >= end || waits) return { mode: knows ? 'know' : 'gamble', at: Infinity, winT: .4 + Math.random() * 2.6 * (1 - elo / 14), correct: knows || Math.random() < .15, earliest }
  at = Math.max(at, earliest)
  return { mode: knows ? 'know' : 'gamble', at, winT: Infinity, correct: knows || Math.random() < .15, earliest }
}
