# Publishing the Make custom app (run only after Luca approves)

Nothing below has been run; no Make account was created.

## 1. Create the app (private) and deploy this source
1. Sign in to Make (a free account; custom-app creation on the free plan is not documented either way — confirm in the UI).
   Note the zone in the URL (eu1, eu2, us1, us2…).
2. Profile -> API access -> create an API token with the Custom Apps / SDK scopes
   (https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/generation-of-your-api-key).
3. VS Code: install **Make Apps Editor** (`Integromat.apps-sdk`), run *Make Apps: Add SDK Environment* with
   `https://<zone>.make.com/api` and the token.
4. In the Make Apps sidebar: *New app* — label "Job Opportunities API (JOA)", ID `job-opportunities-api`
   (immutable; if taken, pick another and update `src/makecomapp.json` -> `origins[0].appId`), version 1,
   description, theme colour, language English, all countries.
5. Put the token in `.secrets/apikey` at the repo root (git-ignored; `apikeyFile` is `../.secrets/apikey`) and set
   `origins[0].baseUrl` to the zone.
6. Right-click `src/makecomapp.json` -> *Deploy to Make*. Choose "create new" when asked to pair each local
   component (connection, 7 modules, 1 RPC). Upload the logo (512×512 PNG) in the app settings.

## 2. Test inside Make (all private)
- Create a connection with a JOA key (label shows "`<plan>` plan"); try a bad key (expect the 401 message).
- Scenarios: Watch New Jobs -> (any action); Watch Closed Jobs (Growth+ key) -> ...; Search Jobs / Get a Job /
  Search Companies / Get a Company / Make an API Call (`/v1/meta/facets`). Run each once; check pagination logs
  for a search with limit above the key's page size.
- A private app is usable only by its author until installed into an organisation from a scenario.

## 3. Make's app-review checklist (to make it public)
- [x] Real web-service API on its own domain; no wrappers or third-party names in module labels.
- [x] Base and connection: `log.sanitize` for the Authorization header.
- [x] Base and connection: error handling; the connection calls a real endpoint (`/v1/me`) and fails on bad keys.
- [x] Module labels/descriptions follow the naming conventions (Watch…, Search…, Get a…, Make an API Call).
- [x] Universal "Make an API Call" module.
- [x] Interfaces for every module; dates typed as `date`; samples for every module.
- [x] Triggers, searches and the RPC have a limit and pagination.
- [ ] Test scenarios: every module used in at least one scenario; one runs error-free, one produces an error;
      search modules at the end of routes; pagination visible in logs; no personal data. Run them right before
      requesting review (log retention is limited).
- [ ] Remove test modules/connections before publishing (cannot be deleted afterwards).
- [ ] Click **Publish** (irreversible), open the **Review** tab, add the API docs link
      (https://jobopportunitiesapi.org/docs) and the scenario links, click **Request review**; answer the
      "App review" email from Make.
