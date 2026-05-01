// Search router (mounted at /api/search)
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth } from '../lib/auth'

const search = new Hono<AppEnv>()
search.use('*', requireAuth())

// Full-text + faceted search across documents
search.get('/', async (c) => {
  const user = c.get('user')!
  const q = (c.req.query('q') || '').trim()
  const docType = c.req.query('type')
  const department = c.req.query('department')
  const counterparty = c.req.query('counterparty')
  const property = c.req.query('property')
  const expiringWithin = c.req.query('expiring_within')

  const where: string[] = ['d.deleted_at IS NULL']
  const params: any[] = []

  if (user.role !== 'admin' && user.role !== 'system') {
    where.push('d.department_id = ?')
    params.push(user.department_id)
  } else if (department) {
    where.push('d.department_id = ?')
    params.push(department)
  }
  if (docType) { where.push('d.document_type = ?'); params.push(docType) }
  if (counterparty) { where.push('d.counterparty_id = ?'); params.push(counterparty) }
  if (property) { where.push('d.property_id = ?'); params.push(property) }

  let sql: string
  if (q) {
    // FTS5 query — split into safe tokens, AND them, prefix-match each token
    const tokens = q.split(/\s+/).filter(Boolean)
      .map(t => t.replace(/[^A-Za-z0-9_]/g, ''))
      .filter(t => t.length > 0)
      .map(t => `${t}*`)
    const ftsQ = tokens.length > 0 ? tokens.join(' AND ') : `"${q.replace(/"/g, '""')}"`
    sql = `
      SELECT d.id, d.title, d.document_type, d.status, d.created_at,
             cp.name as counterparty_name, p.name as property_name,
             dept.name as department_name
      FROM documents_fts fts
      JOIN documents d ON d.id = fts.document_id
      LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
      LEFT JOIN properties p ON p.id = d.property_id
      LEFT JOIN departments dept ON dept.id = d.department_id
      WHERE documents_fts MATCH ? AND ${where.join(' AND ')}
      ORDER BY rank
      LIMIT 100
    `
    params.unshift(ftsQ)
  } else {
    sql = `
      SELECT d.id, d.title, d.document_type, d.status, d.created_at,
             cp.name as counterparty_name, p.name as property_name,
             dept.name as department_name
      FROM documents d
      LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
      LEFT JOIN properties p ON p.id = d.property_id
      LEFT JOIN departments dept ON dept.id = d.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.created_at DESC LIMIT 100
    `
  }

  if (expiringWithin) {
    const days = parseInt(expiringWithin) || 90
    sql = `
      SELECT * FROM (${sql}) base
      WHERE base.id IN (
        SELECT document_id FROM action_items
        WHERE status = 'open' AND due_date <= date('now', '+${days} days')
      )`
  }

  const rows = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ q, count: rows.results.length, results: rows.results })
})

export default search
