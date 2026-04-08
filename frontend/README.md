# SmartStream Frontend

The frontend is a Vite project using plain HTML, CSS, and JavaScript modules.

## What It Includes

Current UI views:

- Login/Signup view
  - Sign in with email/password
  - Invite-based account creation (`display_name`, `invite_code`)
- Workspace pages
  - Overview dashboard
  - Custom Charts
  - Explore Data (guided query builder)
  - Alerts (anomalies feed + review actions)
  - Forecasts
  - Settings, including admin invite generation in `Company Access`

## Runtime Data Behavior

Current polling and refresh behavior in code:

- Live spend trend (`startLiveUpdates`): every 60 seconds
- Dashboard + forecasts (`initInsightsData`): every 20 seconds
- Anomalies feed (`initAnomaliesData`): every 30 seconds

Auth token is stored in local storage under:

- `smartstream_auth_token`

## API Endpoints Used

Frontend calls these live API routes:

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /admin/invites`
- `GET /dashboard`
- `GET /forecasts`
- `GET /anomalies`
- `GET /anomalies/{id}`
- `POST /anomalies/{id}/actions`
- `POST /query`

## Environment

Required environment variable:

```env
VITE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com
```

Create `.env.local` in `frontend/`.

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build
npm run preview  # preview production build
npm run lint     # eslint
```

## Local Development

```bash
cd frontend
npm ci
npm run dev
```

## Build Output

- Vite outputs static assets to `frontend/dist/`.
- Terraform outputs deployment helper commands via `frontend_deploy_commands`.
