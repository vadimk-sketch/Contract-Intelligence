// Cron / scheduled job endpoints
// Cloudflare Pages does not support native cron triggers (as of 2026), so the
// daily reminder sweep is fired by an external scheduler (GitHub Actions)
// hitting POST /api/jobs/cron/tick with the shared CRON_SECRET header.
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { fireDueReminders, processEscalations } from '../lib/reminders'

const jobs = new Hono<AppEnv>()

// Constant-time string comparison to prevent timing oracle attacks on the secret
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

jobs.post('/cron/tick', async (c) => {
  const expected = c.env.CRON_SECRET
  if (!expected) {
    return c.json({ error: 'CRON_SECRET not configured on server' }, 500)
  }
  const provided = c.req.header('x-cron-secret') || ''
  if (!timingSafeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const startedAt = new Date().toISOString()
  const fired = await fireDueReminders(c.env)
  const escalated = await processEscalations(c.env)
  const finishedAt = new Date().toISOString()

  // Best-effort audit trail (no user_id since this is a system call)
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, user_id, user_email, action, resource_type, resource_id, after_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      'aud_cron_' + Math.random().toString(36).slice(2, 14),
      'usr_system',
      'system@smartland.com',
      'cron.tick',
      'system',
      'cron',
      JSON.stringify({ fired, escalated, startedAt, finishedAt }),
      c.req.header('cf-connecting-ip') || ''
    ).run()
  } catch { /* audit_log is non-critical for cron */ }

  return c.json({ ok: true, fired, escalated, startedAt, finishedAt })
})

export default jobs
