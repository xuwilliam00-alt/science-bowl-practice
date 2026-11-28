import { Tex } from './tex'
export interface Mk { words: string[]; starts: number[]; nq: number; buzz: number | null; ok: boolean | null; early: number }
/** The question with markers: gray = earliest realistic buzz point, green/red = where you buzzed (correct/incorrect). A marker sits before word number `count`. */
export function Marked({ mk }: { mk: Mk }) {
  const out: JSX.Element[] = [], n = mk.words.length
  const mark = (k: string, cls: string, tip: string) => <span key={k} className={'mk ' + cls} title={tip} />
  mk.words.forEach((w, i) => {
    if (i === mk.early) out.push(mark('e' + i, 'gray', 'Earliest realistic buzz point'))
    if (mk.buzz !== null && i === mk.buzz) out.push(mark('b' + i, mk.ok ? 'green' : 'red', mk.ok ? 'You buzzed here (correct)' : 'You buzzed here (incorrect)'))
    const nl = mk.starts.includes(i); if (nl) out.push(<br key={'n' + i} />)
    out.push(<span key={i}>{i && !nl ? ' ' : ''}<Tex s={w} /></span>)
  })
  if (mk.early >= n) out.push(mark('e-end', 'gray', 'Earliest realistic buzz point'))
  if (mk.buzz !== null && mk.buzz >= n) out.push(mark('b-end', mk.ok ? 'green' : 'red', 'You buzzed here'))
  return <div><div className="q" style={{ minHeight: 0 }}>{out}</div>
    <div className="mu" style={{ fontSize: 13, marginTop: 6 }}><span className="mk gray" /> earliest realistic buzz point{mk.buzz !== null && <> · <span className={'mk ' + (mk.ok ? 'green' : 'red')} /> where you buzzed ({mk.ok ? 'correct' : 'incorrect'})</>}</div></div>
}
