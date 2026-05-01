// Smartland Contract Intelligence — frontend SPA logic
// Vanilla JS, hash-based router, talks to /api/* endpoints.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STAGES_ORDER = ['T-180', 'T-90', 'T-60', 'T-30', 'T-7', 'T-0'];

const state = {
  user: null,
  view: 'home',
  flash: null
};

// ----- API helpers -----
async function api(path, opts = {}) {
  const resp = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

async function uploadFile(file, departmentId, propertyId) {
  const fd = new FormData();
  fd.append('file', file);
  if (departmentId) fd.append('department_id', departmentId);
  if (propertyId) fd.append('property_id', propertyId);
  const resp = await fetch('/api/documents', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await resp.json();
  if (resp.status === 409 && data.duplicate) {
    if (confirm(`A document with the same content already exists ("${data.existing_title}"). Upload anyway?`)) {
      const resp2 = await fetch('/api/documents?confirm_duplicate=yes', { method: 'POST', body: fd, credentials: 'same-origin' });
      return resp2.json();
    }
    return null;
  }
  if (!resp.ok) throw new Error(data.error || 'upload failed');
  return data;
}

// ----- Boot -----
async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.sso_enabled = !!me.sso_enabled;
    state.dev_login_enabled = !!me.dev_login_enabled;
  } catch (e) {
    state.user = null;
  }
  if (!state.user) {
    renderLogin();
  } else {
    renderShell();
    window.addEventListener('hashchange', route);
    route();
  }
}

// ----- Login screen -----
function renderLogin() {
  const ssoBlock = state.sso_enabled
    ? `<a class="btn" href="/api/auth/google/start" style="display:block;text-align:center;margin-bottom:16px;">
         Sign in with Google
       </a>`
    : `<div class="flash" style="margin-bottom:16px;font-size:12px;background:#FEF3C7;color:#92400E;padding:10px;border-radius:6px;">
         Google SSO is not yet configured. Ask an admin to set <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>.
       </div>`;

  const devBlock = state.dev_login_enabled
    ? `<div style="text-align:center;color:#94a3b8;margin:14px 0;font-size:11px;">— OR (development) —</div>
       <form id="dev-login">
         <div class="form-row">
           <label>Sign in as</label>
           <select id="dev-email">
             <option value="vadim@smartland.com">Vadim Kleyner (Admin)</option>
             <option value="steven@smartland.com">Steven Gesis (Admin)</option>
             <option value="legal.lead@smartland.com">Legal Lead</option>
             <option value="pm.lead@smartland.com">PM Lead</option>
             <option value="energy.lead@smartland.com">Energy Lead</option>
             <option value="rich@smartland.com">Rich Hubbard (Energy member)</option>
             <option value="irina@smartland.com">Irina Kleyner (Legal member)</option>
           </select>
         </div>
         <button class="btn" type="submit" style="width:100%;">Continue</button>
       </form>`
    : '';

  document.body.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Smartland Contracts</h1>
        <div class="subtitle">Contract Intelligence &amp; Renewal Manager</div>
        ${ssoBlock}
        ${devBlock}
        <div id="login-error" class="flash error" style="display:none;margin-top:14px;"></div>
      </div>
    </div>
  `;
  const devForm = document.querySelector('#dev-login');
  if (devForm) {
    devForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/dev-login', {
          method: 'POST',
          body: JSON.stringify({ email: $('#dev-email').value })
        });
        location.reload();
      } catch (err) {
        const el = $('#login-error');
        el.textContent = err.message;
        el.style.display = 'block';
      }
    });
  }
}

// ----- App shell -----
function renderShell() {
  const u = state.user;
  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          SMARTLAND
          <small>Contract Intelligence</small>
        </div>
        <nav>
          <a href="#/dashboard" data-view="dashboard">Dashboard</a>
          <a href="#/documents" data-view="documents">Documents</a>
          <a href="#/upload" data-view="upload">Upload</a>
          <a href="#/search" data-view="search">Search</a>
          ${u.role === 'admin' || u.role === 'lead' ? '<a href="#/audit" data-view="audit">Audit</a>' : ''}
        </nav>
        <div class="user-info">
          ${escapeHtml(u.name)}
          <span class="role-badge">${u.role}</span>
          <a href="#" id="logout-link" style="color:#fff;margin-left:14px;opacity:0.85;font-size:12px;">Sign out</a>
        </div>
      </header>
      <main class="main" id="main"></main>
    </div>
  `;
  $('#logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });
}

// ----- Router -----
function route() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\//, '').split('/');
  const view = parts[0] || 'dashboard';

  // mark active nav
  $$('.topbar nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));

  const main = $('#main');
  if (state.flash) {
    const f = state.flash; state.flash = null;
    main.innerHTML = `<div class="flash ${f.type}">${escapeHtml(f.msg)}</div>`;
  } else {
    main.innerHTML = '';
  }

  if (view === 'dashboard') return renderDashboard(parts[1]);
  if (view === 'documents') return renderDocumentList();
  if (view === 'document') return renderDocumentDetail(parts[1]);
  if (view === 'upload') return renderUpload();
  if (view === 'search') return renderSearch();
  if (view === 'audit') return renderAudit();
  main.insertAdjacentHTML('beforeend', `<div class="card">Unknown view.</div>`);
}

// ----- Dashboards -----
async function renderDashboard(which) {
  const u = state.user;
  const main = $('#main');
  const tabs = [{ id: 'personal', label: 'My Work' }];
  if (u.department_id || u.role === 'admin') tabs.push({ id: 'department', label: 'Department' });
  if (u.role === 'admin') tabs.push({ id: 'executive', label: 'Executive' });

  const active = which || 'personal';
  main.insertAdjacentHTML('beforeend', `
    <div class="card-header" style="margin-bottom:14px;">
      <h2 style="margin:0;color:var(--brand);">Dashboard</h2>
      <div>
        ${tabs.map(t => `<a class="btn ${t.id === active ? '' : 'btn-ghost'} btn-sm" href="#/dashboard/${t.id}" style="margin-left:8px;">${t.label}</a>`).join('')}
      </div>
    </div>
    <div id="dash-body"></div>
  `);

  if (active === 'personal') renderPersonalDash();
  else if (active === 'department') renderDepartmentDash(u.department_id || '');
  else renderExecDash();
}

async function renderPersonalDash() {
  const body = $('#dash-body');
  body.innerHTML = '<div class="card">Loading <span class="spinner"></span></div>';
  try {
    const data = await api('/api/dashboards/personal');

    const totalOpen = data.open_reminders.length;
    const dueIn30 = data.due_in_30.length;
    const recent = data.recent_uploads.length;
    const critical = data.open_reminders.filter(r => r.type === 'notice_deadline' || r.priority === 'critical').length;

    body.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:18px;">
        <div class="kpi ${critical > 0 ? 'danger' : ''}"><div class="label">Critical reminders</div><div class="value">${critical}</div><div class="delta">Notice deadlines &amp; auto-renewals</div></div>
        <div class="kpi"><div class="label">Open reminders</div><div class="value">${totalOpen}</div></div>
        <div class="kpi ${dueIn30 > 0 ? 'warn' : ''}"><div class="label">Due in 30 days</div><div class="value">${dueIn30}</div></div>
        <div class="kpi"><div class="label">My recent uploads</div><div class="value">${recent}</div></div>
      </div>
      <div class="card">
        <h3>My open reminders</h3>
        ${remindersTable(data.open_reminders)}
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3>Action items due in next 30 days</h3>
          ${actionItemsTable(data.due_in_30)}
        </div>
        <div class="card">
          <h3>My recent uploads</h3>
          ${documentsTable(data.recent_uploads, false)}
        </div>
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
  }
}

async function renderDepartmentDash(deptId) {
  const body = $('#dash-body');
  if (!deptId) { body.innerHTML = '<div class="card">No department assigned.</div>'; return; }
  body.innerHTML = '<div class="card">Loading <span class="spinner"></span></div>';
  try {
    const data = await api(`/api/dashboards/department/${deptId}`);
    const unack = data.reminders.filter(r => !r.acknowledged_at).length;
    const expSoon = data.expiring_180.length;
    const review = data.awaiting_approval.length;
    const valFmt = data.total_contract_value_usd
      ? '$' + Math.round(data.total_contract_value_usd).toLocaleString()
      : '—';

    body.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:18px;">
        <div class="kpi ${unack > 0 ? 'danger' : ''}"><div class="label">Unacknowledged</div><div class="value">${unack}</div></div>
        <div class="kpi ${review > 0 ? 'warn' : ''}"><div class="label">Awaiting approval</div><div class="value">${review}</div></div>
        <div class="kpi"><div class="label">Expiring in 180 days</div><div class="value">${expSoon}</div></div>
        <div class="kpi"><div class="label">Total contract value</div><div class="value" style="font-size:22px;">${valFmt}</div></div>
      </div>
      <div class="card">
        <h3>AI extractions awaiting your review</h3>
        ${data.awaiting_approval.length === 0 ? '<p class="muted">All caught up.</p>' :
          `<table class="data"><thead><tr><th>Document</th><th>Type</th><th>Confidence</th><th>Summary</th><th></th></tr></thead><tbody>
          ${data.awaiting_approval.map(d => `
            <tr>
              <td><a href="#/document/${d.id}">${escapeHtml(d.title)}</a></td>
              <td><span class="badge badge-blue">${escapeHtml(d.document_type || 'unclassified')}</span></td>
              <td>${confidenceBadge(d.confidence_overall)}</td>
              <td class="muted">${escapeHtml((d.summary || '').slice(0, 120))}${(d.summary || '').length > 120 ? '…' : ''}</td>
              <td><a class="btn btn-sm" href="#/document/${d.id}">Review</a></td>
            </tr>
          `).join('')}
          </tbody></table>`}
      </div>
      <div class="card">
        <h3>Reminders</h3>
        ${remindersTable(data.reminders)}
      </div>
      <div class="card">
        <h3>Action items in next 180 days</h3>
        ${actionItemsTable(data.expiring_180)}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
  }
}

async function renderExecDash() {
  const body = $('#dash-body');
  body.innerHTML = '<div class="card">Loading <span class="spinner"></span></div>';
  try {
    const data = await api('/api/dashboards/executive');
    const totalUnack = data.by_department.reduce((s, d) => s + (d.unack_count || 0), 0);
    const autoPct = data.auto_renewal && data.auto_renewal.total
      ? Math.round((data.auto_renewal.with_auto / data.auto_renewal.total) * 100) : 0;
    const spendPct = data.ai_budget_usd > 0
      ? Math.round((data.ai_spend_mtd_usd / data.ai_budget_usd) * 100) : 0;

    body.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:18px;">
        <div class="kpi ${data.at_risk_90 > 0 ? 'danger' : 'good'}">
          <div class="label">Contracts at risk in 90 days</div>
          <div class="value">${data.at_risk_90}</div>
          <div class="delta">The single CEO number</div>
        </div>
        <div class="kpi ${totalUnack > 0 ? 'warn' : 'good'}">
          <div class="label">Unacknowledged reminders</div>
          <div class="value">${totalUnack}</div>
        </div>
        <div class="kpi ${data.missed_90_count > 0 ? 'danger' : 'good'}">
          <div class="label">Missed deadlines (90d)</div>
          <div class="value">${data.missed_90_count}</div>
        </div>
        <div class="kpi"><div class="label">Auto-renewal contracts</div><div class="value">${autoPct}%</div><div class="delta">flagged across portfolio</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>By department</h3>
          <table class="data"><thead><tr><th>Dept</th><th>Approved</th><th>Awaiting review</th><th>Unack</th></tr></thead><tbody>
            ${data.by_department.map(d => `
              <tr>
                <td><strong>${escapeHtml(d.name)}</strong></td>
                <td>${d.approved_count}</td>
                <td>${d.awaiting_review > 0 ? '<span class="badge badge-yellow">' + d.awaiting_review + '</span>' : d.awaiting_review}</td>
                <td>${d.unack_count > 0 ? '<span class="badge badge-red">' + d.unack_count + '</span>' : d.unack_count}</td>
              </tr>`).join('')}
          </tbody></table>
        </div>
        <div class="card">
          <h3>AI spend (month-to-date)</h3>
          <div style="font-size:32px;font-weight:bold;color:var(--brand);">$${data.ai_spend_mtd_usd.toFixed(2)}</div>
          <div class="muted">of $${data.ai_budget_usd.toFixed(0)} monthly budget (${spendPct}%)</div>
          <div style="background:var(--gray-200);border-radius:4px;height:8px;margin-top:12px;overflow:hidden;">
            <div style="background:${spendPct > 80 ? 'var(--red)' : 'var(--brand)'};height:100%;width:${Math.min(spendPct,100)}%;"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Top contract value at risk (next 180 days)</h3>
        ${data.top_value_at_risk.length === 0 ? '<p class="muted">No high-value items currently at risk.</p>' :
          `<table class="data"><thead><tr><th>Document</th><th>Type</th><th>Action</th><th>Due</th><th>Value</th></tr></thead><tbody>
          ${data.top_value_at_risk.map(d => `
            <tr>
              <td><a href="#/document/${d.id}">${escapeHtml(d.title)}</a></td>
              <td><span class="badge badge-blue">${escapeHtml(d.document_type || '')}</span></td>
              <td>${escapeHtml(d.ai_title || '')}</td>
              <td>${escapeHtml(String(d.due_date || '').slice(0,10))}</td>
              <td>${d.total_value ? '$' + Math.round(d.total_value).toLocaleString() : '—'}</td>
            </tr>`).join('')}
          </tbody></table>`}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
  }
}

// ----- Document list -----
async function renderDocumentList() {
  const main = $('#main');
  main.insertAdjacentHTML('beforeend', `
    <div class="card-header"><h2 style="margin:0;color:var(--brand);">Documents</h2>
      <a class="btn" href="#/upload">+ Upload</a>
    </div>
    <div class="card">
      <div class="grid grid-4" style="margin-bottom:14px;">
        <div><label>Status</label><select id="f-status"><option value="">All</option><option value="pending">Pending</option><option value="extracting">Extracting</option><option value="review">Awaiting Review</option><option value="approved">Approved</option><option value="archived">Archived</option><option value="failed">Failed</option></select></div>
        <div><label>Type</label><select id="f-type"><option value="">All</option>
          <option>utility</option><option>insurance</option><option>lease</option><option>vendor_msa</option><option>equipment</option><option>loan</option><option>partnership</option><option>securities</option><option>permit</option><option>corporate</option><option>other</option>
        </select></div>
        <div><label>Expiring within</label><select id="f-exp"><option value="">Any</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select></div>
        <div style="display:flex;align-items:flex-end;"><button id="f-apply" class="btn">Apply</button></div>
      </div>
      <div id="docs-table">Loading <span class="spinner"></span></div>
    </div>
  `);
  const load = async () => {
    const status = $('#f-status').value;
    const type = $('#f-type').value;
    const exp = $('#f-exp').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (exp) params.set('expiring_within', exp);
    try {
      const data = await api('/api/documents?' + params.toString());
      $('#docs-table').innerHTML = documentsTable(data.documents, true);
    } catch (e) {
      $('#docs-table').innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
    }
  };
  $('#f-apply').addEventListener('click', load);
  load();
}

function documentsTable(rows, withDept) {
  if (!rows || rows.length === 0) return '<p class="muted">No documents.</p>';
  return `<table class="data"><thead><tr>
    <th>Title</th><th>Type</th>${withDept ? '<th>Dept</th>' : ''}<th>Counterparty</th><th>Status</th><th>Created</th>
  </tr></thead><tbody>
    ${rows.map(d => `<tr>
      <td><a href="#/document/${d.id}"><strong>${escapeHtml(d.title)}</strong></a></td>
      <td><span class="badge badge-blue">${escapeHtml(d.document_type || '—')}</span></td>
      ${withDept ? `<td>${escapeHtml(d.department_name || '')}</td>` : ''}
      <td>${escapeHtml(d.counterparty_name || '—')}</td>
      <td>${statusBadge(d.status)}</td>
      <td class="muted">${escapeHtml(String(d.created_at || '').slice(0,16))}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function statusBadge(s) {
  const map = {
    pending: 'badge-gray', extracting: 'badge-yellow', review: 'badge-orange',
    approved: 'badge-green', archived: 'badge-gray', failed: 'badge-red'
  };
  return `<span class="badge ${map[s] || 'badge-gray'}">${escapeHtml(s || '')}</span>`;
}

function actionItemsTable(items) {
  if (!items || items.length === 0) return '<p class="muted">No items.</p>';
  return `<table class="data"><thead><tr><th>Due</th><th>Title</th><th>Type</th><th>Priority</th></tr></thead><tbody>
    ${items.map(i => `<tr>
      <td><strong>${escapeHtml(String(i.due_date).slice(0,10))}</strong></td>
      <td>${i.doc_id ? `<a href="#/document/${i.doc_id}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}</td>
      <td><span class="badge ${i.type === 'notice_deadline' ? 'badge-red' : 'badge-gray'}">${escapeHtml(i.type)}</span></td>
      <td class="priority-${i.priority}">${escapeHtml(i.priority)}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function remindersTable(rows) {
  if (!rows || rows.length === 0) return '<p class="muted">No reminders.</p>';
  return `<table class="data"><thead><tr><th>Stage</th><th>Document</th><th>Action</th><th>Due</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td><span class="badge stage-${r.stage}">${escapeHtml(r.stage)}</span></td>
      <td><a href="#/document/${r.doc_id}">${escapeHtml(r.doc_title)}</a></td>
      <td>${escapeHtml(r.title)} ${r.type === 'notice_deadline' ? '<span class="badge badge-red" style="margin-left:6px;">NOTICE</span>' : ''}</td>
      <td><strong>${escapeHtml(String(r.due_date).slice(0,10))}</strong></td>
      <td>${r.acknowledged_at ? '<span class="badge badge-green">acked</span>' : `<span class="badge badge-${statusColor(r.status)}">${escapeHtml(r.status || 'pending')}</span>`}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function statusColor(s) {
  if (s === 'sent' || s === 'pending') return 'yellow';
  if (s === 'escalated') return 'red';
  if (s === 'acknowledged' || s === 'completed') return 'green';
  if (s === 'snoozed') return 'blue';
  return 'gray';
}

function confidenceBadge(c) {
  if (c == null) return '<span class="badge badge-gray">—</span>';
  const pct = Math.round(c * 100);
  const cls = c >= 0.85 ? 'high' : c >= 0.6 ? 'med' : 'low';
  return `<span class="field-confidence ${cls}">${pct}%</span>`;
}

// ----- Document detail -----
async function renderDocumentDetail(id) {
  const main = $('#main');
  main.insertAdjacentHTML('beforeend', `<div id="doc-body"><div class="card">Loading <span class="spinner"></span></div></div>`);
  await loadAndRenderDocument(id);
}

async function loadAndRenderDocument(id) {
  try {
    const d = await api(`/api/documents/${id}`);
    const doc = d.document;
    const e = d.extraction;
    const fields = d.fields || [];
    const items = d.action_items || [];

    const isReview = doc.status === 'review';
    const canApprove = (state.user.role === 'admin' || state.user.role === 'lead') && isReview;
    const isExtracting = doc.status === 'pending' || doc.status === 'extracting';

    const noticeBanner = (e?.extracted_json?.base?.auto_renewal?.value)
      ? `<div class="notice-deadline-banner">
          <strong>AUTO-RENEWAL DETECTED.</strong>
          This contract auto-renews unless written notice is delivered by
          <strong>${escapeHtml(e.extracted_json.base.notice_deadline?.value || 'the notice deadline')}</strong>.
          ${e.extracted_json.base.notice_period_days?.value ? `Notice period: ${e.extracted_json.base.notice_period_days.value} days.` : ''}
        </div>` : '';

    $('#doc-body').innerHTML = `
      <div class="card-header">
        <div>
          <h2 style="margin:0;color:var(--brand);">${escapeHtml(doc.title)}</h2>
          <div class="muted" style="font-size:12px;margin-top:4px;">
            ${statusBadge(doc.status)}
            <span class="badge badge-blue" style="margin-left:6px;">${escapeHtml(doc.document_type || 'unclassified')}</span>
            <span style="margin-left:10px;">${escapeHtml(doc.department_name || '')}</span>
            ${doc.counterparty_name ? `<span style="margin-left:10px;">· ${escapeHtml(doc.counterparty_name)}</span>` : ''}
            ${doc.uploader_name ? `<span style="margin-left:10px;">· uploaded by ${escapeHtml(doc.uploader_name)}</span>` : ''}
          </div>
        </div>
        <div>
          <a class="btn btn-ghost btn-sm" href="/api/documents/${doc.id}/file" target="_blank">View File</a>
          ${canApprove ? `<button id="approve-btn" class="btn btn-success btn-sm" style="margin-left:8px;">Approve &amp; Activate Reminders</button>` : ''}
          ${(state.user.role === 'admin' || state.user.role === 'lead') ? `<button id="reprocess-btn" class="btn btn-ghost btn-sm" style="margin-left:8px;">Re-extract</button>` : ''}
        </div>
      </div>

      ${noticeBanner}

      ${isExtracting ? `<div class="card"><div style="text-align:center;padding:20px;"><span class="spinner"></span> Extraction in progress. This page will refresh in 15 seconds.</div></div>` : ''}

      ${e ? `
        <div class="card">
          <h3>AI Summary</h3>
          <p style="font-size:14px;line-height:1.6;">${escapeHtml(e.summary || '(no summary)')}</p>
          <div class="muted" style="font-size:12px;margin-top:8px;">
            Avg confidence: <strong>${Math.round((e.confidence_overall || 0) * 100)}%</strong>
            · Model: ${escapeHtml(e.model_used || '')}
            · Cost: $${(e.cost_usd || 0).toFixed(4)}
            · Extracted: ${escapeHtml(String(e.extracted_at || '').slice(0,16))}
            ${e.approved_at ? `· <span class="badge badge-green">Approved ${escapeHtml(String(e.approved_at).slice(0,10))}</span>` : '<span class="badge badge-orange">Awaiting approval</span>'}
          </div>
        </div>

        <div class="card">
          <h3>Extracted Fields ${fields.filter(f => f.confidence < 0.85).length > 0 ? `<span class="badge badge-yellow" style="margin-left:8px;">${fields.filter(f => f.confidence < 0.85).length} need review</span>` : ''}</h3>
          <div>
            <div class="field-row" style="background:var(--gray-50);font-weight:bold;">
              <div>Field</div><div>Value</div><div>Confidence</div><div></div>
            </div>
            ${fields.map(f => `
              <div class="field-row" data-field-id="${f.id}">
                <div class="field-name">${escapeHtml(f.field_name)} ${f.was_corrected ? '<span class="badge badge-blue" style="font-size:9px;">edited</span>' : ''}</div>
                <div class="field-value">${escapeHtml(f.field_value || '—')}</div>
                <div>${confidenceBadge(f.confidence)}</div>
                <div class="field-action">${(state.user.role === 'admin' || state.user.role === 'lead') ? `<button class="btn btn-ghost edit-field-btn">Edit</button>` : ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : (isExtracting ? '' : '<div class="card"><p class="muted">No extraction available yet.</p></div>')}

      <div class="card">
        <h3>Action Items (${items.length})</h3>
        ${items.length === 0 ? '<p class="muted">No action items.</p>' :
          `<table class="data"><thead><tr><th>Due</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th></tr></thead><tbody>
          ${items.map(i => `<tr>
            <td><strong>${escapeHtml(String(i.due_date).slice(0,10))}</strong></td>
            <td>${escapeHtml(i.title)}<br><span class="muted" style="font-size:12px;">${escapeHtml(i.description || '')}</span></td>
            <td><span class="badge ${i.type === 'notice_deadline' ? 'badge-red' : 'badge-gray'}">${escapeHtml(i.type)}</span></td>
            <td class="priority-${i.priority}">${escapeHtml(i.priority)}</td>
            <td>${escapeHtml(i.status)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        ${doc.status === 'review' ? '<p class="muted" style="margin-top:10px;font-size:12px;">Reminders activate when this extraction is approved.</p>' : ''}
      </div>
    `;

    if (canApprove) {
      $('#approve-btn').addEventListener('click', async () => {
        if (!confirm('Approve extraction and activate reminders for all action items?')) return;
        try {
          await api(`/api/documents/${doc.id}/approve`, { method: 'POST' });
          state.flash = { type: 'success', msg: 'Extraction approved. Reminders are now active.' };
          loadAndRenderDocument(doc.id);
        } catch (err) { alert('Approve failed: ' + err.message); }
      });
    }
    const reproBtn = $('#reprocess-btn');
    if (reproBtn) reproBtn.addEventListener('click', async () => {
      if (!confirm('Re-run AI extraction on this document?')) return;
      try {
        await api(`/api/documents/${doc.id}/reprocess`, { method: 'POST' });
        state.flash = { type: 'success', msg: 'Re-extraction started. Refresh in a minute.' };
        loadAndRenderDocument(doc.id);
      } catch (err) { alert('Reprocess failed: ' + err.message); }
    });

    $$('.edit-field-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.field-row');
        const fieldId = row.dataset.fieldId;
        const cur = row.querySelector('.field-value').textContent.trim();
        const next = prompt('New value:', cur === '—' ? '' : cur);
        if (next == null) return;
        try {
          await api(`/api/documents/${doc.id}/fields/${fieldId}`, { method: 'PATCH', body: JSON.stringify({ value: next }) });
          loadAndRenderDocument(doc.id);
        } catch (err) { alert('Save failed: ' + err.message); }
      });
    });

    if (isExtracting) {
      setTimeout(() => loadAndRenderDocument(doc.id), 15000);
    }
  } catch (e) {
    $('#doc-body').innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
  }
}

// ----- Upload -----
async function renderUpload() {
  const main = $('#main');
  let depts = [];
  let props = [];
  try {
    const [d, p] = await Promise.all([api('/api/ref/departments'), api('/api/ref/properties')]);
    depts = d.departments; props = p.properties;
  } catch {}
  const u = state.user;
  main.insertAdjacentHTML('beforeend', `
    <h2 style="color:var(--brand);">Upload Documents</h2>
    <div class="card">
      <div class="grid grid-2">
        <div class="form-row">
          <label>Department</label>
          <select id="up-dept">
            ${depts.map(d => `<option value="${d.id}" ${u.department_id === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Property / Site (optional)</label>
          <select id="up-prop">
            <option value="">— None —</option>
            ${props.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.market || '')})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="dropzone" id="dropzone">
        <div class="dropzone-icon">⬆</div>
        <div><strong>Drag &amp; drop files here</strong> or click to browse</div>
        <div class="muted" style="margin-top:6px;font-size:12px;">PDF, DOCX, JPG, PNG, TIFF, EML · 50MB max per file</div>
        <input type="file" id="file-input" multiple accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.tiff,.tif,.eml" style="display:none;">
      </div>
      <div id="upload-list" style="margin-top:18px;"></div>
    </div>
  `);
  const dz = $('#dropzone');
  const fi = $('#file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  fi.addEventListener('change', () => handleFiles(fi.files));
}

async function handleFiles(files) {
  const list = $('#upload-list');
  const dept = $('#up-dept').value;
  const prop = $('#up-prop').value;
  for (const f of files) {
    const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    list.insertAdjacentHTML('beforeend', `
      <div id="${id}" style="padding:10px 12px;background:#fff;border:1px solid var(--gray-200);border-radius:4px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div><strong>${escapeHtml(f.name)}</strong> <span class="muted" style="font-size:12px;">${(f.size/1024).toFixed(1)} KB</span></div>
        <div id="${id}-status"><span class="spinner"></span> uploading…</div>
      </div>
    `);
    try {
      const data = await uploadFile(f, dept, prop);
      if (data && data.ok) {
        $(`#${id}-status`).innerHTML = `<span class="badge badge-green">Queued for extraction</span> <a href="#/document/${data.id}" style="margin-left:8px;">View →</a>`;
      } else if (data === null) {
        $(`#${id}-status`).innerHTML = `<span class="badge badge-gray">Skipped (duplicate)</span>`;
      } else {
        $(`#${id}-status`).innerHTML = `<span class="badge badge-red">Failed</span>`;
      }
    } catch (err) {
      $(`#${id}-status`).innerHTML = `<span class="badge badge-red">${escapeHtml(err.message)}</span>`;
    }
  }
}

// ----- Search -----
async function renderSearch() {
  const main = $('#main');
  let depts = [];
  try { depts = (await api('/api/ref/departments')).departments; } catch {}
  main.insertAdjacentHTML('beforeend', `
    <h2 style="color:var(--brand);">Search</h2>
    <div class="card">
      <div class="grid grid-4" style="margin-bottom:14px;">
        <div style="grid-column: span 2;"><label>Search query</label><input type="search" id="q" placeholder="e.g. water Pine Grove, insurance, Wartsila..." autofocus></div>
        <div><label>Type</label><select id="s-type"><option value="">Any</option>
          <option>utility</option><option>insurance</option><option>lease</option><option>vendor_msa</option><option>equipment</option><option>loan</option><option>partnership</option><option>permit</option><option>corporate</option><option>other</option>
        </select></div>
        ${state.user.role === 'admin' ? `<div><label>Department</label><select id="s-dept"><option value="">Any</option>${depts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select></div>` : '<div></div>'}
      </div>
      <button class="btn" id="s-go">Search</button>
      <div id="s-results" style="margin-top:18px;"></div>
    </div>
  `);
  const run = async () => {
    const q = $('#q').value.trim();
    const t = $('#s-type').value;
    const d = $('#s-dept') ? $('#s-dept').value : '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (t) params.set('type', t);
    if (d) params.set('department', d);
    $('#s-results').innerHTML = '<span class="spinner"></span> searching...';
    const t0 = performance.now();
    try {
      const data = await api('/api/search?' + params.toString());
      const ms = Math.round(performance.now() - t0);
      $('#s-results').innerHTML = `<div class="muted" style="margin-bottom:10px;font-size:12px;">${data.count} result${data.count === 1 ? '' : 's'} in ${ms}ms</div>` + documentsTable(data.results, true);
    } catch (e) {
      $('#s-results').innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
    }
  };
  $('#s-go').addEventListener('click', run);
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

// ----- Audit log -----
async function renderAudit() {
  const main = $('#main');
  main.insertAdjacentHTML('beforeend', `
    <div class="card-header"><h2 style="margin:0;color:var(--brand);">Audit Log</h2>
      <a class="btn btn-ghost btn-sm" href="/api/audit?format=csv" target="_blank">Export CSV</a>
    </div>
    <div class="card" id="audit-body">Loading <span class="spinner"></span></div>
  `);
  try {
    const data = await api('/api/audit?limit=300');
    $('#audit-body').innerHTML = `
      <div class="muted" style="margin-bottom:10px;">Showing last ${data.count} events.</div>
      <table class="data"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Resource</th><th>IP</th></tr></thead><tbody>
        ${data.audit.map(a => `<tr>
          <td class="mono">${escapeHtml(String(a.occurred_at).slice(0,19))}</td>
          <td>${escapeHtml(a.user_email || a.user_id || '—')}</td>
          <td><span class="badge badge-blue">${escapeHtml(a.action)}</span></td>
          <td><span class="muted">${escapeHtml(a.resource_type)}</span> ${escapeHtml(a.resource_id || '')}</td>
          <td class="mono">${escapeHtml(a.ip_address || '')}</td>
        </tr>`).join('')}
      </tbody></table>
    `;
  } catch (e) {
    $('#audit-body').innerHTML = `<div class="flash error">${escapeHtml(e.message)}</div>`;
  }
}

// ----- Helpers -----
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

boot();
