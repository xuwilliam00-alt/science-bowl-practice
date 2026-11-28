import { useSyncExternalStore } from 'react'
import { API, accessCode, getCode, lsGet, lsSet, setCode } from './platform'
import type { Profile } from './types'
export interface Friend { name: string; online: boolean; r: Record<string, number> }
export interface Social { me: string; friends: Friend[]; incoming: string[]; outgoing: string[]; invites: { id: number; frm: string; room: string }[] }
/** Sign-in state. The session token lives in this browser (or just this tab if the browser blocks storage). */
let tok = lsGet('bl-token') || '', user = lsGet('bl-user') || ''
const L = new Set<() => void>(), ping = () => L.forEach(f => f())
export const accGet = () => user
export const useUser = () => useSyncExternalStore(f => { L.add(f); return () => { L.delete(f) } }, accGet)
const setSession = (t: string, u: string) => { tok = t; user = u; lsSet('bl-token', t); lsSet('bl-user', u); ping() }
export const available = true

const enc = new TextEncoder()
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
async function localHash(pw: string, salt: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256))
}
interface LocalUser { salt: string; hash: string; profile: Profile | null }
const getLocalUsers = (): Record<string, LocalUser> => { try { return JSON.parse(lsGet('bl-local-users') || '{}') } catch { return {} } }
const saveLocalUsers = (u: Record<string, LocalUser>) => lsSet('bl-local-users', JSON.stringify(u))

async function call<T = any>(path: string, body: unknown = {}, auth = true): Promise<T> {
  if (!API) throw new Error('Accounts need the Cloudflare server (see README).')
  const code = await accessCode()
  const r = await fetch(`${API}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': code, ...(auth && tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })
  const j: any = await r.json().catch(() => ({}))
  if (r.status === 401 && j.error === 'bad access code') { setCode(''); throw new Error('Wrong site password.') }
  if (r.status === 401 && auth && tok) { setSession('', ''); throw new Error('Your session expired. Please sign in again.') }
  if (!r.ok) throw new Error(j.error || 'Server error ' + r.status)
  return j
}
export async function signIn(mode: 'login' | 'register', username: string, password: string) {
  if (API) {
    const j = await call(mode, { username, password }, false)
    setSession(j.token, j.username)
    return j.username as string
  }
  const u = username.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,20}$/.test(u)) throw new Error('Username must be 3–20 letters, numbers, or underscores.')
  if (password.length < 4) throw new Error('Password must be at least 4 characters.')
  const users = getLocalUsers()
  if (mode === 'register') {
    if (users[u]) throw new Error('That username is already taken.')
    const salt = crypto.randomUUID()
    const hash = await localHash(password, salt)
    users[u] = { salt, hash, profile: null }
    saveLocalUsers(users)
    setSession('local-' + crypto.randomUUID(), u)
    return u
  } else {
    const rec = users[u]
    if (!rec) throw new Error('Invalid username or password.')
    const hash = await localHash(password, rec.salt)
    if (hash !== rec.hash) throw new Error('Invalid username or password.')
    setSession('local-' + crypto.randomUUID(), u)
    return u
  }
}
export async function signOut() {
  if (API) { try { if (tok) await call('logout') } catch { /* already gone */ } }
  setSession('', '')
}
/** On page load: drop the saved session if the server no longer accepts it. */
export async function verify() {
  if (!tok) return false
  if (!API) return !!user && !!getLocalUsers()[user]
  try { await call('me'); return true } catch (e: any) { return /expired/.test(e.message) ? false : !!tok }
}
export const getProfile = async (): Promise<Profile | null> => {
  if (!API) return getLocalUsers()[user]?.profile || null
  return (await call('profile/get')).profile
}
export const putProfile = async (p: Profile) => {
  if (!API) {
    if (!user) return
    const users = getLocalUsers()
    if (users[user]) { users[user].profile = p; saveLocalUsers(users) }
    return
  }
  return call('profile/put', { profile: p })
}
// ---- saving the profile in the background ----
let timer: any, latest: Profile | null = null
const flush = () => { clearTimeout(timer); if (latest && user) { const p = latest; latest = null; putProfile(p).catch(() => { latest ||= p }) } }
/** Called after every profile change; waits a few seconds so one game doesn't send dozens of saves. */
export const scheduleSave = (p: Profile) => {
  if (!user) return
  if (!API) { putProfile(p); return }
  latest = p; clearTimeout(timer); timer = setTimeout(flush, 4000)
}
addEventListener('pagehide', () => { if (latest && user && API) { try { fetch(`${API}/api/profile/put`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-access-code': (getCode() || ''), authorization: 'Bearer ' + tok }, body: JSON.stringify({ profile: latest }) }) } catch { /* best effort */ } } })
// ---- friends ----
export const social = async (): Promise<Social> => {
  if (!API) return { me: user, friends: [], incoming: [], outgoing: [], invites: [] }
  return call<Social>('friends')
}
export const friendAction = (a: 'request' | 'accept' | 'decline' | 'remove', who: string) => call('friends/' + a, a === 'request' ? { to: who } : a === 'remove' ? { user: who } : { from: who })
export const invite = (to: string, room: string) => call('invite', { to, room })
export const dismissInvite = (id: number) => call('invite/dismiss', { id })
