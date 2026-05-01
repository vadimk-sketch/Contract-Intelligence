// Audit log router (mounted at /api/audit)
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth, requireRole } from '../lib/auth'

const audit = new Hono<AppEnv>()
audit.use('*', requireAuth())

audit.get('/', requireRole('admin', 'lead'), async (c) => {
  const user = c.get('user')!
  const limit = parseInt(c.req.query('limit') || '200')
  const resourceType = c.req.query('resource_type')
  const resourceId = c.req.query('resource_id')
  const userId = c.req.query('user_id')
  const fromDate = c.req.query('from')
  const format = c.req.query('format') || 'json'

  const where: string[] = ['1=1']
  const params: any[] = []

  if (resourceType) { where.push('resource_type = ?'); params.push(resourceType) }
  if (resourceId) { where.push('resource_id = ?'); params.push(resourceId) }
  if (userId) { where.push('user_id = ?'); params.push(userId) }
  if (fromDate) { where.push('occurred_at >= ?'); params.push(fromDate) }

  // Lead is scoped to their department's resources
  if (user.role === 'lead') {
    where.push(`(
      resource_id IN (SELECT id FROM documents WHERE department_id = ?) OR
      user_id IN (SELECT id FROM users WHERE department_id = ?) OR
      user_id = ?
    )`)
    params.push(user.department_id, user.department_id, user.id)
  }

  const sql = `SELECT id, user_id, user_email, action, resource_type, resource_id,
                      before_json, after_json, ip_address, occurred_at
               FROM audit_log
               WHERE ${where.join(' AND ')}
               ORDER BY occurred_at DESC LIMIT ?`
  params.push(limit)
  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>()

  if (format === 'csv') {
    const cols = ['id','user_id','user_email','action','resource_type','resource_id','ip_address','occurred_at','before_json','after_json']
    const csv = [
      cols.join(','),
      ...rows.results.map(r => cols.map(k => csvCell(r[k])).join(','))
    ].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0,10)}.csv"`
      }
    })
  }

  return c.json({ count: rows.results.length, audit: rows.results })
})

// Convenience alias: /api/audit/export.csv -> same as /api/audit?format=csv
audit.get('/export.csv', requireRole('admin', 'lead'), async (c) => {
  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace(/\/export\.csv$/, '/')
  url.searchParams.set('format', 'csv')
  // Re-dispatch through the main handler by forwarding a fetch
  return audit.fetch(new Request(url.toString(), c.req.raw), c.env, c.executionCtx)
})

function csvCell(v: any): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default audit
