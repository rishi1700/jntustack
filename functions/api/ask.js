// functions/api/ask.js
// Deploy target: Cloudflare Pages Functions (this file's path IS the route:
// a POST to /api/ask hits this handler automatically -- no router needed).
//
// Required setup before this works:
//   1. An Anthropic API key, set as a Cloudflare Pages encrypted environment
//      variable named ANTHROPIC_API_KEY (Pages dashboard -> Settings ->
//      Environment variables -- never put the key in this file or in git).
//   2. The retrieval index (lib/retrieve.js) built from the site's own data
//      at deploy time and bundled alongside this function, or fetched from
//      a small JSON file served from the site itself.
//
// This has NOT been run against a live Anthropic key -- there isn't one to
// test with yet. The request shape (headers, model string, message format)
// matches Anthropic's current API docs; treat this as ready-to-test, not
// ready-to-trust blindly on day one. Run a handful of real questions through
// it manually before linking it from a live page.

import { buildSearchIndex, retrieve } from '../../lib/retrieve.js';

const MODEL = 'claude-haiku-4-5-20251001'; // cost-efficient default; see notes.md for when to route to Sonnet instead
const MAX_QUESTION_LENGTH = 600; // characters -- keeps abuse/cost per request bounded

const SYSTEM_PROMPT = `You are the JNTUStack study assistant for JNTU (Kakinada, Hyderabad, Anantapur, GV) engineering students.

Scope:
- Answer using the GROUNDED CONTEXT provided below when it's relevant. If the context doesn't cover the question, say so plainly rather than guessing -- do not invent syllabus details, exam dates, or facts about JNTU regulations.
- You may also help with general study strategies and career guidance for engineering students (exam prep approaches, how to think about GATE/internships/placements, how to compare branches) -- but never invent specific statistics (placement percentages, salary figures, cutoff numbers). If a student wants real numbers, tell them to check their college's placement cell or official sources.
- Decline politely if asked something with no connection to JNTU academics or student life.

How to answer:
- If a question reads like a graded assignment, lab record, or exam answer to be submitted verbatim, prioritize explaining the concept and the reasoning path over handing over a finished, copy-pasteable answer. Help the student be able to solve the next one themselves.
- Keep answers concise -- most students are reading this on a phone between classes.
- Never present uncertain information with false confidence.`;

export async function onRequestPost({ request, env }) {
  try {
    const { question, searchIndex } = await request.json();

    if (!question || typeof question !== 'string') {
      return jsonResponse({ error: 'Missing question' }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` }, 400);
    }

    // searchIndex is prebuilt at site-build time from subjects.json +
    // branch-guide-data.json (see scripts/build-search-index.js) and served
    // as a static JSON asset -- keeps this function itself dependency-free.
    const hits = retrieve(searchIndex || [], question, 3);
    const groundedContext = hits.length
      ? hits.map(h => `[${h.type}] ${h.title}\n${JSON.stringify(h.summary)}`).join('\n\n')
      : 'No grounded content matched this question in the site\'s dataset.';

    const answer = await callModel({ groundedContext, question, env });
    return jsonResponse({ answer, groundedOn: hits.map(h => h.title) });
  } catch (err) {
    console.error('ask.js error:', err);
    return jsonResponse({ error: 'Something went wrong handling that question.' }, 500);
  }
}

/**
 * The only function that knows which model is answering. Swap this body
 * to point at a self-hosted endpoint later (e.g. an Ollama/vLLM server)
 * without touching retrieval, validation, rate-limiting, or the widget --
 * none of that is provider-specific.
 */
async function callModel({ groundedContext, question, env }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `GROUNDED CONTEXT:\n${groundedContext}\n\nSTUDENT QUESTION:\n${question}` }],
    }),
  });
  if (!res.ok) {
    console.error('Model API error:', res.status, await res.text());
    throw new Error('model_unavailable');
  }
  const data = await res.json();
  return data.content?.find(b => b.type === 'text')?.text || '';
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
