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
    return `<div class="stamp stamp--verified" aria-hidden="true">VERIFIED<span>vs. official syllabus</span></div>`;
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
<link href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
<script src="/theme-toggle.js"></script>
<link rel="stylesheet" href="/teal-brand.css">
</head>
<body>
${stamp ? stampMarkup(stamp) : ''}
<header class="site-header">
  <a class="brand" href="/" aria-label="JNTUStack home"><svg class="brand-logo" viewBox="0 0 900 260" width="118" height="34" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g transform="translate(130,130)"><g style="stroke:var(--logo-mid)" stroke-width="3" opacity="0.55"><line x1="-108" y1="-6" x2="-70" y2="-6"/><line x1="-108" y1="20" x2="-64" y2="20"/><line x1="108" y1="-6" x2="70" y2="-6"/><line x1="108" y1="20" x2="64" y2="20"/></g><polygon points="0,42 92,20 0,-2 -92,20" style="fill:var(--logo-bot);stroke:var(--bar)" stroke-width="4"/><polygon points="0,16 84,-4 0,-24 -84,-4" style="fill:var(--logo-mid);stroke:var(--bar)" stroke-width="4"/><polygon points="0,-10 76,-28 0,-46 -76,-28" style="fill:var(--logo-top);stroke:var(--bar)" stroke-width="4"/><g style="fill:var(--logo-mid)"><circle cx="-108" cy="-6" r="7"/><circle cx="-108" cy="20" r="7"/><circle cx="108" cy="-6" r="7"/><circle cx="108" cy="20" r="7"/></g></g><text x="290" y="150" font-family="'IBM Plex Sans','Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="88" style="fill:var(--text)">JNTUStack</text></svg></a>
  ${renderSearchBar()}
  <nav class="top-nav" aria-label="Main navigation">
    <div class="nav-branches">
      <button type="button" class="nav-branches-toggle" aria-haspopup="true">Branches <span aria-hidden="true">&#9662;</span></button>
      <div class="nav-branches-menu">
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
<footer class="site-footer">
  <a class="telegram-cta" href="#" target="_blank" rel="noopener">Join the Telegram channel for new uploads &rarr;</a>
  <p>&copy; ${new Date().getFullYear()} JNTUStack. Independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV.</p>
</footer>
${searchBarScript()}
</body>
</html>`;
}
