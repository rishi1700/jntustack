// server.js -- the actual process Hostinger runs.
// Local dev:  npm run build && npm start
// Hostinger:  set as the startup file when adding the Node.js App in
//             hPanel (it should auto-detect this via package.json "start").

import 'dotenv/config'; // loads .env locally; no-op in production where hPanel injects env vars directly
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askRouter, loadSearchIndex } from './routes/ask.js';
import { getAdminConfig, getAskConfig } from './lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 3000; // Hostinger sets PORT itself -- always defer to it, never hardcode

const app = express();
// Hostinger terminates TLS and proxies requests to this process, so without
// this, req.ip is always the proxy's address -- which would make IP-based
// rate limiting either see one client (the proxy) or nothing useful.
// '1' trusts exactly one hop (the immediate proxy) and reads the client IP
// from the outermost trusted entry of X-Forwarded-For.
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (host === 'www.jntustack.com') {
    res.redirect(301, `https://jntustack.com${req.originalUrl || req.url || '/'}`);
    return;
  }
  next();
});
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
const adminConfig = getAdminConfig();

console.log('JNTUStack runtime config:', JSON.stringify({
  contentSource: process.env.CONTENT_SOURCE || 'json',
  adminEnabled: adminConfig.enabled,
  adminConfigured: Boolean(adminConfig.email && (adminConfig.passwordHash || adminConfig.password)),
  askEnabled: askConfig.enabled,
  nodeVersion: process.version,
}));

if (adminConfig.enabled && !(adminConfig.email && (adminConfig.passwordHash || adminConfig.password))) {
  console.error('JNTUStack admin configuration error: ADMIN_ENABLED=true requires ADMIN_EMAIL and ADMIN_PASSWORD_HASH or ADMIN_PASSWORD.');
}

// ADMIN_SESSION_SECRET has no fallback (see lib/admin-auth.js adminSecret()):
// without it, every admin route now refuses with 503 rather than silently
// signing sessions with the password hash. This just makes that loud at boot.
if (adminConfig.enabled && !adminConfig.sessionSecret) {
  console.error('JNTUStack admin configuration error: ADMIN_ENABLED=true requires ADMIN_SESSION_SECRET. The admin panel will refuse all requests (503) until it is set.');
}

if (adminConfig.enabled && adminConfig.passwordHash?.startsWith('sha256:')) {
  console.error('JNTUStack admin configuration warning: ADMIN_PASSWORD_HASH uses the deprecated sha256: scheme (unsalted, single-round -- weak if ever leaked). Still accepted so this does not lock out the current login, but regenerate it as pbkdf2:<iterations>:<salt>:<base64url hash> and update ADMIN_PASSWORD_HASH.');
}

if (askConfig.enabled) {
  // Load the grounding index once at boot, not per-request.
  loadSearchIndex(DIST_DIR);

  // API routes before static serving, so /api/ask is never shadowed by a
  // same-named static file.
  app.use(askRouter);
}

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

export { app };
export default app;

const server = app.listen(PORT, () => {
  console.log(`JNTUStack server listening on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('JNTUStack server failed to start:', err);
  process.exitCode = 1;
});
