# Monitor Guide

This folder contains the SmartStream operations dashboard. It is a separate frontend from the main business app and is intended for engineering, admin, or support use.

## What The Monitor Does

The monitor turns infrastructure health into a UI that is easier to understand than raw CloudWatch pages. It shows:

- a top-level pipeline health overview
- per-pipeline status rows
- alarm summaries
- recent log summaries
- pipeline drill-down details in a modal
- data-source status that tells you whether the page is using live data, partial live data, mixed data, or mock fallback data

## Technology Stack

- Vite
- vanilla JavaScript modules
- HTML and CSS
- Vitest
- jsdom

## Folder Layout

| Path | Responsibility |
| --- | --- |
| `index.html` | Main monitor app shell |
| `src/main.js` | App entry point |
| `src/app.js` | Monitor controller: refreshes, filters, modal state, and polling |
| `src/api/client.js` | Shared GET client and auth-token lookup |
| `src/api/opsApi.js` | Ops API wrapper with fallback logic |
| `src/pages/overviewPage.js` | Main page renderer |
| `src/components/` | UI pieces for cards, tables, modal, alarms, and summaries |
| `src/mock/opsData.js` | Mock payloads used when live data is unavailable or explicitly disabled |
| `src/utils/` | Formatting and status helpers |
| `src/styles/` | Theme and page styles |
| `src/__tests__/` | Monitor unit/UI tests |

## Environment Variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_MONITOR_API_BASE_URL` | Usually yes | Base URL for the Ops API |
| `VITE_MONITOR_USE_MOCK` | No | Force mock mode when set to `true` |
| `VITE_MONITOR_REFRESH_INTERVAL_MS` | No | Auto-refresh interval, minimum effective value is 15000 |
| `VITE_MONITOR_AUTH_TOKEN` | No | Explicit bearer token for monitor requests |
| `VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY` | No | Local storage key to read token from, default `smartstream_auth_token` |

## Local Development

Install dependencies:

```powershell
Set-Location monitor
npm ci
```

Create `.env.local`:

```env
VITE_MONITOR_API_BASE_URL=https://<ops-api-id>.execute-api.<region>.amazonaws.com
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_REFRESH_INTERVAL_MS=60000
VITE_MONITOR_AUTH_TOKEN=
VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY=smartstream_auth_token
```

Run locally:

```powershell
npm run dev
```

Other useful commands:

```powershell
npm run build
npm run preview
npm test
npm run test:coverage
```

## Auth Behavior

The monitor client looks for a token in this order:

1. `VITE_MONITOR_AUTH_TOKEN`
2. local storage entry under `VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY`
3. no token

This means the monitor can piggyback on the business frontend login if both apps use the same browser and token storage key.

## Fallback Logic

The monitor is intentionally resilient during demos and partial outages.

Fallback rules from `src/api/opsApi.js`:

- if mock mode is forced, it uses mock data immediately
- if the base URL is missing, it uses mock data immediately
- if a live request fails with a 5xx or network-style error, it falls back to mock data
- if a live request fails with a 4xx, the error is surfaced to the user instead of being hidden

This is important because:

- missing auth or bad configuration should stay visible
- temporary backend or network issues should still allow the UI to be explored

## Refresh Model

- the default refresh interval is 60 seconds
- the app clamps the interval to a minimum of 15 seconds
- users can toggle auto-refresh on and off
- pipeline detail views can refresh in the background while staying open

## Testing

The current tests cover:

- ops API normalization and fallback behavior
- overview page rendering
- pipeline detail drill-down
- mixed/live/mock status handling

Run them with:

```powershell
Set-Location monitor
npm test
```

## Common Gotchas

- If the Ops API is configured to require auth and you do not provide a token, the app will surface `401` responses rather than silently mocking.
- The monitor is a separate app from the main frontend, so deploying one does not automatically deploy the other.
- Mock fallback is a convenience feature, not proof that the live platform is healthy.
