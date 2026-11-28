import { aiJson, lsGet, lsSet, store } from './platform'
import { fixTex, loose, metaFromName, type Meta } from './read'
import { ALL_SUBJECTS, subName } from './types'
import type { Profile, Question, Sub } from './types'

/** Collapse individual NSB high-school sample set names into a single selectable source. */
export const NSB_HS_SAMPLE = 'NSB High School Sample'
export const sourceGroup = (src: string) => /^HS Set(?:\s|$)/i.test(src.trim()) ? NSB_HS_SAMPLE : src
export const sourceMatches = (src: string, selected: string) => selected === NSB_HS_SAMPLE ? sourceGroup(src) === NSB_HS_SAMPLE : src === selected
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Rating (0-10): expected score from rating vs difficulty; accuracy, speed and negs set the actual score s. */
export function upd(P: Profile, sub: Sub, d: number, s: number, k: number) { const r = P.r[sub] ?? 5, e = 1 / (1 + Math.exp(-(r - d) / 1.5)); P.r[sub] = +clamp(r + k * (s - e), 0, 10).toFixed(3); P.n[sub] = (P.n[sub] || 0) + 1 }
/** Expected score for a player rated r on a question of difficulty d. */
export const expected = (r: number, d: number) => 1 / (1 + Math.exp(-(r - d) / 1.5))
export function topic(P: Profile, sub: Sub, t: string, ok: boolean) { const o = (P.t[sub + ':' + t] ||= { a: 0, c: 0 }); o.a++; if (ok) o.c++ }
export const tops = (P: Profile) => Object.entries(P.t).filter(([, v]) => v.a >= 2).map(([k, v]) => ({ k, ...v, r: (v.c + 1) / (v.a + 2) })).sort((x, y) => x.r - y.r)
export const BOT_PRESETS: Record<string, number> = { easy: 3, medium: 5, hard: 8, top: 10 }
/** Bot strength as a 0-10 rating, so it is directly comparable to your own subject ratings. */
export const botElo = (P: Profile, sub: string) => +(P.p.bot === 'match' ? (P.r[sub] ?? 5) : P.p.bot === 'custom' ? (P.p.botElo[sub] ?? 5) : BOT_PRESETS[P.p.bot] ?? 5).toFixed(3)
export const botAcc = (elo: number, d: number) => .05 + .9 / (1 + Math.exp(-(elo - d) / 1.5))
export const BOT = { easy: { f: [.7, 1.3], p: .45 }, medium: { f: [.5, 1.1], p: .65 }, hard: { f: [.3, .95], p: .85 } }
/** What each rating means. The same scale is used for question difficulty, player ratings and bots. */
export const RUBRIC = `Difficulty scale (calibrated to the National Science Bowl; every rating is stored at one-decimal resolution and displayed with three decimals): 0-2 only middle-school-level questions; 2.0-2.5 basic high school (Algebra I, Geometry, basic Algebra II); 3.5-4.0 average NSB high-school Regionals difficulty; 4.5-5 the nationals-qualification bubble, a typical nationals round-robin question with college-intro depth; 6-7 solid nationals contender, multi-concept problems under time pressure; 8 nationals playoff level; 9 national-finals level that only a handful of top players answer; 10 best in the nation, finals-clinching, undergraduate-honors depth, multi-step with no shortcuts. Concept level counts, not just how hard the work is. Energy questions should be assessed using whichever of the five core-subject rubrics best fits the underlying question. Use a consistent concept-first calibration in Math, Physics and calculation-heavy Chemistry: basic algebra/geometry/basic Algebra II is 2.0-2.5; standard precalculus and routine Calc I/II concepts generally remain below 5, while difficult applications can approach 5. Multivariable calculus, eigenvalues/eigenvectors, linear algebra, differential equations, n-dimensional geometry, Lagrangian mechanics, quantum operators and comparable advanced concepts are usually 7-8 for straightforward questions and higher for difficult applications. Rate conceptual level separately from arithmetic burden: a short eigenvalue question is still advanced. Energy uses the best-fit core subject rubric for its underlying concept. Apply equivalent anchors consistently across the five subjects. In knowledge-based subjects (biology, earth and space, and recall-type chemistry or energy) an advanced concept means an obscure, little-known fact or topic: rate by how obscure it is (the more specialised and less widely taught, the higher), not by how long the question is`
export const levelName = (r: number) => r < 1 ? 'Newcomer' : r < 2 ? 'Developing' : r < 4 ? 'Regionals level' : r < 5 ? 'Strong regionals / nationals hopeful' : r < 6 ? 'Nationals qualification range' : r < 8 ? 'Nationals contender' : r < 9.5 ? 'Elite nationals' : 'Best in the nation'
const TEX = `Write math, chemistry and physics expressions in LaTeX inside $...$ (for example $\\frac{1}{2}mv^2$, $x^2+1$ or $\\ce{H2O}$); keep everything else plain text and never put LaTeX outside $...$. Because the reply is JSON, double every backslash (write \\\\frac, not \\frac).`
const EB_DESC = `the exact opening prefix of the toss-up ending at the earliest defensible buzz point for a strong Science Bowl competitor: include all decisive facts, calculations, constraints and clues needed to identify the answer, but omit trailing prompt filler such as "what is" or "name this" when the answer is already inferable. For "which of the following is correct/incorrect" or equivalent comparison questions, mark the point as soon as the relevant choice can reasonably be identified from the clue content, not automatically at the end of the stem; never anticipate information that has not yet been supplied. If choices are essential and cannot be judged before they are heard, mark the full stem`
const SHAPE = `{"topic":short topic,"d":difficulty 0-10 rounded to nearest tenth (e.g. 3.5; display later as 3.500),"tu":toss-up text 30-70 words,"eb":${EB_DESC},"choices":{"W":"","X":"","Y":"","Z":""},"ans":"W|X|Y|Z","bn":related bonus 30-60 words (make about half of them short answer); it must be fully self-contained: if it follows up on the toss-up's scenario, restate every fact, value, given quantity, condition and definition needed to answer it (the bonus is read on its own and must never rely on the toss-up text),"bc":{"W":"","X":"","Y":"","Z":""} only for a multiple-choice bonus (omit it for short answer),"ba":the letter W|X|Y|Z for multiple choice, or the answer itself in at most 6 words for short answer,"bx":[other acceptable short answers],"bnx":[answers that must be rejected, may be empty],"ex":worked solution under 120 words}`
const SHAPE_PKT = `{"sub":"..","topic":short topic,"d":difficulty 0-10 rounded to nearest tenth (e.g. 3.5; display later as 3.500),"misc":true if it is General Science or fits none of the subjects (then give the closest subject in "sub" and leave out "d"; otherwise omit it),"gs":true if the packet labelled it General Science,"tu":toss-up text,"eb":${EB_DESC},"choices":{"W":"","X":"","Y":"","Z":""} (only for a multiple-choice toss-up; omit for short answer),"ans":the letter W|X|Y|Z for multiple choice, or the official answer text for short answer,"ax":[other accepted answers],"nx":[answers the packet says NOT to accept],"bn":bonus text,"bc":{"W":"","X":"","Y":"","Z":""} (only for a multiple-choice bonus),"ba":the letter or the official answer text,"bx":[other accepted answers],"bnx":[answers the packet says NOT to accept],"ex":brief solution,"fl":[{"k":"math|format|transcription|source","n":note}] (only when something needs flagging)}`
const fixQ = (x: any) => {
  for (const k of ['tu', 'ans', 'bn', 'ba', 'ex', 'topic', 'eb']) if (typeof x[k] === 'string') x[k] = fixTex(x[k])
  for (const k of ['choices', 'bc']) if (x[k] && typeof x[k] === 'object') x[k] = Object.fromEntries(Object.entries(x[k]).map(([a, b]) => [a, fixTex(String(b))]))
  if (x.fl !== undefined) { const f = (Array.isArray(x.fl) ? x.fl : []).filter((t: any) => t && ['math', 'format', 'transcription', 'source'].includes(t.k) && typeof t.n === 'string' && t.n.trim()).slice(0, 8).map((t: any) => ({ k: t.k, n: t.n.trim().slice(0, 300) })); if (f.length) x.fl = f; else delete x.fl }
  for (const k of ['ax', 'nx', 'bx', 'bnx']) if (Array.isArray(x[k])) x[k] = x[k].map((t: any) => fixTex(String(t)))
  return x
}
/** Keeps a bonus only if it is a well-formed multiple-choice (bc + letter) or short-answer (answer text) bonus. */
export function cleanBonus(x: any) {
  const ba = String(x.ba ?? '').trim()
  if (!x.bn) { delete x.bc; delete x.ba; delete x.bx; delete x.bnx }
  else if (x.bc && /^[WXYZ]$/.test(ba)) { x.ba = ba; delete x.bx; delete x.bnx }
  else if (!x.bc && ba && !/^[WXYZ]$/.test(ba)) { x.ba = ba; x.bx = Array.isArray(x.bx) ? x.bx.map(String).slice(0, 6) : []; x.bnx = Array.isArray(x.bnx) ? x.bnx.map(String).slice(0, 6) : [] }
  else { delete x.bn; delete x.bc; delete x.ba; delete x.bx; delete x.bnx }
  return x
}
/** AI judge for typed answers that don't obviously match. Falls back to a forgiving text comparison if the AI is unavailable. */
export async function judge(stem: string, accepts: string[], typed: string, rejects: string[] = []): Promise<boolean> {
  try {
    const o = await aiJson<{ correct: boolean }>(`You are grading a Science Bowl response.\nQuestion: ${stem}\nOfficial answer(s): ${JSON.stringify(accepts)}. These are examples/explicit answers, NOT an exhaustive list: accept any scientifically or mathematically correct response that directly answers the question, including equivalent terminology, equivalent expressions, alternate correct methods, reasonable precision and accepted keyboard notation. Do not accept answers contradicted by question constraints or explicit reject list. ${rejects.length ? '\nDo NOT accept: ' + JSON.stringify(rejects) : ''}\nStudent response: ${JSON.stringify(typed)}\nMark it correct only if it clearly means the same thing as an official answer (an equivalent form, synonym, equal number or expression, or a harmless spelling error). Reject answers that are only partly right, vague, or merely related. Return ONLY JSON {"correct":true|false}.`)
    return o.correct === true
  } catch { return loose(typed, accepts) }
}
const ok = (x: any) => x && x.tu && x.ans // choices are optional: no choices = short answer
export const SUBTOPICS: Record<string, string[]> = {
  math: ['algebra and polynomials', 'plane geometry', 'solid geometry', 'combinatorics and counting', 'probability', 'number theory', 'trigonometry', 'single-variable calculus', 'multivariable calculus', 'linear algebra', 'sequences and series', 'complex numbers', 'conic sections', 'statistics', 'logic and set theory', 'functions and graphs', 'differential equations', 'inequalities', 'coordinate geometry', 'discrete math'],
  physics: ['kinematics', 'Newton’s laws and forces', 'work and energy', 'momentum and collisions', 'rotational motion', 'gravitation and orbits', 'oscillations and waves', 'sound', 'thermodynamics', 'kinetic theory of gases', 'electrostatics', 'DC circuits', 'magnetism and induction', 'optics', 'fluids', 'special relativity', 'quantum physics', 'nuclear physics', 'AC circuits', 'astrophysics'],
  chemistry: ['stoichiometry', 'atomic structure', 'periodic trends', 'chemical bonding', 'molecular geometry', 'gas laws', 'thermochemistry', 'kinetics', 'equilibrium', 'acids and bases', 'electrochemistry', 'organic reactions', 'organic nomenclature', 'solutions and colligative properties', 'spectroscopy', 'nuclear chemistry', 'biochemistry', 'analytical techniques'],
  biology: ['cell structure', 'metabolism and enzymes', 'photosynthesis and respiration', 'genetics and inheritance', 'molecular biology', 'evolution', 'ecology', 'human physiology', 'plant biology', 'microbiology', 'immunology', 'neuroscience', 'development', 'taxonomy and diversity', 'biotechnology', 'population genetics'],
  energy: ['fossil fuels: coal, oil and natural gas', 'nuclear fission reactors', 'nuclear fusion', 'solar power and photovoltaics', 'wind power', 'hydroelectric and tidal power', 'geothermal energy', 'biofuels and biomass', 'batteries and energy storage', 'fuel cells and hydrogen', 'the electrical grid and power transmission', 'heat engines and thermodynamic efficiency', 'energy units, conservation and conversion', 'energy in living systems', 'the carbon cycle and emissions', 'energy efficiency and conservation', 'nuclear waste and safety', 'renewable vs non-renewable resources'],
  'earth-space': ['plate tectonics', 'minerals and rocks', 'weather and climate', 'oceanography', 'the solar system', 'stars and stellar evolution', 'galaxies and cosmology', 'geologic time and fossils', 'earth’s interior and seismology', 'hydrology', 'astronomical observation', 'orbital mechanics', 'atmosphere and ozone', 'natural resources'],
}
const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - .5)
const recent = (sub: string): string[] => { try { return JSON.parse(lsGet('bl-recent-' + sub) || '[]') } catch { return [] } }
const remember = (sub: string, qs: Question[]) => lsSet('bl-recent-' + sub, JSON.stringify([...recent(sub), ...qs.map(q => q.tu.slice(0, 100))].slice(-150)))
const wordSet = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3))
const similar = (a: string, b: string) => { const x = wordSet(a), y = wordSet(b); if (!x.size || !y.size) return false; let n = 0; x.forEach(w => y.has(w) && n++); return n / Math.min(x.size, y.size) > .6 }
/** Independently calibrates generated questions against the shared NSB rubric. The generation target is deliberately omitted so it cannot anchor the final rating. */
async function calibrateGenerated(sub: Sub, qs: Question[]): Promise<Question[]> {
  const items = qs.map((q, i) => ({ i, subject: subName(sub), topic: q.topic, question: q.tu, choices: q.choices, correctAnswer: `${q.ans}) ${q.choices?.[q.ans] ?? q.ans}` }))
  const a = await aiJson<any[]>(`You are an independent National Science Bowl difficulty rater. Rate the ACTUAL difficulty of each question using this rubric: ${RUBRIC}. Ignore any difficulty the question generator may have been asked to target; that target is not provided here and must not be inferred. Do not rate by length, wording complexity, or how much text appears. Rate the scientific/mathematical concept level and the reasoning required for a strong NSB competitor to answer correctly. For multiple-choice questions, account for the plausible distractors, but do not lower the underlying conceptual difficulty just because four choices are present. Apply the subject-specific distinction in the rubric: in skill-based subjects judge the level of concepts and calculations; in knowledge-based subjects judge how obscure/specialized the required knowledge is. Use the anchors exactly: 0-2 middle-school level; 2.0-2.5 basic high school; 3.5-4.0 average NSB high-school Regionals; 4.5-5 nationals-qualification bubble / typical nationals round-robin with college-intro depth; 6-7 solid nationals contender; 8 nationals playoff; 9 national finals; 10 best-in-the-nation finals-clinching difficulty. Return a rating rounded to the nearest tenth (for storage; display with three decimal places). Calibrate all items consistently. Items: ${JSON.stringify(items)}. Return ONLY a JSON array with one object per item: {"i":index,"d":number from 0 to 10 with rounded to one decimal}.`,'medium',.15)
  const ratings = new Map<number, number>()
  for (const x of Array.isArray(a) ? a : []) {
    const i = Number(x?.i), d = Number(x?.d)
    if (Number.isInteger(i) && i >= 0 && i < qs.length && Number.isFinite(d) && d >= 0 && d <= 10) ratings.set(i, Math.round(d * 10) / 10)
  }
  if (ratings.size !== qs.length) throw new Error('The AI did not return a valid independent difficulty rating for every generated question.')
  return qs.map((q, i) => ({ ...q, d: ratings.get(i)!, ai: true, dr: false }))
}
/** Writes questions. To stop the AI repeating itself: each question gets its own random subtopic, the model is shown recent questions to avoid, the temperature is high, and near-duplicates are thrown away. */
export async function gen(sub: Sub, diffs: number[], tp?: string): Promise<Question[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const avoid = recent(sub), topics = tp ? diffs.map(() => tp) : shuffle(SUBTOPICS[sub] || []).slice(0, diffs.length)
    const a = await aiJson<any[]>(`Write ${diffs.length} National Science Bowl ${subName(sub)} toss-up questions at these difficulties, in order: ${JSON.stringify(diffs)}. ${RUBRIC}. Each question must genuinely sit at its stated level. For Math and Physics, assess conceptual sophistication separately from calculation workload: eigenvalues, eigenvectors, multivariable calculus, linear algebra, differential equations and comparable advanced concepts typically target 7-8 even if computation is short; routine Calc I/II concepts generally remain below 5 unless application/synthesis raises the difficulty. Energy must use the most suitable core-subject framework for each item. From difficulty 3 up, avoid trivia and plain definitions and require reasoning. From 5 up, require multi-step quantitative reasoning or synthesis of several concepts. At 8-10 write challenging competition-style problems with non-trivial calculations, lesser-known results or subtle conceptual traps. Exactly one choice is correct. The three distractors must be plausible, scientifically/mathematically coherent alternatives based on common misconceptions or calculation errors. CRITICAL MCQ quality rules: all four choices must be parallel in type, grammatical form, specificity, and approximate length; conduct a final answer-leak audit: choices must not reveal the correct answer through option length, uniqueness, repeated stem wording, grammatical agreement, units, specificity, explanation-like phrasing, or obvious distractor absurdity; no choice may stand out by being longer, more detailed, more precise, or differently worded; do not make the correct choice the only one with units, qualifiers, a complete sentence, or a technically valid term; avoid absurd or unrelated distractors; do not repeat a distinctive phrase from the stem only in the correct choice; do not make the answer obvious through grammar, wording, formatting, magnitude, or option structure. Make distractors genuinely competitive and independently plausible. Ensure exactly one is correct, then solve the problem and verify every distractor is incorrect for a clear reason. Make each toss-up self-contained. Make each bonus self-contained too: the bonus is read aloud by itself, so if it builds on the toss-up's scenario, repeat in the bonus every piece of information (numbers, units, conditions, named objects, setup) required to answer it, and never use phrases like "in this scenario", "the same system" or "the previous question" without restating what they refer to; before returning, check that someone who never heard the toss-up could answer the bonus. ${tp ? 'Topic focus: ' + tp + ' (but vary the angle each time). ' : 'Give each question its own subtopic, in order: ' + JSON.stringify(topics) + '. '}Use a different scenario, object, system or setting in every question. Do NOT repeat or closely paraphrase any of these recent questions: ${JSON.stringify(avoid.slice(-25))}. ${TEX} Return ONLY a JSON array of ${SHAPE}. Vary the answer letters.`, 'medium', .95)
    const seen: string[] = [], out: Question[] = []
    for (const x of a.filter(x => ok(x) && x.choices)) { const rawD = Number(x.d); const q = cleanBonus(fixQ({ ...x, sub, ai: true, d: Number.isFinite(rawD) ? clamp(rawD, 0, 10) : clamp(diffs[out.length] ?? diffs[0] ?? 5, 0, 10) })); if ([...avoid, ...seen].some(s => similar(s, q.tu))) continue; seen.push(q.tu); out.push(q) }
    if (out.length) {
      try { const calibrated = await calibrateGenerated(sub, out); remember(sub, calibrated); return calibrated }
      catch { if (attempt === 1) return [] }
    }
  }
  return []
}
const SUBS = ALL_SUBJECTS.map(x => x[0])
export function chunkText(text: string): string[] {
  const ch: string[] = []
  for (let i = 0; i < text.length && ch.length < 40;) { let e = Math.min(text.length, i + 4500); const n = text.lastIndexOf('\n', e); if (e < text.length && n > i + 1500) e = n; ch.push(text.slice(i, e)); i = e }
  return ch
}
/** One chunk of a packet -> questions for ANY subject, labelled. Which subjects players see is the moderator's choice. `note` = the moderator's description of this packet. */
export async function extractChunk(c: string, note = ''): Promise<Question[]> {
  const a = await aiJson<any[]>(`Below is raw text from a Science Bowl packet.${note.trim() ? ' Moderator note about how to read this packet: ' + note.trim().slice(0, 1200) + '.' : ''} Extract every toss-up question (with its bonus if present). Label each with "sub", one of ${JSON.stringify(SUBS)}. Questions about energy resources and technology (fossil fuels, nuclear power, solar, wind, hydro, geothermal, biofuels, batteries and storage, the electrical grid, energy efficiency), including any the packet labelled Energy, get "sub":"energy". General Science questions, and any question that genuinely fits none of the subjects (it spans several of them or tests general scientific knowledge), are Miscellaneous: give them the closest subject from that list in "sub", set "misc":true (and "gs":true if the packet called it General Science) and give no difficulty. Be conservative: a question that clearly belongs to one subject is never Miscellaneous. Skip questions cut off at the edges. Rate each question's "d" on this scale: ${RUBRIC} Return ONLY a JSON array of ${SHAPE_PKT}. Keep the original wording, except for mathematics, which you rebuild as readable LaTeX: (1) Convert text descriptions of math into LaTeX. If part of an expression is blurry, garbled or unreadable in the scan but a readable text description is given (such as "sine of x squared plus one", or a fraction whose numerator and denominator the description identifies), reconstruct the term from the description (a fraction becomes \\frac{numerator}{denominator}); once the description's closing bracket is reached, replace the garbled part and the whole description (brackets included) with just the LaTeX, leaving no description behind. (2) Repair flattened exponents and subscripts such as x4 or x^4 written as x4, so that $x4$ meaning x to the fourth becomes $x^4$, when the context makes the meaning clear. (3) Reconstruct roots, integrals (with limits of integration), limits, fractions, summations, inequalities, trigonometric functions and matrices whenever the transcription gives enough information. (4) Never guess: if the source does not allow a confident reconstruction (for example "x4" could be x^4 or x_4 and nothing decides it, or the unreadable part has no description), keep what is readable, do not invent the missing math, and record the ambiguity in "fl". (5) Use "fl" to flag problems separately by kind, as a list of {"k":kind,"n":short note}: "math" only for an actual mathematical error in the source itself (a wrong answer, an impossible value, an inconsistent calculation); "format" for flattened or mis-formatted notation you repaired; "transcription" for text garbled in extraction (including blurry parts you rebuilt from a description or could not rebuild); "source" for other scan-quality problems such as cut-off text. Never label a formatting, transcription or scan-quality problem as "math", and do not change a question's answer to fix a suspected math error: flag it. Omit "fl" when there is nothing to flag. Keep short-answer questions as short answer (never invent choices). Copy "accept ..." notes into ax / bx and "do not accept ..." notes into nx / bnx, and leave them out of the answer itself. Omit bn/bc/ba if there is no bonus. ${TEX} Text:\n` + c)
  return (Array.isArray(a) ? a : []).filter(x => ok(x) && SUBS.includes(x.sub)).map(x => cleanBonus(fixQ(x.misc === true || x.gs === true ? { ...x, misc: true, ai: false, dr: false, d: 5 } : { ...x, ai: false, dr: true, d: clamp(Number.isFinite(+x.d) ? +x.d : 5, 0, 10) })))
}
const GUESS = .25 // 4 choices, so blind guessing is right a quarter of the time
export const pCorrect = (t: number, d: number) => GUESS + (1 - GUESS) / (1 + Math.exp(-(t - d) / 1))
/** Bayesian ability estimate on the 0-10 scale. Every answer shifts it; harder questions shift it more when answered correctly. */
export class Ability {
  grid = Array.from({ length: 101 }, (_, i) => i / 10); w: number[]; n = 0
  constructor(mean = 4, sd = 3.5) { this.w = this.grid.map(t => Math.exp(-((t - mean) ** 2) / (2 * sd * sd))); this.norm() }
  private norm() { const s = this.w.reduce((a, b) => a + b, 0); this.w = this.w.map(x => x / s) }
  /** `idk` = the player chose "I don't know" (no guess floor); `mc` = false for short answer (guessing is no help there). */
  update(d: number, ok: boolean, idk = false, mc = true) {
    this.w = this.w.map((x, i) => { const t = this.grid[i], pn = 1 / (1 + Math.exp(-(t - d))), pc = mc ? pCorrect(t, d) : pn; return x * (idk ? 1 - pn : ok ? pc : 1 - pc) })
    this.norm(); this.n++
  }
  get mean() { return this.grid.reduce((a, t, i) => a + t * this.w[i], 0) }
  get sd() { const m = this.mean; return Math.sqrt(this.grid.reduce((a, t, i) => a + (t - m) ** 2 * this.w[i], 0)) }
}
/** Supplies placement questions near a target difficulty: uploaded packets first, AI-generated (flagged) when none fit. */
export class PlacementPool {
  used = new Set<string>(); cache: Question[] = []
  constructor(public sub: Sub) {}
  /** Only questions whose difficulty was rated on the current scale (multiple choice or short answer). */
  bank() { return store.bank().filter(x => x.sub === this.sub && x.dr && !this.used.has(x.tu)) }
  async warm() { if (this.bank().length >= 30) return; const r = await Promise.allSettled([gen(this.sub, [1, 2, 3, 4]), gen(this.sub, [5, 6, 7, 9])]); for (const x of r) if (x.status === 'fulfilled') this.cache.push(...x.value) }
  pick(t: number) { const c = [...this.bank(), ...this.cache.filter(x => !this.used.has(x.tu))].filter(x => Math.abs(x.d - t) <= .75).sort((a, b) => Math.abs(a.d - t) - Math.abs(b.d - t)); return c[Math.floor(Math.random() * Math.min(3, c.length))] }
  async next(t: number): Promise<Question | undefined> {
    let q = this.pick(t)
    if (!q) { const d = clamp(Math.round(t), 0, 10); this.cache.push(...await gen(this.sub, [d, d, d])); q = this.pick(t) || this.cache.filter(x => !this.used.has(x.tu)).sort((a, b) => Math.abs(a.d - t) - Math.abs(b.d - t))[0] }
    if (q) this.used.add(q.tu); return q
  }
}

const clean = (s: any) => String(s || '').trim().slice(0, 40)
export { metaFromName, qMeta, type Meta } from './read'
/** Asks the AI to read the packet's source / year / set / round; falls back to the file name. */
export async function aiMeta(name: string, head: string, note = ''): Promise<Meta> {
  const fb = metaFromName(name)
  try {
    const o = await aiJson<any>(`Identify this Science Bowl packet. File name: "${name}". Start of text: ${JSON.stringify(head.slice(0, 1500))}.${note.trim() ? ' Moderator note: ' + note.trim().slice(0, 600) + '.' : ''} Return ONLY JSON {"source":"organization or competition, e.g. NSB, MIT, Texas","year":"4-digit year or empty","set":"set or tournament name, e.g. Regionals or Nationals, or empty","round":"e.g. Round 5, or empty"}.`)
    return { src: clean(o.source) || fb.src, year: clean(o.year) || fb.year, set: clean(o.set) || fb.set, rnd: clean(o.round) || fb.rnd }
  } catch { return fb }
}
