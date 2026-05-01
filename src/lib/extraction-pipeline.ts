// Extraction pipeline orchestrator: OCR → classify → extract → action items
import type { Bindings } from '../types/bindings'
import { newId } from './ids'
import { extractText } from './ocr'
import { classifyDocument, extractContract } from './ai'
import { scheduleRemindersFor } from './reminders'

export async function processDocument(env: Bindings, documentId: string): Promise<{ ok: boolean; error?: string }> {
  // Mark as extracting
  await env.DB.prepare(`UPDATE documents SET status = 'extracting', updated_at = datetime('now') WHERE id = ?`)
    .bind(documentId).run()

  try {
    const doc = await env.DB.prepare(
      `SELECT id, r2_key, mime_type, original_filename, department_id FROM documents WHERE id = ?`
    ).bind(documentId).first<{ id: string; r2_key: string; mime_type: string; original_filename: string; department_id: string }>()
    if (!doc) throw new Error('Document not found')

    // Fetch from R2
    const obj = await env.DOCS.get(doc.r2_key)
    if (!obj) throw new Error('R2 object not found')
    const bytes = new Uint8Array(await obj.arrayBuffer())

    // OCR / text extraction
    const { text, method } = await extractText(env, bytes, doc.mime_type)
    let workingText = text

    // For scanned PDFs we ideally would use Claude vision; Phase 1 fallback: notify reviewer
    if (!workingText || workingText.length < 50) {
      workingText = `[OCR produced minimal text; method=${method}; filename=${doc.original_filename}]`
    }

    // Save OCR text to document for FTS
    await env.DB.prepare(`UPDATE documents SET ocr_text = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(workingText.slice(0, 200000), documentId).run()

    // Classify
    const cls = await classifyDocument(env, workingText)

    // Extract
    const ext = await extractContract(env, workingText, cls.document_type)

    // Persist extraction
    const extractionId = newId('ext')
    await env.DB.prepare(
      `INSERT INTO extractions (id, document_id, schema_version, extracted_json, summary, confidence_overall, model_used, prompt_tokens, completion_tokens, cached_tokens, cost_usd)
       VALUES (?, ?, 'v1', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      extractionId,
      documentId,
      JSON.stringify(ext.json),
      ext.json.summary || '',
      ext.confidence_overall,
      ext.cost.model,
      ext.cost.prompt_tokens,
      ext.cost.completion_tokens,
      ext.cost.cached_tokens,
      ext.cost.cost_usd
    ).run()

    // Persist per-field rows for the review UI
    if (ext.json.base) {
      for (const [k, v] of Object.entries(ext.json.base)) {
        const val = (v as any)?.value
        const conf = (v as any)?.confidence ?? 0
        await env.DB.prepare(
          `INSERT INTO extraction_fields (id, extraction_id, field_name, field_value, confidence) VALUES (?, ?, ?, ?, ?)`
        ).bind(newId('ef'), extractionId, k, val == null ? null : String(val), conf).run()
      }
    }
    if (ext.json.type_specific) {
      for (const [k, v] of Object.entries(ext.json.type_specific)) {
        const val = typeof v === 'object' ? JSON.stringify(v) : v
        await env.DB.prepare(
          `INSERT INTO extraction_fields (id, extraction_id, field_name, field_value, confidence) VALUES (?, ?, ?, ?, ?)`
        ).bind(newId('ef'), extractionId, `ts_${k}`, val == null ? null : String(val), 0.7).run()
      }
    }

    // Update document with classification + extracted fields used for filtering
    const counterpartyName = ext.json.base?.counterparty_name?.value
    let counterpartyId: string | null = null
    if (counterpartyName) {
      const existing = await env.DB.prepare(
        `SELECT id FROM counterparties WHERE LOWER(name) = LOWER(?)`
      ).bind(counterpartyName).first<{ id: string }>()
      if (existing) {
        counterpartyId = existing.id
      } else {
        counterpartyId = newId('cp')
        await env.DB.prepare(
          `INSERT INTO counterparties (id, name, type, primary_contact_email)
           VALUES (?, ?, 'other', ?)`
        ).bind(counterpartyId, counterpartyName, ext.json.base?.counterparty_email?.value || null).run()
      }
    }

    const aiTitle = ext.json.base?.title?.value || doc.original_filename
    await env.DB.prepare(
      `UPDATE documents SET document_type = ?, counterparty_id = ?, title = ?, status = 'review', updated_at = datetime('now') WHERE id = ?`
    ).bind(cls.document_type, counterpartyId, aiTitle, documentId).run()

    // Update FTS
    await env.DB.prepare(`DELETE FROM documents_fts WHERE document_id = ?`).bind(documentId).run()
    await env.DB.prepare(
      `INSERT INTO documents_fts (document_id, title, ocr_text, counterparty_name, document_type, extracted_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      documentId,
      aiTitle,
      workingText.slice(0, 100000),
      counterpartyName || '',
      cls.document_type,
      JSON.stringify(ext.json).slice(0, 50000)
    ).run()

    // Generate action items (NOT yet active — they activate on approval)
    const obligations: any[] = ext.json.obligations || []
    const expDate = ext.json.base?.expiration_date?.value
    const noticeDeadline = ext.json.base?.notice_deadline?.value
    const autoRenewal = ext.json.base?.auto_renewal?.value === true

    // Always generate the notice-deadline action item if auto-renewal detected
    if (autoRenewal && noticeDeadline) {
      await env.DB.prepare(
        `INSERT INTO action_items (id, document_id, title, description, due_date, type, priority, source_field)
         VALUES (?, ?, ?, ?, ?, 'notice_deadline', 'critical', 'notice_deadline')`
      ).bind(
        newId('ai'),
        documentId,
        `Send written notice to cancel auto-renewal`,
        `${aiTitle} auto-renews unless written notice is delivered by ${noticeDeadline}. Counterparty: ${counterpartyName || 'n/a'}.`,
        noticeDeadline
      ).run()
    } else if (expDate) {
      await env.DB.prepare(
        `INSERT INTO action_items (id, document_id, title, description, due_date, type, priority, source_field)
         VALUES (?, ?, ?, ?, ?, 'date', 'high', 'expiration_date')`
      ).bind(
        newId('ai'),
        documentId,
        `Contract expiration`,
        `${aiTitle} expires on ${expDate}. Decide renewal or replacement.`,
        expDate
      ).run()
    }

    for (const ob of obligations) {
      if (!ob.due_date) continue
      await env.DB.prepare(
        `INSERT INTO action_items (id, document_id, title, description, due_date, type, priority, source_field)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'obligation')`
      ).bind(
        newId('ai'),
        documentId,
        ob.title || 'Action required',
        ob.description || '',
        ob.due_date,
        ob.type || 'date',
        ob.priority || 'med'
      ).run()
    }

    return { ok: true }
  } catch (e: any) {
    console.error('Extraction pipeline error:', e)
    await env.DB.prepare(
      `UPDATE documents SET status = 'failed', updated_at = datetime('now') WHERE id = ?`
    ).bind(documentId).run()
    return { ok: false, error: e.message || String(e) }
  }
}

// Once a Lead approves an extraction, activate the action items by scheduling reminders
export async function activateApprovedDocument(env: Bindings, documentId: string, approverUserId: string) {
  // Get department escalation chain for default recipients
  const dept = await env.DB.prepare(
    `SELECT dept.id, dept.escalation_chain_json FROM documents d
     JOIN departments dept ON dept.id = d.department_id
     WHERE d.id = ?`
  ).bind(documentId).first<{ id: string; escalation_chain_json: string }>()
  if (!dept) return

  const leadAndAdmin: string[] = JSON.parse(dept.escalation_chain_json || '[]')
  // Always include uploader and Vadim
  const uploader = await env.DB.prepare(
    `SELECT uploaded_by FROM documents WHERE id = ?`
  ).bind(documentId).first<{ uploaded_by: string }>()

  const baseRecipients = Array.from(new Set([
    ...(uploader ? [uploader.uploaded_by] : []),
    ...leadAndAdmin,
    'usr_vadim'
  ]))

  const items = await env.DB.prepare(
    `SELECT id, due_date, assigned_to_user_id FROM action_items WHERE document_id = ? AND status = 'open'`
  ).bind(documentId).all<{ id: string; due_date: string; assigned_to_user_id: string | null }>()

  for (const item of items.results) {
    const recipients = item.assigned_to_user_id
      ? Array.from(new Set([item.assigned_to_user_id, ...baseRecipients]))
      : baseRecipients
    await scheduleRemindersFor(env, item.id, item.due_date.slice(0, 10), recipients)
  }
}
