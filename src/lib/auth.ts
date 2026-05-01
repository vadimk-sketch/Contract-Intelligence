import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { SignJWT, jwtVerify } from 'jose'
import type { AppEnv, SessionUser, AppRole } from '../types/bindings'
import { newId } from './ids'

const SESSION_COOKIE = 'sl_session'
const SESSION_TTL_HOURS = 24

function getSessionSecret(c: Context<AppEnv>): Uint8Array {
  const raw = c.env.SESSION_SECRET || 'dev-only-insecure-session-secret-change-me'
  return new TextEncoder().encode(raw)
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<string> {
  const sessionId = newId('sess')
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString()
  const ip = c.req.header('cf-connecting-ip') || ''
  const ua = c.req.header('user-agent') || ''

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, expiresAt, ip, ua).run()

  await c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(userId).run()

  const token = await new SignJWT({ sid: sessionId, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(getSessionSecret(c))

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600
  })
  return sessionId
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSessionSecret(c))
      const sid = payload.sid as string
      if (sid) {
        await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run()
      }
    } catch { /* ignore */ }
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function isProduction(c: Context<AppEnv>): boolean {
  return (c.env.ENVIRONMENT || '').toLowerCase() === 'production'
}

export function isSsoConfigured(c: Context<AppEnv>): boolean {
  return !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET)
}

export async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  // Dev auto-login bypass — sandbox-only, never honored in production
  if (!isProduction(c)) {
    const devEmail = c.env.DEV_AUTO_LOGIN_EMAIL
    if (devEmail) {
      const row = await c.env.DB.prepare(
        `SELECT id, email, name, role, department_id FROM users WHERE email = ? AND status = 'active'`
      ).bind(devEmail).first<SessionUser>()
      if (row) return row
    }
  }

  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(c))
    const sid = payload.sid as string
    if (!sid) return null
    const session = await c.env.DB.prepare(
      `SELECT s.user_id, s.expires_at FROM sessions s WHERE s.id = ?`
    ).bind(sid).first<{ user_id: string; expires_at: string }>()
    if (!session) return null
    if (new Date(session.expires_at) < new Date()) return null

    const user = await c.env.DB.prepare(
      `SELECT id, email, name, role, department_id FROM users WHERE id = ? AND status = 'active'`
    ).bind(session.user_id).first<SessionUser>()
    return user || null
  } catch {
    return null
  }
}

export function requireAuth() {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = await loadUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    c.set('user', user)
    await next()
  }
}

export function requireRole(...roles: AppRole[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (!roles.includes(user.role)) return c.json({ error: 'forbidden' }, 403)
    await next()
  }
}

// Helper: check if user can access a document (department-scoped)
export async function canAccessDocument(
  c: Context<AppEnv>,
  documentId: string
): Promise<boolean> {
  const user = c.get('user')
  if (!user) return false
  if (user.role === 'admin' || user.role === 'system') return true
  const doc = await c.env.DB.prepare(
    `SELECT department_id FROM documents WHERE id = ?`
  ).bind(documentId).first<{ department_id: string }>()
  if (!doc) return false
  if (user.role === 'readonly') return false // readonly handled via separate sharing
  return doc.department_id === user.department_id
}
