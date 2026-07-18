// routes/ask.js
// Express router for POST /api/ask, mounted by server.js.
//
// Required setup on Hostinger before this works:
//   1. Deploy as a "Node.js App" in hPanel (Business/Cloud plan), connected
//      via GitHub -- Hostinger auto-detects Express and sets the startup
//      file from package.json's "start" script.
//   2. Add ANTHROPIC_API_KEY as an environment variable in hPanel
//      (Node.js app -> Environment Variables) -- entered through the
//      dashboard, never committed to the repo.
//   3. dist/search-index.json must exist before the app starts -- run
//      `npm run build && node scripts/build-search-index.js` as part of
//      deployment (see package.json's "build" script).
//
// This has NOT been run against a live Anthropic key yet. Request shape
// matches Anthropic's current API docs; test a real batch of questions
// before linking this from a live page.

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { retrieve } from '../lib/retrieve.js';

const MODEL = 'claude-haiku-4-5-20251001'; // cost-efficient default
const MAX_QUESTION_LENGTH = 600; // characters -- bounds abuse/cost per request

const SYSTEM_PROMPT = `You are the JNTUStack study assistant for JNTU (Kakinada, Hyderabad, Anantapur, GV) engineering students.

Scope:
- Answer using the GROUNDED CONTEXT provided below when it's relevant. If the context doesn't cover the question, say so plainly rather than guessing -- do not invent syllabus details, exam dates, or facts about JNTU regulations.
- You may also help with general study strategies and career guidance for engineering students (exam prep approaches, how to think about GATE/internships/placements, how to compare branches) -- but never invent specific statistics (placement percentages, salary figures, cutoff numbers). If a student wants real numbers, tell them to check their college's placement cell or official sources.
- Decline politely if asked something with no connection to JNTU academics or student life.

How to answer:
- If a question reads like a graded assignment, lab record, or exam answer to be submitted verbatim, prioritize explaining the concept and the reasoning path over handing over a finished, copy-pasteable answer. Help the student be able to solve the next one themselves.
- Keep answers concise -- most students are reading this on a phone between classes.
- Never present uncertain information with false confidence.`;

// Loaded once at server startup, not per-request -- it's a static file
// produced by the build, no reason to re-read it on every question.
let searchIndex = [];
export function loadSearchIndex(distDir) {
  const indexPath = path.join(distDir, 'search-index.json');
  if (fs.existsSync(indexPath)) {
    searchIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    console.log(`Loaded search index: ${searchIndex.length} grounded documents.`);
  } else {
    console.warn(`No search-index.json found at ${indexPath} -- the assistant will have nothing to ground answers on. Run scripts/build-search-index.js.`);
  }
}

export const askRouter = Router();

askRouter.post('/api/ask', async (req, res) => {
  try {
    // The browser sends only the question. The server-owned index is the sole
    // grounding source; accepting a client-supplied copy would waste bandwidth
    // and could let a caller smuggle unverified material into the prompt.
    const { question } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Missing question' });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` });
    }

    const hits = retrieve(searchIndex, question, 3);
    const groundedContext = hits.length
      ? hits.map(h => `[${h.type}] ${h.title}\n${JSON.stringify(h.summary)}`).join('\n\n')
      : 'No grounded content matched this question in the site\'s dataset.';

    const answer = await callModel({ groundedContext, question });
    res.json({ answer, groundedOn: hits.map(h => h.title) });
  } catch (err) {
    console.error('ask route error:', err);
    res.status(500).json({ error: 'Something went wrong handling that question.' });
  }
});

/**
 * The only function that knows which model is answering. Swap this body to
 * point at a self-hosted endpoint later without touching retrieval,
 * validation, or the route itself -- none of that is provider-specific.
 */
async function callModel({ groundedContext, question }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set -- add it in hPanel under the Node.js app\'s Environment Variables.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
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
