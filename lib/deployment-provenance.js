import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const DEPLOYMENT_PROVENANCE_SCHEMA_VERSION = 1;
export const DEPLOYMENT_PROVENANCE_FILENAME = 'deployment.json';

const COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FALLBACK_COMMIT_ENV_NAMES = [
  'DEPLOYMENT_COMMIT_SHA',
  'GITHUB_SHA',
  'SOURCE_VERSION',
  'COMMIT_SHA',
];

export function normalizeCommitSha(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return COMMIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

function defaultGitExec(args, root) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function resolveDeploymentProvenance({
  root,
  env = process.env,
  gitExec = defaultGitExec,
} = {}) {
  if (!root) throw new Error('resolveDeploymentProvenance requires a repository root.');

  try {
    const commitSha = normalizeCommitSha(gitExec(['rev-parse', '--verify', 'HEAD'], root));
    if (commitSha) {
      const status = String(gitExec(['status', '--porcelain', '--untracked-files=normal'], root) || '');
      return {
        schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
        commit_sha: commitSha,
        source: 'git',
        source_clean: status.trim().length === 0,
      };
    }
  } catch {
    // Managed builders may copy a source archive without its .git directory.
    // A validated provider-supplied commit SHA is the only accepted fallback.
  }

  for (const envName of FALLBACK_COMMIT_ENV_NAMES) {
    const commitSha = normalizeCommitSha(env?.[envName]);
    if (commitSha) {
      return {
        schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
        commit_sha: commitSha,
        source: 'environment',
        source_clean: null,
      };
    }
  }

  return {
    schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
    commit_sha: null,
    source: 'unavailable',
    source_clean: null,
  };
}

export function sanitizeDeploymentProvenance(value) {
  const marker = value && typeof value === 'object' ? value : {};
  if (marker.schema_version !== DEPLOYMENT_PROVENANCE_SCHEMA_VERSION) {
    return {
      schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
      commit_sha: null,
      source: 'unavailable',
      source_clean: null,
    };
  }

  const commitSha = normalizeCommitSha(marker.commit_sha);
  const source = ['git', 'environment'].includes(marker.source) && commitSha
    ? marker.source
    : 'unavailable';
  const sourceClean = source === 'git' && typeof marker.source_clean === 'boolean'
    ? marker.source_clean
    : null;

  return {
    schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
    commit_sha: source === 'unavailable' ? null : commitSha,
    source,
    source_clean: sourceClean,
  };
}

export function readDeploymentProvenance(markerPath) {
  try {
    return sanitizeDeploymentProvenance(JSON.parse(fs.readFileSync(markerPath, 'utf8')));
  } catch {
    return {
      schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
      commit_sha: null,
      source: 'unavailable',
      source_clean: null,
    };
  }
}
