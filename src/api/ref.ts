// Reference data router (mounted at /api/ref)
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth, requireRole } from '../lib/auth'

const ref = new Hono<AppEnv>()
ref.use('*', requireAuth())

ref.get('/departments', async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, name, color_hex FROM departments ORDER BY name`).all()
  return c.json({ departments: r.results })
})

ref.get('/properties', async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, name, market, property_type FROM properties ORDER BY name`).all()
  return c.json({ properties: r.results })
})

ref.get('/entities', async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, legal_name, type FROM entities ORDER BY legal_name`).all()
  return c.json({ entities: r.results })
})

ref.get('/counterparties', async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, name, type FROM counterparties ORDER BY name LIMIT 500`).all()
  return c.json({ counterparties: r.results })
})

ref.get('/users', requireRole('admin', 'lead'), async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, email, name, role, department_id, status FROM users ORDER BY name`).all()
  return c.json({ users: r.results })
})

export default ref
