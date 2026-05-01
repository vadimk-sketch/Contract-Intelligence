-- Smartland Contract Intelligence & Renewal Manager
-- Initial schema migration
-- All IDs are TEXT (UUID v7-ish, time-orderable nanoids)
-- All timestamps stored as ISO8601 TEXT for portability

-- ============================================================
-- IDENTITY & ORG
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  default_recipient_email TEXT,
  escalation_chain_json TEXT NOT NULL DEFAULT '[]', -- ordered array of user_ids
  color_hex TEXT NOT NULL DEFAULT '#1F4E79',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','lead','member','readonly','system')),
  department_id TEXT REFERENCES departments(id),
  sso_subject TEXT UNIQUE,
  two_factor_secret TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  time_boxed_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('realty','energy','spv','trust','holding','other')),
  parent_entity_id TEXT REFERENCES entities(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  entity_id TEXT REFERENCES entities(id),
  unit_count INTEGER,
  market TEXT,
  property_type TEXT, -- multifamily, energy_site, office, land
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_properties_entity ON properties(entity_id);
CREATE INDEX IF NOT EXISTS idx_properties_market ON properties(market);

CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('vendor','insurer','lender','tenant','utility','partner','contractor','other')),
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
CREATE INDEX IF NOT EXISTS idx_counterparties_type ON counterparties(type);

-- ============================================================
-- DOCUMENTS & EXTRACTION
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  page_count INTEGER,
  ocr_text TEXT, -- extracted text for FTS
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  entity_id TEXT REFERENCES entities(id),
  property_id TEXT REFERENCES properties(id),
  counterparty_id TEXT REFERENCES counterparties(id),
  document_type TEXT, -- utility, insurance, lease, vendor_msa, equipment, loan, partnership, securities, permit, corporate, other
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','extracting','review','approved','archived','failed')),
  superseded_by_document_id TEXT REFERENCES documents(id),
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','email','bulk','drive','api')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_dept_status_type ON documents(department_id, status, document_type);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_counterparty ON documents(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (document_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  extracted_json TEXT NOT NULL,
  summary TEXT,
  confidence_overall REAL,
  model_used TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_extractions_document ON extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_extractions_approved ON extractions(approved_at);

CREATE TABLE IF NOT EXISTS extraction_fields (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT,
  confidence REAL,
  source_page INTEGER,
  source_bbox_json TEXT,
  was_corrected INTEGER NOT NULL DEFAULT 0,
  original_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extraction_fields_extraction ON extraction_fields(extraction_id);
CREATE INDEX IF NOT EXISTS idx_extraction_fields_confidence ON extraction_fields(extraction_id, confidence);

-- ============================================================
-- ACTION ITEMS & REMINDERS
-- ============================================================

CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL, -- ISO date
  type TEXT NOT NULL CHECK (type IN ('date','notice_deadline','recurring')),
  priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low','med','high','critical')),
  assigned_to_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','completed','missed','archived')),
  recurrence_rule TEXT, -- RRULE string for recurring obligations
  source_field TEXT, -- which extraction field generated this
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_items_due ON action_items(due_date, status);
CREATE INDEX IF NOT EXISTS idx_action_items_document ON action_items(document_id);
CREATE INDEX IF NOT EXISTS idx_action_items_assigned ON action_items(assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_action_items_type ON action_items(type, status);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('T-180','T-90','T-60','T-30','T-7','T-0','escalation')),
  sent_at TEXT,
  recipients_json TEXT NOT NULL DEFAULT '[]',
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at TEXT,
  snoozed_until TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','acknowledged','snoozed','completed','escalated','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(scheduled_for, sent_at);
CREATE INDEX IF NOT EXISTS idx_reminders_action_item ON reminders(action_item_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_reminders_escalation ON reminders(acknowledged_at, escalation_level, sent_at);

CREATE TABLE IF NOT EXISTS acknowledgments (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  user_email TEXT, -- in case ack via email link without login
  action TEXT NOT NULL CHECK (action IN ('ack','snooze','complete')),
  snooze_days INTEGER,
  note TEXT,
  ip_address TEXT,
  user_agent TEXT,
  acted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acks_reminder ON acknowledgments(reminder_id);

-- ============================================================
-- AUDIT, EMAIL, SEARCH
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  user_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log(occurred_at);

CREATE TABLE IF NOT EXISTS emails_outbound (
  id TEXT PRIMARY KEY,
  to_addresses_json TEXT NOT NULL,
  cc_addresses_json TEXT,
  subject TEXT NOT NULL,
  template TEXT,
  body_html TEXT,
  body_text TEXT,
  related_document_id TEXT REFERENCES documents(id),
  related_reminder_id TEXT REFERENCES reminders(id),
  sent_at TEXT,
  resend_id TEXT,
  opens_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','bounced')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_status ON emails_outbound(status, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_reminder ON emails_outbound(related_reminder_id);

CREATE TABLE IF NOT EXISTS emails_inbound (
  id TEXT PRIMARY KEY,
  from_address TEXT NOT NULL,
  to_address TEXT,
  subject TEXT,
  raw_email_r2_key TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_id TEXT REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed'))
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_costs_daily (
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  total_usd REAL NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, model)
);

-- ============================================================
-- SESSIONS (for SSO + fallback auth)
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- FULL-TEXT SEARCH (D1 FTS5)
-- ============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  ocr_text,
  counterparty_name,
  document_type,
  extracted_json,
  tokenize = 'porter unicode61'
);
