export class ReleasePublicationBusyError extends Error {
  constructor(message = 'Another publication operation is already running for this release.') {
    super(message);
    this.name = 'ReleasePublicationBusyError';
    this.code = 'publication_busy';
  }
}

async function releaseNamedLocks(connection, keys) {
  let allReleased = true;
  for (const key of [...keys].reverse()) {
    try {
      const [rows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [key]);
      if (Number(rows?.[0]?.released) !== 1) allReleased = false;
    } catch {
      allReleased = false;
    }
  }
  return allReleased;
}

async function disposeConnection(connection, reusable) {
  if (reusable) {
    connection.release();
    return;
  }
  try {
    if (typeof connection.destroy === 'function') {
      await connection.destroy();
      return;
    }
    if (typeof connection.end === 'function') await connection.end();
  } catch {
    // The session is deliberately discarded when named-lock cleanup is uncertain.
  }
}

export async function acquireReleasePublicationLocks(database, releaseCandidateIds, { timeoutSeconds = 15 } = {}) {
  if (typeof database?.getConnection !== 'function') {
    return { db: database, release: async () => {} };
  }
  const connection = await database.getConnection();
  const ids = [...new Set((releaseCandidateIds || []).map(Number))]
    .filter(id => Number.isSafeInteger(id) && id > 0)
    .sort((left, right) => left - right);
  const keys = ids.map(id => `jntustack:github-publication:${id}`);
  const acquired = [];
  const timeoutMs = Math.max(0, Number(timeoutSeconds) || 0) * 1000;
  const deadline = Date.now() + timeoutMs;
  try {
    for (const key of keys) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new ReleasePublicationBusyError();
      const remainingSeconds = Math.max(0.001, remainingMs / 1000);
      let rows;
      try {
        [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [key, remainingSeconds]);
      } catch (error) {
        // The server may have granted the lock even if the client lost the
        // response. This session must never return to the pool in that state.
        error.lockAcquisitionUncertain = true;
        throw error;
      }
      if (Number(rows?.[0]?.acquired) !== 1) throw new ReleasePublicationBusyError();
      acquired.push(key);
    }
  } catch (err) {
    const reusable = !err?.lockAcquisitionUncertain && await releaseNamedLocks(connection, acquired);
    if (err?.lockAcquisitionUncertain) await releaseNamedLocks(connection, acquired);
    await disposeConnection(connection, reusable);
    throw err;
  }
  let released = false;
  return {
    db: connection,
    async release() {
      if (released) return;
      released = true;
      const reusable = await releaseNamedLocks(connection, acquired);
      await disposeConnection(connection, reusable);
    },
  };
}

export function acquireReleasePublicationLock(database, releaseCandidateId, options = {}) {
  return acquireReleasePublicationLocks(database, [releaseCandidateId], options);
}
