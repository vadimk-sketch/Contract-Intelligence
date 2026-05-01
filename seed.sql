-- Smartland Contract Intelligence — seed data
-- Loads departments, users, entities, properties, sample counterparties

-- Departments
INSERT OR IGNORE INTO departments (id, name, default_recipient_email, color_hex) VALUES
  ('dept_legal',  'Legal',                'legal@smartland.com',  '#1F4E79'),
  ('dept_pm',     'Property Management',  'pm@smartland.com',     '#2E7D32'),
  ('dept_energy', 'Energy',               'energy@smartland.com', '#E65100');

-- Users (Admins + Department Leads + Members)
INSERT OR IGNORE INTO users (id, email, name, role, department_id, status) VALUES
  ('usr_vadim',    'vadim@smartland.com',    'Vadim Kleyner',  'admin',  NULL,           'active'),
  ('usr_steven',   'steven@smartland.com',   'Steven Gesis',   'admin',  NULL,           'active'),
  ('usr_legal',    'legal.lead@smartland.com',  'Legal Lead',  'lead',   'dept_legal',   'active'),
  ('usr_pm_lead',  'pm.lead@smartland.com',     'PM Lead',     'lead',   'dept_pm',      'active'),
  ('usr_energy',   'energy.lead@smartland.com', 'Energy Lead', 'lead',   'dept_energy',  'active'),
  ('usr_rich',     'rich@smartland.com',     'Rich Hubbard',   'member', 'dept_energy',  'active'),
  ('usr_irina',    'irina@smartland.com',    'Irina Kleyner',  'member', 'dept_legal',   'active'),
  ('usr_system',   'system@smartland.com',   'System',         'system', NULL,           'active');

-- Entities
INSERT OR IGNORE INTO entities (id, legal_name, type) VALUES
  ('ent_realty',   'Smartland Realty LLC',     'realty'),
  ('ent_energy',   'Smartland Energy LLC',     'energy'),
  ('ent_trust',    'Kleyner Family Trust',     'trust'),
  ('ent_holding',  'Smartland Holdings LLC',   'holding');

-- Properties — multifamily realty
INSERT OR IGNORE INTO properties (id, name, address, entity_id, market, property_type, unit_count) VALUES
  ('prop_pinegrove',   'Pine Grove',           'Cleveland, OH',  'ent_realty', 'Cleveland', 'multifamily', 120),
  ('prop_halloffame',  'Hall of Fame',         'Canton, OH',     'ent_realty', 'Canton',    'multifamily', 96),
  ('prop_columbusA',   'Columbus Property A',  'Columbus, OH',   'ent_realty', 'Columbus',  'multifamily', 80);

-- Properties — energy sites
INSERT OR IGNORE INTO properties (id, name, address, entity_id, market, property_type) VALUES
  ('prop_vanwert',         'Van Wert Site',         'Van Wert, OH',         'ent_energy', 'Van Wert',         'energy_site'),
  ('prop_uppersandusky',   'Upper Sandusky Site',   'Upper Sandusky, OH',   'ent_energy', 'Upper Sandusky',   'energy_site');

-- Sample counterparties
INSERT OR IGNORE INTO counterparties (id, name, type, primary_contact_email) VALUES
  ('cp_wartsila',     'Wartsila North America',         'vendor',     'sales@wartsila.com'),
  ('cp_innio',        'INNIO Jenbacher',                'vendor',     'info@innio.com'),
  ('cp_commonwealth', 'Commonwealth Associates',        'contractor', 'contact@cwlth.com'),
  ('cp_hadron',       'Hadron Energy',                  'partner',    'partners@hadronenergy.com'),
  ('cp_clevwater',    'Cleveland Water Department',     'utility',    'service@clevelandwater.com'),
  ('cp_dominion',     'Dominion Energy Ohio',           'utility',    'service@dominionenergy.com'),
  ('cp_chubb',        'Chubb Insurance',                'insurer',    'claims@chubb.com');

-- Department escalation chains: each chain is ordered list of user_ids; final fallback is admin (Vadim)
UPDATE departments SET escalation_chain_json = '["usr_legal","usr_vadim"]'   WHERE id = 'dept_legal';
UPDATE departments SET escalation_chain_json = '["usr_pm_lead","usr_vadim"]' WHERE id = 'dept_pm';
UPDATE departments SET escalation_chain_json = '["usr_energy","usr_vadim"]'  WHERE id = 'dept_energy';
