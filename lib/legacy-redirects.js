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

  // The first official JNTUK ECE re-source confirmed these two lab records
  // had inherited one another's semester placement from the earlier
  // autonomous-college dataset. Both old URLs were already public, so retain
  // permanent redirects after correcting the canonical semester slugs.
  '/signals-and-systems-lab-jntuk-r23-ece-2-1/': '/signals-and-systems-lab-jntuk-r23-ece-2-2/',
  '/switching-theory-and-logic-design-lab-jntuk-r23-ece-2-2/': '/switching-theory-and-logic-design-lab-jntuk-r23-ece-2-1/',

  // Central JNTUK Civil IV-year sourcing corrected several autonomous-college
  // titles and replaced the software-lab title. Two autonomous-only electives
  // are no longer canonical, so their previously public URLs return students
  // to the CE semester listing instead of becoming dead links.
  '/advance-construction-management-jntuk-r23-ce-4-1/': '/advanced-construction-management-jntuk-r23-ce-4-1/',
  '/pre-stressed-concrete-jntuk-r23-ce-4-1/': '/prestressed-concrete-jntuk-r23-ce-4-1/',
  '/design-drawing-of-irrigation-structures-jntuk-r23-ce-4-1/': '/design-and-drawing-of-irrigation-structures-jntuk-r23-ce-4-1/',
  '/railways-and-airport-engineering-jntuk-r23-ce-4-1/': '/railway-and-airport-engineering-jntuk-r23-ce-4-1/',
  '/structural-analysis-and-design-laboratory-using-etabs-jntuk-r23-ce-4-1/': '/skills-on-civil-engineering-software-jntuk-r23-ce-4-1/',
  '/building-services-jntuk-r23-ce-4-1/': '/ce/#sem-4-1',
  '/watershed-management-jntuk-r23-ce-4-1/': '/ce/#sem-4-1',
};
