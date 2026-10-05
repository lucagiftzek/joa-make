# Job Opportunities API (JOA) — Make (make.com) custom app

Source of a Make custom app for the **Job Opportunities API (JOA)**: employer-direct job postings from employers' own
applicant tracking systems and career sites, every field tagged published / inferred / absent, closures tracked.

- Website: https://jobopportunitiesapi.org — coverage (live figures): https://jobopportunitiesapi.org/coverage
- API docs: https://jobopportunitiesapi.org/docs — free API key (no card required): https://jobopportunitiesapi.org/signup

`src/` uses the **local development layout of the official "Make Apps Editor" VS Code extension**
(`Integromat.apps-sdk`): `makecomapp.json` + IMLJSON code files (`*.iml.jsonc`, the extension's current default;
the files contain no comments, so they are also plain JSON). Deploy it with *Deploy to Make* on `makecomapp.json`.

## Components

| Component | Type | Endpoint | Notes |
|---|---|---|---|
| Job Opportunities API (JOA) | connection (basic) | `GET /v1/me` | API key (password field), Bearer header; label "`<plan>` plan"; `log.sanitize` |
| Watch New Jobs | trigger (polling) | `GET /v1/jobs` | static filters (keywords, countries, work arrangement, employment type, seniority, category, companies) + limit; `trigger` = date (`posted_at`), desc; `posted_after` from `data.lastDate`; cursor pagination; epoch panel |
| Watch Closed Jobs | trigger (polling) | `GET /v1/jobs/expired` | Growth+; `since` rebuilt as `<data.lastDate>|<data.lastID>` (the API's keyset cursor format); `next_since` pagination; epoch panel |
| Search Jobs | search | `GET /v1/jobs` | mappable filters + posted after + include description + limit; cursor pagination |
| Get a Job | action (read) | `GET /v1/jobs/{id}` | ID or slug, include closed; outputs `job` + `description` |
| Search Companies | search | `GET /v1/companies` | name, country, limit; cursor pagination |
| Get a Company | action (read) | `GET /v1/companies/{slug}` | slug dropdown from the `list-companies` RPC (mappable) |
| Make an API Call | universal | any | URL path, method, headers, query string, body |
| list-companies | RPC | `GET /v1/companies` | label/value pairs for dropdowns |

Base (`general/base.iml.jsonc`): base URL, Bearer header from the connection, per-status errors —
401 InvalidAccessTokenError (with the signup link), 402 record allowance, 403 InvalidConfigurationError (plan),
404/410/400/422 DataError, 429 RateLimitError (with `Retry-After`) — and `log.sanitize` for the Authorization header.

No "Watch Job Changes": Make keeps only the last item's date and ID between runs, which cannot carry the change
feed's opaque cursor (the feed items have no timestamp of their own). The Pipedream and Activepieces builds have it.

Every returned job counts against the plan's record allowance; limits default to 10. `apply_url` is always the
employer's own apply link; when `attribution` / `canonical_url` are present, show the attribution and link to
`canonical_url`.

## Checks (no Make account needed)

```bash
npm install
npm run fetch-schemas   # downloads the extension's official IMLJSON + makecomapp JSON schemas into test/.schemas/
npm test                # validate.mjs (structure, review rules, IML parse, schemas) + simulate.mjs (6 offline cases)
set -a; . ~/.config/joa-integrations/test.env; set +a
npm run test:live       # + 3 live cases (requests built from the app's IML, sent to the real API)
```

`test/iml.mjs` is a small IML evaluator for the functions this app uses (`join`, `upper`, `trim`, `ifempty`, `if`,
`formatDate`, `addDays`, `encodeURL`, `length`, `toCollection`); `simulate.mjs` uses it to build the exact
request Make would send and to apply `iterate` / `output` / `limit` / `trigger` / `pagination` / `error`.

## Publishing

See [PUBLISHING.md](PUBLISHING.md). Nothing has been created in Make.

## Licence

MIT — see [LICENSE](LICENSE). Maintainer: Loukas Tzekos <support@jobopportunitiesapi.org>.
