import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { AppEnv } from './types/bindings'
import { newId } from './lib/ids'
import authApi from './api/auth'
import documentsApi from './api/documents'
import remindersApi from './api/reminders'
import dashboardsApi from './api/dashboards'
import searchApi from './api/search'
import auditApi from './api/audit'
import refApi from './api/ref'
import jobsApi from './api/jobs'
import { fireDueReminders, processEscalations } from './lib/reminders'

const app = new Hono<AppEnv>()

// Per-request id + light logger
app.use('*', async (c, next) => {
  c.set('requestId', newId('req'))
  await next()
})
app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }))
app.use('/api/*', logger())

// API routes
app.route('/api/auth', authApi)
app.route('/api/documents', documentsApi)
app.route('/api/dashboards', dashboardsApi)
app.route('/api/search', searchApi)
app.route('/api/audit', auditApi)
app.route('/api/ref', refApi)
app.route('/api', remindersApi)    // /api/reminders/*
app.route('/', remindersApi)       // /r/:token (one-click email links — no /api prefix)
app.route('/api/jobs', jobsApi)

// Health
app.get('/api/health', (c) => c.json({ ok: true, name: c.env.APP_NAME, time: new Date().toISOString() }))

// Static assets via the Pages build pipeline (handled automatically for /static/*)
// SPA shell: serve the same index for all non-API GETs so the hash-router works
app.get('/', (c) => indexHtml(c))
app.get('/dashboard', (c) => indexHtml(c))
app.get('/dashboard/*', (c) => indexHtml(c))
app.get('/documents', (c) => indexHtml(c))
app.get('/documents/*', (c) => indexHtml(c))
app.get('/document/*', (c) => indexHtml(c))
app.get('/upload', (c) => indexHtml(c))
app.get('/search', (c) => indexHtml(c))
app.get('/audit', (c) => indexHtml(c))

function indexHtml(c: any) {
  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smartland Contracts</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231F4E79'/%3E%3Ctext x='50' y='62' font-size='44' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'%3ES%3C/text%3E%3C/svg%3E">
</head>
<body>
<div id="app">
  <div style="text-align:center;padding:60px;">Loading…</div>
</div>
<script src="/static/app.js"></script>
</body>
</html>`)
}

// Cloudflare Pages cron handler — registered via wrangler.jsonc "triggers"
// Runs reminder firing + escalation
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        const fired = await fireDueReminders(env)
        const escalated = await processEscalations(env)
        console.log(`[cron] fired=${fired.fired} escalated=${escalated.escalated}`)
      } catch (e) {
        console.error('[cron] error', e)
      }
    })())
  }
}
