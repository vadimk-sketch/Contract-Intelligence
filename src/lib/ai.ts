// AI client wrapper: classification + extraction with cost tracking and budget cap
import Anthropic from '@anthropic-ai/sdk'
import type { Bindings } from '../types/bindings'

// Pricing per 1M tokens (USD) — as of 2026 published rates
const PRICING: Record<string, { in: number; out: number; cached_in: number }> = {
  'claude-haiku-4-5':  { in: 0.80,  out: 4.00,   cached_in: 0.08 },
  'claude-sonnet-4-5': { in: 3.00,  out: 15.00,  cached_in: 0.30 }
}

export const MODELS = {
  CLASSIFY: 'claude-haiku-4-5',
  EXTRACT:  'claude-sonnet-4-5'
} as const

export interface AICostInfo {
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  cost_usd: number
  model: string
}

function calcCost(model: string, prompt: number, completion: number, cached: number): number {
  const p = PRICING[model] || PRICING['claude-sonnet-4-5']
  const billed_input = Math.max(0, prompt - cached)
  return (billed_input * p.in + cached * p.cached_in + completion * p.out) / 1_000_000
}

export async function recordCost(env: Bindings, info: AICostInfo) {
  const today = new Date().toISOString().slice(0, 10)
  await env.DB.prepare(
    `INSERT INTO ai_costs_daily (date, model, prompt_tokens, completion_tokens, cached_tokens, total_usd, call_count)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(date, model) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       total_usd = total_usd + excluded.total_usd,
       call_count = call_count + 1`
  ).bind(today, info.model, info.prompt_tokens, info.completion_tokens, info.cached_tokens, info.cost_usd).run()
}

export async function getMonthlyCost(env: Bindings): Promise<number> {
  const monthPrefix = new Date().toISOString().slice(0, 7) // YYYY-MM
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(total_usd), 0) as usd FROM ai_costs_daily WHERE date LIKE ? || '%'`
  ).bind(monthPrefix).first<{ usd: number }>()
  return row?.usd || 0
}

export async function checkBudget(env: Bindings): Promise<{ ok: boolean; spent: number; cap: number }> {
  const cap = parseFloat(env.AI_BUDGET_MONTHLY_USD || '250')
  const spent = await getMonthlyCost(env)
  return { ok: spent < cap, spent, cap }
}

function getClient(env: Bindings): Anthropic {
  const key = env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey: key })
}

export async function classifyDocument(
  env: Bindings,
  text: string
): Promise<{ document_type: string; confidence: number; cost: AICostInfo }> {
  const budget = await checkBudget(env)
  if (!budget.ok) throw new Error(`AI budget exceeded: $${budget.spent.toFixed(2)} / $${budget.cap}`)

  const client = getClient(env)
  const truncated = text.slice(0, 12000)

  const types = [
    'utility', 'insurance', 'lease', 'vendor_msa', 'equipment',
    'loan', 'partnership', 'securities', 'permit', 'corporate', 'other'
  ]

  const resp = await client.messages.create({
    model: MODELS.CLASSIFY,
    max_tokens: 256,
    system: `You are a document classifier for Smartland, a real-estate and energy company. Classify the document into exactly ONE of: ${types.join(', ')}. Respond with ONLY a JSON object: {"document_type": "<type>", "confidence": <0-1>}.`,
    messages: [{ role: 'user', content: `Document text (first portion):\n\n${truncated}` }]
  })

  const content = resp.content[0]
  const text_resp = content.type === 'text' ? content.text : '{}'
  const match = text_resp.match(/\{[^}]+\}/)
  const parsed = match ? JSON.parse(match[0]) : { document_type: 'other', confidence: 0 }

  const cost: AICostInfo = {
    prompt_tokens: resp.usage.input_tokens,
    completion_tokens: resp.usage.output_tokens,
    cached_tokens: (resp.usage as any).cache_read_input_tokens || 0,
    cost_usd: calcCost(MODELS.CLASSIFY, resp.usage.input_tokens, resp.usage.output_tokens,
                       (resp.usage as any).cache_read_input_tokens || 0),
    model: MODELS.CLASSIFY
  }
  await recordCost(env, cost)

  return {
    document_type: types.includes(parsed.document_type) ? parsed.document_type : 'other',
    confidence: parsed.confidence ?? 0.5,
    cost
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert contract analyst for Smartland, a real-estate and energy holding company. Your job is to extract structured data from contracts and produce a plain-English executive summary.

CRITICAL RULES:
1. Output VALID JSON only. No prose outside the JSON.
2. Every field includes a "value" and a "confidence" score (0.0-1.0). If a field is not present in the document, use null and confidence 0.
3. For dates, use ISO 8601 format (YYYY-MM-DD).
4. For auto_renewal, examine the contract for evergreen clauses, automatic renewal language, "rolls over", "renews automatically unless", etc. If found, set auto_renewal.value = true and extract the notice period in days.
5. The notice_deadline is the SINGLE MOST IMPORTANT field. It is computed as expiration_date minus notice_period_days. If we miss this date, the contract auto-renews and Smartland loses tens of thousands of dollars.
6. Be conservative with confidence scores. Only use >= 0.85 when the field is clearly stated. Use 0.5-0.7 when inferred. Use < 0.5 when unsure.
7. Counterparty is the OTHER party (not Smartland or its subsidiaries).
8. Provide a 3-4 sentence plain-English summary in the "summary" field, written in active confident voice — direct, professional, never weak.

REQUIRED OUTPUT SCHEMA:
{
  "summary": "string",
  "base": {
    "title": {"value": "string", "confidence": 0-1},
    "counterparty_name": {"value": "string", "confidence": 0-1},
    "counterparty_email": {"value": "string|null", "confidence": 0-1},
    "counterparty_phone": {"value": "string|null", "confidence": 0-1},
    "smartland_entity": {"value": "string", "confidence": 0-1},
    "property_or_site": {"value": "string|null", "confidence": 0-1},
    "effective_date": {"value": "YYYY-MM-DD|null", "confidence": 0-1},
    "expiration_date": {"value": "YYYY-MM-DD|null", "confidence": 0-1},
    "auto_renewal": {"value": true|false, "confidence": 0-1},
    "renewal_term": {"value": "string|null", "confidence": 0-1},
    "notice_period_days": {"value": number|null, "confidence": 0-1},
    "notice_deadline": {"value": "YYYY-MM-DD|null", "confidence": 0-1},
    "total_value_usd": {"value": number|null, "confidence": 0-1},
    "recurring_value_usd": {"value": number|null, "confidence": 0-1},
    "payment_terms": {"value": "string|null", "confidence": 0-1},
    "governing_law": {"value": "string|null", "confidence": 0-1},
    "signed": {"value": true|false, "confidence": 0-1},
    "signature_dates": {"value": ["YYYY-MM-DD"], "confidence": 0-1}
  },
  "type_specific": { ... fields for the specific document_type ... },
  "obligations": [
    {"title": "string", "description": "string", "due_date": "YYYY-MM-DD|null", "type": "date|notice_deadline|recurring", "priority": "low|med|high|critical", "recurrence": "string|null"}
  ]
}

TYPE-SPECIFIC FIELDS (include in type_specific based on document_type):
- utility: service_address, account_number, rate_structure, minimum_usage, deposit_amount, meter_id, early_termination_penalty
- insurance: carrier, policy_number, coverage_type, coverage_limit_per_occurrence, coverage_limit_aggregate, deductible, named_insured, additional_insureds, premium, premium_schedule, broker_contact
- lease: tenant_name, unit, monthly_rent, security_deposit, lease_term, renewal_options, late_fee, pet_policy, escalation_clauses
- vendor_msa: scope_summary, deliverables, milestones, ntp_date, payment_milestones, change_order_process, indemnification, limitation_of_liability, ip_ownership
- equipment: make_model, serial_numbers, delivery_date, commissioning_date, warranty_start, warranty_length_months, warranty_exclusions, service_interval
- loan: lender, principal, rate, term, amortization, maturity, prepayment_penalty, financial_covenants, reporting_cadence, events_of_default
- permit: issuing_authority, permit_number, conditions_of_approval, reporting_obligations, expiration, renewal_process

Always include obligations[] derived from the contract. If auto_renewal is true, ALWAYS include a notice_deadline obligation with priority "critical".`

export async function extractContract(
  env: Bindings,
  text: string,
  documentType: string
): Promise<{ json: any; cost: AICostInfo; confidence_overall: number }> {
  const budget = await checkBudget(env)
  if (!budget.ok) throw new Error(`AI budget exceeded: $${budget.spent.toFixed(2)} / $${budget.cap}`)

  const client = getClient(env)
  const truncated = text.slice(0, 80000)

  const resp = await client.messages.create({
    model: MODELS.EXTRACT,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' } // prompt caching!
      }
    ] as any,
    messages: [{
      role: 'user',
      content: `Document type (pre-classified): ${documentType}\n\nDocument text:\n\n${truncated}\n\nReturn ONLY the JSON object per the schema. No prose outside JSON.`
    }]
  })

  const content = resp.content[0]
  const text_resp = content.type === 'text' ? content.text : '{}'

  // strip code fences if present
  const cleaned = text_resp.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // try to find first { ... } block
    const m = cleaned.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : { summary: 'Extraction failed to parse.', base: {}, type_specific: {}, obligations: [] }
  }

  // Compute overall confidence as average of base field confidences
  const confidences: number[] = []
  if (parsed.base) {
    for (const v of Object.values(parsed.base)) {
      const c = (v as any)?.confidence
      if (typeof c === 'number') confidences.push(c)
    }
  }
  const confidence_overall = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0.5

  const cached_tokens = (resp.usage as any).cache_read_input_tokens || 0
  const cost: AICostInfo = {
    prompt_tokens: resp.usage.input_tokens,
    completion_tokens: resp.usage.output_tokens,
    cached_tokens,
    cost_usd: calcCost(MODELS.EXTRACT, resp.usage.input_tokens, resp.usage.output_tokens, cached_tokens),
    model: MODELS.EXTRACT
  }
  await recordCost(env, cost)

  return { json: parsed, cost, confidence_overall }
}
