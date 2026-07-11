import { escapeHtml } from './layout.js';

// Each quiz option carries weights toward branch codes. Kept deliberately
// simple and transparent -- a student could read this scoring and understand
// exactly why a branch was suggested, nothing is a black box.
const QUIZ_QUESTIONS = [
  {
    q: "Which of these would you rather spend an afternoon doing?",
    options: [
      { label: "Debugging a program until it finally works", weights: { CSE: 3, IT: 3 } },
      { label: "Tinkering with a circuit board or microcontroller", weights: { ECE: 3 } },
      { label: "Working out how to wire or fix something electrical", weights: { EEE: 3 } },
      { label: "Visiting a site to check on a building or structure", weights: { CE: 3 } },
      { label: "Taking apart an engine or machine to see how it works", weights: { MECH: 3 } },
    ],
  },
  {
    q: "After graduating, which daily environment sounds right?",
    options: [
      { label: "Mostly at a laptop, writing and shipping code", weights: { CSE: 2, IT: 2 } },
      { label: "A mix of lab work and circuit or device design", weights: { ECE: 2 } },
      { label: "Power plants, grids, or electrical infrastructure", weights: { EEE: 2 } },
      { label: "Construction sites and infrastructure projects", weights: { CE: 2 } },
      { label: "A factory floor, workshop, or automotive setting", weights: { MECH: 2 } },
    ],
  },
  {
    q: "A field that reinvents itself every couple of years, forcing you to keep learning new tools -- how does that sound?",
    options: [
      { label: "Exciting, that's what keeps it interesting", weights: { CSE: 2, IT: 2 } },
      { label: "I'd rather build on stable, slower-moving fundamentals", weights: { EEE: 2, CE: 2, MECH: 2, ECE: 1 } },
    ],
  },
  {
    q: "Which subject did you actually enjoy more in school?",
    options: [
      { label: "Pure math and logic puzzles", weights: { CSE: 2, IT: 2 } },
      { label: "Physics -- electricity and circuits", weights: { ECE: 2, EEE: 2 } },
      { label: "Physics -- mechanics and machines", weights: { MECH: 2 } },
      { label: "Practical, hands-on subjects over pure theory", weights: { CE: 2, MECH: 1 } },
    ],
  },
  {
    q: "Which pulls you more, if you had to guess right now?",
    options: [
      { label: "A stable government or PSU-style career path", weights: { EEE: 2, CE: 2 } },
      { label: "A private-sector tech or software career", weights: { CSE: 2, IT: 2 } },
      { label: "Honestly, I'm not sure yet", weights: {} },
    ],
  },
];

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'];

function renderQuizSection() {
  return `
<section class="quiz-section">
  <h2>Find a starting point</h2>
  <p class="guide-intro">Five quick questions. This narrows the field based on how you actually answer -- it doesn't hand you a verdict. Treat the result as something to go research and discuss, not a decision made for you.</p>
  <div class="quiz-progress-dots" id="quizProgress"></div>
  <div class="quiz-card" id="quizCard"></div>
  <div id="quizResults"></div>
</section>

<script>
(function(){
  const QUESTIONS = ${JSON.stringify(QUIZ_QUESTIONS)};
  const OPTION_KEYS = ${JSON.stringify(OPTION_KEYS)};
  const BRANCH_DATA = ${'__BRANCH_DATA_PLACEHOLDER__'};
  let current = 0;
  const scores = {};

  function renderProgress(){
    const dots = document.getElementById('quizProgress');
    let html = '';
    for (let i = 0; i < QUESTIONS.length; i++) {
      const cls = i < current ? 'quiz-progress-dot--done' : i === current ? 'quiz-progress-dot--current' : '';
      html += '<span class="quiz-progress-dot ' + cls + '"></span>';
    }
    html += '<span class="quiz-progress-count">' + Math.min(current + 1, QUESTIONS.length) + ' / ' + QUESTIONS.length + '</span>';
    dots.innerHTML = html;
  }

  function renderQuestion(){
    const card = document.getElementById('quizCard');
    const resultsEl = document.getElementById('quizResults');
    resultsEl.innerHTML = '';
    renderProgress();

    if (current >= QUESTIONS.length) {
      card.style.display = 'none';
      showResults();
      return;
    }
    card.style.display = 'block';
    const q = QUESTIONS[current];
    card.innerHTML =
      '<div class="quiz-kicker">QUESTION ' + (current + 1) + ' / ' + QUESTIONS.length + '</div>' +
      '<div class="quiz-question">' + q.q + '</div>' +
      '<div class="quiz-options">' +
        q.options.map((opt, i) => '<button class="quiz-option" data-i="' + i + '"><span class="quiz-option-key">' + OPTION_KEYS[i] + '</span>' + opt.label + '</button>').join('') +
      '</div>' +
      (current > 0 ? '<div class="quiz-nav"><button id="backBtn">&larr; back</button><span></span></div>' : '');

    card.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const opt = q.options[Number(btn.dataset.i)];
        for (const [branch, w] of Object.entries(opt.weights || {})) {
          scores[branch] = (scores[branch] || 0) + w;
        }
        current++;
        renderQuestion();
      });
    });
    const back = document.getElementById('backBtn');
    if (back) back.addEventListener('click', () => { current = Math.max(0, current - 1); renderQuestion(); });
  }

  function showResults(){
    current = QUESTIONS.length;
    renderProgress();
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const resultsEl = document.getElementById('quizResults');
    if (ranked.length === 0) {
      resultsEl.innerHTML = '<div class="disclaimer-box">No strong signal either way -- that\\'s a completely normal place to be. Scroll down and read through all six branches below instead of starting from a narrowed list.</div>';
      return;
    }
    resultsEl.innerHTML =
      '<h3 style="margin-top:1.4rem;">Worth a closer look</h3>' +
      ranked.map(([code, score], i) => {
        const b = BRANCH_DATA.find(x => x.branch === code);
        if (!b) return '';
        const reasons = (b.suits_students_who || []).slice(0, 2);
        const statusHtml = b.published
          ? '<a class="content-status content-status--available" href="' + b.hubUrl + '">' + b.verifiedCount + ' real subject' + (b.verifiedCount === 1 ? '' : 's') + ' \\u2192</a>'
          : '<span class="content-status content-status--none">Not sourced yet</span>';
        return '<div class="result-card">' +
          '<div class="result-rank">Match ' + (i + 1) + '</div>' +
          '<h3>' + b.branch + '</h3>' +
          '<div class="tagline">' + b.tagline + '</div>' +
          '<div class="result-status">' + statusHtml + '</div>' +
          (reasons.length ? '<div class="result-reasons">Why it came up: ' + reasons.join('; ') + '.</div>' : '') +
        '</div>';
      }).join('') +
      '<div class="disclaimer-box">This is a narrowing tool, not an answer. Read the full comparison below for all six branches -- including the ones that didn\\'t come out on top here -- and talk to seniors or a counsellor before deciding anything.</div>' +
      '<button class="quiz-option" id="retakeBtn" style="margin-top:.5rem;">&#8635; Retake the quiz</button>';
    document.getElementById('retakeBtn').addEventListener('click', () => {
      current = 0; for (const k in scores) delete scores[k]; renderQuestion();
    });
  }

  renderQuestion();
})();
</script>`;
}

function contentStatusHtml(status) {
  // Available -> teal pill linking to the real hub. Not yet -> muted pill, no
  // link, no invented count. Same rule as the nav dropdown and homepage registry.
  return status && status.published
    ? `<a class="content-status content-status--available" href="${escapeHtml(status.href)}">${status.verifiedCount} real subject${status.verifiedCount === 1 ? '' : 's'} &rarr;</a>`
    : `<span class="content-status content-status--none">Not sourced yet</span>`;
}

function renderComparisonGrid(branchProfiles, statusByCode = {}) {
  return `
<section>
  <h2>All six branches, compared honestly</h2>
  <div class="branch-compare-grid">
    ${branchProfiles.map(b => `
      <div class="branch-compare-card">
        <div class="branch-compare-head">
          <h3>${escapeHtml(b.branch)}</h3>
          ${contentStatusHtml(statusByCode[b.branch])}
        </div>
        <div class="tagline">${escapeHtml(b.tagline)}</div>

        <div class="compare-label">Core focus</div>
        <p>${b.core_focus.map(escapeHtml).join(' &middot; ')}</p>

        <div class="fit-columns">
          <div>
            <div class="compare-label">Good fit if</div>
            <ul class="fit-list">${b.suits_students_who.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>
          ${b.less_good_fit_if?.length ? `
          <div>
            <div class="compare-label compare-label--reconsider">Reconsider if</div>
            <ul class="nonfit-list">${b.less_good_fit_if.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>` : ''}
        </div>

        <div class="compare-label">Career paths</div>
        <p>${b.career_paths.map(escapeHtml).join(' &middot; ')}</p>

        <div class="disclaimer-box">${escapeHtml(b.data_disclaimer)}</div>
      </div>
    `).join('')}
  </div>
</section>`;
}

export function renderBranchGuidePage(branchProfiles, navBranches = []) {
  // Content-status is keyed by branch code and comes from the SAME navBranches
  // data build.js computes for the nav dropdown and homepage branch registry -- not
  // recomputed here, so the "N real subjects" / "Not sourced yet" state can never
  // drift from what's actually published.
  const statusByCode = Object.fromEntries(
    navBranches.map(b => [b.code, { published: b.published, verifiedCount: b.verifiedCount, href: b.href }])
  );
  // The quiz result cards render the same indicator client-side, so fold the
  // count/hub-url into the existing BRANCH_DATA blob rather than adding a second
  // data channel.
  const augmentedProfiles = branchProfiles.map(b => {
    const st = statusByCode[b.branch] || { published: false, verifiedCount: 0, href: null };
    return { ...b, published: st.published, verifiedCount: st.verifiedCount, hubUrl: st.href };
  });
  // NOTE: the placeholder is injected WITHOUT surrounding quotes (renderQuizSection
  // writes `${'__BRANCH_DATA_PLACEHOLDER__'}` which renders the bare token), so the
  // replace target must be the bare token too. A previous version matched
  // "'...'" (quoted) which never hit, leaving `const BRANCH_DATA = __..._PLACEHOLDER__;`
  // -- a ReferenceError that silently killed the whole quiz. A function replacer
  // also avoids `$&`/`$1` being interpreted inside the JSON payload.
  const quizHtml = renderQuizSection().replace(
    '__BRANCH_DATA_PLACEHOLDER__',
    () => JSON.stringify(augmentedProfiles)
  );
  return `
<div class="page-narrow">
<h1 class="subject-title">Choosing a branch?</h1>
<p class="guide-intro">Picking CSE, ECE, EEE, Civil, Mechanical, or IT shapes the next four years and a good chunk of your career after. This page won't decide for you -- nothing online should -- but it'll help you ask the right questions before you do.</p>

<div class="ad-slot">ad slot &mdash; below intro, well clear of the quiz</div>

${quizHtml}

${renderComparisonGrid(branchProfiles, statusByCode)}
</div>
`;
}
