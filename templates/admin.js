import { isAuditStylePromotionSubject } from '../lib/verification-review.js';
import { hasElectiveOptionAmbiguity } from '../lib/verified-promotion-guardrails.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function auditPublicationWarning(subject = {}) {
  if (!isAuditStylePromotionSubject(subject)) return '';
  return `<div class="notice evidence-warning" style="margin-top:10px;"><strong>Public usefulness review required.</strong> Mandatory non-credit, audit, internship, project, and zero-credit rows need an explicit publication decision. Verified course existence does not automatically mean the page is useful enough to publish.</div>`;
}

function hasWarningCode(warnings = [], code) {
  return warnings.some(warning => warning.code === code);
}

// Persistent, hard-to-miss reconciliation banner (injected into every admin
// page by routes/admin.js's res.send wrapper -- see createAdminRouter).
// Replaces the old silent manual_git_commit_required audit flag: this makes
// "N live-applied change(s) not yet in git / not yet pushed" impossible to
// scroll past.
export function renderPendingGitPushBanner(summary) {
  const pendingPush = summary?.pendingPush || [];
  const commitFailed = summary?.commitFailed || [];
  if (!pendingPush.length && !commitFailed.length) return '';

  const failedBlock = commitFailed.length ? `
<div class="notice" style="margin:0 0 10px;border:2px solid var(--bad);background:#fff5f5;color:var(--bad);">
  <strong>${escapeHtml(commitFailed.length)} live-applied change(s) FAILED to commit to git automatically.</strong>
  <div>Data is live but NOT recorded in git at all. A redeploy from git will silently revert these. Reconcile manually now (see README "Live-apply git reconciliation"), then run <span class="mono">scripts/reconcile-live-apply.js</span> with the id(s) below.</div>
  <ul style="margin:8px 0 0;padding-left:18px;">
  ${commitFailed.map(row => `<li><a href="/admin/release-live-applies/${escapeHtml(row.id)}" style="color:var(--bad);">Live apply ${escapeHtml(row.id)}</a> (release ${escapeHtml(row.releaseCandidateId)}): <span class="mono">${escapeHtml((row.changedFiles || []).join(', '))}</span> -- ${escapeHtml(row.gitCommitError || 'unknown error')}</li>`).join('')}
  </ul>
</div>` : '';

  const pendingBlock = pendingPush.length ? `
<div class="notice evidence-warning" style="margin:0 0 10px;">
  <strong>${escapeHtml(pendingPush.length)} live-applied change(s) committed locally, awaiting git push to origin.</strong>
  <div>Push these to origin before the next redeploy, or the redeploy will not include them (it won't revert them either -- they're committed -- but origin/main and this server will disagree until pushed).</div>
  <ul style="margin:8px 0 0;padding-left:18px;">
  ${pendingPush.map(row => `<li><a href="/admin/release-live-applies/${escapeHtml(row.id)}">Live apply ${escapeHtml(row.id)}</a> (release ${escapeHtml(row.releaseCandidateId)}): <span class="mono">${escapeHtml(row.gitCommitSha || '').slice(0, 12)}</span> -- <span class="mono">${escapeHtml((row.changedFiles || []).join(', '))}</span></li>`).join('')}
  </ul>
</div>` : '';

  return `<div style="margin-bottom:18px;">${failedBlock}${pendingBlock}</div>`;
}

function canonicalSubjectPath(subject, fallbackId = '') {
  if (!subject) return '';
  const slug = subject.seo?.slug || subject.id || fallbackId;
  return slug ? `/${slug}/` : '';
}

function canonicalSubjectPathForChange(change = {}) {
  if (change.entity_type !== 'subject') return '';
  return canonicalSubjectPath(change.after_json, change.entity_key);
}

function canonicalSubjectPathForProposal(proposal = {}) {
  if (proposal.entityType !== 'subject') return '';
  return canonicalSubjectPath(proposal.normalizedPayload || proposal.proposedPayload, proposal.entityKey);
}

function canonicalSubjectPathRows(changes = []) {
  const rows = changes
    .filter(change => change.entity_type === 'subject')
    .map(change => ({
      entityKey: change.entity_key,
      path: canonicalSubjectPathForChange(change),
      status: change.after_json?.source?.status || '',
    }))
    .filter(row => row.path);

  if (!rows.length) return '<tr><td colspan="3">No subject canonical URLs recorded.</td></tr>';
  return rows.map(row => `<tr><td class="mono">${escapeHtml(row.entityKey)}</td><td class="mono">${escapeHtml(row.path)}</td><td><span class="pill">${escapeHtml(row.status)}</span></td></tr>`).join('');
}

function adminShell({ title, active = 'dashboard', breadcrumbs = [], body }) {
  const primaryNav = [
    [['dashboard'], '/admin/', 'Today'],
    [['content_new'], '/admin/content/new', 'Start an update'],
    [['review', 'proposals', 'verification_reviews'], '/admin/review', 'Review'],
    [['release_candidates'], '/admin/release-candidates', 'Publish'],
    [['subjects'], '/admin/subjects', 'Content'],
  ];
  const libraryNav = [
    ['freshness', '/admin/freshness', 'Freshness'],
    ['colleges', '/admin/colleges', 'Colleges'],
    ['branch_profiles', '/admin/branch-profiles', 'Branch profiles'],
  ];
  const advancedNav = [
    ['checks', '/admin/checks', 'System checks'],
    ['sources', '/admin/sources', 'Source registry'],
    ['assets', '/admin/assets', 'Source assets'],
    ['pipeline_runs', '/admin/pipeline-runs', 'Pipeline runs'],
    ['parse_results', '/admin/parse-results', 'Parse results'],
    ['extraction_results', '/admin/extraction-results', 'Extractions'],
    ['diff_results', '/admin/diff-results', 'Diffs'],
    ['source_evidence', '/admin/source-evidence', 'Published evidence'],
    ['revisions', '/admin/revisions', 'Revision history'],
    ['cleanup', '/admin/cleanup', 'Cleanup'],
  ];
  if (String(process.env.ADMIN_TEST_TOOLS || '').trim().toLowerCase() === 'true') {
    advancedNav.push(['test_tools', '/admin/test-tools', 'Test tools']);
  }
  const current = keys => keys.includes(active);
  const libraryOpen = libraryNav.some(([key]) => key === active);
  const advancedOpen = advancedNav.some(([key]) => key === active);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} - JNTUStack Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="/theme-toggle.js"></script>
<link rel="stylesheet" href="/teal-brand.css">
<style>
/* Extend the public teal token system for the private operations interface.
   --warn/--bad/--ok map to review, failure, and verified states; --bad stays
   admin-local because public pages do not expose destructive controls. */
:root{--ink:var(--text);--line:var(--border);--paper:var(--bg);--panel:var(--surface);--warn:var(--draft);--bad:#D6455B;--ok:var(--green);}
html[data-theme="dark"]{--bad:#E5677D;}
*{box-sizing:border-box}body{margin:0;font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--ink);background:var(--paper);font-size:14px;line-height:1.45}
a{color:inherit}.admin-frame{display:grid;grid-template-columns:236px 1fr;min-height:100vh}.admin-rail{background:var(--panel);color:var(--ink);padding:18px 14px;position:sticky;top:0;height:100vh;border-right:1px solid var(--line);overflow:auto}
.admin-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px;margin-bottom:4px}.admin-source{font-size:11.5px;font-family:"IBM Plex Mono",monospace;letter-spacing:.06em;color:var(--muted);margin-bottom:20px;text-transform:uppercase}
.admin-nav{display:grid;gap:4px;font-size:13px}.admin-nav a{display:block;text-decoration:none;padding:9px 10px;border-radius:8px;color:var(--muted)}
.admin-nav a[aria-current="page"]{background:var(--accent-soft);color:var(--accent);font-weight:600}.admin-nav a:hover{color:var(--accent)}
.admin-nav-create{background:var(--accent)!important;color:var(--accent-ink)!important;font-weight:700;text-align:center;margin:6px 0 8px}.admin-nav-create:hover{filter:brightness(1.05)}
.admin-nav-group{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}.admin-nav-group summary{cursor:pointer;list-style:none;padding:8px 10px;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:10px;text-transform:uppercase;letter-spacing:.09em}.admin-nav-group summary::-webkit-details-marker{display:none}.admin-nav-group summary::after{content:'+';float:right}.admin-nav-group[open] summary::after{content:'\\2212'}.admin-nav-group>div{display:grid;gap:2px;padding-bottom:4px}.admin-nav-group a{padding:7px 10px 7px 18px;font-size:12.5px}
.admin-main{padding:24px 30px;min-width:0;max-width:1280px;width:100%}.admin-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.admin-top-right{display:flex;align-items:center;gap:.8rem;font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--muted)}
h1{font-size:23px;margin:0;letter-spacing:-.02em}h2{font-size:17px;margin:26px 0 10px}.admin-sub{color:var(--muted);font-size:12.5px;margin-top:2px}.logout{font-size:13px;color:var(--muted)}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.metric-label{font-family:"IBM Plex Mono",monospace;font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.metric-value{font-size:26px;font-weight:700;margin-top:6px}
.status-ok{color:var(--ok)}.status-warn{color:var(--warn)}.status-bad{color:var(--bad)}
.table-wrap{overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;min-width:760px}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-family:"IBM Plex Mono",monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);background:var(--bg)}
tr:last-child td{border-bottom:0}.mono{font-family:"IBM Plex Mono",monospace;font-size:12px}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:12px;background:var(--bg)}
.proposal-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:16px}.action-box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}.action-box textarea{width:100%;min-height:74px;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;margin-top:8px;background:var(--bg);color:var(--ink)}.action-box button{margin-top:8px;padding:8px 10px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;cursor:pointer}.action-box button.reject{background:var(--bad);color:#fff}.action-box button.warn{background:var(--warn);color:var(--accent-ink)}.danger-zone{border:2px solid var(--bad);background:var(--panel)}.danger-zone strong{color:var(--bad)}.danger-copy{border:1px solid var(--bad);background:var(--panel);color:var(--bad);border-radius:8px;padding:10px;margin-top:10px;font-weight:700}.json-block{white-space:pre-wrap;overflow:auto;background:#0E1211;color:#8FE3D3;border-radius:12px;padding:12px;font-size:12px;line-height:1.55;font-family:"IBM Plex Mono",monospace}.notice{border:1px solid var(--line);background:var(--panel);padding:12px;border-radius:12px;color:var(--muted)}.evidence-warning{border-color:var(--warn);background:var(--draft-bg);color:var(--warn)}.empty-state{padding:18px;color:var(--muted)}.empty-state strong{display:block;color:var(--ink);margin-bottom:4px}.breadcrumbs{font-size:12px;color:var(--muted);margin-bottom:12px}.breadcrumbs a{color:var(--muted);text-decoration:none}.breadcrumbs a:hover{text-decoration:underline}.workflow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 0}.workflow a,.workflow span{border:1px solid var(--line);border-radius:999px;padding:4px 10px;text-decoration:none;background:var(--panel);color:var(--muted);font-size:12px;font-family:"IBM Plex Mono",monospace}.workflow a:hover{border-color:var(--accent);color:var(--accent)}.workflow [aria-current="step"]{background:var(--accent-soft);color:var(--accent);border-color:var(--green-border)}
.login-page{min-height:100vh;display:grid;place-items:center;padding:20px}.login-box{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px}
.login-box h1{margin-bottom:4px}.login-box label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-top:14px}.login-box input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;margin-top:5px;font:inherit;background:var(--bg);color:var(--ink)}.login-box button{width:100%;margin-top:18px;padding:10px 12px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;cursor:pointer}.error{border:1px solid var(--bad);color:var(--bad);background:var(--panel);border-radius:8px;padding:9px;margin:12px 0 0}
.content-desk-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end;padding:8px 0 20px;border-bottom:1px solid var(--line);margin-bottom:20px}.content-desk-kicker{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.12em;color:var(--accent);font-weight:600}.content-desk-head h1{font-size:32px;line-height:1.05;margin:.35rem 0 .55rem;max-width:680px}.content-desk-head p{margin:0;color:var(--muted);max-width:68ch}.primary-action{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-radius:9px;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:700;white-space:nowrap;border:0;cursor:pointer}.secondary-action{display:inline-flex;align-items:center;justify-content:center;padding:9px 12px;border:1px solid var(--line);border-radius:9px;text-decoration:none;font-weight:600;background:var(--panel)}
.proof-rail{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel);margin:0 0 22px}.proof-step{position:relative;padding:16px;min-height:130px;border-right:1px solid var(--line)}.proof-step:last-child{border-right:0}.proof-step-number{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.1em;color:var(--accent);font-weight:600}.proof-step h2{font-size:15px;margin:18px 0 4px}.proof-step p{font-size:12.5px;color:var(--muted);margin:0 0 10px}.proof-step a{font-size:12.5px;font-weight:700;color:var(--accent)}.proof-count{position:absolute;top:12px;right:14px;min-width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-family:"IBM Plex Mono",monospace;font-weight:600}.proof-step--warn{background:var(--draft-bg)}
.desk-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:18px;align-items:start}.desk-panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}.desk-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line)}.desk-panel-head h2{font-size:16px;margin:0}.desk-panel-head a{font-size:12px;color:var(--accent)}.attention-list{display:grid}.attention-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:11px;align-items:start;padding:13px 16px;border-bottom:1px solid var(--line);text-decoration:none}.attention-item:last-child{border-bottom:0}.attention-item:hover{background:var(--accent-soft)}.attention-mark{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700}.attention-item--warn .attention-mark{background:var(--draft-bg);color:var(--warn)}.attention-copy strong{display:block}.attention-copy span{display:block;color:var(--muted);font-size:12px;margin-top:2px}.attention-go{color:var(--accent);font-weight:700}.desk-status{padding:15px 16px}.desk-status-row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--line)}.desk-status-row:last-child{border-bottom:0}.desk-status-row span{color:var(--muted)}
.intake-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.intake-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:18px}.intake-card h2{font-size:18px;margin:0 0 5px}.intake-card>p{color:var(--muted);margin:0 0 16px}.intake-card>.primary-action{margin-top:14px}.field{display:block;margin-top:12px}.field>span{display:block;font-weight:600;margin-bottom:6px}.field input,.field select,.field textarea{display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}.safety-note{display:flex;gap:9px;margin-top:14px;padding:10px;border-radius:9px;background:var(--accent-soft);color:var(--text-2);font-size:12.5px}.safety-note::before{content:'\\2713';color:var(--accent);font-weight:700}.advanced-panel{margin-top:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.advanced-panel>summary{cursor:pointer;padding:12px 14px;font-weight:600}.advanced-panel>div{padding:0 14px 14px}.queue-empty{padding:24px;text-align:center;color:var(--muted)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media(max-width:900px){.proof-rail{grid-template-columns:repeat(2,1fr)}.proof-step:nth-child(2){border-right:0}.proof-step:nth-child(-n+2){border-bottom:1px solid var(--line)}.desk-grid,.intake-grid{grid-template-columns:1fr}}
@media(max-width:760px){.admin-frame{grid-template-columns:1fr}.admin-rail{position:static;height:auto;overflow:visible}.admin-nav{grid-template-columns:repeat(2,1fr)}.admin-nav-group{grid-column:1/-1}.admin-nav-group>div{grid-template-columns:repeat(2,1fr)}.admin-main{padding:18px 14px}.admin-top,.content-desk-head{align-items:flex-start;grid-template-columns:1fr;flex-direction:column}.content-desk-head h1{font-size:28px}.proof-rail{grid-template-columns:1fr}.proof-step{border-right:0;border-bottom:1px solid var(--line)!important;min-height:0}.proof-step:last-child{border-bottom:0!important}.attention-item{grid-template-columns:32px minmax(0,1fr)}.attention-go{display:none}}
</style>
</head>
<body>
<div class="admin-frame">
  <aside class="admin-rail">
    <div class="admin-brand"><svg width="20" height="20" viewBox="0 0 260 260" aria-hidden="true"><g transform="translate(130,146)"><polygon points="0,60 104,22 0,-16 -104,22" style="fill:var(--logo-bot)"/><polygon points="0,22 92,-12 0,-46 -92,-12" style="fill:var(--logo-mid)"/><polygon points="0,-16 80,-46 0,-76 -80,-46" style="fill:var(--logo-top)"/></g></svg>Admin</div>
    <div class="admin-source">Controlled content ops</div>
    <nav class="admin-nav" aria-label="Admin navigation">
      ${primaryNav.map(([keys, href, label], index) => `<a href="${href}"${current(keys) ? ' aria-current="page"' : ''}${index === 1 ? ' class="admin-nav-create"' : ''}>${label}</a>`).join('')}
      <details class="admin-nav-group"${libraryOpen ? ' open' : ''}>
        <summary>Libraries</summary>
        <div>${libraryNav.map(([key, href, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
      </details>
      <details class="admin-nav-group"${advancedOpen ? ' open' : ''}>
        <summary>Advanced</summary>
        <div>${advancedNav.map(([key, href, label]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
      </details>
    </nav>
  </aside>
  <main class="admin-main">
    ${breadcrumbs.length ? `<div class="breadcrumbs">${breadcrumbs.map((crumb, index) => crumb.href ? `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>${index < breadcrumbs.length - 1 ? ' / ' : ''}` : `<span>${escapeHtml(crumb.label)}</span>`).join('')}</div>` : ''}
    ${body}
  </main>
</div>
<button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle day / night" style="position:fixed;bottom:18px;right:18px;z-index:50;">&#9790; Night</button>
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/teal-brand.css">
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

export function renderDashboard({ counts, contentSource, workflow = {}, freshness = {} }) {
  const sourceAttention = Number(freshness.due || 0) + Number(freshness.missing || 0);
  const reviewAttention = Number(workflow.proposalsNeedingReview || 0) + Number(counts.subjectsNeedsVerification || 0);
  const publishAttention = Number(workflow.approvedProposals || 0) + Number(workflow.activeReleases || 0);
  const tasks = [
    ...(workflow.commitFailed ? [{
      kind: '!',
      warn: true,
      title: `${workflow.commitFailed} live change${workflow.commitFailed === 1 ? '' : 's'} not committed`,
      detail: 'Reconcile this before the next deployment.',
      href: '/admin/release-candidates',
    }] : []),
    ...(workflow.pendingPush ? [{
      kind: '\u2191',
      warn: true,
      title: `${workflow.pendingPush} verified change${workflow.pendingPush === 1 ? '' : 's'} waiting for push`,
      detail: 'The live apply is safe, but origin/main still needs the commit.',
      href: '/admin/release-candidates',
    }] : []),
    ...(workflow.pipelineFailures ? [{
      kind: '!',
      warn: true,
      title: `${workflow.pipelineFailures} pipeline run${workflow.pipelineFailures === 1 ? '' : 's'} stopped`,
      detail: 'Review the evidence or missing fields before retrying.',
      href: '/admin/pipeline-runs',
    }] : []),
    ...(workflow.proposalsNeedingReview ? [{
      kind: 'R',
      title: `${workflow.proposalsNeedingReview} proposed change${workflow.proposalsNeedingReview === 1 ? '' : 's'} need a decision`,
      detail: 'Compare the source evidence, then approve or request changes.',
      href: '/admin/review',
    }] : []),
    ...(workflow.approvedProposals ? [{
      kind: 'P',
      title: `${workflow.approvedProposals} approved change${workflow.approvedProposals === 1 ? '' : 's'} ready to prepare`,
      detail: 'Add reviewed changes to a small release batch.',
      href: '/admin/release-candidates',
    }] : []),
    ...(sourceAttention ? [{
      kind: 'S',
      title: `${sourceAttention} source${sourceAttention === 1 ? '' : 's'} due for a freshness review`,
      detail: `Review cadence is ${freshness.reviewDays || 180} days. Open the source before creating an update.`,
      href: '/admin/freshness',
    }] : []),
    ...(counts.subjectsNeedsVerification ? [{
      kind: 'V',
      title: `${counts.subjectsNeedsVerification} existing draft${counts.subjectsNeedsVerification === 1 ? '' : 's'} need source verification`,
      detail: 'These remain private until a human verifies the published evidence.',
      href: '/admin/verification-reviews',
    }] : []),
  ];
  const workflowStatus = workflow.available
    ? '<span class="status-ok">Ready</span>'
    : '<span class="status-warn">Needs database</span>';
  return adminShell({
    title: 'Today',
    active: 'dashboard',
    body: `
<header class="content-desk-head">
  <div>
    <div class="content-desk-kicker">CONTENT DESK / ${escapeHtml(contentSource).toUpperCase()}</div>
    <h1>Keep every page grounded in a source.</h1>
    <p>Start with the document. Automation prepares a review item; you keep the verification and publishing decisions.</p>
  </div>
  <div><a class="primary-action" href="/admin/content/new">+ Start an update</a> <a class="logout" style="margin-left:10px" href="/admin/logout">Sign out</a></div>
</header>

<section class="proof-rail" aria-label="Content workflow">
  <article class="proof-step${sourceAttention ? ' proof-step--warn' : ''}"><span class="proof-step-number">01 / SOURCE</span><span class="proof-count">${escapeHtml(sourceAttention)}</span><h2>Check evidence</h2><p>Fetch or upload an official document.</p><a href="/admin/freshness">Review freshness \u2192</a></article>
  <article class="proof-step${counts.subjectsNeedsVerification ? ' proof-step--warn' : ''}"><span class="proof-step-number">02 / DRAFT</span><span class="proof-count">${escapeHtml(counts.subjectsNeedsVerification)}</span><h2>Prepare content</h2><p>Parse, extract, validate and compare.</p><a href="/admin/content/new">Start from a source \u2192</a></article>
  <article class="proof-step${reviewAttention ? ' proof-step--warn' : ''}"><span class="proof-step-number">03 / REVIEW</span><span class="proof-count">${escapeHtml(reviewAttention)}</span><h2>Make the decision</h2><p>Verify evidence and approve safe changes.</p><a href="/admin/review">Open review queue \u2192</a></article>
  <article class="proof-step${publishAttention ? ' proof-step--warn' : ''}"><span class="proof-step-number">04 / PUBLISH</span><span class="proof-count">${escapeHtml(publishAttention)}</span><h2>Ship a batch</h2><p>Plan, apply, verify, commit and deploy.</p><a href="/admin/release-candidates">Open publishing \u2192</a></article>
</section>

<div class="desk-grid">
  <section class="desk-panel">
    <div class="desk-panel-head"><h2>What needs you now</h2><a href="/admin/review">Review all</a></div>
    ${tasks.length ? `<div class="attention-list">${tasks.map(task => `<a class="attention-item${task.warn ? ' attention-item--warn' : ''}" href="${task.href}"><span class="attention-mark">${escapeHtml(task.kind)}</span><span class="attention-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.detail)}</span></span><span class="attention-go">Open \u2192</span></a>`).join('')}</div>` : '<div class="queue-empty"><strong>Nothing is blocked.</strong><br>Start a source update when a new syllabus or official revision appears.</div>'}
  </section>
  <aside class="desk-panel">
    <div class="desk-panel-head"><h2>Operating state</h2><a href="/admin/checks">System checks</a></div>
    <div class="desk-status">
      <div class="desk-status-row"><span>Guided workflow</span><strong>${workflowStatus}</strong></div>
      <div class="desk-status-row"><span>Verified subjects</span><strong>${escapeHtml(counts.subjectsVerified)}</strong></div>
      <div class="desk-status-row"><span>Sources reviewed on time</span><strong>${escapeHtml(freshness.current || 0)} / ${escapeHtml(freshness.totalSources || 0)}</strong></div>
      <div class="desk-status-row"><span>Active releases</span><strong>${escapeHtml(workflow.activeReleases || 0)}</strong></div>
    </div>
    ${workflow.available ? '' : '<div class="notice" style="margin:0 14px 14px;">The public JSON site is healthy. DB-backed automation is unavailable until the configured MySQL connection is reachable.</div>'}
  </aside>
</div>

<div class="notice" style="margin-top:18px;"><strong>Freshness promise.</strong> The dashboard schedules human review from recorded retrieval dates. It does not claim that an upstream PDF is unchanged; open the official source before approving any update.</div>`,
  });
}

export function renderContentIntakePage({ sources = [], values = {}, error = null } = {}) {
  const enabledSources = sources.filter(source => source.enabled);
  const sourceOptions = enabledSources.map(source => `<option value="${escapeHtml(source.id)}"${selectedAttr(values.discovery_source_id, source.id)}>${escapeHtml(source.name)} \u00b7 ${escapeHtml(source.baseUrl || source.sourceKey)}</option>`).join('');
  const sourceSelect = `<select name="discovery_source_id" required><option value="">Choose a trusted source</option>${sourceOptions}</select>`;
  return adminShell({
    title: 'Start an update',
    active: 'content_new',
    breadcrumbs: [{ href: '/admin/', label: 'Today' }, { label: 'Start an update' }],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 01 / SOURCE</div><h1>Start with the official document</h1><div class="admin-sub">Choose one intake path. The system stores immutable evidence, then helps prepare a review item. Nothing publishes automatically.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${enabledSources.length ? '' : '<div class="notice evidence-warning" style="margin-bottom:14px;"><strong>No enabled trusted sources.</strong> Add or enable a source in Advanced \u2192 Source registry before fetching or uploading evidence.</div>'}
<div class="intake-grid">
  <form class="intake-card" method="post" action="/admin/content/new/fetch">
    <div class="content-desk-kicker">RECOMMENDED</div>
    <h2>Fetch an official URL</h2>
    <p>Best when the university publishes a stable PDF or HTML page.</p>
    <label class="field"><span>Trusted source</span>${sourceSelect}</label>
    <label class="field"><span>Document URL</span><input name="source_url" value="${escapeHtml(values.source_url || '')}" type="url" required placeholder="https://jntuk.edu.in/.../syllabus.pdf"></label>
    <div class="safety-note">The URL must match the trusted source domain. Private networks, redirect loops, oversized files and unsupported formats are blocked.</div>
    <button class="primary-action" type="submit"${enabledSources.length ? '' : ' disabled'}>Fetch document</button>
  </form>
  <form class="intake-card" method="post" action="/admin/assets/new?guided=1" enctype="multipart/form-data">
    <div class="content-desk-kicker">WHEN DOWNLOAD IS REQUIRED</div>
    <h2>Upload a source file</h2>
    <p>Use a PDF or HTML file downloaded from the official source.</p>
    <label class="field"><span>Trusted source</span>${sourceSelect}</label>
    <label class="field"><span>Original document URL <small class="admin-sub">optional</small></span><input name="source_url" value="${escapeHtml(values.source_url || '')}" type="url" placeholder="https://..."></label>
    <label class="field"><span>File</span><input name="asset_file" required type="file" accept=".pdf,.html,.htm,.zip,image/*"></label>
    <div class="safety-note">The original file and checksum are preserved so every proposed field can be traced back to evidence.</div>
    <button class="primary-action" type="submit"${enabledSources.length ? '' : ' disabled'}>Store document</button>
  </form>
</div>
<section class="desk-panel" style="margin-top:18px;">
  <div class="desk-panel-head"><h2>Already have a private draft?</h2><a href="/admin/verification-reviews">Open drafts</a></div>
  <div class="desk-status">Use <strong>Verify drafts</strong> when a subject already exists as <span class="mono">needs_verification</span>. Do not ingest the same content again.</div>
</section>
<details class="advanced-panel"><summary>Need to configure a source or inspect raw assets?</summary><div><a href="/admin/sources">Open source registry</a> \u00b7 <a href="/admin/assets">Open source assets</a></div></details>`,
  });
}

export function renderGuidedProcessingPage({
  asset,
  fileStatus = null,
  parsers = [],
  values = {},
  error = null,
} = {}) {
  const availableParsers = parsers.filter(parser => parser.available);
  const selectedParser = values.parser_key
    || availableParsers.find(parser => parser.suggested)?.key
    || availableParsers[0]?.key
    || '';
  const createReviewItem = values.create_proposal == null || checkedAttr(values.create_proposal);
  return adminShell({
    title: 'Prepare content',
    active: 'content_new',
    breadcrumbs: [
      { href: '/admin/', label: 'Today' },
      { href: '/admin/content/new', label: 'Start an update' },
      { label: 'Prepare content' },
    ],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 02 / DRAFT</div><h1>Prepare a review item</h1><div class="admin-sub">The document is stored. Run the safe pipeline to parse, extract, validate and compare it with current content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<section class="desk-panel" style="margin-bottom:16px;">
  <div class="desk-panel-head"><h2>Source docket</h2><a href="/admin/assets/${escapeHtml(asset.id)}">Technical details</a></div>
  <div class="desk-status">
    <div class="desk-status-row"><span>Document</span><strong>${escapeHtml(asset.originalFilename || `Asset ${asset.id}`)}</strong></div>
    <div class="desk-status-row"><span>Trusted source</span><strong>${escapeHtml(asset.discoverySourceName || asset.discoverySourceId || 'not recorded')}</strong></div>
    <div class="desk-status-row"><span>Source URL</span><strong>${asset.sourceUrl ? `<a href="${escapeHtml(asset.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceHost(asset.sourceUrl))} \u2197</a>` : 'not recorded'}</strong></div>
    <div class="desk-status-row"><span>Evidence file</span><strong>${escapeHtml(fileStatus?.status || 'unknown')} \u00b7 ${escapeHtml(formatBytes(asset.fileSize) || 'size unknown')}</strong></div>
    <div class="desk-status-row"><span>Checksum</span><strong class="mono">${escapeHtml((asset.sha256Checksum || '').slice(0, 16) || 'not recorded')}</strong></div>
  </div>
</section>

<form class="intake-card" method="post" action="/admin/assets/${escapeHtml(asset.id)}/pipeline?guided=1">
  <h2>Build the draft</h2>
  <p>The suggested parser is selected automatically. Only add matching hints when the document does not clearly identify the target.</p>
  <label class="field"><span>Document reader</span><select name="parser_key" required>
    ${availableParsers.map(parser => `<option value="${escapeHtml(parser.key)}"${selectedAttr(selectedParser, parser.key)}>${escapeHtml(parser.label)}${parser.suggested ? ' \u00b7 suggested' : ''}</option>`).join('')}
  </select></label>
  <label class="field"><span>Content type</span><select name="entity_type" required>
    ${[['subject', 'Subject syllabus'], ['college', 'College record'], ['branch_profile', 'Branch guide profile']].map(([value, label]) => `<option value="${value}"${selectedAttr(values.entity_type || 'subject', value)}>${label}</option>`).join('')}
  </select></label>
  <label class="field"><span>Existing record ID or slug <small class="admin-sub">leave blank for new content</small></span><input name="entity_key" value="${escapeHtml(values.entity_key || '')}" placeholder="e.g. r23-cse-3-1-computer-networks"></label>
  <label style="display:flex;gap:8px;align-items:flex-start;margin-top:14px;"><input type="checkbox" name="create_proposal" value="1"${createReviewItem ? ' checked' : ''}><span><strong>Create a review item when validation passes</strong><br><small class="admin-sub">This is the automation handoff. It never approves, verifies or publishes the result.</small></span></label>

  <details class="advanced-panel">
    <summary>Matching hints — use only when the document is ambiguous</summary>
    <div>
      <div class="intake-grid">
        <label class="field"><span>University</span><input name="university" value="${escapeHtml(values.university || '')}" placeholder="JNTUK"></label>
        <label class="field"><span>Regulation</span><input name="regulation" value="${escapeHtml(values.regulation || '')}" placeholder="R23"></label>
        <label class="field"><span>Branch</span><input name="branch" value="${escapeHtml(values.branch || '')}" placeholder="CSE"></label>
        <label class="field"><span>Year</span><input name="year" value="${escapeHtml(values.year || '')}" inputmode="numeric" placeholder="3"></label>
        <label class="field"><span>Semester</span><input name="semester" value="${escapeHtml(values.semester || '')}" inputmode="numeric" placeholder="1"></label>
        <label class="field"><span>Candidate number</span><input name="candidate_index" value="${escapeHtml(values.candidate_index || '')}" inputmode="numeric" placeholder="0"></label>
      </div>
    </div>
  </details>
  <div class="safety-note">Validation failures stop before proposal creation. Ambiguous fields stay unresolved for human correction; the system does not invent missing syllabus content.</div>
  <button class="primary-action" type="submit"${availableParsers.length && fileStatus?.status !== 'missing' ? '' : ' disabled'}>Run safe automation</button>
  ${availableParsers.length ? '' : '<div class="notice evidence-warning" style="margin-top:10px;">No available parser matches this file. Open Technical details to inspect supported formats.</div>'}
</form>`,
  });
}

export function renderReviewQueuePage({ drafts = [], totalDrafts = 0, proposals = [], error = null } = {}) {
  const proposalRows = proposals.filter(proposal => ['draft', 'needs_review', 'needs_verification', 'changes_requested'].includes(proposal.status));
  return adminShell({
    title: 'Review',
    active: 'review',
    breadcrumbs: [{ href: '/admin/', label: 'Today' }, { label: 'Review' }],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 03 / REVIEW</div><h1>Decisions, not pipeline artifacts</h1><div class="admin-sub">Verify existing drafts or decide proposed changes. Publishing remains a separate step.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="notice evidence-warning">${escapeHtml(error)}</div>` : ''}
<div class="intake-grid">
  <section class="desk-panel">
    <div class="desk-panel-head"><h2>Verify source drafts <span class="pill">${escapeHtml(totalDrafts)}</span></h2><a href="/admin/verification-reviews">View all</a></div>
    ${drafts.length ? `<div class="attention-list">${drafts.slice(0, 8).map(subject => `<a class="attention-item" href="/admin/verification-reviews/${encodeURIComponent(subject.id)}"><span class="attention-mark">V</span><span class="attention-copy"><strong>${escapeHtml(subject.name)}</strong><span>${escapeHtml(subject.branch || '')} \u00b7 ${escapeHtml(subject.yearSemLabel || subject.year_sem_label || '')} \u00b7 ${escapeHtml(sourceHost(subject.source?.origin_url))}</span></span><span class="attention-go">Verify \u2192</span></a>`).join('')}</div>` : '<div class="queue-empty">No source-verification drafts are waiting.</div>'}
  </section>
  <section class="desk-panel">
    <div class="desk-panel-head"><h2>Review proposed changes <span class="pill">${escapeHtml(proposalRows.length)}</span></h2><a href="/admin/proposals">View all</a></div>
    ${proposalRows.length ? `<div class="attention-list">${proposalRows.slice(0, 8).map(proposal => `<a class="attention-item" href="/admin/proposals/${escapeHtml(proposal.id)}"><span class="attention-mark">R</span><span class="attention-copy"><strong>${escapeHtml(proposal.entityType)} / ${escapeHtml(proposal.entityKey)}</strong><span>${escapeHtml(proposal.status)} \u00b7 validation ${escapeHtml(proposal.validationStatus)}</span></span><span class="attention-go">Review \u2192</span></a>`).join('')}</div>` : '<div class="queue-empty">No proposed changes are waiting for a decision.</div>'}
  </section>
</div>
<div class="notice" style="margin-top:18px;">Approval requires visible evidence, passed validation and a reviewer note. The dashboard never auto-verifies or auto-approves content.</div>`,
  });
}

export function renderFreshnessPage({ freshness }) {
  return adminShell({
    title: 'Freshness',
    active: 'freshness',
    breadcrumbs: [{ href: '/admin/', label: 'Today' }, { label: 'Freshness' }],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 01 / SOURCE</div><h1>Source review cadence</h1><div class="admin-sub">A source becomes due ${escapeHtml(freshness.reviewDays)} days after its oldest linked record was checked. This is a review reminder, not a claim that the remote file is unchanged.</div></div><a class="primary-action" href="/admin/content/new">Start an update</a></div>
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Source records</div><div class="metric-value">${escapeHtml(freshness.totalSources)}</div></div>
  <div class="metric"><div class="metric-label">Current</div><div class="metric-value status-ok">${escapeHtml(freshness.current)}</div></div>
  <div class="metric"><div class="metric-label">Review due</div><div class="metric-value status-warn">${escapeHtml(freshness.due)}</div></div>
  <div class="metric"><div class="metric-label">Missing date or URL</div><div class="metric-value ${freshness.missing ? 'status-bad' : 'status-ok'}">${escapeHtml(freshness.missing)}</div></div>
</section>
<div class="table-wrap" style="margin-top:16px;"><table><thead><tr><th>Status</th><th>Source</th><th>Last checked</th><th>Age</th><th>Subjects</th><th>Examples</th><th></th></tr></thead><tbody>
${freshness.sources.map(source => `<tr><td><span class="pill ${source.status === 'current' ? 'status-ok' : source.status === 'due' ? 'status-warn' : 'status-bad'}">${escapeHtml(source.status)}</span></td><td>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.host)} \u2197</a>` : '<span class="status-bad">URL missing</span>'}</td><td>${escapeHtml(source.reviewedAt || 'not recorded')}</td><td>${source.ageDays == null ? '-' : `${escapeHtml(source.ageDays)} days`}</td><td>${escapeHtml(source.subjectCount)}</td><td>${source.examples.map(example => escapeHtml(example.name)).join('<br>')}</td><td>${source.url ? `<a href="/admin/content/new?source_url=${encodeURIComponent(source.url)}">Review source</a>` : '<a href="/admin/subjects">Find records</a>'}</td></tr>`).join('')}
</tbody></table></div>`,
  });
}

export function renderAdminChecksPage({ checks }) {
  const expectedSearchDocs = Number(checks.content.subjectsVerified || 0)
    + Number(checks.content.collegesTotal || 0)
    + Number(checks.content.branchProfilesTotal || 0);
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
  <div class="metric"><div class="metric-label">Search index</div><div class="metric-value">${passFail(checks.searchIndex.ok && checks.searchIndex.total === expectedSearchDocs)}</div></div>
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

function selectedAttr(left, right) {
  return String(left || '') === String(right || '') ? ' selected' : '';
}

function checkedAttr(value) {
  return value ? ' checked' : '';
}

function renderPresence(value) {
  return value ? '<span class="status-ok">present</span>' : '<span class="status-warn">missing</span>';
}

function sourceHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

export function renderVerificationSubjectsPage({
  subjects,
  totalDrafts,
  filters = {},
  filterOptions = {},
  contentSource,
  message = null,
  error = null,
}) {
  const branchOptions = filterOptions.branches || [];
  const yearOptions = filterOptions.years || [];
  const semesterOptions = filterOptions.semesters || [];
  return adminShell({
    title: 'Verified promotion reviews',
    active: 'verification_reviews',
    body: `
<div class="admin-top"><div><h1>Verify drafts</h1><div class="admin-sub">Source: ${escapeHtml(contentSource)}. ${escapeHtml(totalDrafts)} needs_verification subject drafts require human source review before publication.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="get" action="/admin/verification-reviews">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
    <label><strong>Branch</strong>
      <select name="branch" style="display:block;width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:5px;">
        <option value="">All branches</option>
        ${branchOptions.map(value => `<option value="${escapeHtml(value)}"${selectedAttr(filters.branch, value)}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </label>
    <label><strong>Year</strong>
      <select name="year" style="display:block;width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:5px;">
        <option value="">All years</option>
        ${yearOptions.map(value => `<option value="${escapeHtml(value)}"${selectedAttr(filters.year, value)}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </label>
    <label><strong>Semester</strong>
      <select name="semester" style="display:block;width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:5px;">
        <option value="">All semesters</option>
        ${semesterOptions.map(value => `<option value="${escapeHtml(value)}"${selectedAttr(filters.semester, value)}>${escapeHtml(value)}</option>`).join('')}
      </select>
    </label>
    <label><strong>Source</strong>
      <input name="source" value="${escapeHtml(filters.source || '')}" placeholder="PDF host or URL text" style="display:block;width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;margin-top:5px;">
    </label>
  </div>
  <button type="submit">Filter</button>
  <a class="logout" style="margin-left:10px;" href="/admin/verification-reviews">Clear</a>
</form>

<div class="table-wrap" style="margin-top:14px;"><table><thead><tr><th>Subject</th><th>Canonical path</th><th>Branch</th><th>Year/Sem</th><th>Source</th><th>Evidence fields</th><th></th></tr></thead><tbody>
${subjects.length ? subjects.map(subject => `<tr>
  <td><strong>${escapeHtml(subject.name)}</strong><div class="mono">${escapeHtml(subject.id || '')}</div></td>
  <td class="mono">${escapeHtml(canonicalSubjectPath(subject))}</td>
  <td>${escapeHtml(subject.branch || '')}<div class="admin-sub">${escapeHtml(subject.regulation || '')}</div></td>
  <td>${escapeHtml(subject.yearSemLabel || `${subject.year || ''}-${subject.semester || ''}`)}</td>
  <td class="mono">${subject.source?.origin_url ? `<a href="${escapeHtml(subject.source.origin_url)}" target="_blank" rel="noopener">${escapeHtml(sourceHost(subject.source.origin_url))}</a>` : '<span class="status-bad">missing source</span>'}<div class="admin-sub">${escapeHtml(subject.source?.college_source_note || subject.source?.retrieved_date || '')}</div></td>
  <td>credits ${renderPresence(subject.hasCredits)}<br>units ${renderPresence(subject.hasUnits)}<br>outcomes ${renderPresence(subject.hasOutcomes)}${isAuditStylePromotionSubject(subject) ? '<br><span class="status-warn">publication review required</span>' : ''}</td>
  <td><a href="/admin/verification-reviews/${encodeURIComponent(subject.id)}">Review</a></td>
</tr>`).join('') : `<tr><td colspan="7">${emptyState('No matching drafts', 'Adjust filters or confirm there are needs_verification subjects in the loaded content.')}</td></tr>`}
</tbody></table></div>`,
  });
}

function checklistInputs(items, values = {}) {
  return items.map(item => `
    <label style="display:block;margin:8px 0;">
      <input type="checkbox" name="${escapeHtml(item.key)}" value="yes"${checkedAttr(values[item.key])}>
      ${escapeHtml(item.label)}
    </label>`).join('');
}

function subjectFieldRows(subject) {
  const rows = [
    ['Title', subject.name],
    ['Canonical public path', canonicalSubjectPath(subject)],
    ['Regulation', subject.regulation],
    ['Branch', subject.branch],
    ['Year/Semester', subject.year_sem_label || `${subject.year || ''}-${subject.semester || ''}`],
    ['Category', subject.category],
    ['Type', subject.type],
    ['Credits', JSON.stringify(subject.credits || {})],
    ['Units present', Array.isArray(subject.units) && subject.units.length ? `${subject.units.length}` : 'no'],
    ['Outcomes present', Array.isArray(subject.course_outcomes) && subject.course_outcomes.length ? `${subject.course_outcomes.length}` : 'no'],
    ['Caveat/source note', subject.source?.college_source_note || ''],
    ['Draft notes', subject.notes || ''],
  ];
  return rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value ?? '')}</td></tr>`).join('');
}

export function renderVerificationReviewPage({
  review,
  checklistItems,
  values = {},
  error = null,
}) {
  const subject = review.subject;
  const source = subject.source || {};
  const validationErrors = review.validation?.errors || [];
  const auditStylePromotion = isAuditStylePromotionSubject(subject);
  const electiveOptionAmbiguous = hasElectiveOptionAmbiguity(subject);
  return adminShell({
    title: `Verify ${subject.name}`,
    active: 'verification_reviews',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/verification-reviews', label: 'Verify drafts' },
      { label: subject.name },
    ],
    body: `
<div class="admin-top"><div><h1>${escapeHtml(subject.name)}</h1><div class="admin-sub">Human source review for a needs_verification subject draft. This creates a proposal only.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('proposal')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${!source.origin_url ? '<div class="error">This draft is missing source/provenance and cannot be promoted.</div>' : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Current status</div><div class="metric-value">${escapeHtml(source.status || '')}</div></div>
  <div class="metric"><div class="metric-label">Validation</div><div class="metric-value ${review.validation?.status === 'passed' ? 'status-ok' : 'status-bad'}">${escapeHtml(review.validation?.status || 'not_validated')}</div></div>
  <div class="metric"><div class="metric-label">Proposed change</div><div class="metric-value">verified</div></div>
  <div class="metric"><div class="metric-label">Diff operation</div><div class="metric-value">${escapeHtml(review.diff?.diff?.operation || 'unknown')}</div></div>
</section>

<h2>Source evidence</h2>
<div class="action-box">
  <strong>Origin</strong>
  <div class="mono">${source.origin_url ? `<a href="${escapeHtml(source.origin_url)}" target="_blank" rel="noopener">${escapeHtml(source.origin_url)}</a>` : 'missing'}</div>
  <div class="admin-sub">Retrieved: ${escapeHtml(source.retrieved_date || '-')} ${source.college_source_note ? ` / ${escapeHtml(source.college_source_note)}` : ''}</div>
</div>

<h2>Extracted fields</h2>
<div class="table-wrap"><table><tbody>${subjectFieldRows(subject)}</tbody></table></div>

${Array.isArray(subject.units) && subject.units.length ? `<h2>Units</h2><pre class="json-block">${escapeHtml(JSON.stringify(subject.units, null, 2))}</pre>` : ''}
${Array.isArray(subject.course_outcomes) && subject.course_outcomes.length ? `<h2>Course outcomes</h2><pre class="json-block">${escapeHtml(JSON.stringify(subject.course_outcomes, null, 2))}</pre>` : ''}
${!Array.isArray(subject.units) || !subject.units.length ? '<div class="notice evidence-warning" style="margin-top:10px;">No units/topics are present in this draft. If promoted, the public page must rely on verified metadata and source caveat rather than detailed syllabus content.</div>' : ''}
${!Array.isArray(subject.course_outcomes) || !subject.course_outcomes.length ? '<div class="notice evidence-warning" style="margin-top:10px;">No course outcomes are present in this draft.</div>' : ''}
${auditPublicationWarning(subject)}

<h2>Validation</h2>
${validationErrors.length ? `<div class="table-wrap"><table><thead><tr><th>Path</th><th>Message</th></tr></thead><tbody>${validationErrors.map(item => `<tr><td class="mono">${escapeHtml(item.path || '')}</td><td>${escapeHtml(item.message || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice"><span class="status-ok">Promotion payload passes schema validation.</span></div>'}

<h2>Create promotion proposal</h2>
<form class="action-box danger-zone" method="post" action="/admin/verification-reviews/${encodeURIComponent(subject.id)}/propose">
  <strong>Checklist</strong>
  <div class="admin-sub">Every item must be checked after opening and comparing the source evidence. Submission creates one proposal; it does not edit JSON or publish the subject.</div>
  ${checklistInputs(checklistItems, values.checklist || {})}
  <label for="reviewer_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="reviewer_note" name="reviewer_note" required>${escapeHtml(values.reviewer_note || '')}</textarea>
  ${auditStylePromotion || electiveOptionAmbiguous ? `<div class="admin-sub">This subject needs an explicit publication decision below. Record a brief reason (at least 30 characters) here explaining why it is safe to publish — no fixed wording required.</div>` : ''}
  <label for="confirmation_phrase" style="display:block;margin-top:12px;"><strong>Confirmation phrase</strong></label>
  <input id="confirmation_phrase" name="confirmation_phrase" required value="${escapeHtml(values.confirmation_phrase || '')}" placeholder="PROMOTE TO VERIFIED" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
  ${auditStylePromotion ? `<label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;"><input type="checkbox" id="audit_course_publication_confirmed" name="audit_course_publication_confirmed" required ${values.audit_course_publication_confirmed ? 'checked' : ''} style="margin-top:4px;"><span><strong>Publish this audit/non-credit page.</strong> Mandatory non-credit, audit, internship, project, and zero-credit rows need an explicit publication decision — verified course existence alone does not make the page worth publishing. Tick this and give a brief reason in the reviewer note above.</span></label>` : ''}
  ${electiveOptionAmbiguous ? `<label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;"><input type="checkbox" id="elective_option_confirmed" name="elective_option_confirmed" required ${values.elective_option_confirmed ? 'checked' : ''} style="margin-top:4px;"><span><strong>Confirm standalone elective page.</strong> This subject has OR/elective-option wording. Confirm the public copy does not imply the course is mandatory for every student, and give a brief reason in the reviewer note above.</span></label>` : ''}
  <button class="warn" type="submit">Create verified promotion proposal</button>
</form>`,
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
  fileStatus = null,
  parsers = [],
  parseResults = [],
  pipelineRuns = [],
  error = null,
  pipelineError = null,
  pipelineValues = {},
}) {
  const selectedParser = pipelineValues.parser_key || parsers.find(parser => parser.suggested && parser.available)?.key || parsers.find(parser => parser.available)?.key || '';
  const fileState = fileStatus?.status || 'missing';
  const fileStateLabel = fileState === 'repaired' ? 'repaired' : fileState === 'present' ? 'present' : 'missing';
  const missingWarning = fileState === 'missing'
    ? `<div class="error"><strong>Stored file missing.</strong> This asset has database metadata but the physical file is not present under storage/source-assets. Parsers and pipeline runs will fail until the file is repaired or re-uploaded.</div>`
    : '';
  const repairAction = fileStatus?.repairAvailable
    ? `<form class="action-box" method="post" action="/admin/assets/${escapeHtml(asset.id)}/repair">
        <strong>Repair missing asset file</strong>
        <div class="admin-sub">Safely re-fetches the original source URL, reuses this asset row, refreshes checksum/size/content type/storage metadata, and records audit events. It does not parse, create proposals, publish content, or change CONTENT_SOURCE.</div>
        <button type="submit">Repair missing file</button>
      </form>`
    : fileState === 'missing'
      ? `<div class="notice">Repair action unavailable: this asset does not have both a source URL and discovery source.</div>`
      : '';
  return adminShell({
    title: `Asset ${asset.id}`,
    active: 'assets',
    body: `
<div class="admin-top"><div><h1>${escapeHtml(asset.originalFilename || `Asset ${asset.id}`)}</h1><div class="admin-sub">Raw source asset. Parser and pipeline actions remain manual and never publish content.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('asset')}
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
${pipelineError ? `<div class="error">${escapeHtml(pipelineError)}</div>` : ''}
${missingWarning}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(asset.downloadStatus || '')}</div></div>
  <div class="metric"><div class="metric-label">File</div><div class="metric-value">${escapeHtml(fileStateLabel)}</div></div>
  <div class="metric"><div class="metric-label">Size</div><div class="metric-value">${escapeHtml(formatBytes(asset.fileSize) || '-')}</div></div>
  <div class="metric"><div class="metric-label">Source</div><div class="metric-value">${escapeHtml(asset.discoverySourceName || asset.discoverySourceId || '')}</div></div>
</section>
${repairAction}

<h2>Metadata</h2>
<div class="table-wrap"><table><tbody>
<tr><th>Filename</th><td>${escapeHtml(asset.originalFilename || '')}</td></tr>
<tr><th>Content type</th><td>${escapeHtml(asset.contentType || '')}</td></tr>
<tr><th>SHA-256</th><td class="mono">${escapeHtml(asset.sha256Checksum || '')}</td></tr>
<tr><th>Source URL</th><td class="mono">${escapeHtml(asset.sourceUrl || '')}</td></tr>
<tr><th>Storage path</th><td class="mono">${escapeHtml(asset.localStoragePath || '')}</td></tr>
<tr><th>File existence</th><td>${escapeHtml(fileStateLabel)}${fileStatus?.repairedAt ? ` <span class="admin-sub">(repaired ${escapeHtml(fileStatus.repairedAt)})</span>` : ''}</td></tr>
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
  const proposalStep = result.steps?.find(step => step.step === 'proposal' && step.status === 'success');
  const extractionStep = result.steps?.find(step => step.step === 'extract' && step.status === 'success');
  const diffStep = result.steps?.find(step => step.step === 'diff' && step.status === 'success');
  const nextAction = proposalStep?.proposal_id
    ? `<div class="attention-item"><span class="attention-mark">R</span><span class="attention-copy"><strong>Review item ready</strong><span>Automation stopped at the human decision gate. Compare the evidence before approval.</span></span><a class="primary-action" href="/admin/proposals/${escapeHtml(proposalStep.proposal_id)}">Review change</a></div>`
    : result.status === 'validation_failed' && extractionStep?.extraction_result_id
      ? `<div class="attention-item attention-item--warn"><span class="attention-mark">!</span><span class="attention-copy"><strong>Validation needs a correction</strong><span>Open the extracted fields to see exactly what is missing. No proposal was created.</span></span><a class="secondary-action" href="/admin/extraction-results/${escapeHtml(extractionStep.extraction_result_id)}">Inspect fields</a></div>`
      : result.status === 'success' && diffStep?.diff_result_id
        ? `<div class="attention-item"><span class="attention-mark">D</span><span class="attention-copy"><strong>Comparison ready</strong><span>Review the structured changes before creating a review item.</span></span><a class="secondary-action" href="/admin/diff-results/${escapeHtml(diffStep.diff_result_id)}">View comparison</a></div>`
        : `<div class="attention-item attention-item--warn"><span class="attention-mark">!</span><span class="attention-copy"><strong>The run stopped</strong><span>${escapeHtml(result.errorMessage || 'Review the recorded steps before retrying.')}</span></span><a class="secondary-action" href="/admin/assets/${escapeHtml(result.assetId)}">Open source</a></div>`;
  return adminShell({
    title: `Pipeline run ${result.id}`,
    active: 'pipeline_runs',
    body: `
<div class="admin-top"><div><h1>Pipeline run ${escapeHtml(result.id)}</h1><div class="admin-sub">Manual evidence pipeline. This run does not publish content or mark anything verified.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${workflowNav('parse')}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(result.status)}</div></div>
  <div class="metric"><div class="metric-label">Parser</div><div class="metric-value">${escapeHtml(result.parserKey)}</div></div>
  <div class="metric"><div class="metric-label">Entity</div><div class="metric-value">${escapeHtml(result.entityType)}</div></div>
  <div class="metric"><div class="metric-label">Asset</div><div class="metric-value"><a href="/admin/assets/${escapeHtml(result.assetId)}">${escapeHtml(result.assetFilename || result.assetId)}</a></div></div>
</section>

<section class="desk-panel" style="margin-top:16px;">
  <div class="desk-panel-head"><h2>Next safe action</h2></div>
  ${nextAction}
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

function renderCredits(credits = {}) {
  if (!credits || typeof credits !== 'object') return '';
  return ['L', 'T', 'P', 'C']
    .filter(key => credits[key] != null)
    .map(key => `${key}:${credits[key]}`)
    .join(' ');
}

function validationMissingCategory(result) {
  return (result.validationErrors || []).some(error => error.params?.missingProperty === 'category' || error.path === '/category');
}

function renderCategoryMappingHelper(result, categoryOptions = []) {
  if (result.entityType !== 'subject') return '';
  const payload = result.extractedPayload || {};
  const evidence = result.categoryEvidence || result.mappingEvidence || {};
  const showHelper = result.parserKey === 'lbrce-r23-syllabus-pdf' || validationMissingCategory(result) || result.mappedCategory;
  if (!showHelper) return '';
  return `<h2>Reviewer category mapping</h2>
<div class="notice evidence-warning" style="margin-bottom:10px;"><strong>Reviewer-supplied metadata.</strong><br>Choose a category only when the source evidence and reviewer judgment support it. Do not infer or guess categories from convenience alone. This keeps <span class="mono">source.status</span> as <span class="mono">needs_verification</span> and does not publish anything.</div>
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Course code</div><div class="metric-value" style="font-size:16px;">${escapeHtml(payload.subject_code || evidence.subject_code || '')}</div></div>
  <div class="metric"><div class="metric-label">Title</div><div class="metric-value" style="font-size:16px;">${escapeHtml(payload.name || evidence.title || '')}</div></div>
  <div class="metric"><div class="metric-label">Year/Sem</div><div class="metric-value" style="font-size:16px;">${escapeHtml(payload.year_sem_label || evidence.year_sem_label || [payload.year, payload.semester].filter(Boolean).join('-'))}</div></div>
  <div class="metric"><div class="metric-label">L/T/P/C</div><div class="metric-value" style="font-size:16px;">${escapeHtml(renderCredits(payload.credits || evidence.credits))}</div></div>
  <div class="metric"><div class="metric-label">Category</div><div class="metric-value ${payload.category ? 'status-ok' : 'status-bad'}" style="font-size:16px;">${escapeHtml(payload.category || 'missing')}</div></div>
  <div class="metric"><div class="metric-label">Source status</div><div class="metric-value" style="font-size:16px;">${escapeHtml(payload.source?.status || '')}</div></div>
</section>
<div class="table-wrap" style="margin-top:10px;"><table><tbody>
<tr><th>Parse result</th><td>${evidence.parse_result_id ? `<a href="/admin/parse-results/${escapeHtml(evidence.parse_result_id)}">${escapeHtml(evidence.parse_result_id)}</a>` : escapeHtml(result.parseResultId || '')}</td></tr>
<tr><th>Parser</th><td class="mono">${escapeHtml(evidence.parser_key || result.parserKey || '')}</td></tr>
<tr><th>Source URL</th><td class="mono">${escapeHtml(evidence.source_url || payload.source?.origin_url || '')}</td></tr>
<tr><th>Page</th><td>${escapeHtml(evidence.page_number || '')}</td></tr>
<tr><th>Section</th><td>${escapeHtml(evidence.section_label || '')}</td></tr>
<tr><th>Semester heading</th><td>${escapeHtml(evidence.semester_heading || '')}</td></tr>
<tr><th>Source row/snippet</th><td class="mono">${escapeHtml(evidence.row_text || '')}</td></tr>
<tr><th>Parser category note</th><td>${escapeHtml(evidence.category_reason || '')}</td></tr>
${result.mappedCategory ? `<tr><th>Mapped category</th><td>${escapeHtml(result.mappedCategory)} by ${escapeHtml(result.mappedBy || '')} at ${escapeHtml(result.mappedAt || '')}</td></tr>
<tr><th>Mapping note</th><td>${escapeHtml(result.mappingNote || '')}</td></tr>` : ''}
</tbody></table></div>
<form class="action-box" method="post" action="/admin/extraction-results/${escapeHtml(result.id)}/category-mapping" style="margin-top:12px;">
  <strong>${result.mappedCategory ? 'Update category mapping' : 'Create category mapping'}</strong>
  <div class="admin-sub">The selected category is written only to this extraction result, then validation is rerun. It does not create a proposal, mark content verified, or publish.</div>
  <label for="mapped_category" style="display:block;margin-top:12px;"><strong>Category</strong></label>
  <select id="mapped_category" name="mapped_category" required style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;">
    <option value="">Select schema category</option>
    ${categoryOptions.map(category => `<option value="${escapeHtml(category)}"${(result.mappedCategory || payload.category || '') === category ? ' selected' : ''}>${escapeHtml(category)}</option>`).join('')}
  </select>
  <label for="mapping_note" style="display:block;margin-top:12px;"><strong>Reviewer note</strong></label>
  <textarea id="mapping_note" name="mapping_note" required placeholder="Required: explain the source/evidence used for this category mapping.">${escapeHtml(result.mappingNote || '')}</textarea>
  <button type="submit">${result.mappedCategory ? 'Update mapping and revalidate' : 'Save mapping and revalidate'}</button>
</form>`;
}

export function renderExtractionResultDetailPage({ result, categoryOptions = [], error = null }) {
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

${renderCategoryMappingHelper(result, categoryOptions)}

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
    title: 'Proposed changes',
    active: 'proposals',
    body: `
<div class="admin-top"><div><h1>Proposed changes</h1><div class="admin-sub">DB-backed review decisions are currently unavailable.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderProposalsPage({ proposals }) {
  return adminShell({
    title: 'Proposed changes',
    active: 'proposals',
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 03 / REVIEW</div><h1>Proposed changes</h1><div class="admin-sub">Human review only. No decision on this page publishes content.</div></div><div><a class="logout" href="/admin/review">Review overview</a> <a class="logout" style="margin-left:10px" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Entity</th><th>Key</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>
${proposals.length ? proposals.map(p => `<tr><td><span class="pill">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.entityType)}</td><td class="mono">${escapeHtml(p.entityKey)}</td><td class="mono">${escapeHtml(p.source?.originUrl || '')}</td><td>${escapeHtml(p.updatedAt || '')}</td><td><a href="/admin/proposals/${p.id}">Review</a></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No proposed changes yet', 'Start from an official source and let the pipeline prepare a validated review item.', '<a href="/admin/content/new">Start an update</a>')}</td></tr>`}
</tbody></table></div>
<details class="advanced-panel"><summary>Manual JSON proposal</summary><div>Use only when the guided extraction cannot represent a well-sourced correction. <a href="/admin/proposals/new">Open manual proposal editor</a>.</div></details>`,
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
  const canonicalPath = canonicalSubjectPathForProposal(proposal);
  const canApprove = ['needs_review', 'needs_verification', 'changes_requested'].includes(proposal.status);
  const canRequestChanges = ['needs_review', 'needs_verification', 'approved_for_draft'].includes(proposal.status);
  const canMarkNeedsVerification = ['needs_review', 'changes_requested', 'approved_for_draft'].includes(proposal.status);
  const canReject = ['draft', 'needs_review', 'needs_verification', 'changes_requested', 'approved_for_draft', 'approved'].includes(proposal.status);
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
${canonicalPath ? `<div class="notice" style="margin-top:14px;"><strong>Canonical public path:</strong> <span class="mono">${escapeHtml(canonicalPath)}</span><br><span class="admin-sub">Generated subject URLs use <span class="mono">seo.slug || id</span>. Do not assume the entity key is the public URL slug.</span></div>` : ''}

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
  ${canApprove ? `<form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Approve for draft/release preparation</strong>
    <div class="admin-sub">Requires passed validation. This does not publish, write live data files, mark content verified, or change CONTENT_SOURCE.</div>
    ${safetyBlockingWarnings.length ? `<div class="danger-copy">Blocking diff safety warnings detected. Check the override only after confirming the proposed payload is safe for draft preparation.</div>
    <label style="display:block;margin-top:10px;"><input type="checkbox" name="safety_override" value="yes"${validationPassed ? '' : ' disabled'}> I reviewed the blocking safety warnings and approve this safe merge/add for draft preparation.</label>` : ''}
    <textarea name="note" required placeholder="Record what was reviewed and why this can move to draft preparation."${validationPassed ? '' : ' disabled'}></textarea>
    <input type="hidden" name="action" value="approve_for_draft">
    <button type="submit"${validationPassed ? '' : ' disabled'}>Approve for draft</button>
    ${validationPassed ? '' : '<div class="notice" style="margin-top:10px;">Approval is blocked until proposal validation passes.</div>'}
  </form>` : proposal.status === 'approved_for_draft'
    ? '<div class="action-box"><strong class="status-ok">Approved for draft preparation</strong><div class="admin-sub">The next step is to add this reviewed change to a small release batch.</div><a class="primary-action" style="margin-top:12px;" href="/admin/release-candidates">Continue to publishing</a></div>'
    : `<div class="action-box"><strong>No approval action available</strong><div class="admin-sub">This proposal is ${escapeHtml(proposal.status)}. Review history records the completed decision.</div></div>`}
  <div class="action-box">
    <strong>Approval history</strong>
    ${approvalEvents.length ? `<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Reviewer</th><th>Note</th><th>When</th></tr></thead><tbody>${approvalEvents.map(event => `<tr><td>${escapeHtml(event.actor || '')}</td><td>${escapeHtml(event.note || '')}</td><td>${escapeHtml(event.createdAt || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="notice" style="margin-top:10px;">No draft approval has been recorded for this proposal.</div>'}
  </div>
</div>

<h2>Source evidence</h2>
<div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Retrieved</th><th>URL</th><th>Asset</th></tr></thead><tbody>
${source ? `<tr><td>${escapeHtml(source.sourceType || '')}</td><td><span class="pill">${escapeHtml(source.status || '')}</span></td><td>${escapeHtml(source.retrievedAt || '')}</td><td class="mono">${escapeHtml(source.originUrl || '')}</td><td class="mono">${escapeHtml(source.rawAssetPath || '')}</td></tr>` : '<tr><td colspan="5">No source linked to this proposal.</td></tr>'}
</tbody></table></div>

<details class="advanced-panel">
  <summary>Technical payload, diff and standalone export</summary>
  <div>
    <h2>Proposed payload</h2><pre class="json-block">${escapeHtml(payload)}</pre>
    <h2>Normalized payload</h2><pre class="json-block">${escapeHtml(normalized)}</pre>
    <h2>Diff</h2><pre class="json-block">${escapeHtml(diff)}</pre>
    <h2>Standalone export</h2>
    <form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/export">
      <strong>Export proposal for review</strong>
      <div class="admin-sub">Publishing normally prepares this from the release page. Use this only for technical inspection.</div>
      <button type="submit"${exportEligible ? '' : ' disabled'}>Export proposal for review</button>
      ${exportEligible ? '' : '<div class="notice" style="margin-top:10px;">Export is available only after validation passes and approval.</div>'}
    </form>
    <div class="table-wrap"><table><thead><tr><th>Status</th><th>Path</th><th>Created</th><th>By</th><th></th></tr></thead><tbody>
    ${exports.length ? exports.map(item => `<tr><td><span class="pill">${escapeHtml(item.validationStatus)}</span></td><td class="mono">${escapeHtml(item.exportPath)}</td><td>${escapeHtml(item.createdAt || '')}</td><td>${escapeHtml(item.createdBy || '')}</td><td><a href="/admin/proposal-exports/${escapeHtml(item.id)}">View</a></td></tr>`).join('') : '<tr><td colspan="5">No exports yet.</td></tr>'}
    </tbody></table></div>
  </div>
</details>

<h2>Review actions</h2>
<div class="proposal-actions">
  ${canRequestChanges ? `<form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Request changes</strong>
    <textarea name="note" required placeholder="Describe what needs to change."></textarea>
    <input type="hidden" name="action" value="request_changes">
    <button class="warn" type="submit">Request changes</button>
  </form>` : ''}
  ${canMarkNeedsVerification ? `<form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Mark needs verification</strong>
    <textarea name="note" required placeholder="Required: record why this needs verification before further review."></textarea>
    <input type="hidden" name="action" value="mark_needs_verification">
    <button type="submit">Mark needs verification</button>
  </form>` : ''}
  ${canReject ? `<form class="action-box" method="post" action="/admin/proposals/${escapeHtml(proposal.id)}/review">
    <strong>Reject proposal</strong>
    <textarea name="note" required placeholder="Required: record why this proposal is being rejected."></textarea>
    <input type="hidden" name="action" value="reject">
    <button class="reject" type="submit">Reject</button>
  </form>` : ''}
  ${!canRequestChanges && !canMarkNeedsVerification && !canReject ? '<div class="notice">No further review actions are available from this status.</div>' : ''}
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
    title: 'Publish',
    active: 'release_candidates',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Releases' }],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 04 / PUBLISH</div><h1>Publish reviewed changes</h1><div class="admin-sub">DB-backed release preparation is currently unavailable.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
<div class="notice">${escapeHtml(message)}</div>`,
  });
}

export function renderReleaseCandidatesPage({ releases }) {
  return adminShell({
    title: 'Publish',
    active: 'release_candidates',
    breadcrumbs: [{ href: '/admin/', label: 'Dashboard' }, { label: 'Releases' }],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 04 / PUBLISH</div><h1>Publish reviewed changes</h1><div class="admin-sub">Prepare small batches of approved changes, verify the plan, then use the guarded publish confirmation.</div></div><div><a class="primary-action" href="/admin/release-candidates/new">New publishing batch</a> <a class="logout" style="margin-left:10px" href="/admin/logout">Sign out</a></div></div>
<div class="table-wrap"><table><thead><tr><th>Status</th><th>Title</th><th>Items</th><th>Exports</th><th>Draft applies</th><th>Revisions</th><th>Updated</th><th></th></tr></thead><tbody>
${releases.length ? releases.map(release => `<tr><td><span class="pill">${escapeHtml(release.status)}</span></td><td>${escapeHtml(release.title)}</td><td>${escapeHtml(release.itemCount)}</td><td>${escapeHtml(release.exportedCount)}</td><td>${escapeHtml(release.draftAppliedCount)}</td><td>${escapeHtml(release.revisionCount)}</td><td>${escapeHtml(release.updatedAt || '')}</td><td><a href="/admin/release-candidates/${escapeHtml(release.id)}">Continue</a></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No publishing batches yet', 'Create a batch after one or more proposed changes have been approved.', '<a href="/admin/release-candidates/new">Create a publishing batch</a>')}</td></tr>`}
</tbody></table></div>`,
  });
}

export function renderReleaseCandidateCreatePage({ values = {}, error = null } = {}) {
  return adminShell({
    title: 'New publishing batch',
    active: 'release_candidates',
    breadcrumbs: [
      { href: '/admin/', label: 'Dashboard' },
      { href: '/admin/release-candidates', label: 'Releases' },
      { label: 'Create' },
    ],
    body: `
<div class="admin-top"><div><div class="content-desk-kicker">STEP 04 / PUBLISH</div><h1>New publishing batch</h1><div class="admin-sub">Group a small set of approved changes for one final plan and confirmation. Creating the batch does not publish.</div></div><a class="logout" href="/admin/logout">Sign out</a></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form class="action-box" method="post" action="/admin/release-candidates/new">
  <label for="title"><strong>Title</strong></label>
  <input id="title" name="title" value="${escapeHtml(values.title || '')}" required maxlength="255" style="display:block;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;margin-top:6px;" placeholder="July verified content draft">
  <div class="notice" style="margin-top:12px;">This creates an empty draft release candidate. Add only approved_for_draft proposals from the detail page.</div>
  <button type="submit">Create publishing batch</button>
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
  const blockingWarnings = summary.blocking_warnings || warnings.filter(warning => warning.blocking);
  const informationalWarnings = summary.informational_warnings || warnings.filter(warning => !warning.blocking);
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
    <div class="metric"><div class="metric-label">Info warnings</div><div class="metric-value ${informationalWarnings.length ? 'status-warn' : 'status-ok'}">${escapeHtml(summary.informational_warning_count || informationalWarnings.length)}</div></div>
  </section>

  <h2>Blocking warnings</h2>
  ${hasWarningCode(blockingWarnings, 'proposal_not_approved_for_draft') ? '<div class="error"><strong>Stale release artifacts.</strong><br>Release contains proposals that are no longer approved_for_draft. Regenerate release artifacts after proposal repair.</div>' : ''}
  <div class="table-wrap"><table><thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Proposal</th><th>File</th></tr></thead><tbody>
  ${blockingWarnings.length ? blockingWarnings.map(warning => `<tr><td><span class="pill">${escapeHtml(warning.severity)}</span></td><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td><td>${warning.proposal_id ? `<a href="/admin/proposals/${escapeHtml(warning.proposal_id)}">${escapeHtml(warning.proposal_id)}</a>` : '-'}</td><td class="mono">${escapeHtml(warning.file || '')}</td></tr>`).join('') : '<tr><td colspan="5"><span class="status-ok">No blocking warnings.</span></td></tr>'}
  </tbody></table></div>

  <h2>Informational warnings</h2>
  <div class="table-wrap"><table><thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Proposal</th><th>File</th></tr></thead><tbody>
  ${informationalWarnings.length ? informationalWarnings.map(warning => `<tr><td><span class="pill">${escapeHtml(warning.severity)}</span></td><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td><td>${warning.proposal_id ? `<a href="/admin/proposals/${escapeHtml(warning.proposal_id)}">${escapeHtml(warning.proposal_id)}</a>` : '-'}</td><td class="mono">${escapeHtml(warning.file || '')}</td></tr>`).join('') : '<tr><td colspan="5"><span class="status-ok">No informational warnings.</span></td></tr>'}
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
  const blockedByCurrentPolicy = release.status === 'ready_for_review' && Boolean(reviewSummary?.has_blocking_warnings);
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
${blockedByCurrentPolicy ? '<div class="error"><strong>Blocked by current policy warnings.</strong><br>This release is ready_for_review in stored workflow state, but current release-review policy has blocking warnings. Do not treat it as safely publishable until the warnings are resolved and a fresh apply plan is generated.</div>' : ''}
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
  ${reviewSummary?.has_blocking_warnings ? '<div class="notice" style="margin-top:10px;">Apply plan generation is blocked while review summary blocking warnings exist.</div>' : ''}
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
  const informationalWarnings = plan.informational_warnings || [];
  const changes = plan.changes || [];
  const changePreviewByKey = new Map(changes.map(change => [`${change.entity_type}:${change.entity_key}`, change]));
  const activeApply = latestApply && !['rolled_back', 'failed'].includes(latestApply.status);
  const canApplyLive = plan.status === 'ready_for_review' && warnings.length === 0 && !activeApply;
  const storage = plan.storage || {};
  const tmpStatusClass = storage.tmp_artifact_status === 'available' ? 'status-ok' : 'status-warn';
  const currentPolicyBlocked = warnings.length > 0 && plan.current_review_status?.generated_from_current_policy;
  const staleProposalBlocked = hasWarningCode(warnings, 'proposal_not_approved_for_draft');
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
${currentPolicyBlocked ? '<div class="error"><strong>Blocked by current policy warnings.</strong><br>This stored apply plan is not safe to live-apply as-is. Current review policy found blocking warnings after the plan was generated; regenerate only after resolving those warnings.</div>' : ''}
${staleProposalBlocked ? '<div class="error"><strong>Stale apply plan.</strong><br>Release contains proposals that are no longer approved_for_draft. Regenerate release artifacts after proposal repair.</div>' : ''}
<section class="metric-grid">
  <div class="metric"><div class="metric-label">Release status</div><div class="metric-value">${escapeHtml(plan.status)}</div></div>
  <div class="metric"><div class="metric-label">Changes</div><div class="metric-value">${escapeHtml(changes.length)}</div></div>
  <div class="metric"><div class="metric-label">Blocking warnings</div><div class="metric-value ${warnings.length ? 'status-bad' : 'status-ok'}">${escapeHtml(warnings.length)}</div></div>
  <div class="metric"><div class="metric-label">Info warnings</div><div class="metric-value ${informationalWarnings.length ? 'status-warn' : 'status-ok'}">${escapeHtml(informationalWarnings.length)}</div></div>
  <div class="metric"><div class="metric-label">Generated</div><div class="metric-value" style="font-size:15px;">${escapeHtml(plan.generated_at || '')}</div></div>
  <div class="metric"><div class="metric-label">Canonical storage</div><div class="metric-value status-ok">DB</div></div>
  <div class="metric"><div class="metric-label">Tmp artifacts</div><div class="metric-value ${tmpStatusClass}">${escapeHtml(storage.tmp_artifact_status || 'unknown')}</div></div>
</section>
<div class="notice" style="margin-top:14px;">The canonical apply plan is stored in MySQL${storage.db_plan_id ? ` as <span class="mono">release_apply_plans #${escapeHtml(storage.db_plan_id)}</span>` : ''}. Tmp files under <span class="mono">${escapeHtml(plan.plan_path || 'tmp/release-apply-plans')}</span> are convenience artifacts only and may be missing after deploy cleanup without invalidating this page.</div>
${storage.tmp_artifact_message ? `<div class="notice evidence-warning" style="margin-top:10px;">${escapeHtml(storage.tmp_artifact_message)}</div>` : ''}
${plan.current_review_status?.generated_from_current_policy ? `<div class="notice evidence-warning" style="margin-top:10px;"><strong>Current policy overlay.</strong><br>Warning counts on this page are recomputed from current release-review policy, not trusted only from the stored historical plan. Blocking: ${escapeHtml(plan.current_review_status.blocking_warning_count || 0)}. Info: ${escapeHtml(plan.current_review_status.informational_warning_count || 0)}.</div>` : ''}
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
<div class="table-wrap"><table><thead><tr><th>Order</th><th>File</th><th>Operation</th><th>Entity</th><th>Canonical path</th><th>Proposal</th><th>Revision</th></tr></thead><tbody>
${plan.ordered_file_changes?.length ? plan.ordered_file_changes.map(change => {
  const preview = changePreviewByKey.get(`${change.entity_type}:${change.entity_key}`) || change;
  const canonicalPath = canonicalSubjectPathForChange(preview);
  return `<tr><td>${escapeHtml(change.order)}</td><td class="mono">${escapeHtml(change.file)}</td><td><span class="pill">${escapeHtml(change.operation)}</span></td><td>${escapeHtml(change.entity_type)}<br><span class="mono">${escapeHtml(change.entity_key)}</span></td><td class="mono">${escapeHtml(canonicalPath || '')}</td><td><a href="/admin/proposals/${escapeHtml(change.proposal_id)}">${escapeHtml(change.proposal_id)}</a></td><td>${change.revision_id ? `<a href="/admin/revisions/${escapeHtml(change.revision_id)}">${escapeHtml(change.revision_id)}</a>` : '-'}</td></tr>`;
}).join('') : '<tr><td colspan="7">No changes in this plan.</td></tr>'}
</tbody></table></div>

<h2>Canonical public URL checks</h2>
<div class="notice" style="margin-bottom:10px;">After live apply and deploy, verify generated subject URLs from <span class="mono">seo.slug || id</span>. Entity keys are stable content identifiers and are not always URL slugs.</div>
<div class="table-wrap"><table><thead><tr><th>Entity key</th><th>Expected path</th><th>Post-apply status</th></tr></thead><tbody>
${canonicalSubjectPathRows(changes)}
</tbody></table></div>

<h2>Warnings</h2>
<div class="table-wrap"><table><thead><tr><th>Code</th><th>Message</th></tr></thead><tbody>
${warnings.length ? warnings.map(warning => `<tr><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td></tr>`).join('') : '<tr><td colspan="2"><span class="status-ok">No final warnings.</span></td></tr>'}
</tbody></table></div>

<h2>Informational warnings</h2>
<div class="table-wrap"><table><thead><tr><th>Code</th><th>Message</th></tr></thead><tbody>
${informationalWarnings.length ? informationalWarnings.map(warning => `<tr><td class="mono">${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.message)}</td></tr>`).join('') : '<tr><td colspan="2"><span class="status-ok">No informational warnings.</span></td></tr>'}
</tbody></table></div>

<h2>Before / after entity preview</h2>
${changes.map(change => `<div class="action-box"><strong>${escapeHtml(change.operation)} ${escapeHtml(change.entity_type)} / <span class="mono">${escapeHtml(change.entity_key)}</span></strong><div class="admin-sub">${escapeHtml(change.file)}</div><h2>Before</h2><pre class="json-block">${escapeHtml(JSON.stringify(change.before_json, null, 2) || 'null')}</pre><h2>After</h2><pre class="json-block">${escapeHtml(JSON.stringify(change.after_json, null, 2) || 'null')}</pre></div>`).join('') || '<div class="notice">No entity previews available.</div>'}

<h2>Combined patch</h2>
<pre class="json-block">${escapeHtml(JSON.stringify(plan.combined_patch || [], null, 2))}</pre>

<h2>Rollback notes</h2>
<div class="notice">Rollback notes are written to <span class="mono">${escapeHtml(plan.rollback_notes_file || 'rollback-notes.md')}</span> inside the apply-plan folder. Because this plan is not applied, rollback means no production action is needed unless a human later applies these changes manually.</div>`,
  });
}

export function renderReleaseLiveApplyDetailPage({ result, plan = null, rollbackPhrase = 'ROLLBACK LIVE JSON', error = null }) {
  if (!result) {
    return renderReleaseCandidateUnavailablePage({ message: error || 'Release live apply result not found.' });
  }
  const canVerify = ['files_written', 'verification_running', 'partial_applied', 'recovered_applied', 'manual_rollback_required', 'published_pending_deploy', 'published_pending_deploy_recovered'].includes(result.status);
  const canRollback = Boolean(result.backupExists && result.backupPath && ['files_written', 'partial_applied', 'recovered_applied', 'published_pending_deploy', 'published_pending_deploy_recovered', 'committed_pending_push', 'failed'].includes(result.status));
  const manualRollback = !result.backupExists && result.changedFiles.length > 0 && [
    'files_written',
    'partial_applied',
    'recovered_applied',
    'manual_rollback_required',
    'published_pending_deploy',
    'published_pending_deploy_recovered',
    'committed_pending_push',
    'failed',
  ].includes(result.status);
  const changes = plan?.changes || [];
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
${result.status === 'committed_pending_push' ? `<div class="notice evidence-warning" style="margin-top:10px;"><strong>Committed locally.</strong> git commit <span class="mono">${escapeHtml((result.gitCommitSha || '').slice(0, 12))}</span>${result.gitCommittedAt ? ` at ${escapeHtml(result.gitCommittedAt)}` : ''}. Not pushed to origin yet -- push manually when ready.</div>` : ''}
${result.gitCommitError ? `<div class="notice" style="margin-top:10px;border:2px solid var(--bad);background:#fff5f5;color:var(--bad);"><strong>Automatic git commit failed.</strong> ${escapeHtml(result.gitCommitError)}<br>Data is live but not in git. Commit this manually, or run <span class="mono">scripts/reconcile-live-apply.js ${escapeHtml(result.id)} --note="..."</span> once you've confirmed it's reconciled some other way.</div>` : ''}
${result.errorMessage ? `<div class="error">${escapeHtml(result.errorMessage)}</div>` : ''}

<h2>Changed files</h2>
<div class="table-wrap"><table><thead><tr><th>File</th></tr></thead><tbody>
${result.changedFiles.length ? result.changedFiles.map(file => `<tr><td class="mono">${escapeHtml(file)}</td></tr>`).join('') : '<tr><td>No files recorded.</td></tr>'}
</tbody></table></div>

<h2>Canonical public URL checks</h2>
<div class="notice" style="margin-bottom:10px;">Verify public subject pages with the generated path from <span class="mono">seo.slug || id</span>. Do not assume the entity key is the URL slug.</div>
<div class="table-wrap"><table><thead><tr><th>Entity key</th><th>Expected path</th><th>Post-apply status</th></tr></thead><tbody>
${canonicalSubjectPathRows(changes)}
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
