import type { AppEnv } from '../types/bindings'
import type { Context } from 'hono'
import { newId } from './ids'

export async function audit(
  c: Context<AppEnv>,
  action: string,
  resourceType: string,
  resourceId: string | null,
  before: unknown = null,
  after: unknown = null
) {
  const user = c.get('user')
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || ''
  const ua = c.req.header('user-agent') || ''

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, user_email, action, resource_type, resource_id, before_json, after_json, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId('aud'),
      user?.id || null,
      user?.email || null,
      action,
      resourceType,
      resourceId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ip,
      ua
    )
    .run()
}
