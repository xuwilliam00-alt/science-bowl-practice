// Cloudflare Worker: holds the Groq key so it never reaches the browser.
// Browser -> POST {prompt, json} + x-access-code header -> this Worker -> Groq.
export interface Env { GROQ_API_KEY: string; GROQ_MODEL?: string; ACCESS_CODE: string; ALLOWED_ORIGINS: string; ROOM: any; ACCOUNTS: any }
export { Room } from './room'
export { Accounts } from './accounts'
const MODEL = 'openai/gpt-oss-120b'
const same = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0 }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/room/')) { // live team rooms (WebSocket -> Durable Object)
      const o = req.headers.get('origin') || '', okO = (env.ALLOWED_ORIGINS || '').split(',').map((s: string) => s.trim()).includes(o)
      if (!okO) return new Response('origin not allowed', { status: 403 })
      if (!env.ACCESS_CODE || !same(url.searchParams.get('c') || '', env.ACCESS_CODE)) return new Response('bad access code', { status: 401 })
      const code = url.pathname.slice(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MAIN'
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req)
    }
    const origin = req.headers.get('origin') || '', allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    const ok = allowed.includes(origin)
    const cors: Record<string, string> = { 'access-control-allow-origin': ok ? origin : allowed[0] || '', 'access-control-allow-headers': 'content-type,x-access-code,authorization', 'access-control-allow-methods': 'POST,OPTIONS', vary: 'origin' }
    const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (!ok) return out({ error: 'origin not allowed' }, 403)
    if (req.method !== 'POST') return out({ error: 'POST only' }, 405)
    if (!env.ACCESS_CODE || !same(req.headers.get('x-access-code') || '', env.ACCESS_CODE)) return out({ error: 'bad access code' }, 401)
    if (url.pathname === '/api/verify-code') return out({ ok: true })
    if (url.pathname.startsWith('/api/')) { // accounts, friends, profile sync (Durable Object)
      const r = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('main')).fetch(req)
      return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': 'application/json' } })
    }
    let body: any; try { body = await req.json() } catch { return out({ error: 'bad json' }, 400) }
    const prompt = String(body?.prompt || '')
    if (!prompt || prompt.length > 40000) return out({ error: 'prompt missing or too long' }, 400)
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({ model: env.GROQ_MODEL || MODEL, temperature: typeof body.temp === 'number' ? Math.min(1.2, Math.max(0, body.temp)) : body.json ? 0.3 : 0.6, max_completion_tokens: 8192, reasoning_effort: body.effort === 'medium' ? 'medium' : 'low', messages: [...(body.json ? [{ role: 'system', content: 'Reply with valid JSON only: no prose and no markdown fences.' }] : []), { role: 'user', content: prompt }] }) })
    if (!r.ok) return out({ error: 'upstream ' + r.status }, r.status === 429 ? 429 : 502)
    const j: any = await r.json()
    return out({ text: j.choices?.[0]?.message?.content || '' })
  },
}
