import fs from 'node:fs';
import path from 'node:path';
import { loadDataset, loadMergedColleges } from '../dataset.js';

function branchProfilePath(dataDir) {
  return path.join(dataDir, 'branch-guide-data.json');
}

export function createJsonStore({ dataDir }) {
  return {
    name: 'json',
    async loadContent() {
      const { files: subjectFiles, data } = loadDataset(dataDir);
      const { files: collegeFiles, colleges, coverageNotes } = loadMergedColleges(dataDir);
      const { branch_profiles: branchProfiles } = JSON.parse(fs.readFileSync(branchProfilePath(dataDir), 'utf-8'));

      return {
        source: 'json',
        subjectFiles,
        collegeFiles,
        data,
        guides: data.guides || [],
        colleges,
        coverageNotes,
        branchProfiles,
      };
    },
  };
}
