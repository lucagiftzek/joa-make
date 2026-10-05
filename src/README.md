# Job Opportunities API (JOA)

Employer-direct job postings from employers' own applicant tracking systems and career sites. Every field is tagged
published, inferred or absent, and closed roles are tracked so stale listings can be removed.

**Connect:** paste your API key. A free key (no card required) is available at https://jobopportunitiesapi.org/signup.
Coverage (live figures): https://jobopportunitiesapi.org/coverage · API docs: https://jobopportunitiesapi.org/docs

## Modules
- **Watch New Jobs** — triggers on new jobs matching keywords, countries, work arrangement, employment type, seniority, category and companies.
- **Watch Closed Jobs** — triggers when a job closes or expires at its source (Growth plan or above).
- **Search Jobs** — searches jobs with the same filters, newest first.
- **Get a Job** — retrieves one job, with its description, by ID or slug.
- **Search Companies** / **Get a Company** — find employers.
- **Make an API Call** — any other endpoint of the API.

Every returned job counts against your plan's record allowance; keep limits small and filters specific.
The apply link (`apply_url`) always points to the employer. When a job carries `attribution` and `canonical_url`,
show the attribution with the listing and link to `canonical_url`.
