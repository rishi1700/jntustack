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

  // The central EEE syllabus includes IPR in the official course title. Keep
  // the shorter previously published URL working after correcting its slug.
  '/research-methodology-jntuk-r23-eee-3-2/': '/research-methodology-and-ipr-jntuk-r23-eee-3-2/',

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

  // Central JNTUK third-year structures correct semester placement and titles
  // inherited from the earlier autonomous-college dataset.
  '/micro-electro-mechanical-systems-jntuk-r23-mech-3-1/': '/micro-electro-mechanical-systems-jntuk-r23-mech-3-2/',
  '/industrial-robotics-jntuk-r23-mech-3-1/': '/industrial-robotics-jntuk-r23-mech-3-2/',
  '/renewable-energy-technologies-jntuk-r23-mech-3-2/': '/renewable-energy-technologies-jntuk-r23-mech-3-1/',
  '/non-destructive-evaluation-jntuk-r23-mech-3-2/': '/non-destructive-evaluation-jntuk-r23-mech-3-1/',
  '/universal-human-values-2-jntuk-r23-mech-2-1/': '/universal-human-values-jntuk-r23-mech-2-1/',
  '/green-buildings-jntuk-r23-ce-3-2/': '/green-buildings-jntuk-r23-ce-3-1/',
  '/hydraulics-and-hydraulic-machinery-lab-jntuk-r23-ce-3-1/': '/fluid-mechanics-and-hydraulic-machines-lab-jntuk-r23-ce-3-1/',
  '/universal-human-values-2-jntuk-r23-ce-2-1/': '/universal-human-values-jntuk-r23-ce-2-1/',
  '/finite-element-method-in-civil-engineering-jntuk-r23-ce-3-2/': '/finite-element-method-jntuk-r23-ce-3-2/',

  // These autonomous-only pages are not part of the central JNTUK baseline.
  // Return their previously public URLs to the relevant semester rather than
  // implying that another course is equivalent.
  '/structural-and-modal-analysis-using-ansys-jntuk-r23-mech-2-2/': '/mech/#sem-2-2',
  '/safety-engineering-jntuk-r23-ce-3-1/': '/ce/#sem-3-1',
  '/low-cost-and-eco-friendly-building-techniques-jntuk-r23-ce-3-2/': '/ce/#sem-3-2',

  // Official branch scopes confirmed these syllabi are common to two branches.
  // They now render once at branch-neutral URLs and fan out to both hubs.
  '/chemistry-jntuk-r23-ece-1-2/': '/chemistry-jntuk-r23-1-2/',
  '/chemistry-lab-jntuk-r23-ece-1-2/': '/chemistry-lab-jntuk-r23-1-2/',
  '/data-structures-jntuk-r23-cse-1-2/': '/data-structures-jntuk-r23-1-2/',
  '/data-structures-lab-jntuk-r23-cse-1-2/': '/data-structures-lab-jntuk-r23-1-2/',
  '/soft-skills-jntuk-r23-it-3-2/': '/soft-skills-jntuk-r23-3-2/',
  '/principles-of-operating-systems-jntuk-r23-cse-3-1/': '/principles-of-operating-systems-jntuk-r23-3-1/',
  '/computer-organization-and-architecture-jntuk-r23-cse-3-1/': '/computer-organization-and-architecture-jntuk-r23-3-1/',
  '/principles-of-database-management-systems-jntuk-r23-cse-3-2/': '/principles-of-database-management-systems-jntuk-r23-3-2/',

  // Exact branch copies with identical structure, credits and syllabus now
  // share one neutral canonical page. Both formerly public branch URLs remain
  // valid entry points, while the branch hubs fan out to the shared record.
  '/database-management-systems-lab-jntuk-r23-cse-2-2/': '/database-management-systems-lab-jntuk-r23-2-2/',
  '/database-management-systems-lab-jntuk-r23-it-2-2/': '/database-management-systems-lab-jntuk-r23-2-2/',
  '/human-resources-and-project-management-jntuk-r23-cse-4-1/': '/human-resources-and-project-management-jntuk-r23-4-1/',
  '/human-resources-and-project-management-jntuk-r23-it-4-1/': '/human-resources-and-project-management-jntuk-r23-4-1/',
  '/blockchain-technology-jntuk-r23-cse-4-1/': '/blockchain-technology-jntuk-r23-4-1/',
  '/blockchain-technology-jntuk-r23-it-4-1/': '/blockchain-technology-jntuk-r23-4-1/',
  '/agile-methodologies-jntuk-r23-cse-4-1/': '/agile-methodologies-jntuk-r23-4-1/',
  '/agile-methodologies-jntuk-r23-it-4-1/': '/agile-methodologies-jntuk-r23-4-1/',
  '/computer-vision-jntuk-r23-cse-4-1/': '/computer-vision-jntuk-r23-4-1/',
  '/computer-vision-jntuk-r23-it-4-1/': '/computer-vision-jntuk-r23-4-1/',
  '/cyber-physical-systems-jntuk-r23-cse-4-1/': '/cyber-physical-systems-jntuk-r23-4-1/',
  '/cyber-physical-systems-jntuk-r23-it-4-1/': '/cyber-physical-systems-jntuk-r23-4-1/',
  '/prompt-engineering-jntuk-r23-cse-4-1/': '/prompt-engineering-jntuk-r23-4-1/',
  '/prompt-engineering-jntuk-r23-it-4-1/': '/prompt-engineering-jntuk-r23-4-1/',
  '/constitution-of-india-jntuk-r23-cse-4-1/': '/constitution-of-india-jntuk-r23-4-1/',
  '/constitution-of-india-jntuk-r23-it-4-1/': '/constitution-of-india-jntuk-r23-4-1/',

  // Quantum Science & Technology is the same official 4-1 open elective for
  // all four listed branches, backed by each branch's central JNTUK PDF.
  '/quantum-science-and-technology-jntuk-r23-ce-4-1/': '/quantum-science-and-technology-jntuk-r23-4-1/',
  '/quantum-science-and-technology-jntuk-r23-ece-4-1/': '/quantum-science-and-technology-jntuk-r23-4-1/',
  '/quantum-science-and-technology-jntuk-r23-eee-4-1/': '/quantum-science-and-technology-jntuk-r23-4-1/',
  '/quantum-science-and-technology-jntuk-r23-mech-4-1/': '/quantum-science-and-technology-jntuk-r23-4-1/',

  // The central PDFs repeat these exact syllabi under both professional- and
  // open-elective headings. One page now records both offering categories.
  '/construction-technology-and-management-open-elective-jntuk-r23-ce-3-1/': '/construction-technology-and-management-jntuk-r23-ce-3-1/',
  '/introduction-to-industrial-robotics-jntuk-r23-mech-3-2/': '/industrial-robotics-jntuk-r23-mech-3-2/',
  '/introduction-to-mechatronics-jntuk-r23-mech-4-1/': '/mechatronics-jntuk-r23-mech-4-1/',

  // Normalize the one legacy entity-key-shaped public slug.
  '/r23-eee-2-1-dc-machines-and-transformers/': '/dc-machines-and-transformers-jntuk-r23-eee-2-1/',
};
