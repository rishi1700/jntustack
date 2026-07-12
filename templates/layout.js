import { renderSearchBar, searchBarScript } from './search-bar.js';

export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Stamp is the signature element: it makes the verified/needs_verification/
// placeholder status -- the thing that actually protects content quality --
// visible on the page itself, not just in a JSON field nobody sees.
function stampMarkup(status) {
  if (status === 'verified') {
    return `<div class="stamp stamp--verified" aria-hidden="true">VERIFIED<span>vs. published syllabus</span></div>`;
  }
  if (status === 'needs_verification') {
    return `<div class="stamp stamp--draft" aria-hidden="true">DRAFT<span>not yet verified &mdash; internal preview only</span></div>`;
  }
  return `<div class="stamp stamp--draft" aria-hidden="true">PLACEHOLDER<span>no source yet &mdash; do not publish</span></div>`;
}


export function layout({ title, description, canonical, jsonLd, bodyHtml, stamp, navBranches = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="google-site-verification" content="5esvFUc-qzMRnp0UPJUJU-KhwEswnbysH32nnWdTLig" />
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/icon-512.png" sizes="512x512">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
<script src="/theme-toggle.js"></script>
<script src="/mobile-nav.js"></script>
<link rel="stylesheet" href="/teal-brand.css">
</head>
<body>
${stamp ? stampMarkup(stamp) : ''}
<header class="site-header">
  <a class="brand" href="/" aria-label="JNTUStack home"><svg class="brand-logo" viewBox="0 0 900 260" width="152" height="44" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g transform="translate(130,146)"><polygon points="0,60 104,22 0,-16 -104,22" style="fill:var(--logo-bot)"/><polygon points="0,22 92,-12 0,-46 -92,-12" style="fill:var(--logo-mid)"/><polygon points="0,-16 80,-46 0,-76 -80,-46" style="fill:var(--logo-top)"/></g><text x="268" y="164" font-family="'IBM Plex Sans','Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="92" letter-spacing="-2" style="fill:var(--text)">JNTUStack</text></svg></a>
  ${renderSearchBar()}
  <button id="mobileNavToggle" class="mobile-nav-toggle" type="button" aria-controls="topNav" aria-expanded="false">
    <span class="mobile-nav-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>
    <span>Menu</span>
  </button>
  <nav id="topNav" class="top-nav" aria-label="Main navigation">
    <div class="nav-branches">
      <button type="button" class="nav-branches-toggle" aria-haspopup="true" aria-controls="branchMenu" aria-expanded="false">Branches <span aria-hidden="true">&#9662;</span></button>
      <div id="branchMenu" class="nav-branches-menu">
        ${navBranches.map(b => b.published
          ? `<a class="nav-branch" href="${escapeHtml(b.href)}"><span>${escapeHtml(b.name)} (${escapeHtml(b.code)})</span><span class="nav-branch-count">${b.verifiedCount}</span></a>`
          : `<span class="nav-branch nav-branch--disabled" aria-disabled="true"><span>${escapeHtml(b.name)} (${escapeHtml(b.code)})</span><span class="nav-branch-soon">not yet available</span></span>`
        ).join('')}
      </div>
    </div>
    <a href="/colleges/">Colleges</a>
    <a href="/branch-guide/">Choosing a Branch?</a>
    <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle day / night">&#9790; Night</button>
  </nav>
</header>
<main>
${bodyHtml}
</main>
<footer class="site-footer site-footer--slate">
  <div class="footer-inner">
    <div class="footer-top">
      <div>
        <div style="display:flex;align-items:center;gap:.6rem;">
          <svg width="22" height="22" viewBox="0 0 260 260" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g transform="translate(130,146)"><polygon points="0,60 104,22 0,-16 -104,22" fill="#EAF4F2"/><polygon points="0,22 92,-12 0,-46 -92,-12" fill="#4E736D"/><polygon points="0,-16 80,-46 0,-76 -80,-46" fill="#00B8A9"/></g></svg>
          <span class="footer-brand">JNTUStack</span>
        </div>
        <p class="footer-tag">Built page by page, checked against a published source before it goes live.</p>
      </div>
      <nav class="footer-links" aria-label="Footer">
        <a href="/colleges/">Colleges</a>
        <a href="/branch-guide/">Choosing a Branch?</a>
      </nav>
    </div>
    <p class="footer-note">&copy; ${new Date().getFullYear()} JNTUStack &middot; Independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV &middot; No fabricated placement or salary stats</p>
  </div>
</footer>
${searchBarScript()}
</body>
</html>`;
}
