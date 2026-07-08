import fs from 'node:fs';
import path from 'node:path';

const SUBJECT_FILE_RE = /^subjects-.*\.json$/;
const COLLEGE_FILE_RE = /^colleges-.*\.json$/;

/**
 * Discover every data/colleges-*.json file and concatenate their `colleges`
 * arrays into one list -- the exact same glob convention as subjects, so adding
 * a whole campus is "drop in a data/colleges-<university>.json file", never an
 * edit to build.js. Each file's `_coverage_note` is carried alongside (paired
 * with its filename) so the directory can surface per-campus coverage honestly.
 * Files are sorted for deterministic order.
 */
export function loadMergedColleges(dataDir) {
  const files = fs.readdirSync(dataDir).filter(f => COLLEGE_FILE_RE.test(f)).sort();
  const colleges = [];
  const coverageNotes = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
    if (Array.isArray(data.colleges)) colleges.push(...data.colleges);
    if (data._coverage_note) coverageNotes.push({ file: f, note: data._coverage_note });
  }
  return { files, colleges, coverageNotes };
}

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
 * A subject belongs to either one branch (`branch`) or several
 * (`branchCodes`, for content common to multiple branches and rendered at one
 * branch-neutral URL) -- never both. This is the one place that distinction
 * gets resolved into a plain array, so callers never have to check which
 * field is set.
 */
export function subjectBranchCodes(subject) {
  return subject.branchCodes && subject.branchCodes.length ? subject.branchCodes : [subject.branch];
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
