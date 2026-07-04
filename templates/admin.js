function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function adminShell({ title, active = 'dashboard', breadcrumbs = [], body }) {
  const nav = [
    ['dashboard', '/admin/', 'Dashboard'],
    ['checks', '/admin/checks', 'Checks'],
    ['subjects', '/admin/subjects', 'Subjects'],
    ['colleges', '/admin/colleges', 'Colleges'],
    ['branch_profiles', '/admin/branch-profiles', 'Branch profiles'],
    ['proposals', '/admin/proposals', 'Review queue'],
    ['release_candidates', '/admin/release-candidates', 'Releases'],
    ['revisions', '/admin/revisions', 'Revisions'],
    ['sources', '/admin/sources', 'Sources'],
    ['assets', '/admin/assets', 'Assets'],
    ['parse_results', '/admin/parse-results', 'Parse results'],
    ['extraction_results', '/admin/extraction-results', 'Extractions'],
    ['diff_results', '/admin/diff-results', 'Diffs'],
    ['pipeline_runs', '/admin/pipeline-runs', 'Pipelines'],
    ['source_evidence', '/admin/source-evidence', 'Evidence'],
    ['cleanup', '/admin/cleanup', 'Cleanup'],
  ];
  if (String(process.env.ADMIN_TEST_TOOLS || '').trim().toLowerCase() === 'true') {
    nav.push(['test_tools', '/admin/test-tools', 'Test tools']);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} - JNTUStack Admin</title>
<style>
:root{--ink:#18212f;--muted:#657184;--line:#d9e1e8;--paper:#f7fafc;--panel:#fff;--accent:#007c73;--warn:#a45d00;--bad:#9b1c31;--ok:#0d7a48;}
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:var(--paper);font-size:14px;line-height:1.45}
a{color:inherit}.admin-frame{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.admin-rail{background:#0e2530;color:#e8f3f2;padding:18px 14px;position:sticky;top:0;height:100vh}
.admin-brand{font-weight:700;font-size:18px;margin-bottom:18px}.admin-source{font-size:12px;color:#9fc5c0;margin-bottom:20px}
.admin-nav{display:grid;gap:4px}.admin-nav a{display:block;text-decoration:none;padding:9px 10px;border-radius:6px;color:#d9ece9}
.admin-nav a[aria-current="page"]{background:#173946;color:#fff}.admin-nav a:hover{background:#17313c}
.admin-main{padding:22px 28px;min-width:0}.admin-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
h1{font-size:24px;margin:0}h2{font-size:17px;margin:26px 0 10px}.admin-sub{color:var(--muted);font-size:13px;margin-top:4px}.logout{font-size:13px;color:var(--muted)}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
.metric-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.metric-value{font-size:24px;font-weight:700;margin-top:4px}
.status-ok{color:var(--ok)}.status-warn{color:var(--warn)}.status-bad{color:var(--bad)}
.table-wrap{overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;min-width:760px}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:#f0f5f7}
tr:last-child td{border-bottom:0}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:12px;background:#f8fbfc}
.proposal-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:16px}.action-box{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}.action-box textarea{width:100%;min-height:74px;border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit;margin-top:8px}.action-box button{margin-top:8px;padding:8px 10px;border:0;border-radius:6px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}.action-box button.reject{background:var(--bad)}.action-box button.warn{background:var(--warn)}.danger-zone{border:2px solid var(--bad);background:#fff5f5}.danger-zone strong{color:var(--bad)}.danger-copy{border:1px solid #efb5bd;background:#fff;color:var(--bad);border-radius:6px;padding:10px;margin-top:10px;font-weight:700}.json-block{white-space:pre-wrap;overflow:auto;background:#101923;color:#d9f7ef;border-radius:8px;padding:12px;font-size:12px;line-height:1.55}.notice{border:1px solid var(--line);background:#fff;padding:12px;border-radius:8px;color:var(--muted)}.evidence-warning{border-color:#efcf8a;background:#fffaf0;color:#6d4c00}.empty-state{padding:18px;color:var(--muted)}.empty-state strong{display:block;color:var(--ink);margin-bottom:4px}.breadcrumbs{font-size:12px;color:var(--muted);margin-bottom:12px}.breadcrumbs a{color:var(--muted);text-decoration:none}.breadcrumbs a:hover{text-decoration:underline}.workflow{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.workflow a,.workflow span{border:1px solid var(--line);border-radius:999px;padding:4px 8px;text-decoration:none;background:#fff;color:var(--muted);font-size:12px}.workflow a:hover{border-color:var(--accent);color:var(--accent)}.workflow [aria-current="step"]{background:#e7f3f1;color:var(--accent);border-color:#9acdc7}
.login-page{min-height:100vh;display:grid;place-items:center;padding:20px}.login-box{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:22px}
.login-box h1{margin-bottom:4px}.login-box label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-top:14px}.login-box input{width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;margin-top:5px;font:inherit}.login-box button{width:100%;margin-top:18px;padding:10px 12px;border:0;border-radius:6px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}.error{border:1px solid #f0b8b8;color:var(--bad);background:#fff5f5;border-radius:6px;padding:9px;margin:12px 0 0}
@media(max-width:760px){.admin-frame{grid-template-columns:1fr}.admin-rail{position:static;height:auto}.admin-nav{grid-template-columns:repeat(2,1fr)}.admin-main{padding:18px 14px}.admin-top{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="admin-frame">
  <aside class="admin-rail">
    <div class="admin-brand">JNTUStack Admin</div>
    <div class="admin-source">Controlled content operations</div>
    <nav class="admin-nav" aria-label="Admin navigation">
      ${nav.map(([key, href, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
  </aside>
  <main class="admin-main">
    ${breadcrumbs.length ? `<div class="breadcrumbs">${breadcrumbs.map((crumb, index) => crumb.href ? `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>${index < breadcrumbs.length - 1 ? ' / ' : ''}` : `<span>${escapeHtml(crumb.label)}</span>`).join('')}</div>` : ''}
    ${body}
  </main>
</div>
</body>
</html>`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function emptyState(title, message, action = '') {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div>${action ? `<div style="margin-top:8px;">${action}</div>` : ''}</div>`;
}

function workflowNav(active) {
  const steps = [
    ['asset', 'Asset', '/admin/assets'],
    ['parse', 'Parse', null],
    ['extraction', 'Extraction', null],
    ['diff', 'Diff', null],
    ['proposal', 'Proposal', '/admin/proposals'],
    ['release', 'Release', '/admin/release-candidates'],
    ['export', 'Export', null],
    ['draft', 'Draft', null],
    ['revision', 'Revision', '/admin/revisions'],
  ];
  return `<div class="workflow" aria-label="Evidence workflow">${steps.map(([key, label, href]) => {
    const attrs = key === active ? ' aria-current="step"' : '';
    return href ? `<a href="${href}"${attrs}>${label}</a>` : `<span${attrs}>${label}</span>`;
  }).join('')}</div>`;
}

function diffOperation(diff = {}) {
  return diff?.operation || diff?.safety?.operation || 'unknown';
}

function diffOperationLabel(diff = {}) {
  const operation = diffOperation(diff);
  if (operation === 'add') return 'add';
  if (operation === 'merge_update') return 'merge/update';
  if (operation === 'replace') return 'replace';
  if (operation === 'no_change') return 'no change';
  return operation;
}

function diffSafetyWarnings(diff = {}) {
  const warnings = diff?.safety?.warnings;
  return Array.isArray(warnings) ? warnings : [];
}

function blockingSafetyWarnings(diff = {}) {
  return diffSafetyWarnings(diff).filter(warning => warning?.blocking);
}

function renderDiffSafetyWarnings(diff = {}) {
  const warnings = diffSafetyWarnings(diff);
  if (!warnings.length) {
    return '<div class="notice"><span class="status-ok">No destructive-change safety warnings recorded.</span></div>';
  }
  return `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Code</th><th>Path</th><th>Action</th><th>Message</th></tr></thead><tbody>
${warnings.map(warning => `<tr><td><span class="pill">${escapeHtml(warning.severity || 'warning')}</span></td><td class="mono">${escapeHtml(warning.code || '')}</td><td class="mono">${escapeHtml(warning.path || '')}</td><td>${escapeHtml(warning.action || '')}</td><td>${escapeHtml(warning.message || '')}</td></tr>`).join('')}
</tbody></table></div>`;
}

function passFail(value) {
  return value ? '<span class="status-ok">ok</span>' : '<span class="status-bad">needs attention</span>';
}

export function renderLoginPage({ error = null } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin login - JNTUStack</title>
${adminShell({ title: 'Login', body: '' }).match(/<style>[\s\S]*<\/style>/)[0]}
</head>
<body class="login-page">
  <form class="login-box" method="post" action="/admin/login">
    <h1>Admin login</h1>
    <div class="admin-sub">Private controlled operations dashboard</div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

export function renderAdminConfigError({ message }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin not configured</title></head><body><h1>Admin not configured</h1><p>${escapeHtml(message)}</p></body></html>`;
}

export function renderAdminTestToolsPage({ enabled, result = null, cleanup = null, error = null }) {
  if (!enabled) {
    return adminShell({
      title: 'Test tools',
      active: 'test_tools',
      body: `
<div class="admin-top"><div><h1>Test tools</h1><div class="admin-sub">Disabled</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">Admin test tools are disabled. Set ADMIN_TEST_TOOLS=true only for controlled dry-run testing.</div>`,
    });
  }
  return adminShell({
    title: 'Test tools',
    active: 'test_tools',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Test tools' }],
    body: `
<div class="admin-top"><div><h1>Test tools</h1><div class="admin-sub">Controlled dry-run fixtures only. Not public content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<div class="notice">These actions create and clean up records whose entity_key starts with <span class="mono">test-</span>. They do not write live data/*.json, modify dist/, publish, crawl, schedule jobs, or expose /api/ask.</div>

<section class="proposal-actions">
  <form class="action-box" method="post" action="/admin/test-tools/release-dry-run">
    <strong>Run release candidate dry run</strong>
    <div class="admin-sub">Runs proposal -> approve_for_draft -> release candidate -> export -> draft apply -> revision -> review summary -> ready_for_review.</div>
    <button type="submit">Run dry run</button>
  </form>
  <form class="action-box" method="post" action="/admin/test-tools/cleanup">
    <strong>Cleanup test fixtures</strong>
    <div class="admin-sub">Removes test proposals, release candidates, exports, draft applies, revisions, and tmp fixture folders.</div>
    <button class="reject" type="submit">Cleanup fixtures</button>
  </form>
</section>

<h2>Last dry-run result</h2>
${result ? `<pre class="json-block">${escapeHtml(JSON.stringify(result, null, 2))}</pre>` : '<div class="notice">No dry-run result in this request.</div>'}

<h2>Last cleanup result</h2>
${cleanup ? `<pre class="json-block">${escapeHtml(JSON.stringify(cleanup, null, 2))}</pre>` : '<div class="notice">No cleanup result in this request.</div>'}`,
  });
}

function cleanupRows(rows, columns) {
  if (!rows?.length) return `<tr><td colspan="${escapeHtml(columns.length)}">No matching records.</td></tr>`;
  return rows.map(row => `<tr>${columns.map(([key, label]) => {
    const value = typeof key === 'function' ? key(row) : row[key];
    return `<td${label === 'ID' ? ' class="mono"' : ''}>${escapeHtml(value ?? '')}</td>`;
  }).join('')}</tr>`).join('');
}

export function renderAdminCleanupPage({
  preview,
  result = null,
  confirmationPhrase = 'CLEAN TEST ARTIFACTS',
  error = null,
} = {}) {
  const counts = preview?.counts || {};
  const candidates = preview?.candidates || {};
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return adminShell({
    title: 'Admin cleanup',
    active: 'cleanup',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Cleanup' }],
    body: `
<div class="admin-top"><div><h1>Admin cleanup</h1><div class="admin-sub">Production safety cleanup for known test-only admin records. This never writes live data/*.json.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<div class="notice"><strong>Scope:</strong> only records matching test/pr entity keys, known PR test filenames, <span class="mono">example.edu</span> evidence, or old test actors are eligible. Public JSON content is not touched.</div>

<section class="metric-grid" style="margin-top:14px;">
  <div class="metric"><div class="metric-label">Candidate rows</div><div class="metric-value">${escapeHtml(total)}</div></div>
  <div class="metric"><div class="metric-label">Assets</div><div class="metric-value">${escapeHtml(counts.assets || 0)}</div></div>
  <div class="metric"><div class="metric-label">Proposals</div><div class="metric-value">${escapeHtml(counts.proposals || 0)}</div></div>
  <div class="metric"><div class="metric-label">Revisions</div><div class="metric-value">${escapeHtml(counts.revisions || 0)}</div></div>
</section>

<h2>Run cleanup</h2>
<form class="action-box" method="post" action="/admin/cleanup/test-artifacts">
  <strong>Clean known test artifacts</strong>
  <div class="admin-sub">Deletes matching DB records and safe matching test storage files only. It does not touch public JSON, dist, crawlers, schedulers, or releases.</div>
  <label for="cleanup_confirmation" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="cleanup_confirmation" name="confirmation_phrase" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="${escapeHtml(confirmationPhrase)}">
  <button class="reject" type="submit"${total ? '' : ' disabled'}>Clean test artifacts</button>
  <div class="notice" style="margin-top:10px;">Type <span class="mono">${escapeHtml(confirmationPhrase)}</span> exactly. Review the candidates below first.</div>
</form>

${result ? `<h2>Last cleanup result</h2><pre class="json-block">${escapeHtml(JSON.stringify(result, null, 2))}</pre>` : ''}

<h2>Candidate assets</h2>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Filename</th><th>Status</th><th>Storage path</th><th>Source URL</th></tr></thead><tbody>
${cleanupRows(candidates.assets, [['id', 'ID'], ['original_filename', 'Filename'], ['download_status', 'Status'], ['local_storage_path', 'Storage'], ['source_url', 'URL']])}
</tbody></table></div>

<h2>Candidate proposals</h2>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Entity</th><th>Key</th><th>Status</th><th>Validation</th><th>Created by</th></tr></thead><tbody>
${cleanupRows(candidates.proposals, [['id', 'ID'], [row => `${row.entity_type}`, 'Entity'], ['entity_key', 'Key'], ['status', 'Status'], ['validation_status', 'Validation'], ['created_by', 'Created']])}
</tbody></table></div>

<h2>Candidate revisions</h2>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Entity</th><th>Key</th><th>Revision</th><th>Proposal</th><th>Draft</th></tr></thead><tbody>
${cleanupRows(candidates.revisions, [['id', 'ID'], ['entity_type', 'Entity'], ['entity_key', 'Key'], ['revision_number', 'Revision'], ['proposal_id', 'Proposal'], ['draft_apply_id', 'Draft']])}
</tbody></table></div>

<h2>Other candidate metadata</h2>
<div class="table-wrap"><table><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>
${['parseResults', 'extractionResults', 'diffResults', 'pipelineRuns', 'exports', 'drafts', 'releases'].map(key => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(counts[key] || 0)}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderDashboard({ counts, contentSource }) {
  const metrics = [
    ['Content source', contentSource],
    ['Subjects total', counts.subjectsTotal],
    ['Verified subjects', counts.subjectsVerified, 'status-ok'],
    ['Needs verification', counts.subjectsNeedsVerification, 'status-warn'],
    ['Placeholder subjects', counts.subjectsPlaceholder, 'status-bad'],
    ['Colleges total', counts.collegesTotal],
    ['Branch profiles', counts.branchProfilesTotal],
  ];
  return adminShell({
    title: 'Dashboard',
    active: 'dashboard',
    body: `
<div class="admin-top"><div><h1>Dashboard</h1><div class="admin-sub">Visibility only. No edits, publishing, or automation are available here.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<section class="metric-grid">${metrics.map(([label, value, cls]) => `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${cls || ''}">${escapeHtml(value)}</div></div>`).join('')}</section>`,
  });
}

export function renderAdminChecksPage({ checks }) {
  const dbRows = [
    ['Configured', checks.db.configured ? 'yes' : 'no'],
    ['Connection', checks.db.skipped ? 'skipped' : checks.db.connected ? 'connected' : 'failed'],
    ['Migrations expected', checks.db.expectedMigrations],
    ['Migrations applied', checks.db.appliedMigrations ?? 'unknown'],
    ['Pending migrations', Array.isArray(checks.db.pendingMigrations) ? checks.db.pendingMigrations.length : 'unknown'],
    ['Message', checks.db.message || ''],
  ];
  const searchRows = [
    ['Status', checks.searchIndex.ok ? 'readable' : 'missing/error'],
    ['Total docs', checks.searchIndex.total ?? 'unknown'],
    ['Subjects', checks.searchIndex.byType?.subject ?? 'unknown'],
    ['Colleges', checks.searchIndex.byType?.college ?? 'unknown'],
    ['Branch profiles', checks.searchIndex.byType?.branch_profile ?? 'unknown'],
    ['Path', checks.searchIndex.path],
  ];
  const runtimeRows = [
    ['Generated at', checks.generatedAt],
    ['Node', checks.runtime.nodeVersion],
    ['Content source', checks.runtime.contentSource],
    ['Admin enabled', checks.runtime.adminEnabled ? 'yes' : 'no'],
    ['Admin configured', checks.runtime.adminConfigured ? 'yes' : 'no'],
    ['Ask enabled', checks.runtime.askEnabled ? 'yes' : 'no'],
  ];
  return adminShell({
    title: 'Runtime checks',
    active: 'checks',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Checks' }],
    body: `
<div class="admin-top"><div><h1>Runtime checks</h1><div class="admin-sub">Protected diagnostics. Values are status-only and never include secrets.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Public content</div><div class="metric-value">${passFail(checks.content.subjectsVerified > 0 && checks.content.collegesTotal > 0)}</div></div>
  <div class="metric"><div class="metric-label">Search index</div><div class="metric-value">${passFail(checks.searchIndex.ok && checks.searchIndex.total === 619)}</div></div>
  <div class="metric"><div class="metric-label">Storage</div><div class="metric-value">${passFail(checks.storage.ok)}</div></div>
  <div class="metric"><div class="metric-label">Database</div><div class="metric-value">${checks.db.skipped ? '<span class="status-warn">not configured</span>' : checks.db.connected ? passFail(checks.db.ok) : '<span class="status-bad">connection failed</span>'}</div></div>
</section>

<h2>Runtime</h2>
<div class="table-wrap"><table><tbody>
${runtimeRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
</tbody></table></div>

<h2>Database</h2>
<div class="table-wrap"><table><tbody>
${dbRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
${checks.db.missing?.length ? `<tr><th>Missing env keys</th><td class="mono">${escapeHtml(checks.db.missing.join(', '))}</td></tr>` : ''}
${checks.db.error ? `<tr><th>Error</th><td><pre class="mono" style="white-space:pre-wrap;margin:0;">${escapeHtml(JSON.stringify(checks.db.error, null, 2))}</pre></td></tr>` : ''}
</tbody></table></div>

<h2>Storage</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Status</th><td>${checks.storage.ok ? 'readable and writable' : 'needs attention'}</td></tr>
<tr><th>Path</th><td class="mono">${escapeHtml(checks.storage.path)}</td></tr>
<tr><th>Message</th><td>${escapeHtml(checks.storage.message || '')}</td></tr>
</tbody></table></div>

<h2>Content counts</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Source</th><td>${escapeHtml(checks.content.source)}</td></tr>
<tr><th>Subjects total</th><td>${escapeHtml(checks.content.subjectsTotal)}</td></tr>
<tr><th>Verified subjects</th><td>${escapeHtml(checks.content.subjectsVerified)}</td></tr>
<tr><th>Needs verification</th><td>${escapeHtml(checks.content.subjectsNeedsVerification)}</td></tr>
<tr><th>Placeholder</th><td>${escapeHtml(checks.content.subjectsPlaceholder)}</td></tr>
<tr><th>Colleges</th><td>${escapeHtml(checks.content.collegesTotal)}</td></tr>
<tr><th>Branch profiles</th><td>${escapeHtml(checks.content.branchProfilesTotal)}</td></tr>
</tbody></table></div>

<h2>Search index</h2>
<div class="table-wrap"><table><tbody>
${searchRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${typeof value === 'object' ? `<pre class="mono" style="white-space:pre-wrap;margin:0;">${escapeHtml(JSON.stringify(value, null, 2))}</pre>` : escapeHtml(value)}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderSubjectsPage({ subjects, contentSource }) {
  return adminShell({
    title: 'Subjects',
    active: 'subjects',
    body: `
<div class="admin-top"><div><h1>Subjects</h1><div class="admin-sub">Source: ${escapeHtml(contentSource)}. Read-only table.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Subject</th><th>Branch</th><th>Regulation</th><th>Semester</th><th>Slug</th></tr></thead><tbody>
${subjects.map(s => `<tr><td><span class="pill">${escapeHtml(s.source?.status || '')}</span></td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.branch)}</td><td>${escapeHtml(s.regulation)}</td><td>${escapeHtml(s.year_sem_label)}</td><td class="mono">${escapeHtml(s.seo?.slug || s.id)}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderCollegesPage({ colleges, contentSource }) {
  return adminShell({
    title: 'Colleges',
    active: 'colleges',
    body: `
<div class="admin-top"><div><h1>Colleges</h1><div class="admin-sub">Source: ${escapeHtml(contentSource)}. Read-only table.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Name</th><th>University</th><th>Type</th><th>District</th><th>Website</th></tr></thead><tbody>
${colleges.map(c => `<tr><td><span class="pill">${escapeHtml(c.source?.status || '')}</span></td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.affiliated_to)}</td><td>${escapeHtml(c.type)}</td><td>${escapeHtml(c.location?.district || '')}</td><td class="mono">${c.official_website ? escapeHtml(c.official_website) : ''}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderBranchProfilesPage({ branchProfiles, contentSource }) {
  return adminShell({
    title: 'Branch profiles',
    active: 'branch_profiles',
    body: `
<div class="admin-top"><div><h1>Branch profiles</h1><div class="admin-sub">Source: ${escapeHtml(contentSource)}. Read-only table.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Branch</th><th>Tagline</th><th>Career paths</th></tr></thead><tbody>
${branchProfiles.map(p => `<tr><td><span class="pill">${escapeHtml(p.source?.status || '')}</span></td><td>${escapeHtml(p.branch)}</td><td>${escapeHtml(p.tagline)}</td><td>${escapeHtml((p.career_paths || []).join(', '))}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderSourceEvidencePage({ sources, contentSource }) {
  return adminShell({
    title: 'Source evidence',
    active: 'source_evidence',
    body: `
<div class="admin-top"><div><h1>Source evidence</h1><div class="admin-sub">Source: ${escapeHtml(contentSource)}. Distinct source evidence found in loaded content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Entity type</th><th>Status</th><th>Retrieved</th><th>URL</th><th>Note</th></tr></thead><tbody>
${sources.map(s => `<tr><td>${escapeHtml(s.entityType)}</td><td><span class="pill">${escapeHtml(s.status)}</span></td><td>${escapeHtml(s.retrievedDate || '')}</td><td class="mono">${escapeHtml(s.originUrl || '')}</td><td>${escapeHtml(s.note || '')}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderSourceUnavailablePage({ message }) {
  return adminShell({
    title: 'Sources',
    active: 'sources',
    body: `
<div class="admin-top"><div><h1>Sources</h1><div class="admin-sub">DB-backed source registry.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderSourceRegistryPage({ sources }) {
  return adminShell({
    title: 'Sources',
    active: 'sources',
    body: `
<div class="admin-top"><div><h1>Sources</h1><div class="admin-sub">Trusted source registry. No crawling, fetching, parsing, or proposal automation is connected here.</div></div><div><a class="logout" href="/admin/sources/new">Create source</a> &middot; <a class="logout" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Name</th><th>Kind</th><th>Trust</th><th>Base URL</th><th>Last checked</th><th>Last success</th><th></th></tr></thead><tbody>
${sources.length ? sources.map(s => `<tr><td><span class="pill">${s.enabled ? 'enabled' : 'disabled'}</span></td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.sourceKind)}</td><td>${escapeHtml(s.trustLevel)}</td><td class="mono">${escapeHtml(s.baseUrl)}</td><td>${escapeHtml(s.lastCheckedAt || '')}</td><td>${escapeHtml(s.lastSuccessAt || '')}</td><td><a href="/admin/sources/${s.id}">View</a></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No discovery sources configured', 'Add trusted source metadata before fetching or uploading source evidence.', '<a href="/admin/sources/new">Create source</a>')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderSourceFormPage({ values = {}, sourceKinds = [], trustLevels = [], error = null, mode = 'create', source = null } = {}) {
  const action = mode === 'edit' && source ? `/admin/sources/${escapeHtml(source.id)}/edit` : '/admin/sources/new';
  const title = mode === 'edit' && source ? `Edit source ${source.id}` : 'Create source';
  const value = key => values[key] ?? values[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] ?? '';
  const selectedKind = value('source_kind') || 'other';
  const selectedTrust = value('trust_level') || 'unknown';
  const enabled = values.enabled === undefined ? true : ['true', '1', 'on', true, 1].includes(values.enabled);
  const crawlEnabled = ['true', '1', 'on', true, 1].includes(values.crawl_enabled);
  return adminShell({
    title,
    active: 'sources',
    body: `
<div class="admin-top"><div><h1>${escapeHtml(title)}</h1><div class="admin-sub">Configuration only. Saving a source does not fetch, parse, create proposals, or publish content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="post" action="${action}">
  <label for="source_key"><strong>Source key</strong></label>
  <input id="source_key" name="source_key" value="${escapeHtml(value('source_key'))}" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="jntuk-official">

  <label for="name" style="display:block;margin-top:12px;"><strong>Name</strong></label>
  <input id="name" name="name" value="${escapeHtml(value('name'))}" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">

  <label for="base_url" style="display:block;margin-top:12px;"><strong>Base URL</strong></label>
  <input id="base_url" name="base_url" value="${escapeHtml(value('base_url'))}" required type="url" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
    <label><strong>University ID</strong> <span class="admin-sub">optional</span><input name="university_id" value="${escapeHtml(value('university_id'))}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;"></label>
    <label><strong>Branch ID</strong> <span class="admin-sub">optional</span><input name="branch_id" value="${escapeHtml(value('branch_id'))}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;"></label>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
    <label><strong>Source kind</strong><select name="source_kind" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">${sourceKinds.map(kind => `<option value="${escapeHtml(kind)}"${selectedKind === kind ? ' selected' : ''}>${escapeHtml(kind)}</option>`).join('')}</select></label>
    <label><strong>Trust level</strong><select name="trust_level" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">${trustLevels.map(level => `<option value="${escapeHtml(level)}"${selectedTrust === level ? ' selected' : ''}>${escapeHtml(level)}</option>`).join('')}</select></label>
  </div>

  <label for="parser_key" style="display:block;margin-top:12px;"><strong>Parser key</strong> <span class="admin-sub">optional</span></label>
  <input id="parser_key" name="parser_key" value="${escapeHtml(value('parser_key'))}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">

  <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;">
    <label><input type="checkbox" name="enabled" value="1"${enabled ? ' checked' : ''}> Enabled</label>
    <label><input type="checkbox" name="crawl_enabled" value="1"${crawlEnabled ? ' checked' : ''}> Crawl enabled flag</label>
  </div>

  <label for="notes" style="display:block;margin-top:12px;"><strong>Notes</strong></label>
  <textarea id="notes" name="notes" style="width:100%;min-height:110px;border:1px solid var(--line);border-radius:6px;padding:10px;font:inherit;margin-top:6px;">${escapeHtml(value('notes'))}</textarea>

  <button type="submit">${mode === 'edit' ? 'Save source' : 'Create source'}</button>
</form>`,
  });
}

export function renderSourceDetailPage({ source, error = null, fetchError = null, fetchValues = {} }) {
  return adminShell({
    title: `Source ${source.id}`,
    active: 'sources',
    body: `
<div class="admin-top"><div><h1>${escapeHtml(source.name)}</h1><div class="admin-sub"><span class="mono">${escapeHtml(source.sourceKey)}</span></div></div><div><a class="logout" href="/admin/sources/${source.id}/edit">Edit</a> &middot; <a class="logout" href="/admin/logout">Sign out</a></div></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${fetchError ? `<div class="error">${escapeHtml(fetchError)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${source.enabled ? 'enabled' : 'disabled'}</div></div>
  <div class="metric"><div class="metric-label">Trust</div><div class="metric-value">${escapeHtml(source.trustLevel)}</div></div>
  <div class="metric"><div class="metric-label">Kind</div><div class="metric-value">${escapeHtml(source.sourceKind)}</div></div>
  <div class="metric"><div class="metric-label">Crawl flag</div><div class="metric-value">${source.crawlEnabled ? 'enabled' : 'disabled'}</div></div>
</section>

<h2>Metadata</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Base URL</th><td class="mono">${escapeHtml(source.baseUrl)}</td></tr>
<tr><th>University</th><td>${escapeHtml(source.universityCode || source.universityId || '')}</td></tr>
<tr><th>Branch</th><td>${escapeHtml(source.branchCode || source.branchId || '')}</td></tr>
<tr><th>Parser key</th><td class="mono">${escapeHtml(source.parserKey || '')}</td></tr>
<tr><th>Last checked</th><td>${escapeHtml(source.lastCheckedAt || '')}</td></tr>
<tr><th>Last success</th><td>${escapeHtml(source.lastSuccessAt || '')}</td></tr>
<tr><th>Notes</th><td>${escapeHtml(source.notes || '')}</td></tr>
</tbody></table></div>

<h2>Source actions</h2>
<form class="action-box" method="post" action="/admin/sources/${escapeHtml(source.id)}/enabled">
  <input type="hidden" name="enabled" value="${source.enabled ? '0' : '1'}">
  <strong>${source.enabled ? 'Disable source' : 'Enable source'}</strong>
  ${source.enabled
    ? '<div class="admin-sub">Disabling a source stops admins from treating it as active evidence configuration. It does not delete assets, proposals, or public content.</div><textarea name="note" required placeholder="Required: explain why this source is being disabled."></textarea>'
    : '<div class="admin-sub">Enabling restores this source for manual evidence operations. It does not crawl or fetch automatically.</div>'}
  <button type="submit">${source.enabled ? 'Disable source' : 'Enable source'}</button>
</form>

<h2>Fetch URL</h2>
<form class="action-box" method="post" action="/admin/sources/${escapeHtml(source.id)}/fetch">
  <strong>Manual fetch</strong>
  <div class="admin-sub">Stores one URL as immutable source evidence. It does not parse, extract, create proposals, or publish content.</div>
  <label for="source_url" style="display:block;margin-top:12px;"><strong>URL</strong></label>
  <input id="source_url" name="source_url" type="url" value="${escapeHtml(fetchValues.source_url || '')}" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="${escapeHtml(source.baseUrl)}">
  <button type="submit">Fetch URL</button>
</form>

<h2>Crawl runs</h2>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Started</th><th>Finished</th><th>Items</th><th>Assets</th><th>Error</th></tr></thead><tbody>
${source.crawlRuns?.length ? source.crawlRuns.map(run => `<tr><td><span class="pill">${escapeHtml(run.status)}</span></td><td>${escapeHtml(run.startedAt || '')}</td><td>${escapeHtml(run.finishedAt || '')}</td><td>${escapeHtml(run.itemsDiscovered)}</td><td>${escapeHtml(run.assetsCreated)}</td><td>${escapeHtml(run.errorMessage || '')}</td></tr>`).join('') : '<tr><td colspan="6">No crawl runs recorded. Crawling is not implemented yet.</td></tr>'}
</tbody></table></div>`,
  });
}

export function renderAssetsUnavailablePage({ message }) {
  return adminShell({
    title: 'Assets',
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Assets</h1><div class="admin-sub">DB-backed raw source material registry.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderAssetsPage({ assets }) {
  return adminShell({
    title: 'Assets',
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Assets</h1><div class="admin-sub">Raw source material only. Assets are stored before parsing and never publish content.</div></div><div><a class="logout" href="/admin/assets/new">Upload asset</a> &middot; <a class="logout" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Filename</th><th>Size</th><th>Type</th><th>Source</th><th>Downloaded</th><th>Checksum</th><th></th></tr></thead><tbody>
${assets.length ? assets.map(asset => `<tr><td><span class="pill">${escapeHtml(asset.downloadStatus || '')}</span></td><td>${escapeHtml(asset.originalFilename || '')}</td><td>${escapeHtml(formatBytes(asset.fileSize))}</td><td>${escapeHtml(asset.contentType || '')}</td><td>${escapeHtml(asset.discoverySourceName || asset.discoverySourceId || '')}</td><td>${escapeHtml(asset.downloadedAt || '')}</td><td class="mono">${escapeHtml(asset.sha256Checksum ? `${asset.sha256Checksum.slice(0, 16)}...` : '')}</td><td><a href="/admin/assets/${asset.id}">View</a></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No source assets stored', 'Upload or manually fetch evidence from a configured source. Assets remain raw evidence and do not publish content.', '<a href="/admin/assets/new">Upload asset</a>')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderParseResultsPage({ results }) {
  return adminShell({
    title: 'Parse results',
    active: 'parse_results',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Parse results' }],
    body: `
<div class="admin-top"><div><h1>Parse results</h1><div class="admin-sub">Parser output history. Evidence extraction only; no proposal or publishing happens from this list.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('parse')}
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Parser</th><th>Asset</th><th>Version</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${results.length ? results.map(result => `<tr><td><span class="pill">${escapeHtml(result.status)}</span></td><td class="mono">${escapeHtml(result.parserKey)}</td><td>${result.assetId ? `<a href="/admin/assets/${escapeHtml(result.assetId)}">${escapeHtml(result.assetFilename || result.assetId)}</a>` : '-'}</td><td>${escapeHtml(result.parserVersion || '')}</td><td>${escapeHtml(result.createdAt || '')}</td><td>${escapeHtml(result.errorMessage || '')}</td><td><a href="/admin/parse-results/${escapeHtml(result.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No parse results yet', 'Run a parser manually from an asset detail page. Parsers only create evidence.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderExtractionResultsPage({ results }) {
  return adminShell({
    title: 'Extraction results',
    active: 'extraction_results',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Extractions' }],
    body: `
<div class="admin-top"><div><h1>Extraction results</h1><div class="admin-sub">Entity-shaped candidates derived from parse results. Validation is still required before proposal use.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('extraction')}
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Validation</th><th>Entity</th><th>Key</th><th>Parser</th><th>Created</th><th></th></tr></thead><tbody>
${results.length ? results.map(result => `<tr><td><span class="pill">${escapeHtml(result.status)}</span></td><td><span class="pill">${escapeHtml(result.validationStatus)}</span></td><td>${escapeHtml(result.entityType)}</td><td class="mono">${escapeHtml(result.entityKey || '')}</td><td class="mono">${escapeHtml(result.parserKey || '')}</td><td>${escapeHtml(result.createdAt || '')}</td><td><a href="/admin/extraction-results/${escapeHtml(result.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No extraction results yet', 'Open a parse result and extract an entity-shaped payload.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderDiffResultsPage({ results }) {
  return adminShell({
    title: 'Diff results',
    active: 'diff_results',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Diffs' }],
    body: `
<div class="admin-top"><div><h1>Diff results</h1><div class="admin-sub">Comparison evidence against current JSON-backed content. Diffs do not create proposals unless an admin explicitly does so.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('diff')}
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Operation</th><th>Entity</th><th>Key</th><th>Parser</th><th>Changes</th><th>Warnings</th><th>Created</th><th></th></tr></thead><tbody>
${results.length ? results.map(result => `<tr><td><span class="pill">${escapeHtml(result.status)}</span></td><td><span class="pill">${escapeHtml(diffOperationLabel(result.diff))}</span></td><td>${escapeHtml(result.entityType)}</td><td class="mono">${escapeHtml(result.entityKey || '')}</td><td class="mono">${escapeHtml(result.parserKey || '')}</td><td>${escapeHtml(result.diff?.change_count ?? '')}</td><td>${escapeHtml(diffSafetyWarnings(result.diff).length)}</td><td>${escapeHtml(result.createdAt || '')}</td><td><a href="/admin/diff-results/${escapeHtml(result.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="9">${emptyState('No diff results yet', 'Run a diff from a parse or extraction result. Missing exact keys now produce add-mode diffs for review.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderPipelineRunsPage({ results }) {
  return adminShell({
    title: 'Pipeline runs',
    active: 'pipeline_runs',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Pipelines' }],
    body: `
<div class="admin-top"><div><h1>Pipeline runs</h1><div class="admin-sub">Manual evidence pipeline history. Pipelines never publish and proposal creation remains opt-in.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('parse')}
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Parser</th><th>Entity</th><th>Key</th><th>Asset</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${results.length ? results.map(result => `<tr><td><span class="pill">${escapeHtml(result.status)}</span></td><td class="mono">${escapeHtml(result.parserKey)}</td><td>${escapeHtml(result.entityType)}</td><td class="mono">${escapeHtml(result.entityKey || '')}</td><td>${result.assetId ? `<a href="/admin/assets/${escapeHtml(result.assetId)}">${escapeHtml(result.assetFilename || result.assetId)}</a>` : '-'}</td><td>${escapeHtml(result.createdAt || '')}</td><td>${escapeHtml(result.errorMessage || '')}</td><td><a href="/admin/pipeline-runs/${escapeHtml(result.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No pipeline runs yet', 'Run the manual pipeline from an asset detail page only after reviewing the source evidence.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderAssetUploadPage({ sources = [], values = {}, error = null } = {}) {
  return adminShell({
    title: 'Upload asset',
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Upload asset</h1><div class="admin-sub">Upload stores immutable raw material only. It does not parse, crawl, create proposals, or modify public content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="post" action="/admin/assets/new" enctype="multipart/form-data">
  <label for="discovery_source_id"><strong>Discovery source</strong></label>
  <select id="discovery_source_id" name="discovery_source_id" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    <option value="">Select source</option>
    ${sources.map(source => `<option value="${escapeHtml(source.id)}"${String(values.discovery_source_id || '') === String(source.id) ? ' selected' : ''}>${escapeHtml(source.name)} (${escapeHtml(source.sourceKey)})</option>`).join('')}
  </select>

  <label for="source_url" style="display:block;margin-top:12px;"><strong>Source URL</strong> <span class="admin-sub">optional</span></label>
  <input id="source_url" name="source_url" value="${escapeHtml(values.source_url || '')}" type="url" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">

  <label for="asset_file" style="display:block;margin-top:12px;"><strong>File</strong></label>
  <input id="asset_file" name="asset_file" required type="file" accept=".pdf,.html,.htm,.zip,image/*" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;background:#fff;">

  <button type="submit">Store asset</button>
</form>`,
  });
}

export function renderAssetDetailPage({
  asset,
  parsers = [],
  parseResults = [],
  pipelineRuns = [],
  error = null,
  pipelineError = null,
  pipelineValues = {},
}) {
  const selectedParser = pipelineValues.parser_key || parsers.find(parser => parser.suggested && parser.available)?.key || parsers.find(parser => parser.available)?.key || '';
  return adminShell({
    title: `Asset ${asset.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>${escapeHtml(asset.originalFilename || `Asset ${asset.id}`)}</h1><div class="admin-sub">Raw source asset. Parser and pipeline actions remain manual and never publish content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('asset')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${pipelineError ? `<div class="error">${escapeHtml(pipelineError)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(asset.downloadStatus || '')}</div></div>
  <div class="metric"><div class="metric-label">Size</div><div class="metric-value">${escapeHtml(formatBytes(asset.fileSize) || '-')}</div></div>
  <div class="metric"><div class="metric-label">Source</div><div class="metric-value">${escapeHtml(asset.discoverySourceName || asset.discoverySourceId || '')}</div></div>
</section>

<h2>Metadata</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Filename</th><td>${escapeHtml(asset.originalFilename || '')}</td></tr>
<tr><th>Content type</th><td>${escapeHtml(asset.contentType || '')}</td></tr>
<tr><th>SHA-256</th><td class="mono">${escapeHtml(asset.sha256Checksum || '')}</td></tr>
<tr><th>Source URL</th><td class="mono">${escapeHtml(asset.sourceUrl || '')}</td></tr>
<tr><th>Storage path</th><td class="mono">${escapeHtml(asset.localStoragePath || '')}</td></tr>
<tr><th>Downloaded at</th><td>${escapeHtml(asset.downloadedAt || '')}</td></tr>
<tr><th>Duplicate of</th><td>${asset.duplicateOfAssetId ? `<a href="/admin/assets/${escapeHtml(asset.duplicateOfAssetId)}">${escapeHtml(asset.duplicateOfAssetId)}</a>` : ''}</td></tr>
<tr><th>ETag</th><td class="mono">${escapeHtml(asset.etag || '')}</td></tr>
<tr><th>Last modified</th><td>${escapeHtml(asset.lastModified || '')}</td></tr>
<tr><th>Error</th><td>${escapeHtml(asset.downloadError || '')}</td></tr>
</tbody></table></div>

<h2>Parsers</h2>
<div class="proposal-actions">
${parsers.length ? parsers.map(parser => `<form class="action-box" method="post" action="/admin/assets/${escapeHtml(asset.id)}/parse">
  <strong>${escapeHtml(parser.label)}</strong>${parser.suggested ? ' <span class="pill">suggested</span>' : ''}${parser.sourceSpecific ? ' <span class="pill">source-specific</span>' : ''}
  <div class="admin-sub">${escapeHtml(parser.description || '')}</div>
  <div class="mono" style="margin-top:8px;">${escapeHtml(parser.key)} v${escapeHtml(parser.version)}</div>
  <input type="hidden" name="parser_key" value="${escapeHtml(parser.key)}">
  ${parser.available ? '<button type="submit">Run parser</button>' : `<div class="notice" style="margin-top:10px;">${escapeHtml(parser.unavailableReason || 'Parser unavailable.')}</div>`}
</form>`).join('') : `<div class="notice">${emptyState('No parser matches this asset', 'Upload HTML for html-basic/source-specific parsers, or wait for a future PDF parser dependency before parsing PDF assets.')}</div>`}
</div>

<h2>Run manual pipeline</h2>
<form class="action-box" method="post" action="/admin/assets/${escapeHtml(asset.id)}/pipeline">
  <div class="admin-sub">Runs parser, extraction, validation, and optional diff/proposal steps for this one asset. It does not publish or write JSON files.</div>
  <label for="pipeline_parser_key"><strong>Parser</strong></label>
  <select id="pipeline_parser_key" name="parser_key" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${parsers.filter(parser => parser.available).map(parser => `<option value="${escapeHtml(parser.key)}"${selectedParser === parser.key ? ' selected' : ''}>${escapeHtml(parser.label)} (${escapeHtml(parser.key)})${parser.suggested ? ' - suggested' : ''}</option>`).join('')}
  </select>

  <label for="pipeline_entity_type" style="display:block;margin-top:12px;"><strong>Entity type</strong></label>
  <select id="pipeline_entity_type" name="entity_type" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${['subject', 'college', 'branch_profile'].map(type => `<option value="${type}"${pipelineValues.entity_type === type ? ' selected' : ''}>${type}</option>`).join('')}
  </select>

  <label for="pipeline_entity_key" style="display:block;margin-top:12px;"><strong>Entity key</strong> <span class="admin-sub">optional</span></label>
  <input id="pipeline_entity_key" name="entity_key" value="${escapeHtml(pipelineValues.entity_key || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="existing subject slug, college key, or branch code">

  <label for="pipeline_candidate_index" style="display:block;margin-top:12px;"><strong>Candidate index</strong> <span class="admin-sub">optional</span></label>
  <input id="pipeline_candidate_index" name="candidate_index" value="${escapeHtml(pipelineValues.candidate_index || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="0">

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;">
    <label><strong>University</strong><input name="university" value="${escapeHtml(pipelineValues.university || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="JNTUK"></label>
    <label><strong>Regulation</strong><input name="regulation" value="${escapeHtml(pipelineValues.regulation || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="R23"></label>
    <label><strong>Branch</strong><input name="branch" value="${escapeHtml(pipelineValues.branch || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="CSE"></label>
    <label><strong>Year</strong><input name="year" value="${escapeHtml(pipelineValues.year || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="3"></label>
    <label><strong>Semester</strong><input name="semester" value="${escapeHtml(pipelineValues.semester || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="1"></label>
  </div>

  <label style="display:block;margin-top:12px;"><input type="checkbox" name="create_proposal" value="1"${pipelineValues.create_proposal ? ' checked' : ''}> Create proposal from diff</label>
  <div class="notice" style="margin-top:10px;">Leave proposal creation off unless you have reviewed the source asset, parser choice, candidate index, and entity key. If checked, the pipeline can create a review-queue proposal, but it still cannot publish or mark anything verified.</div>
  <button type="submit">Run manual pipeline</button>
</form>

<h2>Pipeline history</h2>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Parser</th><th>Entity</th><th>Key</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${pipelineRuns.length ? pipelineRuns.map(run => `<tr><td><span class="pill">${escapeHtml(run.status)}</span></td><td>${escapeHtml(run.parserKey)}</td><td>${escapeHtml(run.entityType)}</td><td class="mono">${escapeHtml(run.entityKey || '')}</td><td>${escapeHtml(run.createdAt || '')}</td><td>${escapeHtml(run.errorMessage || '')}</td><td><a href="/admin/pipeline-runs/${escapeHtml(run.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No pipeline runs yet', 'Run the manual pipeline only after choosing a parser and target entity. Proposal creation remains opt-in.')}</td></tr>`}
</tbody></table></div>

<h2>Parse history</h2>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Parser</th><th>Version</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${parseResults.length ? parseResults.map(result => `<tr><td><span class="pill">${escapeHtml(result.status)}</span></td><td>${escapeHtml(result.parserKey)}</td><td>${escapeHtml(result.parserVersion)}</td><td>${escapeHtml(result.createdAt || '')}</td><td>${escapeHtml(result.errorMessage || '')}</td><td><a href="/admin/parse-results/${escapeHtml(result.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No parse results yet', 'Run a parser manually from this page. Parsing extracts evidence only and creates no proposals by itself.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderPipelineRunDetailPage({ result }) {
  return adminShell({
    title: `Pipeline run ${result.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Pipeline run ${escapeHtml(result.id)}</h1><div class="admin-sub">Manual evidence pipeline. This run does not publish content or mark anything verified.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('parse')}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Parser</div><div class="metric-value">${escapeHtml(result.parserKey)}</div></div>
  <div class="metric"><div class="metric-label">Entity</div><div class="metric-value">${escapeHtml(result.entityType)}</div></div>
  <div class="metric"><div class="metric-label">Asset</div><div class="metric-value"><a href="/admin/assets/${escapeHtml(result.assetId)}">${escapeHtml(result.assetFilename || result.assetId)}</a></div></div>
</section>

<h2>Summary</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Entity key</th><td class="mono">${escapeHtml(result.entityKey || '')}</td></tr>
<tr><th>Created by</th><td>${escapeHtml(result.createdBy || '')}</td></tr>
<tr><th>Created</th><td>${escapeHtml(result.createdAt || '')}</td></tr>
<tr><th>Finished</th><td>${escapeHtml(result.finishedAt || '')}</td></tr>
<tr><th>Error</th><td>${escapeHtml(result.errorMessage || '')}</td></tr>
</tbody></table></div>

<h2>Steps</h2>
<div class="table-wrap"><table><thead><tr><th>Step</th><th>Status</th><th>Details</th><th>At</th></tr></thead><tbody>
${result.steps?.length ? result.steps.map(step => {
  const { step: stepName, status, at, ...details } = step;
  return `<tr><td>${escapeHtml(stepName || '')}</td><td><span class="pill">${escapeHtml(status || '')}</span></td><td><pre class="mono" style="white-space:pre-wrap;margin:0;">${escapeHtml(JSON.stringify(details, null, 2))}</pre></td><td>${escapeHtml(at || '')}</td></tr>`;
}).join('') : '<tr><td colspan="4">No steps recorded.</td></tr>'}
</tbody></table></div>`,
  });
}

function candidateConfidence(candidate) {
  const level = candidate?.confidence?.level || 'unknown';
  const reason = candidate?.confidence?.reason || 'No confidence reason recorded.';
  return { level, reason };
}

function candidateHeading(candidates) {
  const allHighConfidence = candidates.length && candidates.every(candidate => candidateConfidence(candidate).level === 'high');
  return allHighConfidence ? 'High-confidence subject candidates' : 'Parsed candidate rows';
}

function renderPdfExtractionSummary(payload = {}) {
  if (!payload || !['pdf_text', 'tirumala_r23_syllabus_pdf', 'lbrce_r23_syllabus_pdf'].includes(payload.evidence_type)) return '';
  return `<h2>PDF text extraction summary</h2>
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Evidence type</div><div class="metric-value" style="font-size:16px;">${escapeHtml(payload.evidence_type)}</div></div>
  <div class="metric"><div class="metric-label">Pages</div><div class="metric-value">${escapeHtml(payload.page_count || 0)}</div></div>
  <div class="metric"><div class="metric-label">Text length</div><div class="metric-value">${escapeHtml(payload.full_text_length || (payload.text_preview || '').length || 0)}</div></div>
  <div class="metric"><div class="metric-label">Context</div><div class="metric-value" style="font-size:15px;">${escapeHtml(payload.detected_context ? JSON.stringify(payload.detected_context) : 'raw text')}</div></div>
</section>
<div class="notice evidence-warning" style="margin-top:10px;">PDF text extraction is evidence only. Layout and table detection still require human review before any proposal or draft release work.</div>`;
}

export function renderParseResultDetailPage({
  result,
  diffResults = [],
  extractionResults = [],
  values = {},
  error = null,
  extractionValues = {},
  extractionError = null,
}) {
  const candidates = Array.isArray(result.parsedPayload?.candidates) ? result.parsedPayload.candidates : [];
  const lowConfidenceCandidates = Array.isArray(result.parsedPayload?.low_confidence_candidates) ? result.parsedPayload.low_confidence_candidates : [];
  const ignoredRows = Array.isArray(result.parsedPayload?.ignored_table_rows) ? result.parsedPayload.ignored_table_rows : [];
  return adminShell({
    title: `Parse result ${result.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Parse result ${escapeHtml(result.id)}</h1><div class="admin-sub">Evidence extraction only. This result does not publish content or create proposals.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('parse')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${extractionError ? `<div class="error">${escapeHtml(extractionError)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Parser</div><div class="metric-value">${escapeHtml(result.parserKey)}</div></div>
  <div class="metric"><div class="metric-label">Asset</div><div class="metric-value"><a href="/admin/assets/${escapeHtml(result.assetId)}">${escapeHtml(result.assetFilename || result.assetId)}</a></div></div>
</section>

<h2>Error</h2>
<div class="notice">${escapeHtml(result.errorMessage || 'No parser error recorded.')}</div>

<h2>Parsed payload</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.parsedPayload, null, 2) || 'null')}</pre>

<h2>Confidence</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.confidence, null, 2) || 'null')}</pre>

${renderPdfExtractionSummary(result.parsedPayload)}

${candidates.length ? `<h2>${escapeHtml(candidateHeading(candidates))}</h2>
<div class="notice evidence-warning" style="margin-bottom:10px;">Parsed rows are unverified evidence. Extract only rows that clearly match the source document and still run validation before review.</div>
<div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Regulation</th><th>Branch</th><th>Year/Sem</th><th>Category</th><th>Type</th><th>Confidence</th><th></th></tr></thead><tbody>
${candidates.map((candidate, index) => {
  const confidence = candidateConfidence(candidate);
  return `<tr>
  <td>${escapeHtml(candidate.candidate_index ?? index)}</td>
  <td>${escapeHtml(candidate.name || '')}</td>
  <td>${escapeHtml(candidate.regulation || '')}</td>
  <td>${escapeHtml(candidate.branch || '')}</td>
  <td>${escapeHtml(candidate.year_sem_label || [candidate.year, candidate.semester].filter(Boolean).join('-'))}</td>
  <td>${escapeHtml(candidate.category || '')}</td>
  <td>${escapeHtml(candidate.type || '')}</td>
  <td><span class="pill">${escapeHtml(confidence.level)}</span><div class="admin-sub">${escapeHtml(confidence.reason)}</div></td>
  <td>
    ${confidence.level === 'high' ? `<form method="post" action="/admin/parse-results/${escapeHtml(result.id)}/extract">
      <input type="hidden" name="entity_type" value="subject">
      <input type="hidden" name="candidate_index" value="${escapeHtml(index)}">
      <input type="hidden" name="entity_key" value="${escapeHtml(candidate.name || '')}">
      <input type="hidden" name="regulation" value="${escapeHtml(candidate.regulation || '')}">
      <input type="hidden" name="branch" value="${escapeHtml(candidate.branch || '')}">
      <input type="hidden" name="year" value="${escapeHtml(candidate.year || '')}">
      <input type="hidden" name="semester" value="${escapeHtml(candidate.semester || '')}">
      <button type="submit">Extract this candidate</button>
    </form>` : '<span class="admin-sub">Not extractable until confidence is high.</span>'}
  </td>
</tr>`;
}).join('')}
</tbody></table></div>` : ''}

${lowConfidenceCandidates.length ? `<h2>Low-confidence candidate rows</h2>
<div class="notice evidence-warning" style="margin-bottom:10px;">These rows were not promoted to subject candidates because the parser could not verify enough subject-table structure.</div>
<div class="table-wrap"><table><thead><tr><th>#</th><th>Possible name</th><th>Reason</th><th>Row evidence</th></tr></thead><tbody>
${lowConfidenceCandidates.slice(0, 50).map((candidate, index) => {
  const confidence = candidateConfidence(candidate);
  return `<tr><td>${escapeHtml(candidate.candidate_index ?? index)}</td><td>${escapeHtml(candidate.name || '')}</td><td>${escapeHtml(confidence.reason)}</td><td class="mono">${escapeHtml(candidate.evidence?.row_text || '')}</td></tr>`;
}).join('')}
</tbody></table></div>` : ''}

${ignoredRows.length ? `<h2>Ignored table rows</h2>
<div class="notice" style="margin-bottom:10px;">The parser ignored these rows because they looked like contact, staff, navigation, department, address, or otherwise non-syllabus table content.</div>
<div class="table-wrap"><table><thead><tr><th>Table</th><th>Row</th><th>Reason</th><th>Row evidence</th></tr></thead><tbody>
${ignoredRows.slice(0, 50).map(row => `<tr><td>${escapeHtml(row.table_index ?? '')}</td><td>${escapeHtml(row.row_index ?? '')}</td><td>${escapeHtml(row.reason || '')}</td><td class="mono">${escapeHtml(row.row_text || '')}</td></tr>`).join('')}
</tbody></table></div>` : ''}

<h2>Extract entity payload</h2>
<form class="action-box" method="post" action="/admin/parse-results/${escapeHtml(result.id)}/extract">
  <div class="admin-sub">Extraction turns raw parsed evidence into an entity-shaped candidate. Missing fields stay missing and validation remains required.</div>
  <label for="extract_entity_type"><strong>Entity type</strong></label>
  <select id="extract_entity_type" name="entity_type" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${['subject', 'college', 'branch_profile'].map(type => `<option value="${type}"${extractionValues.entity_type === type ? ' selected' : ''}>${type}</option>`).join('')}
  </select>
  <label for="extract_entity_key" style="display:block;margin-top:12px;"><strong>Entity key</strong> <span class="admin-sub">optional</span></label>
  <input id="extract_entity_key" name="entity_key" value="${escapeHtml(extractionValues.entity_key || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="existing subject slug, college key, or branch code">
  <input type="hidden" name="candidate_index" value="${escapeHtml(extractionValues.candidate_index || '')}">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;">
    <label><strong>University</strong><input name="university" value="${escapeHtml(extractionValues.university || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="JNTUK"></label>
    <label><strong>Regulation</strong><input name="regulation" value="${escapeHtml(extractionValues.regulation || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="R23"></label>
    <label><strong>Branch</strong><input name="branch" value="${escapeHtml(extractionValues.branch || '')}" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="CSE"></label>
    <label><strong>Year</strong><input name="year" value="${escapeHtml(extractionValues.year || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="3"></label>
    <label><strong>Semester</strong><input name="semester" value="${escapeHtml(extractionValues.semester || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="1"></label>
  </div>
  <button type="submit">Extract entity payload</button>
</form>

<h2>Extraction history</h2>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Validation</th><th>Entity</th><th>Key</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${extractionResults.length ? extractionResults.map(extraction => `<tr><td><span class="pill">${escapeHtml(extraction.status)}</span></td><td><span class="pill">${escapeHtml(extraction.validationStatus)}</span></td><td>${escapeHtml(extraction.entityType)}</td><td class="mono">${escapeHtml(extraction.entityKey || '')}</td><td>${escapeHtml(extraction.createdAt || '')}</td><td>${escapeHtml(extraction.errorMessage || '')}</td><td><a href="/admin/extraction-results/${escapeHtml(extraction.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No extraction results yet', 'Extract an entity-shaped candidate from the parsed evidence before running a structured diff.')}</td></tr>`}
</tbody></table></div>

<h2>Run diff</h2>
<form class="action-box" method="post" action="/admin/parse-results/${escapeHtml(result.id)}/diff">
  <label for="entity_type"><strong>Entity type</strong></label>
  <select id="entity_type" name="entity_type" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${['subject', 'college', 'branch_profile'].map(type => `<option value="${type}"${values.entity_type === type ? ' selected' : ''}>${type}</option>`).join('')}
  </select>
  <label for="entity_key" style="display:block;margin-top:12px;"><strong>Entity key</strong></label>
  <input id="entity_key" name="entity_key" value="${escapeHtml(values.entity_key || '')}" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="subject id, slug, college key, or branch code">
  <button type="submit">Run diff</button>
</form>

<h2>Diff history</h2>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Operation</th><th>Entity</th><th>Key</th><th>Changes</th><th>Warnings</th><th>Created</th><th>Error</th><th></th></tr></thead><tbody>
${diffResults.length ? diffResults.map(diff => `<tr><td><span class="pill">${escapeHtml(diff.status)}</span></td><td><span class="pill">${escapeHtml(diffOperationLabel(diff.diff))}</span></td><td>${escapeHtml(diff.entityType)}</td><td class="mono">${escapeHtml(diff.entityKey)}</td><td>${escapeHtml(diff.diff?.change_count ?? '')}</td><td>${escapeHtml(diffSafetyWarnings(diff.diff).length)}</td><td>${escapeHtml(diff.createdAt || '')}</td><td>${escapeHtml(diff.errorMessage || '')}</td><td><a href="/admin/diff-results/${escapeHtml(diff.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="9">${emptyState('No diff results yet', 'Run a diff after choosing an entity key. Missing exact keys produce add-mode diffs; fuzzy matching is intentionally not automatic.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderExtractionResultDetailPage({ result, error = null }) {
  const validationErrors = Array.isArray(result.validationErrors) ? result.validationErrors : [];
  return adminShell({
    title: `Extraction result ${result.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Extraction result ${escapeHtml(result.id)}</h1><div class="admin-sub">Entity-shaped candidate only. This does not create proposals or publish content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('extraction')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Validation</div><div class="metric-value">${escapeHtml(result.validationStatus)}</div></div>
  <div class="metric"><div class="metric-label">Entity</div><div class="metric-value">${escapeHtml(result.entityType)}</div></div>
  <div class="metric"><div class="metric-label">Parse result</div><div class="metric-value"><a href="/admin/parse-results/${escapeHtml(result.parseResultId)}">${escapeHtml(result.parseResultId)}</a></div></div>
</section>

<h2>Diff action</h2>
${result.status === 'success' ? `<form class="action-box" method="post" action="/admin/extraction-results/${escapeHtml(result.id)}/diff">
  <strong>Create diff from this extraction</strong>
  <div class="admin-sub">Uses the extracted entity payload for comparison. It does not create proposals or publish content.</div>
  <button type="submit">Create diff from extraction</button>
</form>` : '<div class="notice">Only successful extraction results can be diffed.</div>'}

<h2>Error</h2>
<div class="notice">${escapeHtml(result.errorMessage || 'No extraction error recorded.')}</div>

<h2>Validation errors</h2>
${validationErrors.length ? `<div class="table-wrap"><table><thead><tr><th>Path</th><th>Message</th><th>Rule</th></tr></thead><tbody>${validationErrors.map(err => `<tr><td class="mono">${escapeHtml(err.path || '')}</td><td>${escapeHtml(err.message || '')}</td><td class="mono">${escapeHtml(err.keyword || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice">No validation errors stored.</div>'}

<h2>Extracted payload</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.extractedPayload, null, 2) || 'null')}</pre>

<h2>Confidence</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.confidence, null, 2) || 'null')}</pre>`,
  });
}

export function renderDiffResultDetailPage({ result, existingProposal = null, error = null }) {
  const canCreateProposal = result.status === 'success' && !existingProposal;
  const warnings = diffSafetyWarnings(result.diff);
  const blockingWarnings = blockingSafetyWarnings(result.diff);
  return adminShell({
    title: `Diff result ${result.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>Diff result ${escapeHtml(result.id)}</h1><div class="admin-sub">Comparison evidence only. Proposal creation is manual and still does not publish content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('diff')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Operation</div><div class="metric-value">${escapeHtml(diffOperationLabel(result.diff))}</div></div>
  <div class="metric"><div class="metric-label">Safety warnings</div><div class="metric-value ${blockingWarnings.length ? 'status-bad' : warnings.length ? 'status-warn' : 'status-ok'}">${escapeHtml(warnings.length)}</div></div>
  <div class="metric"><div class="metric-label">Entity</div><div class="metric-value">${escapeHtml(result.entityType)}</div></div>
  <div class="metric"><div class="metric-label">Parse result</div><div class="metric-value"><a href="/admin/parse-results/${escapeHtml(result.parseResultId)}">${escapeHtml(result.parseResultId)}</a></div></div>
  <div class="metric"><div class="metric-label">Extraction result</div><div class="metric-value">${result.extractionResultId ? `<a href="/admin/extraction-results/${escapeHtml(result.extractionResultId)}">${escapeHtml(result.extractionResultId)}</a>` : '-'}</div></div>
</section>

<h2>Safety warnings</h2>
${renderDiffSafetyWarnings(result.diff)}
${blockingWarnings.length ? '<div class="notice evidence-warning" style="margin-top:10px;">Blocking warnings must be reviewed. Draft approval will require an explicit safety override checkbox and reviewer note.</div>' : ''}

<h2>Proposal</h2>
${existingProposal ? `<div class="notice">A proposal already exists for this diff: <a href="/admin/proposals/${escapeHtml(existingProposal.id)}">proposal ${escapeHtml(existingProposal.id)}</a>.</div>` : ''}
${canCreateProposal ? `<form class="action-box" method="post" action="/admin/diff-results/${escapeHtml(result.id)}/proposal">
  <strong>Create proposal from this diff</strong>
  <div class="admin-sub">Creates a needs_review proposal in the review queue. Operation: ${escapeHtml(diffOperationLabel(result.diff))}. It does not write public content or mark anything verified.</div>
  <label for="note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong> <span class="admin-sub">optional</span></label>
  <textarea id="note" name="note" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:6px;padding:10px;font:inherit;margin-top:6px;"></textarea>
  <button type="submit">Create proposal from this diff</button>
</form>` : ''}
${!existingProposal && result.status !== 'success' ? '<div class="notice">Only successful diff results can be converted into proposals.</div>' : ''}

<h2>Error</h2>
<div class="notice">${escapeHtml(result.errorMessage || 'No diff error recorded.')}</div>

<h2>Existing payload</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.existingPayload, null, 2) || 'null')}</pre>

<h2>Proposed / parsed payload</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.proposedPayload, null, 2) || 'null')}</pre>

<h2>Structured diff</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.diff, null, 2) || 'null')}</pre>

<h2>Confidence</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.confidence, null, 2) || 'null')}</pre>`,
  });
}

export function renderProposalUnavailablePage({ message }) {
  return adminShell({
    title: 'Review queue',
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Review queue</h1><div class="admin-sub">DB-backed proposal workflow</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderProposalsPage({ proposals }) {
  return adminShell({
    title: 'Review queue',
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Review queue</h1><div class="admin-sub">Human review only. No proposal action publishes verified content.</div></div><div><a class="logout" href="/admin/proposals/new">Create proposal</a> &middot; <a class="logout" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Entity</th><th>Key</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>
${proposals.length ? proposals.map(p => `<tr><td><span class="pill">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.entityType)}</td><td class="mono">${escapeHtml(p.entityKey)}</td><td class="mono">${escapeHtml(p.source?.originUrl || '')}</td><td>${escapeHtml(p.updatedAt || '')}</td><td><a href="/admin/proposals/${p.id}">View</a></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No content proposals yet', 'Create proposals manually or from reviewed diffs. Nothing publishes directly from the queue.', '<a href="/admin/proposals/new">Create proposal</a>')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderProposalCreatePage({ values = {}, error = null } = {}) {
  const payload = values.proposed_payload_json || '{\n  "source": {\n    "status": "needs_verification"\n  }\n}';
  return adminShell({
    title: 'Create proposal',
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Create proposal</h1><div class="admin-sub">Manual proposal only. This does not write to public content or mark anything verified.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="post" action="/admin/proposals/new">
  <label for="entity_type"><strong>Proposal type</strong></label>
  <select id="entity_type" name="entity_type" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${['subject', 'college', 'branch_profile'].map(type => `<option value="${type}"${values.entity_type === type ? ' selected' : ''}>${type}</option>`).join('')}
  </select>

  <label for="entity_key" style="display:block;margin-top:12px;"><strong>Entity key</strong></label>
  <input id="entity_key" name="entity_key" value="${escapeHtml(values.entity_key || '')}" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="stable id, college key, or branch code">

  <label for="source_id" style="display:block;margin-top:12px;"><strong>Source ID</strong> <span class="admin-sub">optional</span></label>
  <input id="source_id" name="source_id" value="${escapeHtml(values.source_id || '')}" inputmode="numeric" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="numeric source id">

  <label for="proposed_payload_json" style="display:block;margin-top:12px;"><strong>Proposed payload JSON</strong></label>
  <textarea id="proposed_payload_json" name="proposed_payload_json" required style="width:100%;min-height:280px;border:1px solid var(--line);border-radius:6px;padding:10px;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin-top:6px;">${escapeHtml(payload)}</textarea>

  <label for="note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong> <span class="admin-sub">optional</span></label>
  <textarea id="note" name="note" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:6px;padding:10px;font:inherit;margin-top:6px;">${escapeHtml(values.note || '')}</textarea>

  <button type="submit">Create proposal</button>
</form>`,
  });
}

export function renderProposalDetailPage({ proposal, exports = [], error = null }) {
  const payload = JSON.stringify(proposal.proposedPayload, null, 2);
  const diff = proposal.diff ? JSON.stringify(proposal.diff, null, 2) : 'No diff payload stored for this proposal.';
  const normalized = proposal.normalizedPayload ? JSON.stringify(proposal.normalizedPayload, null, 2) : 'No normalized payload stored yet.';
  const validationErrors = Array.isArray(proposal.validationErrors) ? proposal.validationErrors : [];
  const source = proposal.source;
  const validationPassed = proposal.validationStatus === 'passed';
  const exportEligible = validationPassed && proposal.status === 'approved_for_draft';
  const approvalEvents = (proposal.events || []).filter(event => event.action === 'approve_for_draft');
  const safetyWarnings = diffSafetyWarnings(proposal.diff);
  const safetyBlockingWarnings = blockingSafetyWarnings(proposal.diff);
  return adminShell({
    title: `Proposal ${proposal.id}`,
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Proposal ${escapeHtml(proposal.id)}</h1><div class="admin-sub">${escapeHtml(proposal.entityType)} / <span class="mono">${escapeHtml(proposal.entityKey)}</span></div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('proposal')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(proposal.status)}</div></div>
  <div class="metric"><div class="metric-label">Operation</div><div class="metric-value">${escapeHtml(diffOperationLabel(proposal.diff))}</div></div>
  <div class="metric"><div class="metric-label">Safety warnings</div><div class="metric-value ${safetyBlockingWarnings.length ? 'status-bad' : safetyWarnings.length ? 'status-warn' : 'status-ok'}">${escapeHtml(safetyWarnings.length)}</div></div>
  <div class="metric"><div class="metric-label">Created by</div><div class="metric-value">${escapeHtml(proposal.createdBy || '-')}</div></div>
  <div class="metric"><div class="metric-label">Reviewed by</div><div class="metric-value">${escapeHtml(proposal.reviewedBy || '-')}</div></div>
  <div class="metric"><div class="metric-label">Parse result</div><div class="metric-value">${proposal.parseResultId ? `<a href="/admin/parse-results/${escapeHtml(proposal.parseResultId)}">${escapeHtml(proposal.parseResultId)}</a>` : '-'}</div></div>
  <div class="metric"><div class="metric-label">Diff result</div><div class="metric-value">${proposal.diffResultId ? `<a href="/admin/diff-results/${escapeHtml(proposal.diffResultId)}">${escapeHtml(proposal.diffResultId)}</a>` : '-'}</div></div>
  <div class="metric"><div class="metric-label">Validation</div><div class="metric-value ${validationPassed ? 'status-ok' : 'status-bad'}">${escapeHtml(proposal.validationStatus || 'not_validated')}</div></div>
</section>

<h2>Safety warnings</h2>
${renderDiffSafetyWarnings(proposal.diff)}
${safetyBlockingWarnings.length ? '<div class="notice evidence-warning" style="margin-top:10px;">This proposal has blocking safety warnings. Approval is blocked by default and requires the explicit safety override checkbox plus a reviewer note.</div>' : ''}

<h2>Validation</h2>
<div class="action-box">
  <strong>Status: ${escapeHtml(proposal.validationStatus || 'not_validated')}</strong>
  <div class="admin-sub">Validation is review-only. It does not publish content, approve verification, or write JSON files.</div>
  <form method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/validate">
    <button type="submit">Re-run validation</button>
  </form>
</div>
${validationErrors.length ? `<div class="table-wrap"><table><thead><tr><th>Path</th><th>Message</th><th>Rule</th></tr></thead><tbody>${validationErrors.map(err => `<tr><td class="mono">${escapeHtml(err.path || '')}</td><td>${escapeHtml(err.message || '')}</td><td class="mono">${escapeHtml(err.keyword || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice">No validation errors stored.</div>'}

<h2>Approval for draft</h2>
<div class="proposal-actions">
  <form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Approve for draft/release preparation</strong>
    <div class="admin-sub">Requires passed validation. This does not publish, write live data files, mark content verified, or change CONTENT_SOURCE.</div>
    ${safetyBlockingWarnings.length ? `<div class="danger-copy">Blocking diff safety warnings detected. Check the override only after confirming the proposed payload is safe for draft preparation.</div>
    <label style="display:block;margin-top:10px;"><input type="checkbox" name="safety_override" value="yes"${validationPassed ? '' : ' disabled'}> I reviewed the blocking safety warnings and approve this safe merge/add for draft preparation.</label>` : ''}
    <textarea name="note" required placeholder="Record what was reviewed and why this can move to draft preparation."${validationPassed ? '' : ' disabled'}></textarea>
    <input type="hidden" name="action" value="approve_for_draft">
    <button type="submit"${validationPassed ? '' : ' disabled'}>Approve for draft</button>
    ${validationPassed ? '' : '<div class="notice" style="margin-top:10px;">Approval is blocked until proposal validation passes.</div>'}
  </form>
  <div class="action-box">
    <strong>Approval history</strong>
    ${approvalEvents.length ? `<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Reviewer</th><th>Note</th><th>When</th></tr></thead><tbody>${approvalEvents.map(event => `<tr><td>${escapeHtml(event.actor || '')}</td><td>${escapeHtml(event.note || '')}</td><td>${escapeHtml(event.createdAt || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice" style="margin-top:10px;">No draft approval has been recorded for this proposal.</div>'}
  </div>
</div>

<h2>Source evidence</h2>
<div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Retrieved</th><th>URL</th><th>Asset</th></tr></thead><tbody>
${source ? `<tr><td>${escapeHtml(source.sourceType || '')}</td><td><span class="pill">${escapeHtml(source.status || '')}</span></td><td>${escapeHtml(source.retrievedAt || '')}</td><td class="mono">${escapeHtml(source.originUrl || '')}</td><td class="mono">${escapeHtml(source.rawAssetPath || '')}</td></tr>` : '<tr><td colspan="5">No source linked to this proposal.</td></tr>'}
</tbody></table></div>

<h2>Proposed payload</h2>
<pre class="json-block">${escapeHtml(payload)}</pre>

<h2>Normalized payload</h2>
<pre class="json-block">${escapeHtml(normalized)}</pre>

<h2>Diff</h2>
<pre class="json-block">${escapeHtml(diff)}</pre>

<h2>Publishing export</h2>
<form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/export">
  <strong>Export proposal for review</strong>
  <div class="admin-sub">Writes review artifacts under tmp/proposal-exports only. It does not publish, mark verified, or write data files.</div>
  <button type="submit"${exportEligible ? '' : ' disabled'}>Export proposal for review</button>
  ${exportEligible ? '' : '<div class="notice" style="margin-top:10px;">Export is available only after validation passes and the proposal is approved_for_draft.</div>'}
</form>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Path</th><th>Created</th><th>By</th><th></th></tr></thead><tbody>
${exports.length ? exports.map(item => `<tr><td><span class="pill">${escapeHtml(item.validationStatus)}</span></td><td class="mono">${escapeHtml(item.exportPath)}</td><td>${escapeHtml(item.createdAt || '')}</td><td>${escapeHtml(item.createdBy || '')}</td><td><a href="/admin/proposal-exports/${escapeHtml(item.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="5">${emptyState('No exports yet', 'Export creates review artifacts in tmp/proposal-exports only. It does not modify data/ or dist/.')}</td></tr>`}
</tbody></table></div>

<h2>Review actions</h2>
<div class="proposal-actions">
  <form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Request changes</strong>
    <textarea name="note" required placeholder="Describe what needs to change."></textarea>
    <input type="hidden" name="action" value="request_changes">
    <button class="warn" type="submit">Request changes</button>
  </form>
  <form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Mark needs verification</strong>
    <textarea name="note" required placeholder="Required: record why this needs verification before further review."></textarea>
    <input type="hidden" name="action" value="mark_needs_verification">
    <button type="submit">Mark needs verification</button>
  </form>
  <form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Reject proposal</strong>
    <textarea name="note" required placeholder="Required: record why this proposal is being rejected."></textarea>
    <input type="hidden" name="action" value="reject">
    <button class="reject" type="submit">Reject</button>
  </form>
</div>

<h2>Review history</h2>
<div class="table-wrap"><table><thead><tr><th>Action</th><th>From</th><th>To</th><th>Actor</th><th>Note</th><th>When</th></tr></thead><tbody>
${proposal.events?.length ? proposal.events.map(e => `<tr><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.fromStatus || '')}</td><td>${escapeHtml(e.toStatus || '')}</td><td>${escapeHtml(e.actor || '')}</td><td>${escapeHtml(e.note || '')}</td><td>${escapeHtml(e.createdAt || '')}</td></tr>`).join('') : '<tr><td colspan="6">No review events yet.</td></tr>'}
</tbody></table></div>`,
  });
}

export function renderProposalExportDetailPage({ result, draftApplies = [], error = null }) {
  const patch = result.exportPayload?.patch || [];
  const replacement = result.exportPayload?.replacement || null;
  const validationErrors = Array.isArray(result.validationErrors) ? result.validationErrors : [];
  return adminShell({
    title: `Proposal export ${result.id}`,
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Proposal export ${escapeHtml(result.id)}</h1><div class="admin-sub">Review artifact only. This does not publish content or write data files.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('export')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Validation</div><div class="metric-value">${escapeHtml(result.validationStatus)}</div></div>
  <div class="metric"><div class="metric-label">Proposal</div><div class="metric-value"><a href="/admin/proposals/${escapeHtml(result.proposalId)}">${escapeHtml(result.proposalId)}</a></div></div>
  <div class="metric"><div class="metric-label">Created by</div><div class="metric-value">${escapeHtml(result.createdBy || '-')}</div></div>
</section>

<h2>Export path</h2>
<div class="notice mono">${escapeHtml(result.exportPath)}</div>

<h2>Draft workspace</h2>
<form class="action-box" method="post" action="/admin/proposal-exports/${escapeHtml(result.id)}/apply-draft">
  <strong>Apply to draft workspace</strong>
  <div class="admin-sub">Copies data/ into tmp/content-drafts and applies this export there only. NOT PUBLISHED.</div>
  <div class="notice" style="margin-top:10px;">Use this only after reviewing the export payload and patch preview. This creates or replaces a temporary draft workspace for this proposal; live JSON and dist remain untouched.</div>
  <button type="submit">Apply to draft workspace</button>
</form>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Path</th><th>Created</th><th>By</th><th></th></tr></thead><tbody>
${draftApplies.length ? draftApplies.map(item => `<tr><td><span class="pill">${escapeHtml(item.validationStatus)}</span></td><td class="mono">${escapeHtml(item.draftPath)}</td><td>${escapeHtml(item.createdAt || '')}</td><td>${escapeHtml(item.createdBy || '')}</td><td><a href="/admin/proposal-draft-applies/${escapeHtml(item.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="5">${emptyState('No draft applies yet', 'Apply a passed export to a temporary draft workspace for review. Live data files stay untouched.')}</td></tr>`}
</tbody></table></div>

<h2>Validation errors</h2>
${validationErrors.length ? `<div class="table-wrap"><table><thead><tr><th>Path</th><th>Message</th><th>Rule</th></tr></thead><tbody>${validationErrors.map(err => `<tr><td class="mono">${escapeHtml(err.path || '')}</td><td>${escapeHtml(err.message || '')}</td><td class="mono">${escapeHtml(err.keyword || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice">No validation errors stored.</div>'}

<h2>Patch preview</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(patch, null, 2))}</pre>

<h2>Replacement object</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(replacement, null, 2) || 'null')}</pre>

<h2>Full export payload</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(result.exportPayload, null, 2) || 'null')}</pre>`,
  });
}

export function renderProposalDraftApplyDetailPage({ result }) {
  const summary = result.summary || {};
  const validationErrors = Array.isArray(result.validationErrors) ? result.validationErrors : [];
  const changedFiles = Array.isArray(summary.changed_files) ? summary.changed_files : [];
  return adminShell({
    title: `Draft apply ${result.id}`,
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Draft apply ${escapeHtml(result.id)}</h1><div class="admin-sub">Draft workspace only. NOT PUBLISHED.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('draft')}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Validation</div><div class="metric-value">${escapeHtml(result.validationStatus)}</div></div>
  <div class="metric"><div class="metric-label">Proposal export</div><div class="metric-value"><a href="/admin/proposal-exports/${escapeHtml(result.proposalExportId)}">${escapeHtml(result.proposalExportId)}</a></div></div>
  <div class="metric"><div class="metric-label">Proposal</div><div class="metric-value"><a href="/admin/proposals/${escapeHtml(result.proposalId)}">${escapeHtml(result.proposalId)}</a></div></div>
  <div class="metric"><div class="metric-label">Revision</div><div class="metric-value">${summary.revision_id ? `<a href="/admin/revisions/${escapeHtml(summary.revision_id)}">${escapeHtml(summary.revision_id)}</a>` : '-'}</div></div>
  <div class="metric"><div class="metric-label">Created by</div><div class="metric-value">${escapeHtml(result.createdBy || '-')}</div></div>
</section>

<h2>Draft path</h2>
<div class="notice mono">${escapeHtml(result.draftPath)}</div>
<div class="notice">This workspace is under tmp/content-drafts and is not part of public output.</div>

<h2>Changed files</h2>
<div class="table-wrap"><table><thead><tr><th>File</th></tr></thead><tbody>
${changedFiles.length ? changedFiles.map(file => `<tr><td class="mono">${escapeHtml(file)}</td></tr>`).join('') : '<tr><td>No JSON file changes were detected in the draft.</td></tr>'}
</tbody></table></div>

<h2>Validation errors</h2>
${validationErrors.length ? `<div class="table-wrap"><table><thead><tr><th>Path</th><th>Message</th><th>Rule</th></tr></thead><tbody>${validationErrors.map(err => `<tr><td class="mono">${escapeHtml(err.path || '')}</td><td>${escapeHtml(err.message || '')}</td><td class="mono">${escapeHtml(err.keyword || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice">No validation errors stored.</div>'}

<h2>Summary</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(summary, null, 2) || '{}')}</pre>`,
  });
}

export function renderReleaseCandidateUnavailablePage({ message }) {
  return adminShell({
    title: 'Release candidates',
    active: 'release_candidates',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Releases' }],
    body: `
<div class="admin-top"><div><h1>Release candidates</h1><div class="admin-sub">DB-backed release preparation workflow</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderReleaseCandidatesPage({ releases }) {
  return adminShell({
    title: 'Release candidates',
    active: 'release_candidates',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Releases' }],
    body: `
<div class="admin-top"><div><h1>Release candidates</h1><div class="admin-sub">Group approved proposals for final human review. No live JSON writes or publishing happen here.</div></div><div><a class="logout" href="/admin/release-candidates/new">Create release</a> &middot; <a class="logout" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Title</th><th>Items</th><th>Exports</th><th>Draft applies</th><th>Revisions</th><th>Updated</th><th></th></tr></thead><tbody>
${releases.length ? releases.map(release => `<tr><td><span class="pill">${escapeHtml(release.status)}</span></td><td>${escapeHtml(release.title)}</td><td>${escapeHtml(release.itemCount)}</td><td>${escapeHtml(release.exportedCount)}</td><td>${escapeHtml(release.draftAppliedCount)}</td><td>${escapeHtml(release.revisionCount)}</td><td>${escapeHtml(release.updatedAt || '')}</td><td><a href="/admin/release-candidates/${escapeHtml(release.id)}">View</a></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No release candidates yet', 'Create a release candidate after proposals have been approved for draft preparation.', '<a href="/admin/release-candidates/new">Create release</a>')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderReleaseCandidateCreatePage({ values = {}, error = null } = {}) {
  return adminShell({
    title: 'Create release candidate',
    active: 'release_candidates',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/release-candidates', label: 'Releases' },
      { label: 'Create' },
    ],
    body: `
<div class="admin-top"><div><h1>Create release candidate</h1><div class="admin-sub">Release candidates are review groupings only. They do not publish or write live content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="post" action="/admin/release-candidates/new">
  <label for="title"><strong>Title</strong></label>
  <input id="title" name="title" value="${escapeHtml(values.title || '')}" required maxlength="255" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="July verified content draft">
  <div class="notice" style="margin-top:12px;">This creates an empty draft release candidate. Add only approved_for_draft proposals from the detail page.</div>
  <button type="submit">Create release candidate</button>
</form>`,
  });
}

function releaseItemActionForms({ release, item }) {
  const releaseId = escapeHtml(release.id);
  const itemId = escapeHtml(item.id);
  const exportAction = item.proposalExportId
    ? `<a href="/admin/proposal-exports/${escapeHtml(item.proposalExportId)}">Export ${escapeHtml(item.proposalExportId)}</a>`
    : `<form method="post" action="/admin/release-candidates/${releaseId}/items/${itemId}/export"><button type="submit">Export</button></form>`;
  const draftAction = item.draftApplyId
    ? `<a href="/admin/proposal-draft-applies/${escapeHtml(item.draftApplyId)}">Draft ${escapeHtml(item.draftApplyId)}</a>`
    : item.proposalExportId
      ? `<form method="post" action="/admin/release-candidates/${releaseId}/items/${itemId}/apply-draft"><button type="submit">Apply draft</button></form>`
      : '<span class="admin-sub">Export first</span>';
  const revisionAction = item.revisionId
    ? `<a href="/admin/revisions/${escapeHtml(item.revisionId)}">Revision ${escapeHtml(item.revisionId)}</a>`
    : '-';
  const removeAction = release.status === 'draft'
    ? `<form method="post" action="/admin/release-candidates/${releaseId}/items/${itemId}/remove"><button class="reject" type="submit">Remove</button></form>`
    : '';
  return { exportAction, draftAction, revisionAction, removeAction };
}

function renderReleaseReviewSummary(summary) {
  if (!summary) {
    return '<div class="notice">Review summary is unavailable. Generate the summary before marking a release ready.</div>';
  }
  const warnings = summary.warnings || [];
  const items = summary.items || [];
  const files = summary.files_that_would_change || [];
  const entityTypes = summary.entity_types_affected || [];
  return `
<section id="review-summary">
  <h2>Review summary</h2>
  <section class="metric-grid">
    <div class="metric"><div class="metric-label">Items</div><div class="metric-value">${escapeHtml(summary.item_count)}</div></div>
    <div class="metric"><div class="metric-label">Entity types</div><div class="metric-value">${escapeHtml(entityTypes.length)}</div></div>
    <div class="metric"><div class="metric-label">Files</div><div class="metric-value">${escapeHtml(files.length)}</div></div>
    <div class="metric"><div class="metric-label">Blocking warnings</div><div class="metric-value ${summary.has_blocking_warnings ? 'status-bad' : 'status-ok'}">${escapeHtml(summary.blocking_warning_count)}</div></div>
  </section>

  <h2>Warnings</h2>
  <div class="table-wrap"><table><thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Proposal</th><th>File</th></tr></thead><tbody>
  ${warnings.length ? warnings.map(warning => `<tr><td><span class="pill">${escapeHtml(warning.severity)}</span></td><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td><td>${warning.proposal_id ? `<a href="/admin/proposals/${escapeHtml(warning.proposal_id)}">${escapeHtml(warning.proposal_id)}</a>` : '-'}</td><td class="mono">${escapeHtml(warning.file || '')}</td></tr>`).join('') : '<tr><td colspan="5"><span class="status-ok">No blocking warnings.</span></td></tr>'}
  </tbody></table></div>

  <h2>Files that would change</h2>
  <div class="table-wrap"><table><thead><tr><th>File</th></tr></thead><tbody>
  ${files.length ? files.map(file => `<tr><td class="mono">${escapeHtml(file)}</td></tr>`).join('') : '<tr><td>No changed files detected yet.</td></tr>'}
  </tbody></table></div>

  <h2>Validation and provenance</h2>
  <div class="table-wrap"><table><thead><tr><th>Proposal</th><th>Entity</th><th>Proposal validation</th><th>Export</th><th>Draft</th><th>Revision</th></tr></thead><tbody>
  ${items.length ? items.map(item => `<tr><td><a href="${escapeHtml(item.links.proposal)}">Proposal ${escapeHtml(item.proposal_id)}</a></td><td>${escapeHtml(item.entity_type)}<br><span class="mono">${escapeHtml(item.entity_key)}</span></td><td><span class="pill">${escapeHtml(item.proposal_validation_status)}</span></td><td>${item.links.export ? `<a href="${escapeHtml(item.links.export)}">${escapeHtml(item.proposal_export_id)}</a><br><span class="pill">${escapeHtml(item.export_validation_status)}</span>` : '<span class="status-bad">missing</span>'}</td><td>${item.links.draft_apply ? `<a href="${escapeHtml(item.links.draft_apply)}">${escapeHtml(item.draft_apply_id)}</a><br><span class="pill">${escapeHtml(item.draft_validation_status)}</span>` : '<span class="status-bad">missing</span>'}</td><td>${item.links.revision ? `<a href="${escapeHtml(item.links.revision)}">${escapeHtml(item.revision_id)}</a>` : '<span class="status-bad">missing</span>'}</td></tr>`).join('') : '<tr><td colspan="6">No release items yet.</td></tr>'}
  </tbody></table></div>

  <h2>Combined diff summary</h2>
  <pre class="json-block">${escapeHtml(JSON.stringify(summary.combined_diff_summary || {}, null, 2))}</pre>
</section>`;
}

export function renderReleaseCandidateDetailPage({ release, approvedProposals = [], reviewSummary = null, error = null }) {
  if (!release) {
    return renderReleaseCandidateUnavailablePage({ message: error || 'Release candidate not found.' });
  }
  const items = release.items || [];
  const canEdit = release.status === 'draft';
  const canMarkReady = ['draft', 'applied_to_draft'].includes(release.status);
  const readyBlocked = !reviewSummary || Boolean(reviewSummary.has_blocking_warnings);
  return adminShell({
    title: `Release candidate ${release.id}`,
    active: 'release_candidates',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/release-candidates', label: 'Releases' },
      { label: `Release ${release.id}` },
    ],
    body: `
<div class="admin-top"><div><h1>${escapeHtml(release.title)}</h1><div class="admin-sub">Release candidate ${escapeHtml(release.id)}. NOT PUBLISHED.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('release')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(release.status)}</div></div>
  <div class="metric"><div class="metric-label">Items</div><div class="metric-value">${escapeHtml(release.itemCount)}</div></div>
  <div class="metric"><div class="metric-label">Exports</div><div class="metric-value">${escapeHtml(release.exportedCount)}</div></div>
  <div class="metric"><div class="metric-label">Draft applies</div><div class="metric-value">${escapeHtml(release.draftAppliedCount)}</div></div>
  <div class="metric"><div class="metric-label">Revisions</div><div class="metric-value">${escapeHtml(release.revisionCount)}</div></div>
</section>
<div class="notice" style="margin-top:14px;">Release candidates only group approved proposals and help create review artifacts. They do not write live data/*.json, modify dist/, publish, crawl, schedule jobs, or expose /api/ask.</div>

<h2>Generate review summary</h2>
<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(release.id)}/review-summary">
  <strong>Generate review summary</strong>
  <div class="admin-sub">Audits a combined release review summary with validation state, changed files, links, diffs, and blocking warnings. It does not write public content.</div>
  <button type="submit">Generate review summary</button>
</form>
${renderReleaseReviewSummary(reviewSummary)}

<h2>Apply plan</h2>
${release.status === 'ready_for_review' ? `<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(release.id)}/apply-plan">
  <strong>Generate apply plan</strong>
  <div class="admin-sub">Stores a final human-reviewable plan in MySQL and may write tmp convenience files. NOT APPLIED and NOT PUBLISHED.</div>
  <button type="submit"${reviewSummary?.has_blocking_warnings ? ' disabled' : ''}>Generate apply plan</button>
  ${reviewSummary?.has_blocking_warnings ? '<div class="notice" style="margin-top:10px;">Apply plan generation is blocked while review summary warnings exist.</div>' : ''}
</form>` : '<div class="notice">Apply plans can only be generated after the release candidate reaches ready_for_review.</div>'}

<h2>Partial live apply recovery</h2>
<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(release.id)}/recover-live-apply">
  <strong>Recover timeout/partial live apply</strong>
  <div class="admin-sub">Use only if a previous live apply request timed out after writing data/*.json but before a live apply record was created. This inspects the current live data file, searches for a backup, and creates recovery bookkeeping. It does not write data/*.json.</div>
  <label for="candidate_recovery_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="candidate_recovery_note" name="reviewer_note" required placeholder="Record the incident and why recovery is needed."></textarea>
  <label for="candidate_recovery_confirmation" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="candidate_recovery_confirmation" name="confirmation_phrase" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="RECOVER PARTIAL APPLY">
  <button type="submit">Recover partial apply</button>
  <div class="notice evidence-warning" style="margin-top:10px;">Type <span class="mono">RECOVER PARTIAL APPLY</span> exactly. This is for incident recovery only.</div>
</form>

<h2>Add approved proposal</h2>
${canEdit ? `<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(release.id)}/items">
  <label for="proposal_id"><strong>Approved proposal</strong></label>
  <select id="proposal_id" name="proposal_id" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    ${approvedProposals.map(proposal => `<option value="${escapeHtml(proposal.id)}">#${escapeHtml(proposal.id)} ${escapeHtml(proposal.entityType)} / ${escapeHtml(proposal.entityKey)}</option>`).join('')}
  </select>
  ${approvedProposals.length ? '<button type="submit">Add to release</button>' : '<div class="notice" style="margin-top:10px;">No approved_for_draft proposals are available to add.</div>'}
</form>` : '<div class="notice">Only draft release candidates can accept new items.</div>'}

<h2>Release readiness</h2>
${canMarkReady ? `<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(release.id)}/ready">
  <strong>Mark ready for review</strong>
  <div class="admin-sub">Requires a generated review summary with no blocking warnings. This records review readiness only; it does not publish.</div>
  <button type="submit"${items.length && !readyBlocked ? '' : ' disabled'}>Mark ready for review</button>
  ${readyBlocked ? '<div class="notice" style="margin-top:10px;">Ready for review is blocked until the release summary has no blocking warnings.</div>' : ''}
</form>` : '<div class="notice">This release candidate is no longer in a readiness-editing state.</div>'}

<h2>Items</h2>
<div class="table-wrap"><table><thead><tr><th>Proposal</th><th>Entity</th><th>Status</th><th>Validation</th><th>Export</th><th>Draft</th><th>Revision</th><th></th></tr></thead><tbody>
${items.length ? items.map(item => {
  const actions = releaseItemActionForms({ release, item });
  return `<tr><td><a href="/admin/proposals/${escapeHtml(item.proposalId)}">Proposal ${escapeHtml(item.proposalId)}</a></td><td>${escapeHtml(item.proposal?.entityType || '')}<br><span class="mono">${escapeHtml(item.proposal?.entityKey || '')}</span></td><td><span class="pill">${escapeHtml(item.proposal?.status || '')}</span></td><td><span class="pill">${escapeHtml(item.proposal?.validationStatus || '')}</span></td><td>${actions.exportAction}</td><td>${actions.draftAction}</td><td>${actions.revisionAction}</td><td>${actions.removeAction}</td></tr>`;
}).join('') : `<tr><td colspan="8">${emptyState('No proposals in this release', 'Add approved_for_draft proposals before marking the release ready for review.')}</td></tr>`}
</tbody></table></div>`,
  });
}

function verificationRows(verification) {
  const checks = verification?.checks || [];
  if (!checks.length) return '<tr><td colspan="4">No verification checks recorded.</td></tr>';
  return checks.map(check => `<tr><td class="mono">${escapeHtml(check.command)}</td><td><span class="pill">${escapeHtml(check.status)}</span></td><td>${escapeHtml(check.exit_code)}</td><td><details><summary>Output</summary><pre class="mono" style="white-space:pre-wrap;">${escapeHtml([check.stdout, check.stderr].filter(Boolean).join('\n'))}</pre></details></td></tr>`).join('');
}

export function renderReleaseApplyPlanDetailPage({
  plan,
  latestApply = null,
  confirmationPhrase = 'APPLY LIVE JSON',
  recoveryPhrase = 'RECOVER PARTIAL APPLY',
  error = null,
}) {
  if (!plan) {
    return renderReleaseCandidateUnavailablePage({ message: error || 'Release apply plan not found.' });
  }
  const warnings = plan.final_warnings || [];
  const changes = plan.changes || [];
  const activeApply = latestApply && !['rolled_back', 'failed'].includes(latestApply.status);
  const canApplyLive = plan.status === 'ready_for_review' && warnings.length === 0 && !activeApply;
  const storage = plan.storage || {};
  const tmpStatusClass = storage.tmp_artifact_status === 'available' ? 'status-ok' : 'status-warn';
  return adminShell({
    title: `Release apply plan ${plan.release_candidate_id}`,
    active: 'release_candidates',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/release-candidates', label: 'Releases' },
      { href: `/admin/release-candidates/${escapeHtml(plan.release_candidate_id)}`, label: `Release ${plan.release_candidate_id}` },
      { label: 'Apply plan' },
    ],
    body: `
<div class="admin-top"><div><h1>Release apply plan ${escapeHtml(plan.release_candidate_id)}</h1><div class="admin-sub">NOT APPLIED / NOT PUBLISHED. Review artifact only.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('release')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Release status</div><div class="metric-value">${escapeHtml(plan.status)}</div></div>
  <div class="metric"><div class="metric-label">Changes</div><div class="metric-value">${escapeHtml(changes.length)}</div></div>
  <div class="metric"><div class="metric-label">Warnings</div><div class="metric-value ${warnings.length ? 'status-bad' : 'status-ok'}">${escapeHtml(warnings.length)}</div></div>
  <div class="metric"><div class="metric-label">Generated</div><div class="metric-value" style="font-size:15px;">${escapeHtml(plan.generated_at || '')}</div></div>
  <div class="metric"><div class="metric-label">Canonical storage</div><div class="metric-value status-ok">DB</div></div>
  <div class="metric"><div class="metric-label">Tmp artifacts</div><div class="metric-value ${tmpStatusClass}">${escapeHtml(storage.tmp_artifact_status || 'unknown')}</div></div>
</section>
<div class="notice" style="margin-top:14px;">The canonical apply plan is stored in MySQL${storage.db_plan_id ? ` as <span class="mono">release_apply_plans #${escapeHtml(storage.db_plan_id)}</span>` : ''}. Tmp files under <span class="mono">${escapeHtml(plan.plan_path || 'tmp/release-apply-plans')}</span> are convenience artifacts only and may be missing after deploy cleanup without invalidating this page.</div>
${storage.tmp_artifact_message ? `<div class="notice evidence-warning" style="margin-top:10px;">${escapeHtml(storage.tmp_artifact_message)}</div>` : ''}
${plan.reconstructed_from_metadata ? `<div class="notice evidence-warning" style="margin-top:10px;"><strong>Recovered apply-plan view.</strong><br>This plan was reconstructed from durable release, proposal, export, and live-apply metadata because the original tmp artifact was unavailable.</div>` : ''}
${plan.recovered_context ? `<h2>Recovered apply context</h2><pre class="json-block">${escapeHtml(JSON.stringify(plan.recovered_context, null, 2))}</pre>` : ''}

<h2>Final live JSON apply</h2>
<form class="action-box danger-zone" method="post" action="/admin/release-apply-plans/${escapeHtml(plan.release_candidate_id)}/apply-live">
  <strong>Apply to live JSON</strong>
  <div class="danger-copy">Danger: this writes live data/*.json. The write request records a DB row first, creates backups, writes files, then stops for separate verification.</div>
  <div class="admin-sub">This does not run long build/retrieval/audit checks inside the write request. After files are written, open the live apply record and run verification from there. It does not auto-deploy, crawl, schedule jobs, or switch CONTENT_SOURCE.</div>
  ${latestApply ? `<div class="notice" style="margin-top:10px;">Latest apply: <a href="/admin/release-live-applies/${escapeHtml(latestApply.id)}">#${escapeHtml(latestApply.id)}</a> <span class="pill">${escapeHtml(latestApply.status)}</span></div>` : ''}
  <label for="reviewer_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="reviewer_note" name="reviewer_note" required placeholder="Record final human review and why this release can be applied."></textarea>
  <label for="confirmation_phrase" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="confirmation_phrase" name="confirmation_phrase" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="${escapeHtml(confirmationPhrase)}">
  <button class="reject" type="submit"${canApplyLive ? '' : ' disabled'}>Apply to live JSON</button>
  ${canApplyLive ? `<div class="notice evidence-warning" style="margin-top:10px;">Type <span class="mono">${escapeHtml(confirmationPhrase)}</span> exactly. After this write, run verification from the live apply page before any Git commit or deploy.</div>` : `<div class="notice" style="margin-top:10px;">Live apply is blocked unless the release is ready_for_review, the apply plan has zero warnings, and no active live apply already exists.${activeApply ? ' Use the latest live apply page to verify, recover, or roll back.' : ''}</div>`}
</form>

<h2>Recover partial apply</h2>
<form class="action-box" method="post" action="/admin/release-candidates/${escapeHtml(plan.release_candidate_id)}/recover-live-apply">
  <strong>Recover an already-written live JSON change</strong>
  <div class="admin-sub">Use only after a prior apply request timed out after writing live JSON. This inspects the live data file, searches for a backup directory, creates a recovery record, and makes verification/rollback state visible.</div>
  <label for="recovery_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="recovery_note" name="reviewer_note" required placeholder="Record why this partial apply is being recovered."></textarea>
  <label for="recovery_confirmation" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="recovery_confirmation" name="confirmation_phrase" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="${escapeHtml(recoveryPhrase)}">
  <button type="submit"${activeApply ? ' disabled' : ''}>Recover partial apply</button>
  <div class="notice evidence-warning" style="margin-top:10px;">Type <span class="mono">${escapeHtml(recoveryPhrase)}</span> exactly. This does not write data/*.json; it records the observed partial state.</div>
</form>

<h2>Ordered file changes</h2>
<div class="table-wrap"><table><thead><tr><th>Order</th><th>File</th><th>Operation</th><th>Entity</th><th>Proposal</th><th>Revision</th></tr></thead><tbody>
${plan.ordered_file_changes?.length ? plan.ordered_file_changes.map(change => `<tr><td>${escapeHtml(change.order)}</td><td class="mono">${escapeHtml(change.file)}</td><td><span class="pill">${escapeHtml(change.operation)}</span></td><td>${escapeHtml(change.entity_type)}<br><span class="mono">${escapeHtml(change.entity_key)}</span></td><td><a href="/admin/proposals/${escapeHtml(change.proposal_id)}">${escapeHtml(change.proposal_id)}</a></td><td>${change.revision_id ? `<a href="/admin/revisions/${escapeHtml(change.revision_id)}">${escapeHtml(change.revision_id)}</a>` : '-'}</td></tr>`).join('') : '<tr><td colspan="6">No changes in this plan.</td></tr>'}
</tbody></table></div>

<h2>Warnings</h2>
<div class="table-wrap"><table><thead><tr><th>Code</th><th>Message</th></tr></thead><tbody>
${warnings.length ? warnings.map(warning => `<tr><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td></tr>`).join('') : '<tr><td colspan="2"><span class="status-ok">No final warnings.</span></td></tr>'}
</tbody></table></div>

<h2>Before / after entity preview</h2>
${changes.map(change => `<div class="action-box"><strong>${escapeHtml(change.operation)} ${escapeHtml(change.entity_type)} / <span class="mono">${escapeHtml(change.entity_key)}</span></strong><div class="admin-sub">${escapeHtml(change.file)}</div><h2>Before</h2><pre class="json-block">${escapeHtml(JSON.stringify(change.before_json, null, 2) || 'null')}</pre><h2>After</h2><pre class="json-block">${escapeHtml(JSON.stringify(change.after_json, null, 2) || 'null')}</pre></div>`).join('') || '<div class="notice">No entity previews available.</div>'}

<h2>Combined patch</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(plan.combined_patch || [], null, 2))}</pre>

<h2>Rollback notes</h2>
<div class="notice">Rollback notes are written to <span class="mono">${escapeHtml(plan.rollback_notes_file || 'rollback-notes.md')}</span> inside the apply-plan folder. Because this plan is not applied, rollback means no production action is needed unless a human later applies these changes manually.</div>`,
  });
}

export function renderReleaseLiveApplyDetailPage({ result, rollbackPhrase = 'ROLLBACK LIVE JSON', error = null }) {
  if (!result) {
    return renderReleaseCandidateUnavailablePage({ message: error || 'Release live apply result not found.' });
  }
  const canVerify = ['files_written', 'verification_running', 'partial_applied', 'recovered_applied', 'manual_rollback_required', 'published_pending_deploy', 'published_pending_deploy_recovered'].includes(result.status);
  const canRollback = Boolean(result.backupExists && result.backupPath && ['files_written', 'partial_applied', 'recovered_applied', 'published_pending_deploy', 'published_pending_deploy_recovered', 'failed'].includes(result.status));
  const manualRollback = !result.backupExists && result.changedFiles.length > 0 && [
    'files_written',
    'partial_applied',
    'recovered_applied',
    'manual_rollback_required',
    'published_pending_deploy',
    'published_pending_deploy_recovered',
    'failed',
  ].includes(result.status);
  return adminShell({
    title: `Live apply ${result.id}`,
    active: 'release_candidates',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/release-candidates', label: 'Releases' },
      { href: `/admin/release-candidates/${escapeHtml(result.releaseCandidateId)}`, label: `Release ${result.releaseCandidateId}` },
      { label: `Live apply ${result.id}` },
    ],
    body: `
<div class="admin-top"><div><h1>Live apply ${escapeHtml(result.id)}</h1><div class="admin-sub">Manual deploy pending. No auto-deploy was triggered by this action.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Phase</div><div class="metric-value">${escapeHtml(result.phase || 'unknown')}</div></div>
  <div class="metric"><div class="metric-label">Release</div><div class="metric-value"><a href="/admin/release-candidates/${escapeHtml(result.releaseCandidateId)}">${escapeHtml(result.releaseCandidateId)}</a></div></div>
  <div class="metric"><div class="metric-label">Files changed</div><div class="metric-value">${escapeHtml(result.changedFiles.length)}</div></div>
  <div class="metric"><div class="metric-label">Verification</div><div class="metric-value ${result.verification?.status === 'passed' ? 'status-ok' : 'status-bad'}">${escapeHtml(result.verification?.status || 'unknown')}</div></div>
  <div class="metric"><div class="metric-label">Backup</div><div class="metric-value ${result.backupExists ? 'status-ok' : 'status-bad'}">${escapeHtml(result.backupExists ? 'yes' : 'no')}</div></div>
</section>
<div class="notice" style="margin-top:14px;">Live JSON is considered safely ready for Git review only after status is <span class="mono">published_pending_deploy</span> or <span class="mono">published_pending_deploy_recovered</span> and verification is passed. This page does not deploy.</div>
${result.errorMessage ? `<div class="error">${escapeHtml(result.errorMessage)}</div>` : ''}

<h2>Changed files</h2>
<div class="table-wrap"><table><thead><tr><th>File</th></tr></thead><tbody>
${result.changedFiles.length ? result.changedFiles.map(file => `<tr><td class="mono">${escapeHtml(file)}</td></tr>`).join('') : '<tr><td>No files recorded.</td></tr>'}
</tbody></table></div>

<h2>Backup</h2>
<div class="notice mono">${result.backupPath ? escapeHtml(result.backupPath) : 'No backup path recorded.'}</div>
${manualRollback ? `<div class="notice evidence-warning" style="margin-top:10px;"><strong>Manual rollback required.</strong><br>Automatic rollback is unavailable because no backup path was found. Changed file(s): <span class="mono">${escapeHtml(result.changedFiles.join(', '))}</span>. Recovery details identify the applied entity keys.</div>` : ''}

<h2>Recovery details</h2>
${result.recovery ? `<pre class="json-block">${escapeHtml(JSON.stringify(result.recovery, null, 2))}</pre>` : '<div class="notice">No recovery metadata recorded.</div>'}

<h2>Verification output</h2>
<div class="table-wrap"><table><thead><tr><th>Command</th><th>Status</th><th>Exit</th><th>Output</th></tr></thead><tbody>
${verificationRows(result.verification)}
</tbody></table></div>

<h2>Run / resume verification</h2>
<form class="action-box" method="post" action="/admin/release-live-applies/${escapeHtml(result.id)}/verify">
  <strong>Start background build, retrieval, and site audit checks</strong>
  <div class="admin-sub">Starts a detached verification worker and returns immediately. Refresh this page to watch status. If the worker is interrupted, run verification again; the DB row remains recorded.</div>
  <button type="submit"${canVerify ? '' : ' disabled'}>Start verification</button>
  ${canVerify ? '<div class="notice evidence-warning" style="margin-top:10px;">Do not commit or deploy until verification passes and the status is published_pending_deploy or published_pending_deploy_recovered.</div>' : '<div class="notice" style="margin-top:10px;">Verification is unavailable for this status.</div>'}
</form>

<h2>Rollback</h2>
<form class="action-box" method="post" action="/admin/release-live-applies/${escapeHtml(result.id)}/rollback">
  <strong>Restore backed-up JSON files</strong>
  <div class="admin-sub">Allowed only when a backup path exists. Restores files from backup and reruns verification. It does not commit, push, or deploy.</div>
  <label for="rollback_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="rollback_note" name="reviewer_note" required placeholder="Record why this live JSON apply is being rolled back."${canRollback ? '' : ' disabled'}></textarea>
  <label for="rollback_confirmation" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="rollback_confirmation" name="confirmation_phrase" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="${escapeHtml(rollbackPhrase)}"${canRollback ? '' : ' disabled'}>
  <button class="reject" type="submit"${canRollback ? '' : ' disabled'}>Rollback live JSON apply</button>
  ${canRollback ? `<div class="notice" style="margin-top:10px;">Type <span class="mono">${escapeHtml(rollbackPhrase)}</span> exactly.</div>` : '<div class="notice" style="margin-top:10px;">Automatic rollback is unavailable for this status or no backup path is recorded.</div>'}
</form>`,
  });
}

function revisionEntityHref(revision) {
  return `/admin/revisions/entity/${encodeURIComponent(revision.entityType)}/${encodeURIComponent(revision.entityKey)}`;
}

function renderRevisionProvenanceRows(revision) {
  return `
<tr><td>Proposal</td><td>${revision.proposalId ? `<a href="/admin/proposals/${escapeHtml(revision.proposalId)}">${escapeHtml(revision.proposalId)}</a>` : '-'}</td></tr>
<tr><td>Export</td><td>${revision.exportId ? `<a href="/admin/proposal-exports/${escapeHtml(revision.exportId)}">${escapeHtml(revision.exportId)}</a>` : '-'}</td></tr>
<tr><td>Draft apply</td><td>${revision.draftApplyId ? `<a href="/admin/proposal-draft-applies/${escapeHtml(revision.draftApplyId)}">${escapeHtml(revision.draftApplyId)}</a>` : '-'}</td></tr>
<tr><td>Parent revision</td><td>${revision.parentRevisionId ? `<a href="/admin/revisions/${escapeHtml(revision.parentRevisionId)}">${escapeHtml(revision.parentRevisionId)}</a>` : '-'}</td></tr>
<tr><td>Source status</td><td><span class="pill">${escapeHtml(revision.sourceStatus)}</span></td></tr>`;
}

function renderRevisionCompareForm({ revision, revisions }) {
  const options = revisions
    .filter(item => item.id !== revision.id)
    .map(item => `<option value="${escapeHtml(item.id)}">#${escapeHtml(item.revisionNumber)} (${escapeHtml(item.createdAt || '')})</option>`)
    .join('');
  if (!options) return '<div class="notice">No other revision exists for this entity yet.</div>';
  return `
<form class="action-box" method="get" action="/admin/revisions/compare">
  <strong>Compare revisions</strong>
  <div class="admin-sub">Compares immutable JSON snapshots. This does not publish or write content.</div>
  <input type="hidden" name="left" value="${escapeHtml(revision.id)}">
  <label for="right_revision" style="display:block;margin-top:12px;"><strong>Compare with</strong></label>
  <select id="right_revision" name="right" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">${options}</select>
  <button type="submit">Compare</button>
</form>`;
}

export function renderRevisionsPage({ revisions }) {
  return adminShell({
    title: 'Content revisions',
    active: 'revisions',
    body: `
<div class="admin-top"><div><h1>Content revisions</h1><div class="admin-sub">Immutable revision history. Review-only; no publishing or JSON writes.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Entity</th><th>Key</th><th>Latest revision</th><th>Status</th><th>Draft</th><th>Created</th><th></th></tr></thead><tbody>
${revisions.length ? revisions.map(revision => `<tr><td>${escapeHtml(revision.entityType)}</td><td class="mono">${escapeHtml(revision.entityKey)}</td><td><a href="/admin/revisions/${escapeHtml(revision.id)}">#${escapeHtml(revision.revisionNumber)}</a></td><td><span class="pill">${escapeHtml(revision.sourceStatus)}</span></td><td>${revision.draftApplyId ? `<a href="/admin/proposal-draft-applies/${escapeHtml(revision.draftApplyId)}">${escapeHtml(revision.draftApplyId)}</a>` : '-'}</td><td>${escapeHtml(revision.createdAt || '')}</td><td><a href="${revisionEntityHref(revision)}">History</a></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No content revisions yet', 'Revisions appear after a successful draft apply creates an immutable snapshot. They are not public publishing events.')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderRevisionEntityPage({ entityType, entityKey, revisions }) {
  return adminShell({
    title: 'Entity revisions',
    active: 'revisions',
    body: `
<div class="admin-top"><div><h1>Entity revisions</h1><div class="admin-sub">${escapeHtml(entityType)} / <span class="mono">${escapeHtml(entityKey)}</span></div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="table-wrap"><table><thead><tr><th>Revision</th><th>Status</th><th>Proposal</th><th>Export</th><th>Draft</th><th>Parent</th><th>Created</th><th></th></tr></thead><tbody>
${revisions.length ? revisions.map(revision => `<tr><td><a href="/admin/revisions/${escapeHtml(revision.id)}">#${escapeHtml(revision.revisionNumber)}</a></td><td><span class="pill">${escapeHtml(revision.sourceStatus)}</span></td><td>${revision.proposalId ? `<a href="/admin/proposals/${escapeHtml(revision.proposalId)}">${escapeHtml(revision.proposalId)}</a>` : '-'}</td><td>${revision.exportId ? `<a href="/admin/proposal-exports/${escapeHtml(revision.exportId)}">${escapeHtml(revision.exportId)}</a>` : '-'}</td><td>${revision.draftApplyId ? `<a href="/admin/proposal-draft-applies/${escapeHtml(revision.draftApplyId)}">${escapeHtml(revision.draftApplyId)}</a>` : '-'}</td><td>${revision.parentRevisionId ? `<a href="/admin/revisions/${escapeHtml(revision.parentRevisionId)}">${escapeHtml(revision.parentRevisionId)}</a>` : '-'}</td><td>${escapeHtml(revision.createdAt || '')}</td><td>${revision.parentRevisionId ? `<a href="/admin/revisions/compare?left=${escapeHtml(revision.parentRevisionId)}&right=${escapeHtml(revision.id)}">Compare to parent</a>` : ''}</td></tr>`).join('') : '<tr><td colspan="8">No revisions for this entity.</td></tr>'}
</tbody></table></div>`,
  });
}

export function renderRevisionDetailPage({ revision, revisions = [] }) {
  return adminShell({
    title: `Revision ${revision.id}`,
    active: 'revisions',
    body: `
<div class="admin-top"><div><h1>Revision ${escapeHtml(revision.id)}</h1><div class="admin-sub">${escapeHtml(revision.entityType)} / <span class="mono">${escapeHtml(revision.entityKey)}</span></div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('revision')}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Revision</div><div class="metric-value">#${escapeHtml(revision.revisionNumber)}</div></div>
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(revision.sourceStatus)}</div></div>
  <div class="metric"><div class="metric-label">Created by</div><div class="metric-value">${escapeHtml(revision.createdBy || '-')}</div></div>
  <div class="metric"><div class="metric-label">History</div><div class="metric-value"><a href="${revisionEntityHref(revision)}">View</a></div></div>
</section>

<h2>Provenance</h2>
<div class="table-wrap"><table><thead><tr><th>Type</th><th>Reference</th></tr></thead><tbody>${renderRevisionProvenanceRows(revision)}</tbody></table></div>

<h2>Compare</h2>
${renderRevisionCompareForm({ revision, revisions })}

<h2>Content snapshot</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(revision.content, null, 2) || 'null')}</pre>`,
  });
}

export function renderRevisionComparisonPage({ comparison }) {
  const { left, right, diff } = comparison;
  return adminShell({
    title: 'Revision comparison',
    active: 'revisions',
    body: `
<div class="admin-top"><div><h1>Revision comparison</h1><div class="admin-sub">${escapeHtml(left.entityType)} / <span class="mono">${escapeHtml(left.entityKey)}</span></div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<section class="metric-grid">
  <div class="metric"><div class="metric-label">From</div><div class="metric-value"><a href="/admin/revisions/${escapeHtml(left.id)}">#${escapeHtml(left.revisionNumber)}</a></div></div>
  <div class="metric"><div class="metric-label">To</div><div class="metric-value"><a href="/admin/revisions/${escapeHtml(right.id)}">#${escapeHtml(right.revisionNumber)}</a></div></div>
  <div class="metric"><div class="metric-label">Changes</div><div class="metric-value">${escapeHtml(diff.change_count)}</div></div>
  <div class="metric"><div class="metric-label">Entity history</div><div class="metric-value"><a href="${revisionEntityHref(right)}">View</a></div></div>
</section>

<h2>Changes</h2>
<div class="table-wrap"><table><thead><tr><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>
${diff.changes.length ? diff.changes.map(change => `<tr><td class="mono">${escapeHtml(change.path)}</td><td><pre class="mono">${escapeHtml(JSON.stringify(change.before, null, 2))}</pre></td><td><pre class="mono">${escapeHtml(JSON.stringify(change.after, null, 2))}</pre></td></tr>`).join('') : '<tr><td colspan="3">No JSON differences.</td></tr>'}
</tbody></table></div>

<h2>Structured diff</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(diff, null, 2) || 'null')}</pre>`,
  });
}
