import { useEffect, useState } from 'react'
import { lsGet, lsSet } from './platform'
export type MemeKind = 'neg' | 'fast' | 'interrupt'
const M: Record<MemeKind, [string, string][]> = {
  neg: [['💀', 'Bro negged. Aura −500.'], ['🫠', 'That was a choice.'], ['🧊', 'Cooked. Absolutely cooked.'], ['📉', 'Stonks: down 4 points.'], ['🤡', 'Buzz first, think later?'], ['🚨', 'Neg alert. Confidence: high. Accuracy: not.']],
  fast: [['⚡', 'Speedrun any%. Locked in.'], ['🏎️', 'Zoom. Buzzer finger = elite.'], ['🧠', 'Big brain, instant buzz.'], ['🐐', 'Goated reflexes.'], ['😎', 'Read the whole question? Couldn’t be me.']],
  interrupt: [['🔔', 'Interrupted AND correct. Main character energy.'], ['🎯', 'Sniped it mid-sentence.'], ['🔥', 'Cooking! Interrupt secured.']],
}
let push: (m: { e: string; t: string }) => void = () => {}, tmr: any
export const memesOn = () => lsGet('bl-memes') !== 'off'
export const setMemes = (on: boolean) => lsSet('bl-memes', on ? 'on' : 'off')
/** Shows a short reaction pop-up (emoji + caption) if memes are enabled in Settings. */
export function meme(kind: MemeKind, who?: string) { if (!memesOn()) return; const [e, t] = M[kind][Math.floor(Math.random() * M[kind].length)]; push({ e, t: (who ? who + ': ' : '') + t }) }
export function MemeHost() {
  const [m, setM] = useState<{ e: string; t: string } | null>(null)
  useEffect(() => { push = x => { setM(x); clearTimeout(tmr); tmr = setTimeout(() => setM(null), 2600) } }, [])
  return m ? <div className="meme" role="status"><span>{m.e}</span><b>{m.t}</b></div> : null
}
