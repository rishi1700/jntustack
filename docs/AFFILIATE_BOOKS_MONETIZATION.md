# Affiliate Books Monetization

Status: planned pilot; not implemented
Recorded: 2026-07-15

This note records the proposed approach to monetizing subject pages with
affiliate links to relevant books. It does not authorize adding affiliate
links, changing the content schema, or publishing commercial recommendations.

## Decision Summary

The idea is a good fit for JNTUStack when it is implemented as a useful,
evidence-backed bibliography rather than an automated book-ad system.

The preferred initial presentation is:

> Books listed in the published syllabus

This is materially different from claiming that JNTUStack or JNTUK recommends
a particular book or retailer.

The intended model is:

```text
Official syllabus bibliography
  -> structured and source-linked book record
  -> human verification of title, author, edition, and publisher
  -> separately verified merchant listing
  -> clearly disclosed affiliate link
  -> availability and link-health monitoring
```

Academic evidence must remain independent of commission rates, retailer
availability, and affiliate-program decisions.

## Current Project Findings

Snapshot at the time this note was recorded:

- JNTUStack has 427 subject records: 396 verified/public and 31 drafts.
- The verified set includes 293 theory and 29 theory-cum-lab courses.
- The canonical Subject schema has no textbook, reference-book, recommendation,
  ISBN, author, publisher, or commercial-offer fields.
- The existing `resources` object contains only lecture notes, previous papers,
  and lab-manual URLs. All three resource URLs are currently null across the
  subject dataset.
- Bibliographies are present in source documents but are not part of the
  canonical extraction pipeline.
- The initial audit found bibliography text accidentally appended to Unit V in
  three verified ECE records. That extraction residue was removed on
  2026-07-15, and the site audit now guards against its return:
  - Digital Image Processing
  - Fundamentals of VLSI Design
  - Electronic Measurements and Instrumentations
- A legacy audit parser in `scripts/audit-content.js` demonstrates basic
  textbook/reference-section extraction, but its output is not used by the
  canonical build.
- The 396 verified subjects point to a small set of recurring syllabus PDFs,
  which makes source-level extraction more tractable than editing every subject
  independently.

Relevant implementation locations:

- `data/schema.json`: canonical Subject and Resources definitions.
- `templates/subject-page.js`: public syllabus, outcomes, unit checklist, and
  Downloads rail.
- `lib/entity-extractors/subject-extractor.js`: canonical subject extraction.
- `lib/diff-engine.js`: preservation and comparison of extracted content.
- `templates/admin.js`: evidence and proposal review.
- `lib/db-json.js` and `migrations/001_initial_schema.sql`: DB round trips.
- `scripts/audit-site.js`: generated-page integrity checks.

## Content Labels and Authority

Keep these content types visibly separate:

| Content | Public label | Authority |
| --- | --- | --- |
| A book explicitly named in the source PDF | Books listed in the published syllabus | Published syllabus evidence |
| A book independently reviewed by JNTUStack | JNTUStack study pick | Named human editorial review |
| A retailer link | Check availability - affiliate link | Commercial offer |

Rules:

- Never describe a retailer offer as recommended by JNTUK or a college.
- Preserve the order and textbook/reference classification from the source.
- Do not rank books by commission, price, or retailer availability.
- Do not call something a JNTUStack recommendation without an accountable human
  review and a useful written rationale.
- Keep affiliated-college bibliographies clearly labelled under the existing
  provenance and public-caveat rules.
- A syllabus citation is not proof of a current ISBN, edition, price, or
  retailer listing.

## Proposed Data Separation

Do not add books to the existing Downloads resource object. Academic book
records and commercial offers have different provenance, review, and expiry
rules.

### Academic bibliography

Suggested shape:

```json
{
  "syllabus_books": [
    {
      "book_id": "book_...",
      "role": "textbook",
      "title": "Example title",
      "authors": ["Example author"],
      "edition_text": "Second edition",
      "publisher": "Example publisher",
      "publication_year": null,
      "isbn_10": null,
      "isbn_13": null,
      "source": {
        "origin_url": "https://official.example/syllabus.pdf",
        "page": 42,
        "source_order": 1,
        "retrieved_date": "2026-07-15"
      },
      "verification_status": "verified"
    }
  ]
}
```

Preserve uncertain or missing values as null. Never infer an ISBN, edition, or
publication year from a similar retailer product.

### Commercial offer

Suggested separate record:

```json
{
  "book_id": "book_...",
  "merchant": "amazon_in",
  "region": "IN",
  "affiliate_url": "https://www.amazon.in/dp/example?tag=example-21",
  "merchant_product_id": "example",
  "match_status": "human_verified",
  "last_checked_at": "2026-07-15T12:00:00Z",
  "availability_status": "unknown",
  "enabled": true
}
```

This separation allows an expired or incorrect retailer offer to be disabled
without changing the sourced academic record or forcing a syllabus re-review.

## Book-Matching Rules

Before an offer becomes visible, a reviewer must confirm:

- exact title;
- all relevant authors or editors;
- volume, part, and subject where applicable;
- edition when the syllabus specifies one;
- publisher when the syllabus specifies one;
- ISBN only from a reliable bibliographic or publisher source;
- retailer product identity and format;
- that the linked product is not merely a similarly named guide or solution
  manual.

An edition currently sold by a retailer must not silently replace the edition
named in the syllabus. If both are shown, explain the distinction explicitly.

Do not let an LLM independently choose ASINs, ISBNs, editions, or affiliate
destinations. It may suggest candidates for human review.

## Public Page Experience

Place a restrained section after the syllabus units and outcomes, separate from
the Downloads rail:

```text
Books listed in this syllabus

Textbook
Title - Author, edition, publisher
Listed on page 42 of the published syllabus
[View syllabus evidence] [Check availability - affiliate link]

Affiliate links: JNTUStack may earn a commission at no extra cost to you.
```

Presentation rules:

- Show two to four high-confidence records before offering an expanded list.
- Use `Check availability`, not high-pressure wording such as `Buy now`.
- Do not imply that buying a book is required to pass the course.
- Include library, publisher, open-access, or high-quality free study options
  when they genuinely help the student.
- Do not show a commercial book section on a subject with no verified
  bibliography.
- Do not force books onto labs, projects, internships, seminars, or audit
  courses when they are not useful.
- Keep affiliate cards visually separate from notes, papers, official source
  links, and other downloads.
- Avoid prices during the first pilot.

## Compliance Requirements

The requirements below were checked on 2026-07-15 and must be rechecked before
implementation because affiliate terms and rates can change.

### Disclosure

Every commercial section should display a clear, nearby disclosure such as:

> Affiliate links: JNTUStack may earn a commission at no extra cost to you.

If Amazon India is used, its required site identification statement must also
appear clearly on the site:

> As an Amazon Associate I earn from qualifying purchases.

The disclosure must be visible without opening an About page or expanding
hidden text.

References:

- Amazon India disclosure guidance:
  <https://affiliate-program.amazon.in/help/node/topic/GPXFHVYZMTGPUMPE>
- ASCI Guidelines for Influencer Advertising in Digital Media:
  <https://www.ascionline.in/wp-content/uploads/2023/08/GUIDELINES-FOR-INFLUENCER-ADVERTISING-IN-DIGITAL-MEDIA.pdf>

### Link attributes and tracking

Every affiliate CTA should use:

```html
rel="sponsored nofollow noopener noreferrer"
```

Use merchant-approved tagged URLs. Do not hide the destination through unclear
link shortening or redirects. Tracking IDs may be used for broad page or
category measurement, but must not be dynamically assigned to identify
individual users.

Reference:

- Amazon India linking requirements:
  <https://affiliate-program.amazon.in/help/operating/linking>

### Price and availability

Do not manually copy or hardcode Amazon prices or availability. Amazon permits
these displays only through approved mechanisms, including its Product
Advertising API, with additional freshness and timestamp requirements.

The first pilot should use `Check availability` links without price claims.

### Original value and SEO

Do not copy merchant descriptions, reviews, images, or generic sales content.
The useful and original value should come from:

- the verified syllabus citation;
- textbook versus reference classification;
- accurate edition and author matching;
- an honest explanation of syllabus relevance;
- optional unit coverage mapping when evidence supports it;
- neutral access options rather than retailer-only promotion.

Google allows affiliate monetization but identifies copied, low-value merchant
content as thin affiliation:

- Google Search spam policies:
  <https://developers.google.com/search/docs/essentials/spam-policies>
- Google people-first content guidance:
  <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>

Do not add Product or Offer structured data unless the visible price,
availability, and offer facts are genuinely present and kept current.

## Commercial Assumptions

Amazon India's July 2026 fee schedule lists books at a 5.9% advertising rate.
Rates may change and qualifying purchases can be reduced by exclusions,
returns, cancellations, or tracking failures.

Illustrative economics only:

```text
Average qualifying book sale: Rs. 600
Rate: 5.9%
Approximate commission per sale: Rs. 35.40
100 qualifying sales/month: approximately Rs. 3,540
```

This is unlikely to be meaningful without sustained relevant traffic and good
conversion. Do not justify a large engineering or editorial workload based on
page count alone.

Current references:

- Amazon India fee schedule:
  <https://affiliate-program.amazon.in/help/node/topic/GRXPHT8U84RAYDXZ>
- Amazon India application review process:
  <https://affiliate-program.amazon.in/help/node/topic/G8TW5AE9XL2VX9VM>

Amazon currently states that it evaluates an application after at least three
qualifying sales within the first 180 days and expects robust, original, recent
public content. Program acceptance is not guaranteed.

## Recommended Pilot

Start with approximately 20 verified theory subjects, selected using a
combination of:

- clear official bibliography sections;
- reliable edition and retailer matching;
- relevant search or page traffic;
- representative branches and subject types;
- no unresolved source-provenance issue.

Pilot steps:

1. Keep bibliography text separate from unit topics; the known ECE residue was
   corrected on 2026-07-15 and is covered by a regression check.
2. Add a versioned bibliography schema and DB round-trip support.
3. Extract book candidates from official source PDFs.
4. Require human evidence review for each academic record.
5. Match exact retailer listings separately.
6. Add the disclosed public component to pilot subjects only.
7. Add link-health monitoring and a kill switch for each merchant or offer.
8. Measure results for at least one meaningful academic traffic cycle.
9. Review student usefulness, errors, conversions, maintenance effort, page
   performance, and Search Console impact before expanding.

Expansion should require:

- no unresolved book or edition mismatches;
- zero undisclosed commercial links;
- no meaningful mobile-performance regression;
- demonstrated student use rather than outbound clicks alone;
- revenue sufficient to justify recurring verification work;
- no SEO or trust degradation.

## Implementation Work Required

A complete implementation will require:

- new schema definitions for sourced bibliography records;
- DB migration and JSON import/export mappings;
- parser and extractor support for textbook/reference sections;
- diff preservation so thin extraction cannot delete verified books;
- admin evidence review and merchant-match approval;
- public rendering and responsive styling;
- affiliate configuration and environment separation;
- disclosure, approved-domain, link-attribute, and source-integrity tests;
- broken-link and stale-offer checks;
- click and conversion reporting without user-level affiliate identifiers;
- documentation and a merchant-wide disable switch.

Commercial offers should never be copied into the grounded academic search
index or used to influence subject answers.

## Decisions Still Needed

- Initial merchant and approved affiliate account.
- Pilot subjects and selection metrics.
- Whether the first release shows only syllabus-listed books or also includes
  separately reviewed JNTUStack picks.
- Exact human-review checklist for ISBN and retailer-product matching.
- Offer storage model and link-check cadence.
- Analytics approach and privacy policy updates.
- Ownership of recurring link, edition, and disclosure audits.
- Minimum commercial result required before expanding beyond the pilot.

Until these decisions are made and the pilot is implemented with tests, no
affiliate link should be added to public subject pages.
