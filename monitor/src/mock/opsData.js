// Rebuild the mock snapshot periodically so relative timestamps keep feeling
// current during long-running local sessions without changing on every access.
const CACHE_TTL_MS = 30_000;

let cachedDataset = null;
let cachedAtMs = 0;

/**
 * Returns a cloned mock overview payload.
 *
 * @returns {object}
 */
export function getMockOverview() {
  return cloneValue(getMockDataset().overview);
}

/**
 * Returns the pipeline list used by the overview table.
 *
 * @returns {Array<object>}
 */
export function getMockPipelines() {
  return cloneValue(getMockDataset().pipelines);
}

/**
 * Returns a cloned detail payload for a specific pipeline.
 *
 * @param {string} pipelineId
 * @returns {object}
 */
export function getMockPipelineDetails(pipelineId) {
  const pipelineDetail = getMockDataset().pipelineDetails[pipelineId];

  if (!pipelineDetail) {
    throw new Error(`No mock pipeline detail is defined for "${pipelineId}".`);
  }

  return cloneValue(pipelineDetail);
}

/**
 * Returns the mock alarms collection.
 *
 * @returns {Array<object>}
 */
export function getMockAlarms() {
  return cloneValue(getMockDataset().alarms);
}

/**
 * Returns the mock log summary shown in the right-hand rail.
 *
 * @returns {Array<object>}
 */
export function getMockLogSummary() {
  return cloneValue(getMockDataset().logSummary);
}

/**
 * Reuses a short-lived in-memory snapshot so all mock endpoints stay internally
 * consistent during a single render cycle.
 *
 * @returns {object}
 */
function getMockDataset() {
  const nowMs = Date.now();

  if (!cachedDataset || nowMs - cachedAtMs > CACHE_TTL_MS) {
    cachedDataset = buildMockDataset();
    cachedAtMs = nowMs;
  }

  return cachedDataset;
}

/**
 * Builds the monitor's canonical mock dataset. The data is intentionally varied
 * so the UI exercises healthy, degraded, and down states together.
 *
 * @returns {{
 *   overview: object,
 *   pipelines: Array<object>,
 *   alarms: Array<object>,
 *   pipelineDetails: Record<string, object>,
 *   logSummary: Array<object>
 * }}
 */
function buildMockDataset() {
  const pipelines = [
    {
      id: "employee-pipeline",
      name: "Employee pipeline",
      pipeline_group: "smartstream",
      overall_status: "healthy",
      source_status: "healthy",
      processing_status: "healthy",
      delivery_status: "healthy",
      freshness_status: "healthy",
      last_success_at: minutesAgo(2),
      alarm_count: 0,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy"
      ]
    },
    {
      id: "finance-pipeline",
      name: "Finance pipeline",
      pipeline_group: "smartstream",
      overall_status: "degraded",
      source_status: "healthy",
      processing_status: "degraded",
      delivery_status: "healthy",
      freshness_status: "warning",
      last_success_at: minutesAgo(17),
      alarm_count: 2,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "degraded",
        "degraded",
        "warning",
        "healthy",
        "degraded",
        "degraded",
        "healthy",
        "degraded",
        "degraded"
      ]
    },
    {
      id: "forecast-pipeline",
      name: "Forecast pipeline",
      pipeline_group: "smartstream",
      overall_status: "degraded",
      source_status: "healthy",
      processing_status: "degraded",
      delivery_status: "healthy",
      freshness_status: "warning",
      last_success_at: minutesAgo(32),
      alarm_count: 1,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "warning",
        "warning",
        "degraded",
        "degraded",
        "warning",
        "healthy",
        "degraded",
        "degraded",
        "warning"
      ]
    },
    {
      id: "anomaly-pipeline",
      name: "Anomaly pipeline",
      pipeline_group: "smartstream",
      overall_status: "down",
      source_status: "healthy",
      processing_status: "down",
      delivery_status: "down",
      freshness_status: "down",
      last_success_at: minutesAgo(252),
      alarm_count: 3,
      status_history: [
        "healthy",
        "healthy",
        "warning",
        "degraded",
        "degraded",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down"
      ]
    },
    {
      id: "acme-employee-pipeline",
      name: "Employee pipeline",
      pipeline_group: "acme",
      overall_status: "healthy",
      source_status: "healthy",
      processing_status: "healthy",
      delivery_status: "healthy",
      freshness_status: "healthy",
      last_success_at: minutesAgo(3),
      alarm_count: 0,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy"
      ]
    },
    {
      id: "acme-finance-pipeline",
      name: "Finance pipeline",
      pipeline_group: "acme",
      overall_status: "healthy",
      source_status: "healthy",
      processing_status: "healthy",
      delivery_status: "healthy",
      freshness_status: "healthy",
      last_success_at: minutesAgo(4),
      alarm_count: 0,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy"
      ]
    },
    {
      id: "acme-forecast-pipeline",
      name: "Forecast pipeline",
      pipeline_group: "acme",
      overall_status: "degraded",
      source_status: "healthy",
      processing_status: "degraded",
      delivery_status: "healthy",
      freshness_status: "warning",
      last_success_at: minutesAgo(19),
      alarm_count: 1,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "warning",
        "warning",
        "healthy",
        "warning",
        "warning",
        "degraded",
        "degraded"
      ]
    },
    {
      id: "acme-anomaly-pipeline",
      name: "Anomaly pipeline",
      pipeline_group: "acme",
      overall_status: "degraded",
      source_status: "healthy",
      processing_status: "degraded",
      delivery_status: "degraded",
      freshness_status: "warning",
      last_success_at: minutesAgo(47),
      alarm_count: 1,
      status_history: [
        "healthy",
        "healthy",
        "healthy",
        "warning",
        "warning",
        "degraded",
        "healthy",
        "warning",
        "degraded",
        "degraded",
        "degraded",
        "degraded"
      ]
    }
  ];

  const alarms = [
    {
      id: "alarm-finance-transform-errors",
      pipeline_id: "finance-pipeline",
      pipeline_name: "Finance pipeline",
      pipeline_group: "smartstream",
      name: "FinanceTransformErrorRate",
      severity: "high",
      summary: "Transform Lambda retry rate exceeded 8% after a payroll currency field drift.",
      resource: "lambda:smartstream-transform",
      triggered_at: minutesAgo(6),
      state: "ALARM"
    },
    {
      id: "alarm-finance-freshness",
      pipeline_id: "finance-pipeline",
      pipeline_name: "Finance pipeline",
      pipeline_group: "smartstream",
      name: "FinanceFreshnessLag",
      severity: "medium",
      summary: "Trusted finance partitions are 16 minutes behind the expected 5 minute SLA.",
      resource: "s3://smartstream-lake/trusted/{company_id}/finance/",
      triggered_at: minutesAgo(12),
      state: "ALARM"
    },
    {
      id: "alarm-forecast-lag",
      pipeline_id: "forecast-pipeline",
      pipeline_name: "Forecast pipeline",
      pipeline_group: "smartstream",
      name: "ForecastPredictionLag",
      severity: "medium",
      summary: "Latest predictions have not landed within the 15 minute inference window.",
      resource: "lambda:smartstream-forecast-ml",
      triggered_at: minutesAgo(18),
      state: "ALARM"
    },
    {
      id: "alarm-anomaly-failures",
      pipeline_id: "anomaly-pipeline",
      pipeline_name: "Anomaly pipeline",
      pipeline_group: "smartstream",
      name: "AnomalyLambdaFailures",
      severity: "critical",
      summary: "Anomaly Lambda has failed 5 consecutive invocations with validation exceptions.",
      resource: "lambda:smartstream-anomaly-detector",
      triggered_at: minutesAgo(4),
      state: "ALARM"
    },
    {
      id: "alarm-anomaly-delivery",
      pipeline_id: "anomaly-pipeline",
      pipeline_name: "Anomaly pipeline",
      pipeline_group: "smartstream",
      name: "AnomalyDeliveryStalled",
      severity: "critical",
      summary: "No new objects have been written to trusted-analytics anomalies in the last 3 hours.",
      resource: "s3://smartstream-lake/trusted-analytics/{company_id}/anomalies/",
      triggered_at: minutesAgo(9),
      state: "ALARM"
    },
    {
      id: "alarm-anomaly-freshness",
      pipeline_id: "anomaly-pipeline",
      pipeline_name: "Anomaly pipeline",
      pipeline_group: "smartstream",
      name: "AnomalyFreshnessCritical",
      severity: "critical",
      summary: "Anomaly output freshness exceeded the 20 minute critical threshold.",
      resource: "api:live-api/anomalies",
      triggered_at: minutesAgo(15),
      state: "ALARM"
    },
    {
      id: "alarm-acme-forecast-lag",
      pipeline_id: "acme-forecast-pipeline",
      pipeline_name: "Forecast pipeline",
      pipeline_group: "acme",
      name: "AcmeForecastPredictionLag",
      severity: "medium",
      summary: "Acme forecast predictions have not landed within the 15 minute freshness target.",
      resource: "lambda:acme-dev-forecast-ml",
      triggered_at: minutesAgo(14),
      state: "ALARM"
    },
    {
      id: "alarm-acme-anomaly-errors",
      pipeline_id: "acme-anomaly-pipeline",
      pipeline_name: "Anomaly pipeline",
      pipeline_group: "acme",
      name: "AcmeAnomalyLambdaErrors",
      severity: "high",
      summary: "Acme anomaly detection Lambda error rate elevated after a cold-start initialisation timeout.",
      resource: "lambda:acme-dev-anomaly-detector",
      triggered_at: minutesAgo(22),
      state: "ALARM"
    }
  ];

  const pipelineDetails = {
    "employee-pipeline": {
      id: "employee-pipeline",
      name: "Employee pipeline",
      overall_status: "healthy",
      summary: "Employee ingestion is within SLA from PostgreSQL replication through trusted employee delivery.",
      freshness: {
        status: "healthy",
        lag_minutes: 2,
        target_minutes: 5,
        message: "Freshness is comfortably inside the expected replication window."
      },
      last_success_at: minutesAgo(2),
      last_failure_at: hoursAgo(9),
      components: [
        {
          name: "PostgreSQL public.employee",
          area: "Source",
          status: "healthy",
          resource: "rds:smartstream-postgres",
          detail: "CDC writes are flowing without replication lag."
        },
        {
          name: "DMS task public-schema",
          area: "Ingestion",
          status: "healthy",
          resource: "dms:smartstream-public-task",
          detail: "Applied changes are current with no backlog."
        },
        {
          name: "Kinesis ingest stream",
          area: "Streaming",
          status: "healthy",
          resource: "kinesis:smartstream-ingest",
          detail: "Shard iterator age is below 5 seconds."
        },
        {
          name: "Transform Lambda",
          area: "Processing",
          status: "healthy",
          resource: "lambda:smartstream-transform",
          detail: "Employee record normalization is succeeding on the first attempt."
        },
        {
          name: "Trusted employee dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://smartstream-lake/trusted/{company_id}/employees/",
          detail: "Trusted partitions are receiving new objects every cycle."
        }
      ],
      recent_errors: [
        {
          timestamp: hoursAgo(2),
          service: "transform-lambda",
          summary: "Transient schema warning on optional employee_preference column auto-resolved."
        }
      ],
      active_alarms: [],
      impacted_resources: [
        "rds:smartstream-postgres",
        "dms:smartstream-public-task",
        "kinesis:smartstream-ingest",
        "lambda:smartstream-transform",
        "s3://smartstream-lake/trusted/{company_id}/employees/"
      ]
    },
    "finance-pipeline": {
      id: "finance-pipeline",
      name: "Finance pipeline",
      overall_status: "degraded",
      summary: "Finance ingest is still delivering, but transform retries and freshness lag are outside the target envelope.",
      freshness: {
        status: "warning",
        lag_minutes: 16,
        target_minutes: 5,
        message: "Finance partitions are delayed while transform retries clear a schema drift."
      },
      last_success_at: minutesAgo(17),
      last_failure_at: minutesAgo(5),
      components: [
        {
          name: "PostgreSQL finance schema",
          area: "Source",
          status: "healthy",
          resource: "rds:smartstream-postgres",
          detail: "Source writes are available and replication source volume is normal."
        },
        {
          name: "DMS task finance-schema",
          area: "Ingestion",
          status: "healthy",
          resource: "dms:smartstream-finance-task",
          detail: "CDC capture is current with no task restarts."
        },
        {
          name: "Transform Lambda",
          area: "Processing",
          status: "degraded",
          resource: "lambda:smartstream-transform",
          detail: "Retry volume increased after payroll_currency arrived with mixed formats."
        },
        {
          name: "Trusted finance dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://smartstream-lake/trusted/{company_id}/finance/",
          detail: "Objects are landing, but later than the expected cadence."
        },
        {
          name: "Glue crawler finance-trusted",
          area: "Catalog",
          status: "warning",
          resource: "glue:finance-trusted-crawler",
          detail: "Catalog refresh is one run behind while partitions stabilize."
        }
      ],
      recent_errors: [
        {
          timestamp: minutesAgo(5),
          service: "transform-lambda",
          summary: "ValueError while coercing payroll_currency from list to scalar; event retried."
        },
        {
          timestamp: minutesAgo(8),
          service: "transform-lambda",
          summary: "Finance enrichment retry exceeded warm container threshold for tenant acme-dev."
        }
      ],
      active_alarms: [
        {
          name: "FinanceTransformErrorRate",
          severity: "high",
          triggered_at: minutesAgo(6),
          resource: "lambda:smartstream-transform",
          summary: "Error rate has remained above the 5 minute SLO for the last three checks."
        },
        {
          name: "FinanceFreshnessLag",
          severity: "medium",
          triggered_at: minutesAgo(12),
          resource: "s3://smartstream-lake/trusted/{company_id}/finance/",
          summary: "Trusted finance lag is 11 minutes beyond the allowed threshold."
        }
      ],
      impacted_resources: [
        "dms:smartstream-finance-task",
        "lambda:smartstream-transform",
        "s3://smartstream-lake/trusted/{company_id}/finance/",
        "glue:finance-trusted-crawler"
      ]
    },
    "forecast-pipeline": {
      id: "forecast-pipeline",
      name: "Forecast pipeline",
      overall_status: "degraded",
      summary: "Forecast generation is delayed by elevated inference duration, but predictions are still publishing.",
      freshness: {
        status: "warning",
        lag_minutes: 29,
        target_minutes: 15,
        message: "Prediction freshness is above target because the ML Lambda is running longer than normal."
      },
      last_success_at: minutesAgo(32),
      last_failure_at: minutesAgo(11),
      components: [
        {
          name: "Trusted finance + employee inputs",
          area: "Source",
          status: "healthy",
          resource: "s3://smartstream-lake/trusted/{company_id}/",
          detail: "Required input partitions are complete for the current window."
        },
        {
          name: "ML forecast Lambda",
          area: "Processing",
          status: "degraded",
          resource: "lambda:smartstream-forecast-ml",
          detail: "P95 duration spiked after the last model package refresh."
        },
        {
          name: "Predictions dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://smartstream-lake/trusted-analytics/{company_id}/predictions/",
          detail: "Predictions continue to publish, but later than the desired run window."
        },
        {
          name: "Live API forecast cache",
          area: "Serving",
          status: "warning",
          resource: "api:live-api/forecasts",
          detail: "API responses are serving the last completed prediction set while the next run finishes."
        }
      ],
      recent_errors: [
        {
          timestamp: minutesAgo(11),
          service: "forecast-ml-lambda",
          summary: "Inference batch approached timeout while generating blended finance + headcount forecast windows."
        }
      ],
      active_alarms: [
        {
          name: "ForecastPredictionLag",
          severity: "medium",
          triggered_at: minutesAgo(18),
          resource: "lambda:smartstream-forecast-ml",
          summary: "Prediction output missed the 15 minute freshness target."
        }
      ],
      impacted_resources: [
        "lambda:smartstream-forecast-ml",
        "s3://smartstream-lake/trusted-analytics/{company_id}/predictions/",
        "api:live-api/forecasts"
      ]
    },
    "anomaly-pipeline": {
      id: "anomaly-pipeline",
      name: "Anomaly pipeline",
      overall_status: "down",
      summary: "Anomaly detection is failing end-to-end, and anomaly outputs are not reaching trusted analytics or the Live API.",
      freshness: {
        status: "down",
        lag_minutes: 186,
        target_minutes: 20,
        message: "No fresh anomalies have been generated since the last successful detection run."
      },
      last_success_at: minutesAgo(252),
      last_failure_at: minutesAgo(4),
      components: [
        {
          name: "Predictions input set",
          area: "Source",
          status: "healthy",
          resource: "s3://smartstream-lake/trusted-analytics/{company_id}/predictions/",
          detail: "Input predictions are present for the expected windows."
        },
        {
          name: "Anomaly Lambda",
          area: "Processing",
          status: "down",
          resource: "lambda:smartstream-anomaly-detector",
          detail: "Invocations are failing with a validation exception on null expected ranges."
        },
        {
          name: "Anomalies dataset",
          area: "Delivery",
          status: "down",
          resource: "s3://smartstream-lake/trusted-analytics/{company_id}/anomalies/",
          detail: "No new anomaly objects have been written for more than three hours."
        },
        {
          name: "Live API anomalies route",
          area: "Serving",
          status: "degraded",
          resource: "api:live-api/anomalies",
          detail: "API is returning stale anomalies from the last successful run."
        }
      ],
      recent_errors: [
        {
          timestamp: minutesAgo(4),
          service: "anomaly-lambda",
          summary: "ValidationError: expected_upper_bound missing for forecast window 2026-03-13T17:00:00Z."
        },
        {
          timestamp: minutesAgo(9),
          service: "anomaly-lambda",
          summary: "S3 write skipped because anomaly batch terminated before serialization completed."
        }
      ],
      active_alarms: [
        {
          name: "AnomalyLambdaFailures",
          severity: "critical",
          triggered_at: minutesAgo(4),
          resource: "lambda:smartstream-anomaly-detector",
          summary: "Five consecutive anomaly detection invocations failed."
        },
        {
          name: "AnomalyDeliveryStalled",
          severity: "critical",
          triggered_at: minutesAgo(9),
          resource: "s3://smartstream-lake/trusted-analytics/{company_id}/anomalies/",
          summary: "Trusted analytics anomaly outputs have stopped arriving."
        },
        {
          name: "AnomalyFreshnessCritical",
          severity: "critical",
          triggered_at: minutesAgo(15),
          resource: "api:live-api/anomalies",
          summary: "Anomaly freshness exceeded the critical threshold and the API is stale."
        }
      ],
      impacted_resources: [
        "lambda:smartstream-anomaly-detector",
        "s3://smartstream-lake/trusted-analytics/{company_id}/anomalies/",
        "api:live-api/anomalies",
        "cloudwatch:AnomalyLambdaFailures"
      ]
    },
    "acme-employee-pipeline": {
      id: "acme-employee-pipeline",
      name: "Employee pipeline",
      pipeline_group: "acme",
      overall_status: "healthy",
      summary: "Acme employee ingestion is within SLA from PostgreSQL replication through trusted delivery.",
      freshness: {
        status: "healthy",
        lag_minutes: 3,
        target_minutes: 5,
        message: "Freshness is inside the expected replication window for tenant acme-dev."
      },
      last_success_at: minutesAgo(3),
      last_failure_at: hoursAgo(14),
      components: [
        {
          name: "PostgreSQL public.employee",
          area: "Source",
          status: "healthy",
          resource: "rds:acme-dev-postgres",
          detail: "CDC writes are flowing without replication lag."
        },
        {
          name: "DMS task public-schema",
          area: "Ingestion",
          status: "healthy",
          resource: "dms:acme-dev-public-task",
          detail: "Applied changes are current with no backlog."
        },
        {
          name: "Kinesis ingest stream",
          area: "Streaming",
          status: "healthy",
          resource: "kinesis:acme-dev-ingest",
          detail: "Shard iterator age is below 5 seconds."
        },
        {
          name: "Transform Lambda",
          area: "Processing",
          status: "healthy",
          resource: "lambda:acme-dev-transform",
          detail: "Employee record normalization is succeeding on the first attempt."
        },
        {
          name: "Trusted employee dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://acme-dev-lake/trusted/acme/employees/",
          detail: "Trusted partitions are receiving new objects every cycle."
        }
      ],
      recent_errors: [],
      active_alarms: [],
      impacted_resources: [
        "rds:acme-dev-postgres",
        "dms:acme-dev-public-task",
        "kinesis:acme-dev-ingest",
        "lambda:acme-dev-transform",
        "s3://acme-dev-lake/trusted/acme/employees/"
      ]
    },
    "acme-finance-pipeline": {
      id: "acme-finance-pipeline",
      name: "Finance pipeline",
      pipeline_group: "acme",
      overall_status: "healthy",
      summary: "Acme finance ingestion is healthy and delivering within the freshness SLA.",
      freshness: {
        status: "healthy",
        lag_minutes: 4,
        target_minutes: 5,
        message: "Finance partitions are landing on time for tenant acme-dev."
      },
      last_success_at: minutesAgo(4),
      last_failure_at: hoursAgo(18),
      components: [
        {
          name: "PostgreSQL finance schema",
          area: "Source",
          status: "healthy",
          resource: "rds:acme-dev-postgres",
          detail: "Source writes are available and replication volume is normal."
        },
        {
          name: "DMS task finance-schema",
          area: "Ingestion",
          status: "healthy",
          resource: "dms:acme-dev-finance-task",
          detail: "CDC capture is current with no task restarts."
        },
        {
          name: "Transform Lambda",
          area: "Processing",
          status: "healthy",
          resource: "lambda:acme-dev-transform",
          detail: "Finance record normalization is completing within the expected duration."
        },
        {
          name: "Trusted finance dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://acme-dev-lake/trusted/acme/finance/",
          detail: "Objects are landing within the cadence window."
        },
        {
          name: "Glue crawler finance-trusted",
          area: "Catalog",
          status: "healthy",
          resource: "glue:acme-dev-finance-crawler",
          detail: "Catalog refresh is current with no missed runs."
        }
      ],
      recent_errors: [],
      active_alarms: [],
      impacted_resources: [
        "dms:acme-dev-finance-task",
        "lambda:acme-dev-transform",
        "s3://acme-dev-lake/trusted/acme/finance/",
        "glue:acme-dev-finance-crawler"
      ]
    },
    "acme-forecast-pipeline": {
      id: "acme-forecast-pipeline",
      name: "Forecast pipeline",
      pipeline_group: "acme",
      overall_status: "degraded",
      summary: "Acme forecast generation is delayed by elevated ML Lambda duration; predictions are still publishing but behind schedule.",
      freshness: {
        status: "warning",
        lag_minutes: 19,
        target_minutes: 15,
        message: "Prediction freshness is above the 15 minute target due to longer-than-normal inference runs."
      },
      last_success_at: minutesAgo(19),
      last_failure_at: minutesAgo(14),
      components: [
        {
          name: "Trusted finance + employee inputs",
          area: "Source",
          status: "healthy",
          resource: "s3://acme-dev-lake/trusted/acme/",
          detail: "Required input partitions are complete for the current window."
        },
        {
          name: "ML forecast Lambda",
          area: "Processing",
          status: "degraded",
          resource: "lambda:acme-dev-forecast-ml",
          detail: "Inference duration increased after a model artefact refresh; P95 is above the timeout threshold."
        },
        {
          name: "Predictions dataset",
          area: "Delivery",
          status: "healthy",
          resource: "s3://acme-dev-lake/trusted-analytics/acme/predictions/",
          detail: "Predictions are publishing, but later than the target run window."
        },
        {
          name: "Live API forecast cache",
          area: "Serving",
          status: "warning",
          resource: "api:acme-dev-live-api/forecasts",
          detail: "API is serving the previous completed prediction set while the delayed run finishes."
        }
      ],
      recent_errors: [
        {
          timestamp: minutesAgo(14),
          service: "acme-dev-forecast-ml",
          summary: "Forecast batch exceeded the expected duration envelope; inference run approaching Lambda timeout."
        }
      ],
      active_alarms: [
        {
          name: "AcmeForecastPredictionLag",
          severity: "medium",
          triggered_at: minutesAgo(14),
          resource: "lambda:acme-dev-forecast-ml",
          summary: "Acme prediction output has missed the 15 minute freshness target."
        }
      ],
      impacted_resources: [
        "lambda:acme-dev-forecast-ml",
        "s3://acme-dev-lake/trusted-analytics/acme/predictions/",
        "api:acme-dev-live-api/forecasts"
      ]
    },
    "acme-anomaly-pipeline": {
      id: "acme-anomaly-pipeline",
      name: "Anomaly pipeline",
      pipeline_group: "acme",
      overall_status: "degraded",
      summary: "Acme anomaly detection is experiencing elevated error rates after a cold-start timeout; some outputs are not reaching trusted analytics.",
      freshness: {
        status: "warning",
        lag_minutes: 47,
        target_minutes: 20,
        message: "Anomaly freshness is above the 20 minute target while Lambda recovers from cold-start failures."
      },
      last_success_at: minutesAgo(47),
      last_failure_at: minutesAgo(22),
      components: [
        {
          name: "Predictions input set",
          area: "Source",
          status: "healthy",
          resource: "s3://acme-dev-lake/trusted-analytics/acme/predictions/",
          detail: "Input predictions are present for the expected windows."
        },
        {
          name: "Anomaly Lambda",
          area: "Processing",
          status: "degraded",
          resource: "lambda:acme-dev-anomaly-detector",
          detail: "Cold-start initialisation timeouts are causing intermittent invocation failures."
        },
        {
          name: "Anomalies dataset",
          area: "Delivery",
          status: "degraded",
          resource: "s3://acme-dev-lake/trusted-analytics/acme/anomalies/",
          detail: "Some anomaly batches are not completing, leaving gaps in the delivery schedule."
        },
        {
          name: "Live API anomalies route",
          area: "Serving",
          status: "warning",
          resource: "api:acme-dev-live-api/anomalies",
          detail: "API is serving partially stale anomalies from the last successful batch."
        }
      ],
      recent_errors: [
        {
          timestamp: minutesAgo(22),
          service: "acme-dev-anomaly-detector",
          summary: "Cold-start initialisation timeout caused Lambda invocation to fail before processing began."
        },
        {
          timestamp: minutesAgo(31),
          service: "acme-dev-anomaly-detector",
          summary: "Anomaly batch terminated early; S3 write skipped for incomplete detection window."
        }
      ],
      active_alarms: [
        {
          name: "AcmeAnomalyLambdaErrors",
          severity: "high",
          triggered_at: minutesAgo(22),
          resource: "lambda:acme-dev-anomaly-detector",
          summary: "Acme anomaly Lambda error rate elevated after cold-start initialisation failures."
        }
      ],
      impacted_resources: [
        "lambda:acme-dev-anomaly-detector",
        "s3://acme-dev-lake/trusted-analytics/acme/anomalies/",
        "api:acme-dev-live-api/anomalies"
      ]
    }
  };

  const logSummary = [
    {
      service: "transform-lambda",
      pipeline_group: "smartstream",
      level: "ERROR",
      count_15m: 17,
      latest_message: "Finance record normalization retried after payroll_currency shape mismatch.",
      updated_at: minutesAgo(5)
    },
    {
      service: "forecast-ml-lambda",
      pipeline_group: "smartstream",
      level: "WARN",
      count_15m: 9,
      latest_message: "Forecast generation exceeded the expected duration envelope.",
      updated_at: minutesAgo(11)
    },
    {
      service: "anomaly-lambda",
      pipeline_group: "smartstream",
      level: "ERROR",
      count_15m: 34,
      latest_message: "ValidationError on missing expected_upper_bound halted anomaly batch execution.",
      updated_at: minutesAgo(4)
    },
    {
      service: "live-api",
      pipeline_group: "smartstream",
      level: "INFO",
      count_15m: 4,
      latest_message: "Anomalies endpoint served cached results while upstream pipeline stayed unhealthy.",
      updated_at: minutesAgo(3)
    },
    {
      service: "acme-dev-forecast-ml",
      pipeline_group: "acme",
      level: "WARN",
      count_15m: 5,
      latest_message: "Forecast batch duration exceeded the expected run envelope for tenant acme-dev.",
      updated_at: minutesAgo(14)
    },
    {
      service: "acme-dev-anomaly-detector",
      pipeline_group: "acme",
      level: "ERROR",
      count_15m: 8,
      latest_message: "Cold-start initialisation timeout caused Lambda invocation failure for tenant acme-dev.",
      updated_at: minutesAgo(22)
    }
  ];

  return {
    overview: {
      total_pipelines: pipelines.length,
      healthy: pipelines.filter((pipeline) => pipeline.overall_status === "healthy").length,
      degraded: pipelines.filter((pipeline) => pipeline.overall_status === "degraded").length,
      down: pipelines.filter((pipeline) => pipeline.overall_status === "down").length,
      active_alarms: alarms.filter((alarm) => alarm.state === "ALARM").length,
      last_updated: new Date().toISOString()
    },
    pipelines,
    alarms,
    pipelineDetails,
    logSummary
  };
}

/**
 * Produces a defensive deep clone so consumers cannot mutate the shared cached
 * dataset by accident.
 *
 * @param {any} value
 * @returns {any}
 */
function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Generates an ISO timestamp relative to the current time.
 *
 * @param {number} minutes
 * @returns {string}
 */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Generates an ISO timestamp measured in hours.
 *
 * @param {number} hours
 * @returns {string}
 */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
