-- Demo seed: pre-loaded approved documents to showcase the end-to-end flow
-- without needing to run the AI extraction pipeline. Idempotent.

-- 1) Counterparties used by demo docs
INSERT OR IGNORE INTO counterparties (id, name, type, primary_contact_email, primary_contact_phone) VALUES
  ('cp_demo_chubb',     'Chubb Insurance Company',          'insurer',  'service@chubb.com',     '212-555-0101'),
  ('cp_demo_dominion',  'Dominion Energy Ohio',             'utility',  'service@dominionenergy.com', '800-555-0177'),
  ('cp_demo_clevwater', 'Cleveland Division of Water',      'utility',  'service@clevelandwater.com', '216-555-0099'),
  ('cp_demo_kelley',    'Kelley Drye & Warren LLP',         'vendor',   'engagement@kelleydrye.com',  '212-555-0142'),
  ('cp_demo_jenbacher', 'INNIO Jenbacher GmbH',             'vendor',   'sales-na@innio.com',         '+43-1-555-0188'),
  ('cp_demo_acme',      'Acme HVAC Services LLC',           'vendor',   'sales@acmehvac.com',         '440-555-0223'),
  ('cp_demo_pnc',       'PNC Bank, National Association',   'lender',   'cre.servicing@pnc.com',      '412-555-0166');

-- 2) Documents (status='approved' so reminders can fire). No R2 file — these are demo only.
INSERT OR IGNORE INTO documents (id, title, file_hash, r2_key, original_filename, file_size, mime_type, page_count, ocr_text, uploaded_by, department_id, entity_id, property_id, counterparty_id, document_type, status, source) VALUES
  ('doc_demo_ins',
   'Property Insurance Policy — Pine Grove (2026 Renewal)',
   'demo_hash_ins_001', 'demo/insurance-pinegrove.pdf', 'insurance-pinegrove-2026.pdf', 184320, 'application/pdf', 28,
   'PROPERTY INSURANCE POLICY. Carrier: Chubb Insurance Company. Named Insured: Smartland Realty LLC. Policy Number: PI-2026-44871. Coverage: Property, General Liability. Per-occurrence: $5,000,000. Aggregate: $10,000,000. Deductible: $25,000. Premium: $48,500 annual. Effective: 2026-06-01. Expiration: 2027-05-31. Auto-renewal: yes, 30-day written notice required to non-renew. Property: Pine Grove Apartments, Cleveland OH.',
   'usr_pm_lead', 'dept_pm', 'ent_realty', 'prop_pinegrove', 'cp_demo_chubb', 'insurance', 'approved', 'web'),

  ('doc_demo_msa',
   'Master Services Agreement — Acme HVAC Services',
   'demo_hash_msa_001', 'demo/acme-msa.pdf', 'acme-hvac-msa-2024.pdf', 96256, 'application/pdf', 14,
   'MASTER SERVICES AGREEMENT between Smartland Realty LLC and Acme HVAC Services LLC. Term: 2 years from Effective Date 2024-08-15. Auto-renewal: agreement renews automatically for successive one-year terms unless either party delivers written notice of non-renewal at least 60 days prior to expiration. Total contract value over initial term: $240,000. Payment: net 30. Governing law: Ohio.',
   'usr_pm_lead', 'dept_pm', 'ent_realty', NULL, 'cp_demo_acme', 'vendor_msa', 'approved', 'web'),

  ('doc_demo_util',
   'Cleveland Water Service Agreement — Pine Grove',
   'demo_hash_util_001', 'demo/cleveland-water-pinegrove.pdf', 'cleveland-water-pinegrove.pdf', 38912, 'application/pdf', 6,
   'WATER SERVICE AGREEMENT. Service Address: Pine Grove Apartments, Cleveland OH. Account: 8841-22193. Rate: tiered residential. Effective: 2025-01-01. Auto-renewal: rolls year-to-year. Notice to terminate: 90 days written notice. Deposit: $2,500. Counterparty: Cleveland Division of Water.',
   'usr_pm_lead', 'dept_pm', 'ent_realty', 'prop_pinegrove', 'cp_demo_clevwater', 'utility', 'approved', 'web'),

  ('doc_demo_gas',
   'Dominion Energy Ohio — Hall of Fame Service',
   'demo_hash_gas_001', 'demo/dominion-hof.pdf', 'dominion-hof-gas.pdf', 42180, 'application/pdf', 7,
   'GAS SERVICE AGREEMENT. Service Address: Hall of Fame Apartments, Canton OH. Account: 7720-11338. Rate: commercial. Effective: 2024-03-01. Term: 3 years. Expiration: 2027-02-28. Auto-renewal: yes, 90-day written notice required to cancel. Counterparty: Dominion Energy Ohio.',
   'usr_pm_lead', 'dept_pm', 'ent_realty', 'prop_halloffame', 'cp_demo_dominion', 'utility', 'approved', 'web'),

  ('doc_demo_loan',
   'PNC Bank — Pine Grove Acquisition Loan',
   'demo_hash_loan_001', 'demo/pnc-loan.pdf', 'pnc-pinegrove-loan.pdf', 524288, 'application/pdf', 78,
   'COMMERCIAL LOAN AGREEMENT. Lender: PNC Bank, N.A. Borrower: Smartland Realty LLC. Principal: $14,500,000. Rate: 6.25% fixed. Maturity: 2030-09-30. DSCR covenant: 1.25x tested quarterly. LTV covenant: 70%. Quarterly compliance certificates required by 30 days after quarter end.',
   'usr_vadim', 'dept_legal', 'ent_realty', 'prop_pinegrove', 'cp_demo_pnc', 'loan', 'approved', 'web'),

  ('doc_demo_legal',
   'Engagement Letter — Kelley Drye & Warren',
   'demo_hash_legal_001', 'demo/kelley-engagement.pdf', 'kelley-drye-engagement.pdf', 28160, 'application/pdf', 5,
   'OUTSIDE COUNSEL ENGAGEMENT LETTER. Firm: Kelley Drye & Warren LLP. Matter: Smartland Energy LLC — Reg A+ filings & corporate governance. Effective: 2025-04-01. Term: open-ended; either party may terminate on 30 days written notice. Hourly rates: partner $895, associate $545.',
   'usr_legal', 'dept_legal', 'ent_holding', NULL, 'cp_demo_kelley', 'vendor_msa', 'approved', 'web'),

  ('doc_demo_equip',
   'INNIO Jenbacher J920 — Equipment Purchase & Warranty',
   'demo_hash_equip_001', 'demo/jenbacher-j920.pdf', 'jenbacher-j920-warranty.pdf', 327680, 'application/pdf', 42,
   'EQUIPMENT PURCHASE AGREEMENT. Make/Model: INNIO Jenbacher J920 FleXtra (9.5 MW). Serial Numbers: J920-NA-0042, J920-NA-0043. Buyer: Smartland Energy LLC. Site: Van Wert, OH. Delivery: 2026-09-15. Commissioning target: 2026-12-01. Warranty: 24 months from commissioning, OR 8,000 operating hours, whichever first. Annual major service interval: 4,000 hours.',
   'usr_energy', 'dept_energy', 'ent_energy', 'prop_vanwert', 'cp_demo_jenbacher', 'equipment', 'approved', 'web');

-- 3) Extractions (one per doc) with realistic JSON + summaries
INSERT OR IGNORE INTO extractions (id, document_id, schema_version, extracted_json, summary, confidence_overall, model_used, prompt_tokens, completion_tokens, cached_tokens, cost_usd, approved_by, approved_at) VALUES
  ('ext_demo_ins', 'doc_demo_ins', 'v1',
   '{"summary":"Chubb property and general liability policy covering Pine Grove. Renews automatically on 2027-05-31 unless 30-day written notice of non-renewal is delivered. Premium $48,500 annual.","base":{"title":{"value":"Property Insurance Policy — Pine Grove (2026 Renewal)","confidence":0.96},"counterparty_name":{"value":"Chubb Insurance Company","confidence":0.99},"counterparty_email":{"value":"service@chubb.com","confidence":0.92},"smartland_entity":{"value":"Smartland Realty LLC","confidence":0.98},"property_or_site":{"value":"Pine Grove Apartments","confidence":0.97},"effective_date":{"value":"2026-06-01","confidence":0.99},"expiration_date":{"value":"2027-05-31","confidence":0.99},"auto_renewal":{"value":true,"confidence":0.94},"renewal_term":{"value":"1 year","confidence":0.91},"notice_period_days":{"value":30,"confidence":0.96},"notice_deadline":{"value":"2027-05-01","confidence":0.95},"total_value_usd":{"value":48500,"confidence":0.97},"recurring_value_usd":{"value":48500,"confidence":0.95},"payment_terms":{"value":"Annual premium","confidence":0.9},"governing_law":{"value":"Ohio","confidence":0.82},"signed":{"value":true,"confidence":0.95},"signature_dates":{"value":["2026-05-12"],"confidence":0.84}},"type_specific":{"carrier":"Chubb Insurance Company","policy_number":"PI-2026-44871","coverage_type":"Property + General Liability","coverage_limit_per_occurrence":5000000,"coverage_limit_aggregate":10000000,"deductible":25000,"named_insured":"Smartland Realty LLC","premium":48500,"premium_schedule":"Annual"},"obligations":[]}',
   'Chubb property and general liability policy covering Pine Grove. Renews automatically on 2027-05-31 unless 30-day written notice of non-renewal is delivered. Premium is $48,500 annual. Begin RFP process at T-180 to market-shop the renewal.',
   0.93, 'claude-sonnet-4-5', 8420, 1840, 6500, 0.0432, 'usr_pm_lead', datetime('now', '-3 days')),

  ('ext_demo_msa', 'doc_demo_msa', 'v1',
   '{"summary":"Master services agreement with Acme HVAC for property maintenance. Auto-renews for one-year terms unless 60-day written notice of non-renewal is delivered before 2026-06-15.","base":{"title":{"value":"Master Services Agreement — Acme HVAC Services","confidence":0.95},"counterparty_name":{"value":"Acme HVAC Services LLC","confidence":0.98},"smartland_entity":{"value":"Smartland Realty LLC","confidence":0.97},"effective_date":{"value":"2024-08-15","confidence":0.99},"expiration_date":{"value":"2026-08-15","confidence":0.97},"auto_renewal":{"value":true,"confidence":0.97},"renewal_term":{"value":"1 year","confidence":0.94},"notice_period_days":{"value":60,"confidence":0.96},"notice_deadline":{"value":"2026-06-16","confidence":0.95},"total_value_usd":{"value":240000,"confidence":0.84},"payment_terms":{"value":"Net 30","confidence":0.92},"governing_law":{"value":"Ohio","confidence":0.96}},"type_specific":{"scope_summary":"HVAC maintenance and emergency repair services","limitation_of_liability":"Cap at fees paid in trailing 12 months"},"obligations":[]}',
   'Master services agreement with Acme HVAC for property maintenance. Auto-renews for one-year terms unless 60-day written notice of non-renewal is delivered before 2026-06-16.',
   0.95, 'claude-sonnet-4-5', 4210, 1180, 3800, 0.0188, 'usr_pm_lead', datetime('now', '-5 days')),

  ('ext_demo_util', 'doc_demo_util', 'v1',
   '{"summary":"Cleveland Water service for Pine Grove. Rolls year-to-year unless 90-day written notice of cancellation is provided. Deposit $2,500 on file.","base":{"title":{"value":"Cleveland Water Service Agreement — Pine Grove","confidence":0.94},"counterparty_name":{"value":"Cleveland Division of Water","confidence":0.99},"smartland_entity":{"value":"Smartland Realty LLC","confidence":0.96},"property_or_site":{"value":"Pine Grove Apartments","confidence":0.98},"effective_date":{"value":"2025-01-01","confidence":0.96},"expiration_date":{"value":"2026-12-31","confidence":0.85},"auto_renewal":{"value":true,"confidence":0.92},"renewal_term":{"value":"1 year","confidence":0.9},"notice_period_days":{"value":90,"confidence":0.93},"notice_deadline":{"value":"2026-10-02","confidence":0.9},"total_value_usd":{"value":null,"confidence":0.0},"governing_law":{"value":"Ohio","confidence":0.85}},"type_specific":{"service_address":"Pine Grove Apartments, Cleveland OH","account_number":"8841-22193","rate_structure":"Tiered residential","deposit_amount":2500},"obligations":[]}',
   'Cleveland Water service for Pine Grove. Rolls year-to-year unless 90-day written notice of cancellation is provided. Deposit of $2,500 on file.',
   0.91, 'claude-sonnet-4-5', 2240, 720, 1800, 0.0102, 'usr_pm_lead', datetime('now', '-7 days')),

  ('ext_demo_gas', 'doc_demo_gas', 'v1',
   '{"summary":"Dominion Energy gas supply for Hall of Fame. Three-year fixed term ending 2027-02-28. Auto-renews unless 90-day written notice is delivered before 2026-11-30.","base":{"title":{"value":"Dominion Energy Ohio — Hall of Fame Service","confidence":0.95},"counterparty_name":{"value":"Dominion Energy Ohio","confidence":0.99},"smartland_entity":{"value":"Smartland Realty LLC","confidence":0.96},"property_or_site":{"value":"Hall of Fame Apartments","confidence":0.97},"effective_date":{"value":"2024-03-01","confidence":0.99},"expiration_date":{"value":"2027-02-28","confidence":0.98},"auto_renewal":{"value":true,"confidence":0.96},"renewal_term":{"value":"1 year","confidence":0.92},"notice_period_days":{"value":90,"confidence":0.95},"notice_deadline":{"value":"2026-11-30","confidence":0.94},"governing_law":{"value":"Ohio","confidence":0.92}},"type_specific":{"service_address":"Hall of Fame Apartments, Canton OH","account_number":"7720-11338","rate_structure":"Commercial fixed"},"obligations":[]}',
   'Dominion Energy gas supply for Hall of Fame. Three-year fixed term ending 2027-02-28. Auto-renews unless 90-day written notice is delivered before 2026-11-30.',
   0.95, 'claude-sonnet-4-5', 2380, 760, 2000, 0.0108, 'usr_pm_lead', datetime('now', '-2 days')),

  ('ext_demo_loan', 'doc_demo_loan', 'v1',
   '{"summary":"PNC commercial loan secured by Pine Grove. $14.5M principal at 6.25% fixed, maturing 2030-09-30. Quarterly DSCR (1.25x) and LTV (70%) covenant testing with compliance certificates due 30 days after quarter end.","base":{"title":{"value":"PNC Bank — Pine Grove Acquisition Loan","confidence":0.97},"counterparty_name":{"value":"PNC Bank, National Association","confidence":0.99},"smartland_entity":{"value":"Smartland Realty LLC","confidence":0.99},"property_or_site":{"value":"Pine Grove Apartments","confidence":0.96},"effective_date":{"value":"2024-09-30","confidence":0.97},"expiration_date":{"value":"2030-09-30","confidence":0.99},"auto_renewal":{"value":false,"confidence":0.98},"total_value_usd":{"value":14500000,"confidence":0.99},"governing_law":{"value":"Ohio","confidence":0.93}},"type_specific":{"lender":"PNC Bank, N.A.","principal":14500000,"rate":"6.25% fixed","maturity":"2030-09-30","financial_covenants":"DSCR >= 1.25x; LTV <= 70%","reporting_cadence":"Quarterly compliance certificates due 30 days after quarter end"},"obligations":[]}',
   'PNC commercial loan secured by Pine Grove. $14.5M principal at 6.25% fixed, maturing 2030-09-30. Quarterly DSCR and LTV covenant testing with compliance certificates due 30 days after quarter end.',
   0.97, 'claude-sonnet-4-5', 18200, 2400, 14000, 0.0816, 'usr_legal', datetime('now', '-10 days')),

  ('ext_demo_legal', 'doc_demo_legal', 'v1',
   '{"summary":"Outside counsel engagement with Kelley Drye & Warren. Open-ended term; either party may terminate on 30 days notice. Partner $895/hr, Associate $545/hr.","base":{"title":{"value":"Engagement Letter — Kelley Drye & Warren","confidence":0.94},"counterparty_name":{"value":"Kelley Drye & Warren LLP","confidence":0.99},"smartland_entity":{"value":"Smartland Holdings LLC","confidence":0.93},"effective_date":{"value":"2025-04-01","confidence":0.98},"expiration_date":{"value":null,"confidence":0.0},"auto_renewal":{"value":false,"confidence":0.9},"notice_period_days":{"value":30,"confidence":0.96},"governing_law":{"value":"New York","confidence":0.9}},"type_specific":{"scope_summary":"Reg A+ filings & corporate governance for Smartland Energy LLC"},"obligations":[]}',
   'Outside counsel engagement with Kelley Drye & Warren for Reg A+ filings and corporate governance. Open-ended term, terminable on 30 days written notice.',
   0.92, 'claude-sonnet-4-5', 1950, 640, 1500, 0.0086, 'usr_legal', datetime('now', '-15 days')),

  ('ext_demo_equip', 'doc_demo_equip', 'v1',
   '{"summary":"INNIO Jenbacher J920 (9.5 MW) for Van Wert site. Two units. Commissioning target 2026-12-01. 24-month or 8,000-hour warranty (whichever first). Major service every 4,000 hours.","base":{"title":{"value":"INNIO Jenbacher J920 — Equipment Purchase & Warranty","confidence":0.96},"counterparty_name":{"value":"INNIO Jenbacher GmbH","confidence":0.99},"smartland_entity":{"value":"Smartland Energy LLC","confidence":0.99},"property_or_site":{"value":"Van Wert Site","confidence":0.97},"effective_date":{"value":"2025-11-01","confidence":0.93},"expiration_date":{"value":"2028-12-01","confidence":0.85},"auto_renewal":{"value":false,"confidence":0.95},"total_value_usd":{"value":null,"confidence":0.0},"governing_law":{"value":"New York","confidence":0.86}},"type_specific":{"make_model":"INNIO Jenbacher J920 FleXtra (9.5 MW)","serial_numbers":"J920-NA-0042, J920-NA-0043","delivery_date":"2026-09-15","commissioning_date":"2026-12-01","warranty_start":"2026-12-01","warranty_length_months":24,"warranty_exclusions":"Operator misuse, fuel out-of-spec","service_interval":"Major service every 4,000 operating hours"},"obligations":[]}',
   'INNIO Jenbacher J920 (9.5 MW) units for Van Wert energy site. Commissioning target 2026-12-01. 24-month or 8,000-hour warranty (whichever first). Major service every 4,000 hours.',
   0.94, 'claude-sonnet-4-5', 12400, 2100, 9800, 0.0612, 'usr_energy', datetime('now', '-20 days'));

-- 4) Action items (the heart of the system — date-driven + notice deadlines)
-- All dates are calculated relative to current "now" so the demo always shows live reminders.

INSERT OR IGNORE INTO action_items (id, document_id, title, description, due_date, type, priority, source_field, status) VALUES
  -- Insurance: notice deadline (T-180-ish from now → triggers GREEN reminder)
  ('ai_demo_ins_notice','doc_demo_ins',
   'Send written notice OR initiate market RFP — Pine Grove insurance',
   'Chubb policy auto-renews unless 30-day written non-renewal notice is delivered. Begin market shopping at T-180 to compare carriers.',
   date('now','+165 days'), 'notice_deadline','critical','notice_deadline','open'),

  ('ai_demo_ins_exp','doc_demo_ins',
   'Property insurance expiration — confirm renewal in place',
   'Pine Grove property insurance expires; confirm new bound coverage is active before this date.',
   date('now','+195 days'), 'date','high','expiration_date','open'),

  -- Acme MSA: notice deadline 60 days before 2026-08-15. Engineered to be ~T-30/T-60 from now.
  ('ai_demo_msa_notice','doc_demo_msa',
   'Send written notice to cancel auto-renewal — Acme HVAC MSA',
   'Acme HVAC MSA auto-renews for 1-year terms. Written notice of non-renewal must be delivered at least 60 days before 2026-08-15. THIS IS THE AUTO-RENEWAL TRAP.',
   date('now','+45 days'), 'notice_deadline','critical','notice_deadline','open'),

  -- Cleveland Water: 90-day notice. Shows up as T-90/T-60.
  ('ai_demo_util_notice','doc_demo_util',
   'Notice deadline — Cleveland Water service termination option',
   'If terminating, deliver written notice 90 days before year-end roll. Otherwise rolls automatically.',
   date('now','+88 days'), 'notice_deadline','high','notice_deadline','open'),

  -- Dominion: notice deadline near T-180 (just informational at this point).
  ('ai_demo_gas_notice','doc_demo_gas',
   'Notice deadline — Dominion Energy gas supply',
   'Auto-renewal unless 90-day written notice. Begin RFP for 2027 gas supply at T-180.',
   date('now','+210 days'), 'notice_deadline','critical','notice_deadline','open'),

  -- PNC quarterly compliance certificate (date-based, recurring representation)
  ('ai_demo_loan_q','doc_demo_loan',
   'PNC quarterly DSCR/LTV compliance certificate due',
   'Deliver quarterly compliance certificate to PNC within 30 days after quarter end. DSCR must be >= 1.25x; LTV <= 70%.',
   date('now','+25 days'), 'date','high','reporting_obligation','open'),

  -- PNC maturity (long-tail tracking)
  ('ai_demo_loan_mat','doc_demo_loan',
   'PNC loan maturity — refinance decision',
   'Begin refinancing analysis 12 months before maturity.',
   date('now','+800 days'), 'date','med','expiration_date','open'),

  -- Jenbacher commissioning + warranty milestones
  ('ai_demo_equip_comm','doc_demo_equip',
   'Jenbacher J920 commissioning target — Van Wert',
   'Verify commissioning is on schedule. Warranty clock starts at commissioning.',
   date('now','+220 days'), 'date','high','commissioning_date','open'),

  ('ai_demo_equip_svc','doc_demo_equip',
   'Schedule Jenbacher J920 first major service (4,000 hours)',
   'First major service due at 4,000 operating hours. Estimated calendar date based on dispatch profile.',
   date('now','+560 days'), 'date','med','service_interval','open'),

  -- Kelley Drye — recurring fee review (no hard date — quarterly check)
  ('ai_demo_legal_q','doc_demo_legal',
   'Quarterly review of Kelley Drye fee accruals',
   'Confirm hourly rates and matter scope still aligned with engagement letter.',
   date('now','+85 days'), 'recurring','low','obligation','open');

-- 5) Schedule reminders for all the action items above so dashboards have data
-- We pre-fire some reminders (sent_at != NULL, status='sent', no acknowledged_at) to demonstrate
-- the "unacknowledged" KPI and the notice-deadline RED warnings.
-- Recipients are by user_id (Vadim + relevant dept lead).

-- Acme MSA — T-60 fired 6 hours ago, NOT yet acknowledged → shows up as critical+unacked
INSERT OR IGNORE INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status, sent_at) VALUES
  ('rem_demo_msa_60', 'ai_demo_msa_notice', datetime('now','-6 hours'), 'T-60',
   '["usr_pm_lead","usr_vadim"]', 'sent', datetime('now','-6 hours'));

-- Cleveland Water — T-90 fired yesterday, NOT acknowledged
INSERT OR IGNORE INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status, sent_at) VALUES
  ('rem_demo_util_90', 'ai_demo_util_notice', datetime('now','-1 days'), 'T-90',
   '["usr_pm_lead","usr_vadim"]', 'sent', datetime('now','-1 days'));

-- PNC quarterly cert — T-30 fired 3 days ago, escalated once already
INSERT OR IGNORE INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status, sent_at, escalation_level) VALUES
  ('rem_demo_loan_30', 'ai_demo_loan_q', datetime('now','-3 days'), 'T-30',
   '["usr_legal","usr_vadim"]', 'escalated', datetime('now','-3 days'), 1);

-- Pine Grove insurance — T-180 fired 2 days ago, ACKNOWLEDGED (shows the green path)
INSERT OR IGNORE INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status, sent_at, acknowledged_by, acknowledged_at) VALUES
  ('rem_demo_ins_180', 'ai_demo_ins_notice', datetime('now','-2 days'), 'T-180',
   '["usr_pm_lead","usr_vadim"]', 'acknowledged', datetime('now','-2 days'),
   'usr_pm_lead', datetime('now','-1 days','-12 hours'));

-- Dominion gas — T-180 scheduled for tomorrow (pending)
INSERT OR IGNORE INTO reminders (id, action_item_id, scheduled_for, stage, recipients_json, status) VALUES
  ('rem_demo_gas_180', 'ai_demo_gas_notice', datetime('now','+1 days'), 'T-180',
   '["usr_pm_lead","usr_vadim"]', 'pending');

-- Acknowledgment row for the acked insurance reminder (audit trail)
INSERT OR IGNORE INTO acknowledgments (id, reminder_id, user_id, action, ip_address, user_agent, acted_at) VALUES
  ('ack_demo_ins_1', 'rem_demo_ins_180', 'usr_pm_lead', 'ack',
   '198.51.100.42', 'Mozilla/5.0 (demo)', datetime('now','-1 days','-12 hours'));

-- 6) Document tags (cross-cutting)
INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES
  ('doc_demo_ins', 'Insurance'),
  ('doc_demo_loan', 'Insurance');

-- 7) Populate FTS for search
INSERT OR IGNORE INTO documents_fts (document_id, title, ocr_text, counterparty_name, document_type, extracted_json)
SELECT d.id, d.title, COALESCE(d.ocr_text,''), COALESCE(cp.name,''), COALESCE(d.document_type,''),
       COALESCE((SELECT extracted_json FROM extractions WHERE document_id = d.id ORDER BY extracted_at DESC LIMIT 1), '')
FROM documents d
LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
WHERE d.id LIKE 'doc_demo_%';

-- 8) A few audit log entries so /audit isn't empty
INSERT OR IGNORE INTO audit_log (id, user_id, user_email, action, resource_type, resource_id, ip_address, occurred_at) VALUES
  ('aud_demo_1','usr_pm_lead','pm.lead@smartland.com','document.upload','document','doc_demo_ins','198.51.100.10', datetime('now','-3 days')),
  ('aud_demo_2','usr_pm_lead','pm.lead@smartland.com','document.approve','document','doc_demo_ins','198.51.100.10', datetime('now','-3 days','+10 minutes')),
  ('aud_demo_3','usr_pm_lead','pm.lead@smartland.com','reminder.ack','reminder','rem_demo_ins_180','198.51.100.42', datetime('now','-1 days','-12 hours')),
  ('aud_demo_4','usr_legal','legal.lead@smartland.com','document.approve','document','doc_demo_loan','198.51.100.11', datetime('now','-10 days')),
  ('aud_demo_5','usr_energy','energy.lead@smartland.com','document.approve','document','doc_demo_equip','198.51.100.12', datetime('now','-20 days'));

-- 9) AI cost log so the executive dashboard shows realistic spend
INSERT OR IGNORE INTO ai_costs_daily (date, model, prompt_tokens, completion_tokens, cached_tokens, total_usd, call_count) VALUES
  (date('now','-20 days'), 'claude-sonnet-4-5', 12400, 2100, 9800, 0.0612, 1),
  (date('now','-15 days'), 'claude-sonnet-4-5',  1950,  640, 1500, 0.0086, 1),
  (date('now','-10 days'), 'claude-sonnet-4-5', 18200, 2400, 14000, 0.0816, 1),
  (date('now','-7 days'),  'claude-sonnet-4-5',  2240,  720, 1800, 0.0102, 1),
  (date('now','-5 days'),  'claude-sonnet-4-5',  4210, 1180, 3800, 0.0188, 1),
  (date('now','-3 days'),  'claude-sonnet-4-5',  8420, 1840, 6500, 0.0432, 1),
  (date('now','-3 days'),  'claude-haiku-4-5',   1200,  120,  900, 0.0011, 1),
  (date('now','-2 days'),  'claude-sonnet-4-5',  2380,  760, 2000, 0.0108, 1);
