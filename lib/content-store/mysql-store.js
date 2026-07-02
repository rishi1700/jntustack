import { closeDbPool, describeDbError, getDbPool } from '../db.js';
import { exportDbContent } from '../db-json.js';

function subjectFilesFromContent(content) {
  return [...new Set(content.subjects.map(subject => `subjects-${String(subject.branch).toLowerCase()}.json`))].sort();
}

function collegeFilesFromContent(content) {
  return [...new Set(content.colleges.map(college => `colleges-${String(college.affiliated_to).toLowerCase()}.json`))].sort();
}

export function createMysqlStore() {
  return {
    name: 'db',
    async loadContent() {
      try {
        const pool = await getDbPool({ requireConfigured: true });
        const content = await exportDbContent(pool);
        return {
          source: 'db',
          subjectFiles: subjectFilesFromContent(content),
          collegeFiles: collegeFilesFromContent(content),
          data: {
            regulations: content.shared.regulations,
            branches: content.shared.branches,
            subjects: content.subjects,
          },
          colleges: content.colleges,
          coverageNotes: [],
          branchProfiles: content.branchProfiles,
        };
      } catch (err) {
        const safe = describeDbError(err);
        throw new Error(`CONTENT_SOURCE=db failed to load MySQL content: ${safe.code ? `${safe.code} ` : ''}${safe.message}`);
      } finally {
        await closeDbPool();
      }
    },
  };
}
