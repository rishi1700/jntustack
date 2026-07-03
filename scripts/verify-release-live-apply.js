import { closeDbPool, describeDbError } from '../lib/db.js';
import { runReleaseLiveApplyVerification } from '../lib/release-live-apply.js';

async function main() {
  const applyId = process.argv[2];
  const actor = process.argv[3] || null;
  if (!applyId) {
    throw new Error('Usage: node scripts/verify-release-live-apply.js <apply-id> [actor]');
  }
  await runReleaseLiveApplyVerification({
    root: process.cwd(),
    applyId,
    actor,
  });
}

main().catch(err => {
  console.error('Release live apply verification failed:', JSON.stringify(describeDbError(err), null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
