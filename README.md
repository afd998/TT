# Playwright + Chrome + Local Secrets

This project boots a minimal JavaScript Playwright Test setup that explicitly drives Google Chrome and reads secrets from a local `.env` file.

## Getting started

1. Install dependencies
   ```bash
   npm install
   ```
2. Create your environment file
   ```bash
   cp .env.example .env
   # edit .env and provide NETID=... and NETID_PW=...
   ```
3. Run the tests headless (Chrome channel is selected in `playwright.config.js`)
   ```bash
   npm test
   ```
   To watch the browser, run `npm run test:headed`.

### Single Node-driven run

If you only need to exercise the ServiceNow login/navigation flow (e.g., while building a script), run the helper that uses the core `playwright` library directly:

```bash
# headed by default so you can see Chrome; script will pause on the ServiceNow page
npm run run:node

# for CI or background runs
npm run run:ci
```

## How secrets flow

- `playwright.config.js` loads environment variables via `dotenv` before Playwright spins up.
- Tests can now read `process.env.*`; see `tests/close-tickets.spec.js` for a Playwright Test version and `tests/run-close-tickets.js` for a bare-node example that drives ServiceNow.
- If the ServiceNow login page appears, the scripts pull `NETID` and `NETID_PW` from `.env`, fill the `idToken1`/`idToken2` inputs, submit `loginButton_0`, and wait until they land on the incident list.
- Shift-specific filtering lives in `config.js`; define one or more shift objects (name, `startHour`, `endHour`, and `rooms` array) to highlight when the automation finds an incident that matches both the time window and any of your assigned rooms.
- Set `HEADLESS=true|false` (or pass `--headless/--headed` to the node runner) to override whether Chrome is visible; by default, CI is headless and local runs are headed.
- `.env` stays local (ignored via `.gitignore`), so secrets never leave your machine or get committed.

## Scheduled GitHub Action

A workflow in `.github/workflows/daily-playwright.yml` runs `npm run run:ci` once per day in headless mode. Store `NETID` and `NETID_PW` as repository secrets so the workflow can authenticate (thanks to `dotenv`, they are injected into the script at runtime). You can also trigger it manually via the workflow dispatch button.
