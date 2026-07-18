import crypto from 'node:crypto';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function encodePath(value) {
  return String(value).split('/').map(part => encodeURIComponent(part)).join('/');
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function normalizePrivateKey(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.includes('BEGIN') || raw.includes('\\n')) return raw.replaceAll('\\n', '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return decoded.includes('BEGIN') ? decoded : raw;
  } catch {
    return raw;
  }
}

function requiredConfig(config) {
  const missing = Object.entries(config)
    .filter(([, value]) => !clean(String(value ?? '')))
    .map(([key]) => key);
  if (missing.length) throw new Error(`GitHub App configuration is incomplete. Missing: ${missing.join(', ')}.`);
}

function positiveInteger(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

async function readResponseTextWithLimit(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`GitHub response declared ${declared} bytes; limit is ${maxBytes}.`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`GitHub response exceeded ${maxBytes} bytes.`);
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response_too_large').catch(() => {});
      throw new Error(`GitHub response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function createGitHubAppJwt({ appId, privateKey, now = new Date() }) {
  requiredConfig({ appId, privateKey });
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + (9 * 60),
    iss: String(appId),
  }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), normalizePrivateKey(privateKey)).toString('base64url');
  return `${input}.${signature}`;
}

export class GitHubApiError extends Error {
  constructor(message, { status = null, response = null } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.response = response;
  }
}

export class GitHubAppClient {
  constructor({
    appId,
    installationId,
    privateKey,
    owner,
    repo,
    defaultBranch = 'main',
    apiBaseUrl = 'https://api.github.com',
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    requestTimeoutMs = 15_000,
    maxResponseBytes = 5 * 1024 * 1024,
  } = {}) {
    requiredConfig({ appId, installationId, privateKey, owner, repo });
    if (typeof fetchImpl !== 'function') throw new Error('GitHub App client requires a fetch implementation.');
    this.appId = String(appId);
    this.installationId = String(installationId);
    this.privateKey = normalizePrivateKey(privateKey);
    this.owner = clean(owner);
    this.repo = clean(repo);
    this.repositoryFullName = `${this.owner}/${this.repo}`;
    this.defaultBranch = clean(defaultBranch) || 'main';
    this.apiBaseUrl = clean(apiBaseUrl).replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.now = now;
    this.requestTimeoutMs = positiveInteger(requestTimeoutMs, 'GitHub requestTimeoutMs', 60_000);
    this.maxResponseBytes = positiveInteger(maxResponseBytes, 'GitHub maxResponseBytes', 20 * 1024 * 1024);
    this.installationToken = null;
    this.installationTokenExpiresAt = 0;
  }

  async request(apiPath, {
    method = 'GET',
    body = undefined,
    auth = 'installation',
    accept = 'application/vnd.github+json',
    allow404 = false,
  } = {}) {
    const token = auth === 'app'
      ? createGitHubAppJwt({ appId: this.appId, privateKey: this.privateKey, now: this.now() })
      : await this.getInstallationToken();
    const attempts = method === 'GET' ? 3 : 1;
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      let response;
      let text = '';
      try {
        response = await this.fetch(`${this.apiBaseUrl}${apiPath}`, {
          method,
          signal: controller.signal,
          headers: {
            accept,
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'user-agent': 'JNTUStack-GitHub-Publisher',
            'x-github-api-version': '2022-11-28',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        text = await readResponseTextWithLimit(response, this.maxResponseBytes);
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `GitHub request timed out after ${this.requestTimeoutMs}ms.`
          : err.message || String(err);
        lastError = new GitHubApiError(`GitHub request failed before a complete bounded response was received: ${message}`);
        if (attempt + 1 < attempts) {
          await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeout);
      }

      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      if (allow404 && response.status === 404) return null;
      if (!response.ok) {
        const detailValue = typeof payload === 'object' ? payload?.message : payload;
        const detail = clean(String(detailValue || response.statusText)).slice(0, 500);
        lastError = new GitHubApiError(
          `GitHub request ${method} ${apiPath} failed (${response.status}): ${detail}`,
          { status: response.status, response: payload }
        );
        if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
          await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
          continue;
        }
        throw lastError;
      }
      return payload;
    }
    throw lastError || new GitHubApiError(`GitHub request ${method} ${apiPath} did not complete.`);
  }

  async getInstallationToken() {
    if (this.installationToken && Date.now() < this.installationTokenExpiresAt - 60_000) {
      return this.installationToken;
    }
    const payload = await this.request(`/app/installations/${encodeURIComponent(this.installationId)}/access_tokens`, {
      method: 'POST',
      body: {},
      auth: 'app',
    });
    if (!payload?.token || !payload?.expires_at) throw new GitHubApiError('GitHub did not return a usable installation token.');
    this.installationToken = payload.token;
    this.installationTokenExpiresAt = Date.parse(payload.expires_at);
    return this.installationToken;
  }

  repoPath(suffix) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  async getRef(branch = this.defaultBranch) {
    return this.request(this.repoPath(`/git/ref/heads/${encodePath(branch)}`), { allow404: true });
  }

  async getCommit(sha) {
    return this.request(this.repoPath(`/git/commits/${encodeURIComponent(sha)}`));
  }

  async getFile(filePath, ref = this.defaultBranch) {
    const payload = await this.request(
      this.repoPath(`/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`),
      { allow404: true }
    );
    if (!payload) return null;
    if (payload.type !== 'file' || !payload.content) {
      throw new GitHubApiError(`GitHub content response for ${filePath} is not an inline file.`);
    }
    return {
      path: payload.path,
      gitBlobSha: payload.sha,
      buffer: Buffer.from(payload.content.replace(/\s+/g, ''), payload.encoding || 'base64'),
    };
  }

  async getBranchSnapshot({ branch = this.defaultBranch, paths = [] } = {}) {
    const ref = await this.getRef(branch);
    if (!ref?.object?.sha) return null;
    const commit = await this.getCommit(ref.object.sha);
    const files = new Map();
    for (const filePath of [...new Set(paths)].sort()) {
      const file = await this.getFile(filePath, ref.object.sha);
      files.set(filePath, file);
    }
    return {
      branch,
      headSha: ref.object.sha,
      treeSha: commit?.tree?.sha,
      parentShas: Array.isArray(commit?.parents) ? commit.parents.map(parent => parent.sha).filter(Boolean) : [],
      files,
    };
  }

  async createBlob(buffer) {
    return this.request(this.repoPath('/git/blobs'), {
      method: 'POST',
      body: { content: Buffer.from(buffer).toString('base64'), encoding: 'base64' },
    });
  }

  async createTree({ baseTreeSha, files }) {
    const tree = [];
    for (const file of files) {
      const blob = await this.createBlob(file.buffer);
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    return this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: { base_tree: baseTreeSha, tree },
    });
  }

  async createCommit({ message, treeSha, parentSha }) {
    return this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: { message, tree: treeSha, parents: [parentSha] },
    });
  }

  async createRef({ branch, sha }) {
    return this.request(this.repoPath('/git/refs'), {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  async findPullRequest({ branch }) {
    const head = `${this.owner}:${branch}`;
    const rows = await this.request(this.repoPath(`/pulls?state=all&head=${encodeURIComponent(head)}&per_page=20`));
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async createPullRequest({ branch, title, body, base = this.defaultBranch }) {
    return this.request(this.repoPath('/pulls'), {
      method: 'POST',
      body: { title, body, head: branch, base, draft: false },
    });
  }

  async getPullRequest(number) {
    return this.request(this.repoPath(`/pulls/${encodeURIComponent(number)}`));
  }

  async getCommitChecks(sha) {
    let status = null;
    try {
      status = await this.request(this.repoPath(`/commits/${encodeURIComponent(sha)}/status`));
    } catch (err) {
      if (err?.status !== 403) throw err;
    }
    let checks = null;
    try {
      checks = await this.request(this.repoPath(`/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`));
    } catch (err) {
      // Missing visibility is reported to the publisher, which fails closed.
      // Branch protection remains the authoritative merge gate.
      if (err?.status !== 403) throw err;
    }
    return {
      checkRuns: checks?.check_runs || [],
      combinedStatus: status?.state || 'pending',
      checksAvailable: Boolean(checks),
      statusesAvailable: Boolean(status),
    };
  }
}

export function createGitHubAppClientFromEnv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return new GitHubAppClient({
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY_BASE64 || env.GITHUB_APP_PRIVATE_KEY,
    owner: env.GITHUB_REPOSITORY_OWNER || env.GITHUB_OWNER,
    repo: env.GITHUB_REPOSITORY_NAME || env.GITHUB_REPO,
    defaultBranch: env.GITHUB_DEFAULT_BRANCH || 'main',
    apiBaseUrl: env.GITHUB_API_URL || 'https://api.github.com',
    fetchImpl,
  });
}
