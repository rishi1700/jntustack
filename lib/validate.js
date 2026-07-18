import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';

/**
 * Validates an already-assembled dataset object against the schema on disk.
 * Throws (and halts the build) if the data is structurally invalid.
 * This is a build-time gate, not a documentation suggestion -- a malformed
 * record cannot reach dist/ no matter what generated or wrote it.
 *
 * The dataset is now assembled in build.js by merging data/shared.json
 * (regulations + branches) with every data/subjects-*.json file, so this takes
 * the merged object directly rather than reading a single data file itself.
 */
export function validateData(schemaPath, data) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid) {
    console.error('Schema validation FAILED -- build aborted:');
    for (const err of validate.errors) {
      console.error(`  ${err.instancePath || '(root)'} ${err.message}`);
    }
    throw new Error(`${validate.errors.length} schema violation(s) found.`);
  }

  const semanticErrors = [];
  const branchCodes = new Set((data.branches || []).map(branch => branch.code));
  const seenSubjectIds = new Set();
  const seenSlugs = new Set();
  const guidesByPath = new Map((data.guides || []).map(guide => [`/${guide.seo.slug}/`, guide]));

  for (const subject of data.subjects || []) {
    if (seenSubjectIds.has(subject.id)) semanticErrors.push(`duplicate subject id: ${subject.id}`);
    seenSubjectIds.add(subject.id);
    if (seenSlugs.has(subject.seo.slug)) semanticErrors.push(`duplicate public slug: ${subject.seo.slug}`);
    seenSlugs.add(subject.seo.slug);

    const offerings = subject.offerings || [{
      branchCodes: subject.branchCodes?.length ? subject.branchCodes : [subject.branch],
      year: subject.year,
      semester: subject.semester,
      year_sem_label: subject.year_sem_label,
    }];
    const offeredBranches = new Set();
    for (const offering of offerings) {
      const expectedLabel = `${offering.year}-${offering.semester}`;
      if (offering.year_sem_label && offering.year_sem_label !== expectedLabel) {
        semanticErrors.push(`${subject.id} offering label ${offering.year_sem_label} does not match ${expectedLabel}`);
      }
      for (const code of offering.branchCodes || []) {
        if (!branchCodes.has(code)) semanticErrors.push(`${subject.id} references unknown branch ${code}`);
        if (offeredBranches.has(code)) semanticErrors.push(`${subject.id} has duplicate offering branch ${code}`);
        offeredBranches.add(code);
      }
    }

    if (subject.publication?.mode === 'listing_only') {
      if (subject.source?.status !== 'verified') semanticErrors.push(`${subject.id} is listing_only but not source-verified`);
      const listingUrl = subject.publication.listing_url;
      if (listingUrl?.startsWith('/')) {
        const [pathname, anchor] = listingUrl.split('#');
        const guide = guidesByPath.get(pathname);
        if (!guide) semanticErrors.push(`${subject.id} listing_url targets an unknown guide: ${listingUrl}`);
        else if (anchor && !(guide.sections || []).some(section => section.id === anchor)) {
          semanticErrors.push(`${subject.id} listing_url targets an unknown guide section: ${listingUrl}`);
        }
      }
    }
  }

  const seenGuideIds = new Set();
  for (const guide of data.guides || []) {
    if (seenGuideIds.has(guide.id)) semanticErrors.push(`duplicate guide id: ${guide.id}`);
    seenGuideIds.add(guide.id);
    if (seenSlugs.has(guide.seo.slug)) semanticErrors.push(`duplicate public slug: ${guide.seo.slug}`);
    seenSlugs.add(guide.seo.slug);
    const sectionIds = new Set();
    for (const section of guide.sections || []) {
      if (sectionIds.has(section.id)) semanticErrors.push(`${guide.id} has duplicate section id ${section.id}`);
      sectionIds.add(section.id);
    }
  }

  if (semanticErrors.length) {
    console.error('Semantic validation FAILED -- build aborted:');
    for (const error of semanticErrors) console.error(`  ${error}`);
    throw new Error(`${semanticErrors.length} semantic content violation(s) found.`);
  }

  return data;
}
