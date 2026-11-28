import { lsGet, lsSet } from './platform'
import type { GameRec } from './types'
const key = (u: string) => 'bl-hist:' + (u || 'guest')
/** Game history is kept in this browser (per signed-in name), newest last. */
export const loadHist = (u: string): GameRec[] => { try { return JSON.parse(lsGet(key(u)) || '[]') } catch { return [] } }
export function addGame(u: string, g: GameRec) {
  const a = loadHist(u).filter(x => x.id !== g.id); a.push(g); a.sort((x, y) => x.ts - y.ts)
  let out = a.slice(-120); while (out.length > 1 && JSON.stringify(out).length > 2_000_000) out = out.slice(1)
  lsSet(key(u), JSON.stringify(out))
}
export const clearHist = (u: string) => lsSet(key(u), '[]')

/** Updates a saved game record by id, preserving other history. */
export function updateGame(u: string, g: GameRec) { const a = loadHist(u).map(x => x.id === g.id ? g : x); lsSet(key(u), JSON.stringify(a)); }
