import { unserialize, serialize } from 'php-serialize';

/**
 * EASY DIGITAL DOWNLOADS FILE EXTRACTION
 * =======================================
 * Why this script exists: the public subject pages link to a `/downloads/{slug}/`
 * product page, and that page requires an add-to-cart + checkout before EDD reveals
 * the file -- even at price 0. So no crawler can reach the PDFs from the public site.
 * The real file URLs/attachment IDs are stored server-side, in WordPress's database,
 * as a PHP-serialized array under postmeta key `_edd_download_files` on each
 * `download` custom-post-type entry. This script reads THAT, bypassing the
 * checkout gate entirely (you're the owner -- you don't need to "buy" your own files).
 *
 * STEP 1 -- pull the raw data from the live server. Two ways, pick whichever
 * access you have:
 *
 *   (a) WP-CLI (if you have SSH access to the host):
 *       wp post list --post_type=download --field=ID,post_title,post_name --format=csv > downloads.csv
 *       wp post meta get <ID> _edd_download_files --format=json   # repeat per ID, or script the loop
 *
 *   (b) Direct SQL export (if you have phpMyAdmin/DB access instead of SSH):
 *       SELECT p.ID, p.post_title, p.post_name, pm.meta_value
 *       FROM wp_posts p
 *       JOIN wp_postmeta pm ON pm.post_id = p.ID
 *       WHERE p.post_type = 'download' AND pm.meta_key = '_edd_download_files';
 *
 * STEP 2 -- feed each `meta_value` string into parseEddFileMeta() below.
 */

export function parseEddFileMeta(serializedString) {
  const raw = unserialize(serializedString);
  // EDD stores this as an object keyed "0","1","2"... each value like:
  // { name: 'DWDM_UNIT-1', file: 'https://.../wp-content/uploads/.../DWDM_UNIT-1.pdf', condition: 'all' }
  return Object.values(raw).map(entry => ({
    name: entry.name ?? null,
    file_url: entry.file ?? null,
    condition: entry.condition ?? null,
  }));
}

export function buildMigrationRecord({ productId, productSlug, productTitle, files }) {
  return {
    product_id: productId,
    product_slug: productSlug,
    product_title: productTitle,
    file_count: files.length,
    files: files.map(f => ({
      ...f,
      // where it needs to land once re-hosted off WordPress -- adjust bucket/path
      // convention to taste, this just keeps the original filename
      target_path: f.file_url ? `r16/${productSlug}/${f.file_url.split('/').pop()}` : null,
    })),
  };
}

// --- demonstration against a realistic mock, matching EDD's real serialization shape ---
// (Not live data -- bash_tool's network can't reach the production DB from here.
//  Point STEP 1's output at this function once you have a real export.)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Built via serialize() rather than hand-typed -- PHP's format prefixes every
  // string with its exact byte length, which is easy to miscount by hand (learned
  // that the hard way on the first pass of this script). Generating it programmatically
  // guarantees the mock is well-formed, while still exercising the real unserialize() path.
  const mockStructure = {
    0: { name: 'DWDM_UNIT-1', file: 'https://jntukmaterials.com/wp-content/uploads/2020/07/DWDM_UNIT-1.pdf', condition: 'all' },
    1: { name: 'DWDM_UNIT-2', file: 'https://jntukmaterials.com/wp-content/uploads/2020/07/DWDM_UNIT-2.pdf', condition: 'all' },
    2: { name: 'DWDM_UNIT-3', file: 'https://jntukmaterials.com/wp-content/uploads/2020/07/DWDM_UNIT-3.pdf', condition: 'all' },
    3: { name: 'DWDM_UNIT-4', file: 'https://jntukmaterials.com/wp-content/uploads/2020/07/DWDM_UNIT-4.pdf', condition: 'all' },
    4: { name: 'DWDM_UNIT-5', file: 'https://jntukmaterials.com/wp-content/uploads/2020/07/DWDM_UNIT-5.pdf', condition: 'all' },
  };
  const mockSerializedFromWpDb = serialize(mockStructure);

  const files = parseEddFileMeta(mockSerializedFromWpDb);
  const record = buildMigrationRecord({
    productId: 1234,
    productSlug: 'data-warehousing-and-mining-jntuk-r16-materials',
    productTitle: '[3-2]Data Warehousing and Mining Jntuk R16 Materials',
    files,
  });

  console.log('Parsed from mock EDD postmeta (replace with a real DB export to use for real):');
  console.log(JSON.stringify(record, null, 2));
  console.log('');
  console.log(`Matches the 5 filenames shown on the gated product page: ${
    files.map(f => f.name).join(', ') === 'DWDM_UNIT-1, DWDM_UNIT-2, DWDM_UNIT-3, DWDM_UNIT-4, DWDM_UNIT-5'
  }`);
  console.log('Note: the page audit (audit-content.js) found 6 syllabus units but only 5 files here --');
  console.log('that mismatch is real and will show up again once this runs against the live DB.');
}
