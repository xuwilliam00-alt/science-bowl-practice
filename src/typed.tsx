import { useEffect, useRef, useState } from 'react'
/** Free-text answer box. With `auto` it submits itself after that many seconds (used when the server owns the clock). */
export function TypedBox({ label, onChange, onSubmit, auto }: { label: string; onChange?: (t: string) => void; onSubmit: (t: string) => void; auto?: number }) {
  const [t, setT] = useState(''), done = useRef(false), cur = useRef('')
  cur.current = t
  const go = () => { if (done.current) return; done.current = true; onSubmit(cur.current) }
  useEffect(() => { if (!auto) return; const id = setTimeout(go, auto * 1000); return () => clearTimeout(id) }, [])
  return <form className="card" onSubmit={e => { e.preventDefault(); go() }}><div className="mu">{label}</div>
    <div className="row"><input autoFocus value={t} onChange={e => { setT(e.target.value); onChange?.(e.target.value) }} style={{ flex: 3 }} /><button className="p" type="submit">Submit</button></div></form>
}
