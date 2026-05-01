// Reminder generation, sending, and escalation
import type { Bindings } from '../types/bindings'
import { newId } from './ids'
import { sendEmail, shell, actionButton, escapeHtml } from './email'
import { signReminderToken } from './reminder-tokens'

const STAGES = ['T-180', 'T-90', 'T-60', 'T-30', 'T-7', 'T-0'] as const
type Stage = typeof STAGES[number]

const STAGE_DAYS: Record<Stage, number> = {
  'T-180': 180,
  'T-90': 90,
  'T-60': 60,
  'T-30': 30,
  'T-7':   7,
  'T-0':   0
}

const STAGE_COLOR: Record<Stage, string> = {
  'T-180': '#16a34a', // green
  'T-90':  '#eab308', // yellow
  'T-60':  '#f97316', // orange
  'T-30':  '#dc2626', // red
  'T-7':   '#dc2626', // red
  'T-0':   '#7f1d1d'  // dark red
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 3600 * 24))
}

// Generate the reminder rows for a single action item
export async function scheduleRemindersFor(
  env: Bindings,
  actionItemId: string,
  dueDate: string, // ISO date YYYY-MM-DD
  recipients: string[]
) {
  const due = new Date(dueDate + 'T09:00:00Z') // 9am UTC = ~5am ET on the due day
  const now = new Date()

  for (const stage of STAGES) {
    const offsetDays = STAGE_DAYS[stage]
    const fireAt = new Date(due.getTime() - offsetDays * 24 * 3600 * 1000)
    if (fireAt < now) continue // skip past stages

    await env.DB.prepare(
      `INSERT INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(
      newId('rem'),
      actionItemId,
      fireAt.toISOString(),
      stage,
      JSON.stringify(recipients)
    ).run()
  }
}

interface ReminderJoin {
  reminder_id: string
  stage: Stage
  recipients_json: string
  ai_id: string
  ai_title: string
  ai_description: string | null
  ai_due_date: string
  ai_priority: string
  ai_type: string
  doc_id: string
  doc_title: string
  counterparty_name: string | null
  document_type: string | null
  scheduled_for: string
}

export async function fireDueReminders(env: Bindings): Promise<{ fired: number }> {
  const due = await env.DB.prepare(`
    SELECT r.id as reminder_id, r.stage, r.recipients_json, r.scheduled_for,
           a.id as ai_id, a.title as ai_title, a.description as ai_description,
           a.due_date as ai_due_date, a.priority as ai_priority, a.type as ai_type,
           d.id as doc_id, d.title as doc_title, d.document_type,
           cp.name as counterparty_name
    FROM reminders r
    JOIN action_items a ON a.id = r.action_item_id
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    WHERE r.sent_at IS NULL
      AND r.status = 'pending'
      AND r.scheduled_for <= datetime('now')
      AND a.status NOT IN ('completed','archived')
      AND d.status = 'approved'
    ORDER BY r.scheduled_for ASC
    LIMIT 100
  `).all<ReminderJoin>()

  let fired = 0
  for (const row of due.results) {
    await sendReminder(env, row)
    fired++
  }
  return { fired }
}

async function sendReminder(env: Bindings, r: ReminderJoin) {
  const recipientUserIds: string[] = JSON.parse(r.recipients_json || '[]')
  if (recipientUserIds.length === 0) {
    await env.DB.prepare(`UPDATE reminders SET sent_at = datetime('now'), status = 'sent' WHERE id = ?`)
      .bind(r.reminder_id).run()
    return
  }

  // Resolve recipient emails
  const placeholders = recipientUserIds.map(() => '?').join(',')
  const users = await env.DB.prepare(
    `SELECT id, email, name FROM users WHERE id IN (${placeholders})`
  ).bind(...recipientUserIds).all<{ id: string; email: string; name: string }>()

  const emails = users.results.map(u => u.email)
  if (emails.length === 0) {
    await env.DB.prepare(`UPDATE reminders SET sent_at = datetime('now'), status = 'sent' WHERE id = ?`)
      .bind(r.reminder_id).run()
    return
  }

  const dueDate = r.ai_due_date.slice(0, 10)
  const daysUntil = daysBetween(new Date().toISOString(), r.ai_due_date)
  const isCritical = r.ai_type === 'notice_deadline' || r.ai_priority === 'critical'
  const stageLabel = r.stage === 'T-0' ? 'TODAY' : r.stage
  const color = STAGE_COLOR[r.stage]

  const subject = `${isCritical ? '[CRITICAL] ' : ''}${r.doc_title} — ${r.ai_title} (${stageLabel}, due ${dueDate})`

  // For each recipient, generate signed action links
  const primaryUser = users.results[0]
  const ackToken = await signReminderToken(env, { rid: r.reminder_id, uid: primaryUser.id, act: 'ack' })
  const completeToken = await signReminderToken(env, { rid: r.reminder_id, uid: primaryUser.id, act: 'complete' })
  const snooze7Token = await signReminderToken(env, { rid: r.reminder_id, uid: primaryUser.id, act: 'snooze', sd: 7 })
  const snooze14Token = await signReminderToken(env, { rid: r.reminder_id, uid: primaryUser.id, act: 'snooze', sd: 14 })
  const snooze30Token = await signReminderToken(env, { rid: r.reminder_id, uid: primaryUser.id, act: 'snooze', sd: 30 })

  const base = env.APP_URL.replace(/\/$/, '')
  const linkAck = `${base}/r/${ackToken}`
  const linkComplete = `${base}/r/${completeToken}`
  const linkSnooze7 = `${base}/r/${snooze7Token}`
  const linkSnooze14 = `${base}/r/${snooze14Token}`
  const linkSnooze30 = `${base}/r/${snooze30Token}`
  const linkDoc = `${base}/documents/${r.doc_id}`

  const body = `
    <div style="border-left:4px solid ${color};padding:8px 14px;background:#fafafa;margin-bottom:18px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${color};font-weight:bold;">${escapeHtml(stageLabel)} ${isCritical ? '— CRITICAL' : ''}</div>
      <div style="font-size:18px;font-weight:bold;margin-top:4px;color:#111;">${escapeHtml(r.ai_title)}</div>
    </div>
    <p style="margin:0 0 6px 0;"><strong>Document:</strong> ${escapeHtml(r.doc_title)}</p>
    <p style="margin:0 0 6px 0;"><strong>Counterparty:</strong> ${escapeHtml(r.counterparty_name || 'n/a')}</p>
    <p style="margin:0 0 6px 0;"><strong>Type:</strong> ${escapeHtml(r.document_type || 'n/a')}</p>
    <p style="margin:0 0 6px 0;"><strong>Due date:</strong> ${escapeHtml(dueDate)} <span style="color:#6b7280;">(${daysUntil >= 0 ? `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}` : `${-daysUntil} days overdue`})</span></p>
    ${r.ai_description ? `<p style="margin:14px 0 6px 0;color:#374151;">${escapeHtml(r.ai_description)}</p>` : ''}
    ${r.ai_type === 'notice_deadline' ? `<p style="background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;padding:10px 12px;border-radius:4px;margin:14px 0;font-size:13px;"><strong>Auto-renewal trap:</strong> This contract auto-renews unless written notice is delivered by ${escapeHtml(dueDate)}. Acknowledge below to confirm action plan, or mark complete once notice has been sent.</p>` : ''}
    <div style="margin:22px 0 8px 0;">
      ${actionButton(linkAck, 'Acknowledge', '#1F4E79')}
      ${actionButton(linkComplete, 'Mark Complete', '#16a34a')}
    </div>
    <div style="margin:6px 0 18px 0;font-size:12px;color:#6b7280;">
      Snooze:
      <a href="${linkSnooze7}" style="color:#1F4E79;margin:0 8px;">7 days</a>·
      <a href="${linkSnooze14}" style="color:#1F4E79;margin:0 8px;">14 days</a>·
      <a href="${linkSnooze30}" style="color:#1F4E79;margin:0 8px;">30 days</a>
    </div>
    <p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:22px;">
      <a href="${linkDoc}" style="color:#1F4E79;">Open document in Smartland Contracts →</a>
    </p>
  `

  await sendEmail(env, {
    to: emails,
    subject,
    html: shell(subject, body),
    related_document_id: r.doc_id,
    related_reminder_id: r.reminder_id,
    template: `reminder-${r.stage}`
  })

  await env.DB.prepare(
    `UPDATE reminders SET sent_at = datetime('now'), status = 'sent' WHERE id = ?`
  ).bind(r.reminder_id).run()
}

// Escalation: any sent-but-unacknowledged reminder >48h → Lead. >96h → Vadim.
export async function processEscalations(env: Bindings): Promise<{ escalated: number }> {
  const stale = await env.DB.prepare(`
    SELECT r.id as reminder_id, r.escalation_level, r.sent_at,
           a.id as ai_id, a.title as ai_title, a.due_date,
           d.id as doc_id, d.title as doc_title, d.department_id,
           dept.escalation_chain_json
    FROM reminders r
    JOIN action_items a ON a.id = r.action_item_id
    JOIN documents d ON d.id = a.document_id
    JOIN departments dept ON dept.id = d.department_id
    WHERE r.sent_at IS NOT NULL
      AND r.acknowledged_at IS NULL
      AND r.status = 'sent'
      AND r.escalation_level < 2
      AND a.status NOT IN ('completed','archived')
      AND (
        (r.escalation_level = 0 AND r.sent_at <= datetime('now', '-48 hours')) OR
        (r.escalation_level = 1 AND r.sent_at <= datetime('now', '-96 hours'))
      )
    LIMIT 50
  `).all<any>()

  let count = 0
  for (const row of stale.results) {
    const chain: string[] = JSON.parse(row.escalation_chain_json || '[]')
    const nextLevel = row.escalation_level + 1
    const escalateToUserId = chain[Math.min(nextLevel - 1, chain.length - 1)]
    if (!escalateToUserId) continue

    const u = await env.DB.prepare(`SELECT email, name FROM users WHERE id = ?`).bind(escalateToUserId).first<{ email: string; name: string }>()
    if (!u) continue

    const subject = `[ESCALATION L${nextLevel}] Unacknowledged: ${row.doc_title} — ${row.ai_title}`
    const body = `
      <p style="background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;padding:10px 12px;border-radius:4px;font-size:14px;font-weight:bold;">Escalation Level ${nextLevel}: a reminder has gone unacknowledged for ${nextLevel === 1 ? '48' : '96'} hours.</p>
      <p><strong>Document:</strong> ${escapeHtml(row.doc_title)}</p>
      <p><strong>Action item:</strong> ${escapeHtml(row.ai_title)}</p>
      <p><strong>Due date:</strong> ${escapeHtml(String(row.due_date).slice(0,10))}</p>
      <p><strong>Originally sent:</strong> ${escapeHtml(String(row.sent_at))}</p>
      <p style="margin-top:18px;"><a href="${env.APP_URL.replace(/\/$/, '')}/documents/${row.doc_id}" style="color:#1F4E79;font-weight:bold;">Open document →</a></p>
    `
    await sendEmail(env, {
      to: [u.email],
      subject,
      html: shell(subject, body),
      related_document_id: row.doc_id,
      related_reminder_id: row.reminder_id,
      template: `escalation-L${nextLevel}`
    })

    await env.DB.prepare(
      `UPDATE reminders SET escalation_level = ?, status = 'escalated' WHERE id = ?`
    ).bind(nextLevel, row.reminder_id).run()

    count++
  }
  return { escalated: count }
}
