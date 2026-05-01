// Dashboard endpoints: personal, department, executive
import { Hono } from 'hono'
import type { AppEnv } from '../types/bindings'
import { requireAuth } from '../lib/auth'

const dashboards = new Hono<AppEnv>()
dashboards.use('*', requireAuth())

// Personal dashboard
dashboards.get('/personal', async (c) => {
  const user = c.get('user')!

  const myOpenReminders = await c.env.DB.prepare(`
    SELECT r.id, r.stage, r.scheduled_for, r.status,
           a.title, a.due_date, a.type, a.priority,
           d.id as doc_id, d.title as doc_title,
           cp.name as counterparty_name
    FROM reminders r
    JOIN action_items a ON a.id = r.action_item_id
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    WHERE (json_extract(r.recipients_json, '$') LIKE ? OR a.assigned_to_user_id = ?)
      AND r.status IN ('sent','escalated','pending')
      AND r.acknowledged_at IS NULL
      AND a.status NOT IN ('completed','archived')
    ORDER BY a.due_date ASC
    LIMIT 50
  `).bind(`%"${user.id}"%`, user.id).all()

  const recentUploads = await c.env.DB.prepare(`
    SELECT id, title, document_type, status, created_at
    FROM documents
    WHERE uploaded_by = ? AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 10
  `).bind(user.id).all()

  const dueIn30 = await c.env.DB.prepare(`
    SELECT a.id, a.title, a.due_date, a.type, a.priority,
           d.id as doc_id, d.title as doc_title
    FROM action_items a
    JOIN documents d ON d.id = a.document_id
    WHERE a.assigned_to_user_id = ?
      AND a.status = 'open'
      AND a.due_date <= date('now', '+30 days')
    ORDER BY a.due_date ASC
  `).bind(user.id).all()

  return c.json({
    open_reminders: myOpenReminders.results,
    recent_uploads: recentUploads.results,
    due_in_30: dueIn30.results
  })
})

// Department dashboard (Lead/Admin)
dashboards.get('/department/:id', async (c) => {
  const user = c.get('user')!
  const deptId = c.req.param('id')
  if (user.role !== 'admin' && user.department_id !== deptId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const allReminders = await c.env.DB.prepare(`
    SELECT r.id, r.stage, r.scheduled_for, r.status, r.acknowledged_at,
           a.title, a.due_date, a.type, a.priority,
           d.id as doc_id, d.title as doc_title
    FROM reminders r
    JOIN action_items a ON a.id = r.action_item_id
    JOIN documents d ON d.id = a.document_id
    WHERE d.department_id = ?
      AND r.status IN ('sent','escalated','pending')
      AND a.status NOT IN ('completed','archived')
    ORDER BY a.due_date ASC LIMIT 200
  `).bind(deptId).all()

  const awaitingApproval = await c.env.DB.prepare(`
    SELECT d.id, d.title, d.document_type, d.created_at,
           e.confidence_overall, e.summary
    FROM documents d
    LEFT JOIN extractions e ON e.document_id = d.id
    WHERE d.department_id = ? AND d.status = 'review'
    ORDER BY d.created_at DESC
  `).bind(deptId).all()

  const expiring180 = await c.env.DB.prepare(`
    SELECT a.id, a.title, a.due_date, a.type, a.priority,
           d.id as doc_id, d.title as doc_title,
           cp.name as counterparty_name
    FROM action_items a
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
    WHERE d.department_id = ? AND a.status = 'open'
      AND a.due_date <= date('now', '+180 days')
    ORDER BY a.due_date ASC LIMIT 100
  `).bind(deptId).all()

  const valueRow = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(CAST(json_extract(e.extracted_json, '$.base.total_value_usd.value') AS REAL)), 0) as total_value
    FROM documents d JOIN extractions e ON e.document_id = d.id
    WHERE d.department_id = ? AND d.status = 'approved'
  `).bind(deptId).first<{ total_value: number }>()

  return c.json({
    department_id: deptId,
    reminders: allReminders.results,
    awaiting_approval: awaitingApproval.results,
    expiring_180: expiring180.results,
    total_contract_value_usd: valueRow?.total_value || 0
  })
})

// Executive dashboard (admin only)
dashboards.get('/executive', async (c) => {
  const user = c.get('user')!
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)

  const byDept = await c.env.DB.prepare(`
    SELECT dept.id, dept.name,
      (SELECT COUNT(*) FROM documents WHERE department_id = dept.id AND status = 'approved' AND deleted_at IS NULL) as approved_count,
      (SELECT COUNT(*) FROM documents WHERE department_id = dept.id AND status = 'review') as awaiting_review,
      (SELECT COUNT(*) FROM reminders r
         JOIN action_items a ON a.id = r.action_item_id
         JOIN documents d ON d.id = a.document_id
         WHERE d.department_id = dept.id
           AND r.status IN ('sent','escalated')
           AND r.acknowledged_at IS NULL) as unack_count
    FROM departments dept
  `).all()

  const missed90 = await c.env.DB.prepare(`
    SELECT COUNT(*) as n FROM action_items
    WHERE status = 'missed' AND updated_at >= datetime('now', '-90 days')
  `).first<{ n: number }>()

  const at_risk_90 = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT d.id) as n FROM action_items a
    JOIN documents d ON d.id = a.document_id
    WHERE a.status = 'open'
      AND a.due_date <= date('now', '+90 days')
      AND d.status = 'approved'
  `).first<{ n: number }>()

  const top_value = await c.env.DB.prepare(`
    SELECT d.id, d.title, d.document_type,
           CAST(json_extract(e.extracted_json, '$.base.total_value_usd.value') AS REAL) as total_value,
           a.due_date, a.title as ai_title
    FROM action_items a
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN extractions e ON e.document_id = d.id
    WHERE a.status = 'open' AND a.due_date <= date('now', '+180 days')
      AND d.status = 'approved'
    ORDER BY total_value DESC NULLS LAST LIMIT 10
  `).all()

  const auto_renewal_pct = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM documents d JOIN extractions e ON e.document_id = d.id
        WHERE d.status = 'approved' AND json_extract(e.extracted_json, '$.base.auto_renewal.value') = 1) as with_auto,
      (SELECT COUNT(*) FROM documents WHERE status = 'approved' AND deleted_at IS NULL) as total
  `).first<{ with_auto: number; total: number }>()

  const ai_spend = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(total_usd), 0) as month_to_date
    FROM ai_costs_daily
    WHERE date LIKE strftime('%Y-%m', 'now') || '%'
  `).first<{ month_to_date: number }>()

  return c.json({
    by_department: byDept.results,
    missed_90_count: missed90?.n || 0,
    at_risk_90: at_risk_90?.n || 0,
    top_value_at_risk: top_value.results,
    auto_renewal: auto_renewal_pct,
    ai_spend_mtd_usd: ai_spend?.month_to_date || 0,
    ai_budget_usd: parseFloat(c.env.AI_BUDGET_MONTHLY_USD || '250')
  })
})

export default dashboards
