// 301s for public URLs that were live/indexed before a content restructure
// moved them. Only URLs that were actually published (source.status ===
// 'verified' at some point, i.e. present in a real deploy) belong here --
// a URL that only ever existed as a needs_verification draft was never in
// dist/, so nothing could have linked or indexed it, and it needs no entry.
//
// Keys and values are pathnames with a leading and trailing slash, matching
// how every page on this site is served (dist/<slug>/index.html -> /<slug>/).
export const LEGACY_REDIRECTS = {
  // CSE 1-1 Chemistry: was verified at the per-branch URL below (added before
  // first-year content became branch-neutral for subjects shared across
  // branches); Chemistry 1-1 is shared by CSE and EEE, so it now renders once
  // at a branch-neutral URL instead of a CSE-specific one.
  '/r23-cse-1-1-chemistry/': '/chemistry-jntuk-r23-1-1/',
};
