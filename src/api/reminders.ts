// Reminder action endpoints (one-click links + authenticated views)
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth } from '../lib/auth'
import { audit } from '../lib/audit'
import { newId } from '../lib/ids'
import { verifyReminderToken } from '../lib/reminder-tokens'
import { fireDueReminders, processEscalations } from '../lib/reminders'

const reminders = new Hono<AppEnv>()

// One-click action endpoint (no login required, JWT-verified)
// Called from email links: /r/:token
reminders.get('/r/:token', async (c) => {
  const token = c.req.param('token')
  const payload = await verifyReminderToken(c.env, token)
  if (!payload) return c.html(simplePage('Link invalid or expired',
    '<p>This reminder link is invalid or has expired. Please log in to take action.</p>',
    '#dc2626'))

  const { rid, uid, act, sd } = payload

  const rem = await c.env.DB.prepare(
    `SELECT r.*, a.title as ai_title, a.id as ai_id, d.title as doc_title, d.id as doc_id
     FROM reminders r
     JOIN action_items a ON a.id = r.action_item_id
     JOIN documents d ON d.id = a.document_id
     WHERE r.id = ?`
  ).bind(rid).first<any>()
  if (!rem) return c.html(simplePage('Not found', '<p>Reminder not found.</p>', '#dc2626'))

  const ip = c.req.header('cf-connecting-ip') || ''
  const ua = c.req.header('user-agent') || ''
  const ackId = newId('ack')

  if (act === 'ack') {
    await c.env.DB.prepare(
      `UPDATE reminders SET acknowledged_by = ?, acknowledged_at = datetime('now'), status = 'acknowledged' WHERE id = ?`
    ).bind(uid, rid).run()
    await c.env.DB.prepare(
      `UPDATE action_items SET status = 'acknowledged', updated_at = datetime('now') WHERE id = ? AND status = 'open'`
    ).bind(rem.ai_id).run()
    await c.env.DB.prepare(
      `INSERT INTO acknowledgments (id, reminder_id, user_id, action, ip_address, user_agent) VALUES (?, ?, ?, 'ack', ?, ?)`
    ).bind(ackId, rid, uid, ip, ua).run()
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, ip_address, user_agent) VALUES (?, ?, 'reminder.ack', 'reminder', ?, ?, ?)`
    ).bind(newId('aud'), uid, rid, ip, ua).run()
    return c.html(simplePage('Acknowledged',
      `<p>Thank you. <strong>${rem.doc_title}</strong> — <em>${rem.ai_title}</em> has been acknowledged.</p>
       <p style="color:#6b7280;font-size:13px;">You will continue to receive escalating reminders if this action item is not marked complete by its due date.</p>`,
      '#16a34a'))
  }

  if (act === 'snooze') {
    const days = sd || 7
    const snoozedUntil = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
    await c.env.DB.prepare(
      `UPDATE reminders SET snoozed_until = ?, status = 'snoozed' WHERE id = ?`
    ).bind(snoozedUntil, rid).run()
    await c.env.DB.prepare(
      `INSERT INTO acknowledgments (id, reminder_id, user_id, action, snooze_days, ip_address, user_agent) VALUES (?, ?, ?, 'snooze', ?, ?, ?)`
    ).bind(ackId, rid, uid, days, ip, ua).run()
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, after_json, ip_address, user_agent) VALUES (?, ?, 'reminder.snooze', 'reminder', ?, ?, ?, ?)`
    ).bind(newId('aud'), uid, rid, JSON.stringify({ days }), ip, ua).run()

    // Schedule a follow-up reminder after snooze expires
    await c.env.DB.prepare(
      `INSERT INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(newId('rem'), rem.action_item_id, snoozedUntil, rem.stage, rem.recipients_json).run()

    return c.html(simplePage('Snoozed',
      `<p>Snoozed for <strong>${days} days</strong>. You will be reminded again on ${snoozedUntil.slice(0,10)}.</p>`,
      '#1F4E79'))
  }

  if (act === 'complete') {
    await c.env.DB.prepare(
      `UPDATE action_items SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(rem.ai_id).run()
    // Cancel all future pending reminders for this action item
    await c.env.DB.prepare(
      `UPDATE reminders SET status = 'cancelled' WHERE action_item_id = ? AND status = 'pending'`
    ).bind(rem.ai_id).run()
    await c.env.DB.prepare(
      `UPDATE reminders SET status = 'completed', acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?`
    ).bind(uid, rid).run()
    await c.env.DB.prepare(
      `INSERT INTO acknowledgments (id, reminder_id, user_id, action, ip_address, user_agent) VALUES (?, ?, ?, 'complete', ?, ?)`
    ).bind(ackId, rid, uid, ip, ua).run()
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, ip_address, user_agent) VALUES (?, ?, 'reminder.complete', 'reminder', ?, ?, ?)`
    ).bind(newId('aud'), uid, rid, ip, ua).run()
    return c.html(simplePage('Marked Complete',
      `<p>Action item complete. <strong>${rem.doc_title}</strong> — <em>${rem.ai_title}</em>.</p>
       <p style="color:#6b7280;font-size:13px;">Future reminders for this item have been cancelled. The audit log records this action.</p>`,
      '#16a34a'))
  }

  return c.html(simplePage('Unknown action', '<p>Unknown action.</p>', '#dc2626'))
})

// Authenticated reminder list — for personal dashboard
reminders.get('/api/reminders/mine', requireAuth(), async (c) => {
  const user = c.get('user')!
  const rows = await c.env.DB.prepare(`
    SELECT r.id, r.stage, r.scheduled_for, r.sent_at, r.status, r.acknowledged_at,
           a.id as ai_id, a.title, a.due_date, a.type, a.priority,
           d.id as doc_id, d.title as doc_title, d.document_type,
           cp.name as counterparty_name
    FROM reminders r
    JOIN action_items a ON a.id = r.action_item_id
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    WHERE (json_extract(r.recipients_json, '$') LIKE ? OR a.assigned_to_user_id = ?)
      AND a.status NOT IN ('completed','archived')
    ORDER BY r.scheduled_for ASC
    LIMIT 100
  `).bind(`%"${user.id}"%`, user.id).all()
  return c.json({ reminders: rows.results })
})

// Manual fire (admin) — useful for testing
reminders.post('/api/reminders/fire-due', requireAuth(), async (c) => {
  const user = c.get('user')!
  if (user.role !== 'admin' && user.role !== 'system') return c.json({ error: 'forbidden' }, 403)
  const result = await fireDueReminders(c.env)
  await audit(c, 'reminders.fire-due', 'reminders', null, null, result)
  return c.json(result)
})

reminders.post('/api/reminders/process-escalations', requireAuth(), async (c) => {
  const user = c.get('user')!
  if (user.role !== 'admin' && user.role !== 'system') return c.json({ error: 'forbidden' }, 403)
  const result = await processEscalations(c.env)
  await audit(c, 'reminders.escalate', 'reminders', null, null, result)
  return c.json(result)
})

function simplePage(title: string, bodyHtml: string, color: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Smartland</title>
  <style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;color:#1a1a1a;}
  .wrap{max-width:560px;margin:60px auto;background:#fff;border-radius:6px;border:1px solid #e3e6ea;overflow:hidden;}
  .head{background:${color};color:#fff;padding:18px 24px;font-weight:bold;font-size:18px;}
  .body{padding:24px;line-height:1.55;font-size:14px;}
  a.btn{display:inline-block;background:#1F4E79;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;font-weight:bold;margin-top:12px;}
  </style></head><body>
  <div class="wrap"><div class="head">${title}</div><div class="body">${bodyHtml}
  <p style="margin-top:18px;"><a class="btn" href="/">Open Smartland Contracts →</a></p>
  </div></div></body></html>`
}

export default reminders
