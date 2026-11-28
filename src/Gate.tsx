import { useEffect, useState, type ReactNode } from 'react'
import { GATE } from './gateHash'
import { API, getCode, setCode, verifyAccessCode } from './platform'
import { signIn, useUser } from './account'

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
async function checkLocalHash(pw: string) {
  if (!GATE.hash) return false
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64(GATE.salt), iterations: GATE.iter, hash: 'SHA-256' }, k, 256)
  return btoa(String.fromCharCode(...new Uint8Array(bits))) === GATE.hash
}
const ss = {
  get: () => { try { return sessionStorage.getItem('bl-ok') } catch { return null } },
  set: () => { try { sessionStorage.setItem('bl-ok', '1') } catch { /* ignore */ } },
  clear: () => { try { sessionStorage.removeItem('bl-ok') } catch { /* ignore */ } }
}

/** Two-step Gate:
 *  Step 1: Enter the site access code (validated against local GATE hash and/or Cloudflare Worker ACCESS_CODE).
 *  Step 2: Sign in or create an account (or continue without an account).
 */
export default function Gate({ children }: { children: ReactNode }) {
  const user = useUser()
  const [siteOk, setSiteOk] = useState(() => ss.get() === '1' && !!getCode())
  const [guest, setGuest] = useState(false)
  const [sitePw, setSitePw] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [u, setU] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [fails, setFails] = useState(0)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t) }, [wait])

  // Step 1: Always require the access code first before showing the sign-in screen
  if (!siteOk) {
    const submitSite = async (e: React.FormEvent) => {
      e.preventDefault()
      if (busy || wait > 0 || !sitePw.trim()) return
      setBusy(true)
      setErr('')
      let good = false
      try {
        if (GATE.hash) {
          good = await checkLocalHash(sitePw)
        }
        if (!good && API) {
          good = await verifyAccessCode(sitePw)
        }
        if (!GATE.hash && !API) {
          setErr('Access code not configured yet. Run `npm run set-password -- "your-code"` or deploy the Cloudflare Worker.')
          setBusy(false)
          return
        }
      } catch {
        setErr('Could not verify access code. Check your connection or HTTPS address.')
        setBusy(false)
        return
      }
      setBusy(false)
      if (good) {
        setCode(sitePw)
        ss.set()
        setSiteOk(true)
        setErr('')
      } else {
        const f = fails + 1
        setFails(f)
        setSitePw('')
        setErr('Incorrect access code. Please try again.')
        if (f >= 3) setWait(Math.min(60, 5 * 2 ** (f - 3)))
      }
    }

    return (
      <div className="gate">
        <form className="gate-card" onSubmit={submitSite}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="10" rx="2" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
          <h1>Science Bowl Practice</h1>
          <div className="mu">buzzer trainer</div>
          <div className="mu">Private access. Enter the access code to reach the sign-in screen.</div>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="Access code"
            value={sitePw}
            onChange={e => { setSitePw(e.target.value); setErr('') }}
            aria-label="Access code"
          />
          <button className="p" type="submit" disabled={busy || wait > 0 || !sitePw.trim()}>
            {busy ? 'Checking…' : wait > 0 ? `Try again in ${wait}s` : 'Continue'}
          </button>
          <div className="gate-err" role="alert">{err}</div>
          <div className="mu gate-foot">Need an access code? Contact the site administrator.</div>
        </form>
      </div>
    )
  }

  // Step 2: Once access code is verified, show the app if signed in or guest; otherwise show Sign In / Create Account
  if (user || guest) return <>{children}</>

  const submitAcct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !u.trim() || !pw) return
    if (mode === 'register' && pw !== pw2) return setErr('The two passwords don’t match.')
    setBusy(true)
    setErr('')
    try {
      await signIn(mode, u, pw)
    } catch (x: any) {
      if (/wrong site password/i.test(x.message || '')) {
        setCode('')
        ss.clear()
        setSiteOk(false)
        setSitePw('')
      }
      setErr(x.message || 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submitAcct}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.8-4 14.2-4 16 0" />
        </svg>
        <h1>Science Bowl Practice</h1>
        <div className="mu">
          {mode === 'login' ? 'Sign in to load your ratings and progress.' : 'Create an account to save your ratings and stats.'}
        </div>
        <div className="row">
          <button type="button" className={mode === 'login' ? 'p' : ''} onClick={() => { setMode('login'); setErr('') }}>
            Sign in
          </button>
          <button type="button" className={mode === 'register' ? 'p' : ''} onClick={() => { setMode('register'); setErr('') }}>
            Create account
          </button>
        </div>
        <input
          type="text"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          maxLength={20}
          placeholder="Username"
          value={u}
          onChange={e => { setU(e.target.value); setErr('') }}
          aria-label="Username"
        />
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="Password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr('') }}
          aria-label="Password"
        />
        {mode === 'register' && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat password"
            value={pw2}
            onChange={e => { setPw2(e.target.value); setErr('') }}
            aria-label="Repeat password"
          />
        )}
        <button className="p" type="submit" disabled={busy || !u.trim() || !pw}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div className="gate-err" role="alert">{err}</div>
        <div className="gate-foot" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="mu">
            {mode === 'login' ? 'Usernames are 3–20 letters, numbers, or underscores.' : 'Choose a password you will remember.'}
          </div>
          <button type="button" onClick={() => setGuest(true)} style={{ fontSize: 13 }}>
            Continue without an account
          </button>
        </div>
      </form>
    </div>
  )
}
