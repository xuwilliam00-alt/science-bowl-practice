export type Sub = string
export const ALL_SUBJECTS: [string, string][] = [['math', 'Math'], ['physics', 'Physics'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['earth-space', 'Earth & Space'], ['energy', 'Energy']]
export const subName = (s: string) => ALL_SUBJECTS.find(x => x[0] === s)?.[1] || s
export interface Question {
  sub: Sub; topic: string; d: number; tu: string; ans: string
  choices?: Record<string, string> | null // absent = short-answer toss-up
  ax?: string[]; nx?: string[]            // other accepted answers / answers to reject (short answer)
  bn?: string; bc?: Record<string, string>; ba?: string; bx?: string[]; bnx?: string[] // bonus: choices (bc + letter) or short answer (ba text, bx accepted, bnx rejected)
  misc?: boolean                          // Miscellaneous: never rated, never played, only visible in the question database. `sub` keeps the original subject.
  gs?: boolean                            // the packet marked it General Science (reclassified into a normal subject)
  eb?: string                              // the exact opening words of the toss-up, up to the earliest point a strong competitor could realistically buzz
  ai?: boolean; dr?: boolean              // AI-written / difficulty rated on the current scale
  k?: string                               // stable id (kept when the text is later reformatted, so ratings stay attached)
  pk?: string; ord?: number; src?: string; year?: string; set?: string; rnd?: string; ex?: string
  fl?: { k: 'math' | 'format' | 'transcription' | 'source'; n: string }[]  // scan notes for moderators: real math errors are kept apart from formatting / transcription / source-quality problems
}
/** One toss-up in a saved game. `e0`/`e1` = rating (or, in a placement test, the running estimate) before and after. */
export interface QRec {
  sub: Sub; topic: string; d: number | null; ai?: boolean; src?: string; tu: string; choices?: Record<string, string> | null; ans: string
  given: string | null; ok: boolean; neg: boolean; idk?: boolean; noBuzz?: boolean; botWon?: boolean
  at: number; frac: number; tier: string; e0: number; e1: number; speed: number; pts: number; rated: boolean; reported?: boolean; wi?: number; ei?: number; nq?: number; lag?: number; mc?: boolean
  bonus?: { ok: boolean; given: string | null; ba: string; bn: string; choices?: Record<string, string> | null; e0?: number; e1?: number; rated?: boolean }
}
export interface GameRec { id: string; ts: number; mode: 'place' | 'bot' | 'prac'; label: string; subs: string[]; qs: QRec[]; end?: { r: number; sd: number } }
export interface Profile {
  name: string; r: Record<string, number>; n: Record<string, number>; diag: Record<string, boolean>
  t: Record<string, { a: number; c: number }>
  confidence?: Record<string, number>
  st: { tu: number; ok: number; neg: number; en: number; tm: number }
  p: { wpm: number; subjs: string[]; src: 'ai' | 'bank' | 'both'; bot: string; botElo: Record<string, number> }
}
export const newProfile = (): Profile => ({ name: '', r: { math: 5, physics: 5 }, n: { math: 0, physics: 0 }, diag: {}, t: {}, st: { tu: 0, ok: 0, neg: 0, en: 0, tm: 0 }, confidence: {}, p: { wpm: 160, subjs: [], src: 'ai', bot: 'medium', botElo: {} } })

/** Miscellaneous questions (General Science, or fitting no subject) have no rating and appear only in the question database. */
export const isMisc = (q: { misc?: boolean; gs?: boolean }) => !!(q.misc || q.gs)
