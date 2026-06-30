import fs from 'node:fs';
import path from 'node:path';

const SUBJECT_FILE_RE = /^subjects-.*\.json$/;

/**
 * Discover every data/subjects-*.json file and concatenate their `subjects`
 * arrays into one list. This is the single place the glob convention lives, so
 * adding a branch's syllabus is "drop in a data/subjects-<code>.json file" --
 * never an edit to the build scripts. Files are sorted for deterministic order.
 * Returns both the merged subjects and the filenames (handy for build logging).
 */
export function loadMergedSubjects(dataDir) {
  const files = fs.readdirSync(dataDir).filter(f => SUBJECT_FILE_RE.test(f)).sort();
  const subjects = files.flatMap(f =>
    JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')).subjects || []
  );
  return { files, subjects };
}

/**
 * Assemble the full dataset object the site builds from: regulations + branches
 * come from data/shared.json, subjects from the merged subjects-*.json files.
 * The caller validates this against schema.json before using it.
 */
export function loadDataset(dataDir) {
  const shared = JSON.parse(fs.readFileSync(path.join(dataDir, 'shared.json'), 'utf-8'));
  const { files, subjects } = loadMergedSubjects(dataDir);
  return {
    files,
    data: {
      regulations: shared.regulations,
      branches: shared.branches,
      subjects,
    },
  };
}
