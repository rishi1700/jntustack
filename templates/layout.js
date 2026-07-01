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

const baseStyles = `
  :root{
    --ink:#1B2A4A;
    --ink-soft:#33456B;
    --paper:#FAF8F3;
    --paper-raised:#FFFFFF;
    --marigold:#C97A0A;
    --rule:#DAD3C2;
    --verified:#2F6D4F;
    --text-muted:#5B5648;
    --radius:3px;
  }
  *{box-sizing:border-box;}
  html{-webkit-text-size-adjust:100%;}
  body{
    margin:0;
    background:var(--paper);
    color:var(--ink);
    font-family:"IBM Plex Sans",system-ui,sans-serif;
    font-size:16px;
    line-height:1.55;
  }
  h1,h2,h3{
    font-family:"Zilla Slab",Georgia,serif;
    font-weight:600;
    color:var(--ink);
    margin:0 0 .5rem;
  }
  a{color:var(--ink-soft);}
  .mono{font-family:"IBM Plex Mono",monospace;}

  .site-header{
    display:flex;align-items:center;justify-content:space-between;
    padding:.85rem 1.25rem;border-bottom:2px solid var(--ink);
    background:var(--paper-raised);
  }
  .brand{font-family:"Zilla Slab",serif;font-weight:700;font-size:1.15rem;text-decoration:none;color:var(--ink);}
  .top-nav{display:flex;gap:1rem;font-size:.85rem;font-weight:500;}
  .top-nav a{text-decoration:none;color:var(--ink-soft);}
  .top-nav a:hover{color:var(--marigold);}

  main{max-width:760px;margin:0 auto;padding:1.5rem 1.25rem 3rem;}

  .form-strip{
    display:flex;flex-wrap:wrap;gap:0 1.5rem;
    font-family:"IBM Plex Mono",monospace;font-size:.72rem;letter-spacing:.04em;
    text-transform:uppercase;color:var(--text-muted);
    border:1px solid var(--rule);background:var(--paper-raised);
    padding:.6rem .9rem;border-radius:var(--radius);margin-bottom:1.1rem;
  }
  .form-strip b{color:var(--ink);font-weight:600;}

  h1.subject-title{font-size:1.7rem;line-height:1.25;}

  .status-row{display:flex;align-items:center;gap:.6rem;margin:.4rem 0 1.4rem;font-size:.85rem;color:var(--text-muted);}
  .badge{
    display:inline-block;padding:.15rem .55rem;border-radius:99px;
    font-size:.7rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
  }
  .badge--verified{background:#E4F1EA;color:var(--verified);}
  .badge--draft{background:#F7E9D6;color:var(--marigold);}

  .stamp{
    position:fixed;top:90px;right:18px;z-index:50;
    border:2.5px solid;border-radius:6px;padding:.5rem .8rem;
    transform:rotate(6deg);font-family:"IBM Plex Mono",monospace;
    font-weight:700;font-size:.78rem;letter-spacing:.06em;text-align:center;
    background:rgba(250,248,243,.92);
  }
  .stamp span{display:block;font-weight:500;text-transform:none;letter-spacing:0;font-size:.62rem;margin-top:.15rem;max-width:140px;}
  .stamp--verified{border-color:var(--verified);color:var(--verified);}
  .stamp--draft{border-color:var(--marigold);color:var(--marigold);}

  section{margin-bottom:1.8rem;}
  .units-list{list-style:none;margin:0;padding:0;counter-reset:unit;}
  .units-list li{
    counter-increment:unit;position:relative;padding:.7rem 0 .7rem 2.6rem;
    border-bottom:1px solid var(--rule);
  }
  .units-list li::before{
    content:"Unit " counter(unit);
    position:absolute;left:0;top:.7rem;
    font-family:"IBM Plex Mono",monospace;font-size:.7rem;font-weight:600;
    color:var(--marigold);
  }
  .units-list .unit-title{font-weight:600;margin-bottom:.2rem;}
  .units-list .unit-topics{font-size:.92rem;color:var(--text-muted);}

  .empty-state{
    border:1px dashed var(--rule);border-radius:var(--radius);
    padding:1rem;font-size:.9rem;color:var(--text-muted);background:var(--paper-raised);
  }

  .resources-box{
    border:1.5px solid var(--ink);border-radius:var(--radius);
    padding:1rem;background:var(--paper-raised);
  }
  .resources-box a.download{
    display:inline-block;margin:.3rem .5rem .3rem 0;padding:.55rem .9rem;
    background:var(--ink);color:#fff;text-decoration:none;border-radius:var(--radius);
    font-weight:600;font-size:.88rem;
  }
  .resources-box a.download:hover{background:var(--ink-soft);}

  /* Ad slots are visually separated and never adjacent to .resources-box,
     per AdSense placement policy -- don't move these without checking that. */
  .ad-slot{
    margin:1.6rem 0;padding:.4rem;text-align:center;
    font-size:.65rem;color:#9c9484;border:1px dotted var(--rule);
  }

  .legacy-callout{
    font-size:.88rem;border-left:3px solid var(--marigold);
    padding:.6rem .9rem;background:#FBF3E6;border-radius:0 var(--radius) var(--radius) 0;
  }

  .site-footer{
    border-top:2px solid var(--ink);padding:1.4rem 1.25rem;text-align:center;
    font-size:.82rem;color:var(--text-muted);
  }
  .telegram-cta{
    display:inline-block;margin-bottom:.6rem;font-weight:600;color:var(--ink);
    text-decoration:none;border-bottom:2px solid var(--marigold);
  }

  @media (max-width:480px){
    .stamp{top:64px;right:10px;padding:.35rem .55rem;font-size:.68rem;}
    h1.subject-title{font-size:1.4rem;}
  }

  /* --- Branch guide: quiz + comparison --- */
  .guide-intro{font-size:1rem;color:var(--text-muted);max-width:62ch;}
  .disclaimer-box{
    border:1px dashed var(--rule);border-radius:var(--radius);
    padding:.85rem 1rem;font-size:.85rem;color:var(--text-muted);
    background:var(--paper-raised);margin:1.2rem 0;
  }
  .progress-bar{height:4px;background:var(--rule);border-radius:99px;margin-bottom:1.2rem;overflow:hidden;}
  .progress-bar-fill{height:100%;background:var(--marigold);width:0%;transition:width .25s ease;}
  .quiz-card{border:1.5px solid var(--ink);border-radius:var(--radius);padding:1.3rem;background:var(--paper-raised);}
  .quiz-question{font-family:"Zilla Slab",serif;font-size:1.2rem;margin-bottom:1rem;}
  .quiz-options{display:flex;flex-direction:column;gap:.55rem;}
  .quiz-option{
    text-align:left;padding:.7rem .9rem;border:1px solid var(--rule);border-radius:var(--radius);
    background:#fff;font-family:inherit;font-size:.95rem;cursor:pointer;color:var(--ink);
  }
  .quiz-option:hover{border-color:var(--marigold);background:#FBF3E6;}
  .quiz-nav{display:flex;justify-content:space-between;margin-top:1.1rem;font-size:.85rem;}
  .quiz-nav button{background:none;border:none;color:var(--ink-soft);cursor:pointer;text-decoration:underline;padding:0;}

  .result-card{
    border:1.5px solid var(--verified);border-radius:var(--radius);padding:1.1rem;
    background:#F1F8F4;margin-bottom:.9rem;
  }
  .result-card h3{margin-bottom:.3rem;}
  .result-rank{font-family:"IBM Plex Mono",monospace;font-size:.7rem;color:var(--verified);text-transform:uppercase;letter-spacing:.05em;}
  .result-reasons{font-size:.9rem;color:var(--text-muted);margin-top:.4rem;}

  .branch-compare-grid{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr));gap:1rem;
    /* The reading column (main) is 760px -- too narrow for two 380px tracks, so
       auto-fit would collapse to one column even on desktop. Let ONLY the
       comparison grid break out wider than main (centred on the viewport) so it's
       genuinely two-up on desktop while still collapsing to one on narrow screens. */
    width:min(92vw,1040px);margin-left:50%;transform:translateX(-50%);
  }
  .branch-compare-card{border:1px solid var(--rule);border-radius:var(--radius);padding:1.1rem;background:var(--paper-raised);}
  .content-status{
    display:inline-block;margin:.15rem 0 .5rem;padding:.2rem .65rem;border-radius:99px;
    font-family:"IBM Plex Mono",monospace;font-size:.68rem;font-weight:600;letter-spacing:.03em;text-decoration:none;
  }
  .content-status--available{background:#E4F1EA;color:var(--verified);}
  .content-status--available:hover{background:#D3E8DC;color:var(--verified);}
  .content-status--none{background:#ECE7DA;color:var(--text-muted);}
  .result-status{margin:.2rem 0 .1rem;}
  .branch-compare-card h3{font-size:1.1rem;margin-bottom:.2rem;}
  .branch-compare-card .tagline{font-size:.9rem;color:var(--text-muted);margin-bottom:.7rem;}
  .fit-list,.nonfit-list{margin:0 0 .6rem;padding-left:1.1rem;font-size:.87rem;}
  .fit-list li{color:var(--ink-soft);}
  .nonfit-list li{color:var(--text-muted);}
  .compare-label{font-family:"IBM Plex Mono",monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--marigold);margin:.6rem 0 .25rem;}

  /* --- College directory --- */
  .district-filter{display:flex;flex-wrap:wrap;gap:.5rem;margin:1.2rem 0 .4rem;}
  .district-btn{
    padding:.4rem .8rem;border:1px solid var(--rule);border-radius:99px;
    background:var(--paper-raised);font-family:"IBM Plex Mono",monospace;
    font-size:.72rem;letter-spacing:.03em;text-transform:uppercase;
    color:var(--ink-soft);cursor:pointer;
  }
  .district-btn:hover{border-color:var(--marigold);color:var(--marigold);}
  .district-btn[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink);}
  .college-count{font-family:"IBM Plex Mono",monospace;font-size:.74rem;color:var(--text-muted);margin:.2rem 0 1.4rem;}
  .college-type-group h2{font-size:1.25rem;border-bottom:1px solid var(--rule);padding-bottom:.3rem;}
  .college-type-group .group-count{font-family:"IBM Plex Mono",monospace;font-size:.8rem;font-weight:400;color:var(--text-muted);}
  .college-grid{display:grid;grid-template-columns:1fr;gap:.8rem;margin-top:.9rem;}
  .college-card{border:1px solid var(--rule);border-radius:var(--radius);padding:.9rem 1rem;background:var(--paper-raised);}
  .college-card h3{font-size:1.02rem;line-height:1.3;margin-bottom:.45rem;}
  .college-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.35rem;}
  .college-type-badge{
    display:inline-block;padding:.12rem .5rem;border-radius:99px;
    font-size:.66rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;
    background:#ECE7DA;color:var(--ink-soft);
  }
  .college-district{font-size:.85rem;color:var(--text-muted);}
  .college-codes{font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem;}
  .college-link{display:inline-block;font-size:.85rem;font-weight:600;color:var(--ink-soft);text-decoration:none;border-bottom:1px solid var(--marigold);}
  .college-link:hover{color:var(--marigold);}
  @media (min-width:560px){.college-grid{grid-template-columns:1fr 1fr;}}

  /* --- Branch hub --- */
  .hub-breadcrumb{display:inline-block;margin-bottom:1rem;font-size:.82rem;font-weight:600;color:var(--ink-soft);text-decoration:none;}
  .hub-breadcrumb:hover{color:var(--marigold);}
  .hub-sem-group h2{font-size:1.2rem;border-bottom:1px solid var(--rule);padding-bottom:.3rem;}
  .hub-subject-list{list-style:none;margin:.6rem 0 0;padding:0;}
  .hub-subject-list li{padding:.6rem 0;border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;}
  .hub-subject-list a{font-weight:600;color:var(--ink);text-decoration:none;border-bottom:1px solid var(--marigold);}
  .hub-subject-list a:hover{color:var(--marigold);}
  .hub-reg{font-size:.66rem;color:var(--text-muted);background:#ECE7DA;padding:.1rem .45rem;border-radius:99px;letter-spacing:.03em;}

  /* --- Header search bar --- */
  .site-search{position:relative;flex:1 1 auto;max-width:340px;margin:0 1rem;}
  .site-search-input{
    width:100%;padding:.5rem .85rem;border:1.5px solid var(--rule);border-radius:99px;
    background:var(--paper);font-family:inherit;font-size:.85rem;color:var(--ink);
  }
  .site-search-input:focus{outline:none;border-color:var(--marigold);background:var(--paper-raised);}
  .site-search-input::placeholder{color:#9c9484;}
  .site-search-results{
    position:absolute;left:0;right:0;top:calc(100% + .35rem);z-index:60;
    background:var(--paper-raised);border:1.5px solid var(--ink);border-radius:var(--radius);
    box-shadow:0 6px 20px rgba(27,42,74,.12);max-height:60vh;overflow-y:auto;
  }
  .site-search-hit{
    display:flex;align-items:center;justify-content:space-between;gap:.6rem;
    padding:.55rem .8rem;text-decoration:none;color:var(--ink);
    border-bottom:1px solid var(--rule);font-size:.85rem;
  }
  .site-search-hit:last-child{border-bottom:none;}
  .site-search-hit:hover,.site-search-hit:focus{background:#FBF3E6;color:var(--marigold);}
  .site-search-hit-title{font-weight:500;line-height:1.3;}
  .site-search-badge{
    flex:none;font-family:"IBM Plex Mono",monospace;font-size:.6rem;font-weight:600;
    text-transform:uppercase;letter-spacing:.04em;padding:.12rem .45rem;border-radius:99px;
    background:#ECE7DA;color:var(--ink-soft);
  }
  .site-search-badge--subject{background:#E4F1EA;color:var(--verified);}
  .site-search-badge--branch_profile{background:#F7E9D6;color:var(--marigold);}
  .site-search-badge--college{background:#E7ECF5;color:var(--ink-soft);}
  .site-search-empty{padding:.7rem .8rem;font-size:.82rem;color:var(--text-muted);}

  /* --- Branches dropdown nav --- */
  .nav-branches{position:relative;}
  .nav-branches-toggle{
    font-family:inherit;font-size:.85rem;font-weight:500;color:var(--ink-soft);
    background:none;border:none;cursor:pointer;padding:0;
  }
  .nav-branches-toggle:hover{color:var(--marigold);}
  .nav-branches-menu{
    display:none;position:absolute;right:0;top:calc(100% + .5rem);z-index:60;min-width:240px;
    background:var(--paper-raised);border:1.5px solid var(--ink);border-radius:var(--radius);
    box-shadow:0 6px 20px rgba(27,42,74,.12);overflow:hidden;
  }
  .nav-branches:hover .nav-branches-menu,
  .nav-branches:focus-within .nav-branches-menu{display:block;}
  .nav-branch{
    display:flex;align-items:center;justify-content:space-between;gap:.8rem;
    padding:.5rem .8rem;font-size:.82rem;border-bottom:1px solid var(--rule);text-decoration:none;
  }
  .nav-branch:last-child{border-bottom:none;}
  a.nav-branch{color:var(--ink);}
  a.nav-branch:hover,a.nav-branch:focus{background:#FBF3E6;color:var(--marigold);}
  .nav-branch-count{
    flex:none;font-family:"IBM Plex Mono",monospace;font-size:.62rem;font-weight:600;
    background:#E4F1EA;color:var(--verified);padding:.1rem .45rem;border-radius:99px;
  }
  .nav-branch--disabled{color:#A9A290;cursor:not-allowed;}
  .nav-branch-soon{
    flex:none;font-family:"IBM Plex Mono",monospace;font-size:.58rem;text-transform:uppercase;
    letter-spacing:.03em;color:#A9A290;
  }

  /* --- Homepage CTA row + branch grid --- */
  .badge--soon{background:#F7E9D6;color:var(--marigold);margin-left:.35rem;vertical-align:middle;}
  .home-cta-row{display:grid;grid-template-columns:1fr;gap:1rem;margin-bottom:2rem;}
  .home-cta-card{
    display:block;border:1.5px solid var(--ink);border-radius:var(--radius);padding:1.1rem;
    background:var(--paper-raised);text-decoration:none;color:var(--ink);
  }
  a.home-cta-card:hover{border-color:var(--marigold);}
  .home-cta-card h3{font-size:1.08rem;margin-bottom:.3rem;}
  .home-cta-card .tagline{font-size:.88rem;color:var(--text-muted);margin:0 0 .7rem;}
  .home-cta-go{font-size:.85rem;font-weight:600;color:var(--marigold);}
  .home-cta-card--soon{border-style:dashed;border-color:var(--rule);}
  .home-cta-go--muted{color:var(--text-muted);font-weight:600;font-size:.85rem;}
  @media (min-width:640px){.home-cta-row{grid-template-columns:1fr 1fr 1fr;}}

  .branch-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-top:.9rem;}
  @media (min-width:560px){.branch-grid{grid-template-columns:1fr 1fr 1fr;}}
  .branch-tile{
    display:flex;flex-direction:column;gap:.2rem;padding:.85rem .9rem;
    border:1px solid var(--rule);border-radius:var(--radius);background:var(--paper-raised);
    text-decoration:none;
  }
  a.branch-tile:hover{border-color:var(--marigold);}
  .branch-tile-code{font-family:"Zilla Slab",serif;font-weight:700;font-size:1.05rem;color:var(--ink);}
  .branch-tile-name{font-size:.82rem;color:var(--ink-soft);}
  .branch-tile-count{font-family:"IBM Plex Mono",monospace;font-size:.66rem;color:var(--verified);margin-top:.15rem;}
  .branch-tile--disabled{opacity:.55;}
  .branch-tile--disabled .branch-tile-code{color:var(--text-muted);}
  .branch-tile-soon{font-family:"IBM Plex Mono",monospace;font-size:.62rem;text-transform:uppercase;letter-spacing:.03em;color:#A9A290;margin-top:.15rem;}

  @media (max-width:560px){
    .site-header{flex-wrap:wrap;gap:.5rem;}
    .site-search{order:3;flex-basis:100%;max-width:none;margin:.2rem 0 0;}
  }
`;

export function layout({ title, description, canonical, jsonLd, bodyHtml, stamp, navBranches = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="google-site-verification" content="5esvFUc-qzMRnp0UPJUJU-KhwEswnbysH32nnWdTLig" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
<style>${baseStyles}</style>
</head>
<body>
${stamp ? stampMarkup(stamp) : ''}
<header class="site-header">
  <a class="brand" href="/">JNTUStack</a>
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
