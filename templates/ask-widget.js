import { escapeHtml } from './layout.js';

// Set to true only for this standalone preview file -- the real generator
// build should always leave this false so the widget calls the real
// /api/ask function once it's deployed.
export function renderAskWidget({ mock = false } = {}) {
  return `
<section class="ask-widget" id="askWidget">
  <h2>Ask JNTUStack</h2>
  <p class="guide-intro">Ask about a subject's syllabus, compare branches, or ask a study/career question. It only answers from real, verified course content when relevant -- and says so plainly when it doesn't know something.</p>

  <div class="ask-box">
    <textarea id="askInput" placeholder="e.g. What's covered in Computer Networks unit 3? Or: should I pick ECE or EEE?" maxlength="600"></textarea>
    <button id="askSubmit" class="quiz-option ask-submit">Ask</button>
  </div>
  <div id="askAnswer"></div>
  <div class="disclaimer-box">Answers come from an AI model and can still be wrong, especially for anything time-sensitive (exam dates, fee changes, official notices) -- always confirm those against your college or the official JNTU site.</div>
</section>

<script>
(function(){
  const MOCK = ${mock ? 'true' : 'false'};
  const input = document.getElementById('askInput');
  const submit = document.getElementById('askSubmit');
  const answerEl = document.getElementById('askAnswer');
  let searchIndexPromise = MOCK ? null : fetch('/search-index.json').then(r => r.json()).catch(() => []);

  async function mockAnswer(question) {
    await new Promise(r => setTimeout(r, 600));
    if (/ece|eee/i.test(question)) {
      return {
        answer: "ECE leans toward circuits, signal processing, and communication systems with strong embedded-systems and VLSI paths. EEE leans toward power systems, electrical machines, and control -- more aligned with the energy sector and PSU-style government roles. If you enjoy circuits AND want some software crossover, ECE tends to bridge that better. If you're drawn to the power/energy sector specifically, EEE is the more direct path. (This is a mocked preview answer -- the real version reasons over your live course data.)",
        groundedOn: ['ECE branch overview', 'EEE branch overview'],
      };
    }
    return {
      answer: "This is a preview using a mocked response so you can see the interaction without a live API key yet. Once deployed, this calls /api/ask, which grounds its answer in your site's actual verified subject and branch content.",
      groundedOn: [],
    };
  }

  async function realAnswer(question) {
    const searchIndex = await searchIndexPromise;
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, searchIndex }),
    });
    if (!res.ok) throw new Error('Request failed');
    return res.json();
  }

  async function handleAsk() {
    const question = input.value.trim();
    if (!question) return;
    submit.disabled = true;
    answerEl.innerHTML = '<div class="ask-loading">Thinking…</div>';
    try {
      const result = MOCK ? await mockAnswer(question) : await realAnswer(question);
      answerEl.innerHTML =
        '<div class="ask-answer-card">' + result.answer.replace(/\\n/g, '<br>') +
        (result.groundedOn && result.groundedOn.length
          ? '<div class="ask-grounded-on">Grounded on: ' + result.groundedOn.join(', ') + '</div>'
          : '<div class="ask-grounded-on">No matching course content found -- general answer only.</div>') +
        '</div>';
    } catch (e) {
      answerEl.innerHTML = '<div class="disclaimer-box">Couldn\\'t reach the assistant just now. Try again in a moment.</div>';
    } finally {
      submit.disabled = false;
    }
  }

  submit.addEventListener('click', handleAsk);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk(); });
})();
</script>`;
}
