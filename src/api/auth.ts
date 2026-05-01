// Auth routes: Google SSO + dev-mode email login (for sandbox testing)
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { createSession, destroySession, loadUser, isProduction, isSsoConfigured } from '../lib/auth'
import { audit } from '../lib/audit'

const auth = new Hono<AppEnv>()

// Current user (also exposes auth-method capabilities to the frontend)
auth.get('/me', async (c) => {
  const user = await loadUser(c)
  const sso_enabled = isSsoConfigured(c)
  const dev_login_enabled = !isProduction(c)
  if (!user) return c.json({ user: null, sso_enabled, dev_login_enabled })
  return c.json({ user, sso_enabled, dev_login_enabled })
})

// Logout
auth.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

// Dev login: pick from seeded users (used in sandbox / when SSO not configured)
// Hard-disabled when ENVIRONMENT=production
auth.post('/dev-login', async (c) => {
  if (isProduction(c)) {
    return c.json({ error: 'dev-login disabled in production — use Google SSO' }, 403)
  }
  const body = await c.req.json<{ email: string }>().catch(() => ({ email: '' }))
  const email = body.email?.toLowerCase().trim()
  if (!email) return c.json({ error: 'email required' }, 400)

  const u = await c.env.DB.prepare(
    `SELECT id, email, name, role, department_id FROM users WHERE LOWER(email) = ? AND status = 'active'`
  ).bind(email).first<{ id: string; email: string; name: string; role: string; department_id: string | null }>()
  if (!u) return c.json({ error: 'user not found' }, 404)

  await createSession(c, u.id)
  c.set('user', u as any)
  await audit(c, 'login.dev', 'user', u.id)
  return c.json({ ok: true, user: u })
})

// Workspace domain we restrict SSO to. Could be promoted to an env var later.
const WORKSPACE_HD = 'smartland.com'

// Google OAuth start
auth.get('/google/start', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.json({ error: 'Google SSO not configured' }, 500)
  const redirect = `${c.env.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')
  // Hint Google to only show smartland.com Workspace accounts in the picker
  url.searchParams.set('hd', WORKSPACE_HD)
  return c.redirect(url.toString())
})

// Google OAuth callback
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'missing code' }, 400)
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return c.json({ error: 'Google SSO not configured' }, 500)

  const redirect = `${c.env.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    })
  })
  const tokenData: any = await tokenResp.json()
  if (!tokenData.id_token) return c.json({ error: 'token exchange failed', detail: tokenData }, 500)

  const payload = JSON.parse(atob(tokenData.id_token.split('.')[1]))
  const email = (payload.email as string)?.toLowerCase()
  if (!email) return c.json({ error: 'no email in token' }, 500)

  // Server-side hardening: verified email + Smartland Workspace domain only.
  // The `hd` claim from Google is the Workspace primary domain; the `email`
  // suffix protects us if someone managed to skip the hd= hint.
  if (payload.email_verified !== true) {
    return c.json({ error: 'email not verified by Google' }, 403)
  }
  const hd = (payload.hd as string | undefined)?.toLowerCase()
  const emailDomain = email.split('@')[1] || ''
  if (hd !== WORKSPACE_HD && emailDomain !== WORKSPACE_HD) {
    return c.json({ error: `only ${WORKSPACE_HD} Workspace accounts may sign in` }, 403)
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, name, role, department_id FROM users WHERE LOWER(email) = ? AND status = 'active'`
  ).bind(email).first<{ id: string; email: string; name: string; role: string; department_id: string | null }>()

  if (!user) return c.json({ error: 'no Smartland account for this email — contact admin' }, 403)

  await c.env.DB.prepare(`UPDATE users SET sso_subject = ? WHERE id = ?`)
    .bind(payload.sub, user.id).run()

  await createSession(c, user.id)
  c.set('user', user as any)
  await audit(c, 'login.sso', 'user', user.id)
  return c.redirect('/')
})

export default auth
