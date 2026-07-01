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
<link rel="stylesheet" href="/night-study.css">
</head>
<body>
${stamp ? stampMarkup(stamp) : ''}
<header class="site-header">
  <a class="brand" href="/" aria-label="JNTUStack home"><img class="brand-logo" src="/jntustack-lockup.svg" alt="JNTUStack" width="131" height="38"></a>
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
    <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle day / night">&#9728; Day</button>
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
