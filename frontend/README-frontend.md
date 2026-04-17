# Frontend Guide

This folder contains the business-facing SmartStream web application. It is the app used by tenant users to sign in, view their business data, inspect forecasts, review anomalies, and manage workspace preferences.

## What The App Does

The frontend is a Vite-powered single-page app built with vanilla JavaScript, HTML, and CSS. It provides these main experiences:

- invite-based sign up and sign in
- dashboard metrics for spend, headcount, and department mix
- custom chart creation
- controlled query exploration against trusted data
- anomaly list, detail view, and review actions
- forecast pages for spend and headcount outlook
- settings for account, appearance, accessibility, security placeholders, and company access

## Main Pages

The route definitions live in `src/routes.js`.

| Route | Page name | Purpose |
| --- | --- | --- |
| `/dashboard` | Dashboard | Main business summary and metrics |
| `/charts` | Create Graph | Build custom chart views |
| `/query` | Query | Explore trusted data with the safe query endpoint |
| `/alerts` | Anomalies | Review and action anomaly results |
| `/forecasts` | Forecasts | Planning outlook based on ML output |
| `/settings` | Settings | Account, preferences, and tenant context |
| `/login` | Login | Sign in or create an account with an invite |

## Technology Stack

- Vite
- vanilla JavaScript modules
- HTML and CSS
- Vitest
- jsdom
- ESLint

## Folder Layout

| Path | Responsibility |
| --- | --- |
| `index.html` | Main app shell markup |
| `src/main.js` | App bootstrap, routing, auth flow, workspace startup |
| `src/routes.js` | Route metadata and page mapping |
| `src/liveUpdates.js` | Polling and live dashboard feed behavior |
| `src/insightsData.js` | Dashboard, forecast, query, and chart orchestration |
| `src/anomaliesData.js` | Anomaly feed, detail drawer, and action workflow |
| `src/services/` | API and auth session helpers |
| `src/settings/` | Settings page rendering and service adapters |
| `src/preferences/` | Browser-side theme, layout, and accessibility storage |
| `src/__tests__/` | Frontend unit/UI tests |

## Auth And Session Model

The frontend expects the Live API to provide:

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`

Session behavior:

- the auth token is stored in local storage as `smartstream_auth_token`
- the app restores the session on startup by calling `/auth/me`
- protected routes redirect back to `/login` when there is no valid session
- tenant identity, role, company name, trusted prefix, analytics prefix, and Athena database are pulled from `/auth/me`

## Environment Variables

Only one variable is strictly required for the core app to work.

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | Base URL for the Live API |
| `VITE_AUTH_PROFILE_UPDATE_PATH` | No | Enables profile update calls from Settings |
| `VITE_AUTH_PROFILE_UPDATE_METHOD` | No | HTTP method for profile updates, default `PATCH` |
| `VITE_AUTH_CHANGE_PASSWORD_PATH` | No | Enables password-change calls from Settings |
| `VITE_AUTH_CHANGE_PASSWORD_METHOD` | No | HTTP method for password changes, default `POST` |
| `VITE_AUTH_REVOKE_SESSIONS_PATH` | No | Enables sign-out-all-sessions action |
| `VITE_AUTH_REVOKE_SESSIONS_METHOD` | No | HTTP method for revoke-sessions action |
| `VITE_AUTH_ADMIN_INVITES_PATH` | No | Override for admin invite creation path, default `/admin/invites` |
| `VITE_AUTH_ADMIN_INVITES_METHOD` | No | HTTP method for admin invite creation, default `POST` |

If the optional settings variables are not provided, the Settings UI still renders but explains that those actions are not available in the current environment.

## Local Development

Install dependencies:

```powershell
Set-Location frontend
npm ci
```

Create `.env.local`:

```env
VITE_API_BASE_URL=https://<live-api-id>.execute-api.<region>.amazonaws.com
```

Start the app:

```powershell
npm run dev
```

Useful commands:

```powershell
npm run build
npm run preview
npm run lint
npm test
npm run test:coverage
```

## Behavioral Notes

- The app is intentionally framework-light. Most page behavior is composed manually through modules rather than React or Vue.
- `src/insightsData.js` is the main business-data orchestrator. It wires dashboard refreshes, forecast rendering, query behavior, and chart-building.
- `src/anomaliesData.js` owns the anomaly inbox and posts review actions back to the Live API.
- The settings page is more capable than a simple profile page. It includes tenant context, invite generation for admins, and browser-only preferences.
- Browser preferences are stored in local storage as `smartstream_preferences`.

## Build And Deployment Notes

The repository includes `frontend/.env.production`, but the practical deployment path is:

1. build the app with `npm run build`
2. upload `dist/` to the Terraform-managed web bucket
3. invalidate CloudFront if you enable and use it

Terraform exposes helper commands in the `frontend_deploy_commands` output.

## Testing

The frontend test suite focuses on high-value flows rather than end-to-end browser automation.

Current coverage areas include:

- auth service behavior
- dashboard rendering logic
- forecast rendering behavior
- anomaly UI flows
- settings page interactions
- admin invite service behavior

Run tests with:

```powershell
Set-Location frontend
npm test
```

Coverage:

```powershell
npm run test:coverage
```

## Common Gotchas

- If `VITE_API_BASE_URL` is missing, the app loads but the data-driven sections will report configuration errors.
- The frontend expects tenant-scoped auth. Browsing API routes directly without the token will usually return `401`.
- Some settings actions are placeholders until the backend exposes matching endpoints.
