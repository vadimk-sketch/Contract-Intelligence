// Document upload, list, get, approve, supersede
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth, requireRole, canAccessDocument } from '../lib/auth'
import { audit } from '../lib/audit'
import { newId } from '../lib/ids'
import { sha256 } from '../lib/hash'
import { processDocument, activateApprovedDocument } from '../lib/extraction-pipeline'
import { sendEmail, shell, escapeHtml } from '../lib/email'

const docs = new Hono<AppEnv>()

docs.use('*', requireAuth())

// List documents (scoped by role + department)
docs.get('/', async (c) => {
  const user = c.get('user')!
  const status = c.req.query('status')
  const department = c.req.query('department')
  const docType = c.req.query('type')
  const counterparty = c.req.query('counterparty')
  const expiringWithin = c.req.query('expiring_within') // days

  const where: string[] = ['d.deleted_at IS NULL']
  const params: any[] = []

  if (user.role !== 'admin' && user.role !== 'system') {
    where.push('d.department_id = ?')
    params.push(user.department_id)
  } else if (department) {
    where.push('d.department_id = ?')
    params.push(department)
  }
  if (status) { where.push('d.status = ?'); params.push(status) }
  if (docType) { where.push('d.document_type = ?'); params.push(docType) }
  if (counterparty) { where.push('d.counterparty_id = ?'); params.push(counterparty) }

  let extraJoin = ''
  if (expiringWithin) {
    extraJoin = `
      LEFT JOIN action_items ai ON ai.document_id = d.id AND ai.status = 'open'
        AND ai.due_date <= date('now', '+${parseInt(expiringWithin) || 90} days')
    `
    where.push('ai.id IS NOT NULL')
  }

  const sql = `
    SELECT DISTINCT d.id, d.title, d.document_type, d.status, d.created_at,
           d.department_id, d.original_filename, d.file_size, d.version,
           cp.name as counterparty_name,
           p.name as property_name,
           u.name as uploader_name,
           dept.name as department_name
    FROM documents d
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN users u ON u.id = d.uploaded_by
    LEFT JOIN departments dept ON dept.id = d.department_id
    ${extraJoin}
    WHERE ${where.join(' AND ')}
    ORDER BY d.created_at DESC
    LIMIT 200
  `
  const rows = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ documents: rows.results })
})

// Single document with extraction + action items
docs.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)

  const doc = await c.env.DB.prepare(`
    SELECT d.*, cp.name as counterparty_name, p.name as property_name,
           u.name as uploader_name, dept.name as department_name
    FROM documents d
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN users u ON u.id = d.uploaded_by
    LEFT JOIN departments dept ON dept.id = d.department_id
    WHERE d.id = ?
  `).bind(id).first()
  if (!doc) return c.json({ error: 'not found' }, 404)

  const extraction = await c.env.DB.prepare(
    `SELECT * FROM extractions WHERE document_id = ? ORDER BY extracted_at DESC LIMIT 1`
  ).bind(id).first<any>()

  let fields: any[] = []
  if (extraction) {
    const r = await c.env.DB.prepare(
      `SELECT * FROM extraction_fields WHERE extraction_id = ? ORDER BY field_name`
    ).bind(extraction.id).all<any>()
    fields = r.results
  }

  const actionItems = await c.env.DB.prepare(
    `SELECT a.*, u.name as assigned_to_name FROM action_items a
     LEFT JOIN users u ON u.id = a.assigned_to_user_id
     WHERE a.document_id = ? ORDER BY a.due_date ASC`
  ).bind(id).all<any>()

  await audit(c, 'document.view', 'document', id)

  return c.json({
    document: doc,
    extraction: extraction ? {
      ...extraction,
      extracted_json: extraction.extracted_json ? JSON.parse(extraction.extracted_json) : null
    } : null,
    fields,
    action_items: actionItems.results
  })
})

// Upload
docs.post('/', async (c) => {
  const user = c.get('user')!
  if (user.role === 'readonly') return c.json({ error: 'forbidden' }, 403)

  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const departmentId = (form.get('department_id') as string) || user.department_id
  const propertyId = (form.get('property_id') as string) || null
  const entityId = (form.get('entity_id') as string) || null

  if (!file) return c.json({ error: 'file required' }, 400)
  if (!departmentId) return c.json({ error: 'department_id required (admin uploads must specify)' }, 400)
  if (file.size > 50 * 1024 * 1024) return c.json({ error: 'file too large (50MB max)' }, 400)

  const buf = await file.arrayBuffer()
  const hash = await sha256(buf)

  // Duplicate check
  const dup = await c.env.DB.prepare(
    `SELECT id, title FROM documents WHERE file_hash = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(hash).first<{ id: string; title: string }>()
  if (dup && c.req.query('confirm_duplicate') !== 'yes') {
    return c.json({
      duplicate: true,
      existing_id: dup.id,
      existing_title: dup.title,
      message: 'A document with the same content hash already exists. Add ?confirm_duplicate=yes to override.'
    }, 409)
  }

  const id = newId('doc')
  const r2Key = `documents/${id}/${file.name}`
  await c.env.DOCS.put(r2Key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploaded_by: user.id, uploaded_at: new Date().toISOString() }
  })

  await c.env.DB.prepare(
    `INSERT INTO documents (id, title, file_hash, r2_key, original_filename, file_size, mime_type, uploaded_by, department_id, entity_id, property_id, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'web')`
  ).bind(
    id,
    file.name,
    hash,
    r2Key,
    file.name,
    file.size,
    file.type || 'application/octet-stream',
    user.id,
    departmentId,
    entityId,
    propertyId
  ).run()

  await audit(c, 'document.upload', 'document', id, null, { filename: file.name, size: file.size })

  // Kick off extraction in the background (waitUntil), so the upload returns immediately
  c.executionCtx.waitUntil(
    (async () => {
      const result = await processDocument(c.env, id)
      if (result.ok) {
        // Send summary email to uploader, dept lead, and Vadim
        await sendSummaryEmail(c.env, id)
      }
    })()
  )

  return c.json({ ok: true, id, status: 'extracting' })
})

// Approve extraction (Lead/Admin) — activates reminders
docs.post('/:id/approve', requireRole('admin', 'lead'), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')!
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)

  const extraction = await c.env.DB.prepare(
    `SELECT id FROM extractions WHERE document_id = ? ORDER BY extracted_at DESC LIMIT 1`
  ).bind(id).first<{ id: string }>()
  if (!extraction) return c.json({ error: 'no extraction to approve' }, 400)

  await c.env.DB.prepare(
    `UPDATE extractions SET approved_by = ?, approved_at = datetime('now') WHERE id = ?`
  ).bind(user.id, extraction.id).run()

  await c.env.DB.prepare(
    `UPDATE documents SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run()

  await activateApprovedDocument(c.env, id, user.id)
  await audit(c, 'document.approve', 'document', id)
  return c.json({ ok: true })
})

// Edit a single extraction field (Lead/Admin)
docs.patch('/:id/fields/:fieldId', requireRole('admin', 'lead'), async (c) => {
  const id = c.req.param('id')
  const fieldId = c.req.param('fieldId')
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)

  const body = await c.req.json<{ value: string }>().catch(() => ({ value: '' }))
  const old = await c.env.DB.prepare(`SELECT * FROM extraction_fields WHERE id = ?`).bind(fieldId).first<any>()
  if (!old) return c.json({ error: 'field not found' }, 404)

  await c.env.DB.prepare(
    `UPDATE extraction_fields SET field_value = ?, was_corrected = 1, original_value = COALESCE(original_value, ?), confidence = 1.0 WHERE id = ?`
  ).bind(body.value, old.field_value, fieldId).run()
  await audit(c, 'extraction.field.edit', 'extraction_field', fieldId, { value: old.field_value }, { value: body.value })
  return c.json({ ok: true })
})

// Download (signed access — for now require auth)
docs.get('/:id/file', async (c) => {
  const id = c.req.param('id')
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)
  const doc = await c.env.DB.prepare(
    `SELECT r2_key, mime_type, original_filename FROM documents WHERE id = ?`
  ).bind(id).first<{ r2_key: string; mime_type: string; original_filename: string }>()
  if (!doc) return c.json({ error: 'not found' }, 404)
  const obj = await c.env.DOCS.get(doc.r2_key)
  if (!obj) return c.json({ error: 'object missing' }, 404)
  await audit(c, 'document.download', 'document', id)
  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.mime_type,
      'Content-Disposition': `inline; filename="${doc.original_filename}"`
    }
  })
})

// Mark as superseded by a newer version
docs.post('/:id/supersede', requireRole('admin', 'lead'), async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ new_document_id: string }>()
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)

  await c.env.DB.prepare(
    `UPDATE documents SET superseded_by_document_id = ?, status = 'archived', updated_at = datetime('now') WHERE id = ?`
  ).bind(body.new_document_id, id).run()

  // Archive open action items + cancel pending reminders on the old doc
  await c.env.DB.prepare(
    `UPDATE action_items SET status = 'archived', updated_at = datetime('now') WHERE document_id = ? AND status = 'open'`
  ).bind(id).run()
  await c.env.DB.prepare(
    `UPDATE reminders SET status = 'cancelled' WHERE action_item_id IN (SELECT id FROM action_items WHERE document_id = ?) AND status = 'pending'`
  ).bind(id).run()

  await audit(c, 'document.supersede', 'document', id, null, { new_document_id: body.new_document_id })
  return c.json({ ok: true })
})

// Re-run extraction (admin)
docs.post('/:id/reprocess', requireRole('admin', 'lead'), async (c) => {
  const id = c.req.param('id')
  if (!(await canAccessDocument(c, id))) return c.json({ error: 'forbidden' }, 403)
  await audit(c, 'document.reprocess', 'document', id)
  c.executionCtx.waitUntil(processDocument(c.env, id).then(() => sendSummaryEmail(c.env, id)))
  return c.json({ ok: true, status: 'extracting' })
})

async function sendSummaryEmail(env: AppEnv['Bindings'], documentId: string) {
  const doc = await env.DB.prepare(`
    SELECT d.id, d.title, d.document_type, d.uploaded_by, d.department_id,
           cp.name as counterparty_name, dept.escalation_chain_json,
           u.email as uploader_email, u.name as uploader_name
    FROM documents d
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    LEFT JOIN departments dept ON dept.id = d.department_id
    LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.id = ?
  `).bind(documentId).first<any>()
  if (!doc) return

  const ext = await env.DB.prepare(
    `SELECT summary, confidence_overall, extracted_json FROM extractions WHERE document_id = ? ORDER BY extracted_at DESC LIMIT 1`
  ).bind(documentId).first<any>()
  if (!ext) return

  const items = await env.DB.prepare(
    `SELECT title, due_date, type, priority FROM action_items WHERE document_id = ? ORDER BY due_date ASC LIMIT 20`
  ).bind(documentId).all<any>()

  const chain: string[] = JSON.parse(doc.escalation_chain_json || '[]')
  const recipients = Array.from(new Set([doc.uploaded_by, ...chain, 'usr_vadim']))
  const placeholders = recipients.map(() => '?').join(',')
  const users = await env.DB.prepare(
    `SELECT email FROM users WHERE id IN (${placeholders})`
  ).bind(...recipients).all<{ email: string }>()
  const toAddrs = users.results.map(u => u.email)
  if (toAddrs.length === 0) return

  const docLink = `${env.APP_URL.replace(/\/$/, '')}/documents/${doc.id}`
  const itemsHtml = items.results.length === 0
    ? '<p style="color:#6b7280;">No date-driven action items detected.</p>'
    : '<ul style="padding-left:18px;">' + items.results.map(i =>
        `<li><strong>${escapeHtml(String(i.due_date).slice(0,10))}</strong> — ${escapeHtml(i.title)} <span style="color:${i.type === 'notice_deadline' ? '#dc2626' : '#6b7280'};">[${escapeHtml(i.type)}/${escapeHtml(i.priority)}]</span></li>`
      ).join('') + '</ul>'

  const confPct = Math.round((ext.confidence_overall || 0) * 100)
  const subject = `New contract processed: ${doc.title}`
  const body = `
    <p style="margin:0 0 14px 0;font-size:15px;"><strong>${escapeHtml(doc.title)}</strong>${doc.counterparty_name ? ' — ' + escapeHtml(doc.counterparty_name) : ''}</p>
    <p style="margin:0 0 14px 0;color:#374151;">${escapeHtml(ext.summary || '')}</p>
    <p style="margin:0 0 6px 0;font-size:12px;color:#6b7280;">Type: <strong>${escapeHtml(doc.document_type || 'unclassified')}</strong> · Avg confidence: <strong>${confPct}%</strong> · Uploaded by ${escapeHtml(doc.uploader_name || '')}</p>
    <h4 style="margin:20px 0 8px 0;">Action items</h4>
    ${itemsHtml}
    <p style="margin-top:22px;"><a href="${docLink}" style="background:#1F4E79;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;font-weight:bold;">Review extraction →</a></p>
    <p style="margin-top:14px;font-size:12px;color:#6b7280;">Reminders are inactive until a Department Lead approves the extraction.</p>
  `
  await sendEmail(env, {
    to: toAddrs,
    subject,
    html: shell(subject, body),
    related_document_id: doc.id,
    template: 'document-summary'
  })
}

export default docs
