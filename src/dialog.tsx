import { useEffect, useState } from 'react'
type D = { title: string; msg: string; input?: 'text' | 'password'; ok: string; cancel?: boolean; res: (v: string | null) => void }
type TT = { text: string; ok: boolean }
let push: (d: D) => void = () => {}, pushT: (t: TT) => void = () => {}, tm: any
/** In-page replacements for prompt()/alert(), which are blocked inside Google Sites embeds. */
export const askText = (title: string, msg = '', input: 'text' | 'password' = 'text') => new Promise<string | null>(res => push({ title, msg, input, ok: 'Continue', res }))
export const tell = (title: string, msg = '') => new Promise<void>(res => push({ title, msg, ok: 'OK', res: () => res() }))
/** Yes/no question in the page (never a browser dialog). */
export const confirmBox = (title: string, msg = '', ok = 'Delete') => new Promise<boolean>(res => push({ title, msg, ok, cancel: true, res: v => res(v === 'ok') }))
/** A short banner at the top of the screen, e.g. "Groq key accepted". */
export const toast = (text: string, ok = true) => pushT({ text, ok })
export function DialogHost() {
  const [d, setD] = useState<D | null>(null), [v, setV] = useState(''), [t, setT] = useState<TT | null>(null)
  useEffect(() => { push = x => { setV(''); setD(x) }; pushT = x => { setT(x); clearTimeout(tm); tm = setTimeout(() => setT(null), 5000) } }, [])
  const done = (r: string | null) => { d?.res(r); setD(null) }
  return <>
    {t && <div className={'toast ' + (t.ok ? 'ok' : 'no')} role="status">{t.ok ? '✓ ' : '✗ '}{t.text}</div>}
    {d && <div className="modal"><form className="gate-card" onSubmit={e => { e.preventDefault(); done(d.input ? v : 'ok') }}>
      <h2 style={{ margin: 0 }}>{d.title}</h2>{d.msg && <div className="mu">{d.msg}</div>}
      {d.input && <input autoFocus type={d.input} value={v} onChange={e => setV(e.target.value)} />}
      <div className="row">{(d.input || d.cancel) && <button type="button" onClick={() => done(null)}>Cancel</button>}<button className="p" type="submit">{d.ok}</button></div></form></div>}</>
}
