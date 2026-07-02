// server.js -- the actual process Hostinger runs.
// Local dev:  npm run build && npm start
// Hostinger:  set as the startup file when adding the Node.js App in
//             hPanel (it should auto-detect this via package.json "start").

import 'dotenv/config'; // loads .env locally; no-op in production where hPanel injects env vars directly
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { askRouter, loadSearchIndex } from './routes/ask.js';
import { getAdminConfig, getAskConfig } from './lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 3000; // Hostinger sets PORT itself -- always defer to it, never hardcode

const app = express();
app.use(express.json({ limit: '10kb' })); // small limit -- this only ever needs to carry one short question

process.on('uncaughtException', (err) => {
  console.error('JNTUStack uncaught exception:', err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (err) => {
  console.error('JNTUStack unhandled rejection:', err);
  process.exitCode = 1;
});

const askConfig = getAskConfig();
if (askConfig.enabled) {
  // Load the grounding index once at boot, not per-request.
  loadSearchIndex(DIST_DIR);

  // API routes before static serving, so /api/ask is never shadowed by a
  // same-named static file.
  app.use(askRouter);
}

const adminConfig = getAdminConfig();
if (adminConfig.enabled) {
  let adminRouterPromise = null;
  app.use('/admin', async (req, res, next) => {
    try {
      if (!adminRouterPromise) {
        adminRouterPromise = import('./routes/admin.js')
          .then(({ createAdminRouter }) => createAdminRouter({ root: __dirname }));
      }
      const adminRouter = await adminRouterPromise;
      adminRouter(req, res, next);
    } catch (err) {
      next(err);
    }
  });
}

// Basic health check -- useful for Hostinger/UptimeRobot-style monitoring,
// and for confirming the app is actually up after a deploy.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// The generated site itself.
app.use(express.static(DIST_DIR));

export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = app.listen(PORT, () => {
    console.log(`JNTUStack server listening on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error('JNTUStack server failed to start:', err);
    process.exitCode = 1;
  });
}
