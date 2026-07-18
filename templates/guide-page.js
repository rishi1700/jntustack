import { escapeHtml } from './layout.js';

function displayDate(value = '') {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function sectionBody(section) {
  const paragraphs = Array.isArray(section.body) ? section.body : [section.body];
  return paragraphs.filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
}

export function renderGuidePage(guide) {
  const sourceUrl = guide.source?.origin_url;
  const checked = guide.source?.retrieved_date;
  const tableOfContents = guide.sections.map(section =>
    `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a></li>`
  ).join('');
  const sections = guide.sections.map(section => `<section class="editorial-guide-section" id="${escapeHtml(section.id)}">
    <h2>${escapeHtml(section.title)}</h2>
    ${sectionBody(section)}
  </section>`).join('\n');

  return `
<nav class="page-breadcrumb" aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li aria-current="page">${escapeHtml(guide.name)}</li>
  </ol>
</nav>

<article class="editorial-guide">
  <header class="editorial-guide-head">
    <div class="pill-row"><span class="pill">${escapeHtml(guide.regulation)}</span><span class="pill pill--verified">&#10003; VERIFIED GUIDE</span></div>
    <h1 class="subject-title">${escapeHtml(guide.name)}</h1>
    ${guide.intro ? `<p class="guide-intro">${escapeHtml(guide.intro)}</p>` : ''}
  </header>

  <aside class="editorial-guide-toc" aria-label="On this page">
    <strong class="mono">ON THIS PAGE</strong>
    <ol>${tableOfContents}</ol>
  </aside>

  ${sections}

  <section class="source-docket" aria-labelledby="guide-source-title">
    <div class="source-docket-head">
      <div><span class="source-docket-kicker mono">SOURCE DOCKET</span><h2 id="guide-source-title">Official regulation evidence</h2></div>
      <span class="source-docket-status">&#10003; Verified</span>
    </div>
    <dl class="source-docket-grid">
      <div><dt>Source</dt><dd>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official ${escapeHtml(guide.regulation)} regulations <span aria-hidden="true">&#8599;</span></a>` : 'Source URL not recorded'}</dd></div>
      <div><dt>Checked</dt><dd>${checked ? `<time datetime="${escapeHtml(checked)}">${escapeHtml(displayDate(checked))}</time>` : 'Date not recorded'}</dd></div>
    </dl>
    ${guide.source?.college_source_note ? `<p class="source-docket-scope"><strong>Scope note</strong>${escapeHtml(guide.source.college_source_note)}</p>` : ''}
  </section>
</article>`;
}
