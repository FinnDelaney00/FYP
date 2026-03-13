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

If `VITE_MONITOR_API_BASE_URL` is not set, or the request fails, the UI falls back to mock data in `src/mock/opsData.js`.

## Environment

Copy `.env.example` to `.env.local` and set the ops API base URL:

```env
VITE_MONITOR_API_BASE_URL=https://<ops-api-host>
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_REFRESH_INTERVAL_MS=60000
```

`VITE_MONITOR_USE_MOCK=true` forces the app to stay on mock data.

## Local Development

```bash
cd monitor
npm install
npm run dev
```

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
