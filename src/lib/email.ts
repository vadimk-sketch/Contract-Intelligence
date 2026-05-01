// Email outbound via Resend
import type { Bindings } from '../types/bindings'
import { newId } from './ids'

export interface EmailMessage {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  text?: string
  template?: string
  related_document_id?: string
  related_reminder_id?: string
}

export async function sendEmail(env: Bindings, msg: EmailMessage): Promise<{ ok: boolean; id?: string; error?: string }> {
  const id = newId('eml')

  // Always log the queued email first
  await env.DB.prepare(
    `INSERT INTO emails_outbound (id, to_addresses_json, cc_addresses_json, subject, template, body_html, body_text, related_document_id, related_reminder_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`
  ).bind(
    id,
    JSON.stringify(msg.to),
    msg.cc ? JSON.stringify(msg.cc) : null,
    msg.subject,
    msg.template || null,
    msg.html,
    msg.text || null,
    msg.related_document_id || null,
    msg.related_reminder_id || null
  ).run()

  if (!env.RESEND_API_KEY) {
    // Dev mode — log only
    console.log(`[email/dev] To: ${msg.to.join(', ')} | Subject: ${msg.subject}`)
    await env.DB.prepare(
      `UPDATE emails_outbound SET status = 'sent', sent_at = datetime('now'), resend_id = 'dev-mode' WHERE id = ?`
    ).bind(id).run()
    return { ok: true, id: 'dev-mode' }
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
        to: msg.to,
        cc: msg.cc,
        subject: msg.subject,
        html: msg.html,
        text: msg.text
      })
    })
    const data: any = await resp.json()
    if (!resp.ok) {
      await env.DB.prepare(
        `UPDATE emails_outbound SET status = 'failed', error_message = ? WHERE id = ?`
      ).bind(JSON.stringify(data), id).run()
      return { ok: false, error: data.message || 'send failed' }
    }
    await env.DB.prepare(
      `UPDATE emails_outbound SET status = 'sent', sent_at = datetime('now'), resend_id = ? WHERE id = ?`
    ).bind(data.id || '', id).run()
    return { ok: true, id: data.id }
  } catch (e: any) {
    await env.DB.prepare(
      `UPDATE emails_outbound SET status = 'failed', error_message = ? WHERE id = ?`
    ).bind(e.message || String(e), id).run()
    return { ok: false, error: e.message }
  }
}

const BRAND_BLUE = '#1F4E79'

export function shell(title: string, bodyHtml: string, brandColor = BRAND_BLUE): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #e3e6ea;">
        <tr><td style="background:${brandColor};padding:20px 28px;color:#fff;">
          <div style="font-size:20px;font-weight:bold;letter-spacing:0.3px;">SMARTLAND</div>
          <div style="font-size:12px;opacity:0.85;margin-top:2px;">Contract Intelligence</div>
        </td></tr>
        <tr><td style="padding:28px;font-size:14px;line-height:1.55;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="background:#f7f9fb;padding:14px 28px;font-size:11px;color:#6b7280;border-top:1px solid #e3e6ea;">
          This is an automated message from Smartland's contract management system. Every action you take is logged for audit.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export function actionButton(href: string, label: string, color = BRAND_BLUE): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 22px;margin:0 6px 8px 0;background:${color};color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;font-size:13px;">${escapeHtml(label)}</a>`
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export function escapeAttr(s: string): string {
  return escapeHtml(s)
}
