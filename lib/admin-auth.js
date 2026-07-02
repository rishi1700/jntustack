import crypto from 'node:crypto';
import { getAdminConfig } from './config.js';

const COOKIE_NAME = 'jntustack_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function unbase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf-8');
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function verifyPasswordHash(password, passwordHash) {
  if (!passwordHash) return false;

  if (passwordHash.startsWith('sha256:')) {
    return constantTimeEqual(`sha256:${sha256Hex(password)}`, passwordHash);
  }

  if (passwordHash.startsWith('pbkdf2:')) {
    const [, iterationsRaw, salt, expected] = passwordHash.split(':');
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || !salt || !expected) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
    return constantTimeEqual(actual, expected);
  }

  return false;
}

function adminSecret(config) {
  return config.sessionSecret || config.passwordHash || config.password || null;
}

export function adminIsConfigured(config = getAdminConfig()) {
  return Boolean(config.enabled && config.email && (config.passwordHash || config.password) && adminSecret(config));
}

export function verifyAdminCredentials({ email, password }, config = getAdminConfig()) {
  if (!adminIsConfigured(config)) return false;
  if (!constantTimeEqual(email || '', config.email)) return false;
  if (config.passwordHash) return verifyPasswordHash(password || '', config.passwordHash);
  return constantTimeEqual(password || '', config.password);
}

export function createAdminCookie(email, config = getAdminConfig()) {
  const secret = adminSecret(config);
  const payload = base64url(JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS }));
  const signature = hmac(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyAdminCookie(cookieValue, config = getAdminConfig()) {
  const secret = adminSecret(config);
  if (!cookieValue || !secret) return false;
  const [payload, signature] = cookieValue.split('.');
  if (!payload || !signature) return false;
  if (!constantTimeEqual(hmac(payload, secret), signature)) return false;

  try {
    const data = JSON.parse(unbase64url(payload));
    return data.email === config.email && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function readCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(part => {
    const [name, ...value] = part.trim().split('=');
    return [name, decodeURIComponent(value.join('='))];
  }).filter(([name]) => name));
}

export function adminCookieName() {
  return COOKIE_NAME;
}

export function passwordHashHelp() {
  return 'Use ADMIN_PASSWORD_HASH=sha256:<hex> or pbkdf2:<iterations>:<salt>:<base64url hash>. ADMIN_PASSWORD is accepted for local setup.';
}
