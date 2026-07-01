// Header search bar. The client script imports the SAME matching logic the
// build uses (/retrieve.js, copied into dist/ at build time) and runs it over
// the already-built /search-index.json. The matching logic is NOT reimplemented
// here -- doing so would let the in-page ranking drift from the build-time index,
// exactly the kind of duplication this project avoids.

export function renderSearchBar() {
  return `<div class="site-search" role="search">
    <input type="search" class="site-search-input" data-search-input autocomplete="off"
      placeholder="Search subjects, branches, colleges..." aria-label="Search JNTUStack" />
    <div class="site-search-results" data-search-results role="listbox" aria-label="Search results" hidden></div>
  </div>`;
}

export function searchBarScript() {
  return `<script type="module">
import { retrieve } from '/retrieve.js';

const input = document.querySelector('[data-search-input]');
const panel = document.querySelector('[data-search-results]');
if (input && panel) {
  const TYPE_LABEL = { subject: 'Subject', branch_profile: 'Branch', college: 'College' };
  let docs = null, loading = null;

  function loadIndex() {
    if (docs) return Promise.resolve(docs);
    if (!loading) loading = fetch('/search-index.json')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { docs = Array.isArray(d) ? d : []; return docs; })
      .catch(() => { docs = []; return docs; });
    return loading;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function render(hits, q) {
    if (!q) { panel.hidden = true; panel.innerHTML = ''; return; }
    const linkable = hits.filter(h => h && h.url); // never render a result we can't link to
    if (!linkable.length) {
      panel.hidden = false;
      panel.innerHTML = '<div class="site-search-empty">No matches for &ldquo;' + esc(q) + '&rdquo; yet. Only verified pages are searchable.</div>';
      return;
    }
    panel.hidden = false;
    panel.innerHTML = linkable.map(h =>
      '<a class="site-search-hit" role="option" href="' + esc(h.url) + '">' +
        '<span class="site-search-hit-title">' + esc(h.title) + '</span>' +
        '<span class="site-search-badge site-search-badge--' + esc(h.type) + '">' + esc(TYPE_LABEL[h.type] || h.type) + '</span>' +
      '</a>'
    ).join('');
  }

  let debounce;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const index = await loadIndex();
      render(retrieve(index, q, 8), q);
    }, 120);
  });
  input.addEventListener('focus', loadIndex);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { panel.hidden = true; input.blur(); } });
  document.addEventListener('click', (e) => {
    if (e.target !== input && !panel.contains(e.target)) panel.hidden = true;
  });
}
</script>`;
}
