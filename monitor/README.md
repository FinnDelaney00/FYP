# SmartStream Monitor

SmartStream Monitor is a separate Vite app for engineers, operators, and admins to track pipeline health across ingestion, processing, delivery, and freshness stages.

It is intentionally isolated from the customer-facing dashboard in `frontend/`.

## Features

- Pipeline fleet overview with health summary cards
- Critical incident banner when any pipeline is down
- Recent alarms and log pulse panels
- Filterable and sortable pipeline health table
- Pipeline details modal with component health, errors, alarms, freshness, and impacted AWS resources
- Automatic fallback to realistic mock ops data when the live ops API is unavailable
- Auto-refresh scaffold for ongoing monitoring

## Expected Ops API Endpoints

The monitor frontend is built around these endpoints:

- `GET /ops/overview`
- `GET /ops/pipelines`
- `GET /ops/pipelines/{id}`
- `GET /ops/alarms`
- `GET /ops/log-summary`

If `VITE_MONITOR_API_BASE_URL` is not set, or the live ops API returns a network/5xx failure, the UI falls back to mock data in `src/mock/opsData.js`.

Auth and 4xx errors are surfaced in the UI as live API failures instead of silently falling back to mock data.

## Environment

Copy `.env.example` to `.env.local` and set the ops API base URL:

```env
VITE_MONITOR_API_BASE_URL=https://<ops-api-host>
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_REFRESH_INTERVAL_MS=60000
VITE_MONITOR_AUTH_TOKEN=
VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY=smartstream_auth_token
```

`VITE_MONITOR_USE_MOCK=true` forces the app to stay on mock data.

`VITE_MONITOR_AUTH_TOKEN` is optional and useful for local verification when the ops API requires a bearer token. If unset, the frontend will look in `localStorage` using `VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY`.

## Local Development

```bash
cd monitor
npm install
npm run dev
```

## Switching To Live AWS Data

1. Deploy the Terraform stack so the ops API Lambda and HTTP API exist.
2. Read the deployed base URL:

```bash
cd smartstream-terraform
terraform output -raw ops_api_base_url
```

3. Create `monitor/.env.local`:

```env
VITE_MONITOR_API_BASE_URL=https://<ops-api-id>.execute-api.<region>.amazonaws.com
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_REFRESH_INTERVAL_MS=60000
VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY=smartstream_auth_token
```

4. If `ops_api_require_auth=true`, either:
   - set `VITE_MONITOR_AUTH_TOKEN=<bearer-token>` in `monitor/.env.local`, or
   - write the token into `localStorage["smartstream_auth_token"]` before loading the app.

5. Start the app with `npm run dev`.

## Verifying Live Mode

- `curl https://<ops-api-host>/ops/overview`
- If auth is enabled:

```bash
curl -H "Authorization: Bearer <token>" https://<ops-api-host>/ops/overview
```

- In the monitor UI, the source pill should read `Live ops data` or `Live partial data`.
- If the backend is unreachable, the pill switches to `Mock fallback` and the fallback reason is shown in the header.

## Build

```bash
cd monitor
npm run build
```

The app builds as a standalone static site under `monitor/dist/`.

## API Shape Assumptions

The current UI expects the future ops API to return JSON payloads similar to:

- Overview:
  - `total_pipelines`
  - `healthy`
  - `degraded`
  - `down`
  - `active_alarms`
  - `last_updated`
- Pipeline summary rows:
  - `id`
  - `name`
  - `overall_status`
  - `source_status`
  - `processing_status`
  - `delivery_status`
  - `freshness_status`
  - `last_success_at`
  - `alarm_count`
  - `status_history`
- Pipeline detail:
  - `id`
  - `name`
  - `overall_status`
  - `summary`
  - `freshness`
  - `last_success_at`
  - `last_failure_at`
  - `components`
  - `recent_errors`
  - `active_alarms`
  - `impacted_resources`
- Alarm entries:
  - `id`
  - `pipeline_id`
  - `pipeline_name`
  - `name`
  - `severity`
  - `summary`
  - `resource`
  - `triggered_at`
  - `state`
- Log summary entries:
  - `service`
  - `level`
  - `count_15m`
  - `latest_message`
  - `updated_at`
