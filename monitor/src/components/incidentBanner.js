import { escapeHtml } from "../utils/dom.js";

export function renderIncidentBanner(pipelines, alarms) {
  const downPipelines = pipelines.filter((pipeline) => pipeline.overall_status === "down");

  if (!downPipelines.length) {
    return "";
  }

  const pipelineNames = downPipelines.map((pipeline) => pipeline.name).join(", ");
  const criticalAlarmCount = alarms.filter((alarm) => alarm.severity === "critical").length;

  return `
    <section class="panel incident-banner">
      <div class="incident-banner__copy">
        <span class="eyebrow eyebrow--critical">Critical incident</span>
        <h2>${escapeHtml(String(downPipelines.length))} pipeline down</h2>
        <p>
          ${escapeHtml(pipelineNames)} currently require operator intervention. Critical alarms in flight:
          ${escapeHtml(String(criticalAlarmCount))}.
        </p>
      </div>
      <div class="incident-banner__signal">
        <span class="incident-banner__pulse"></span>
        <span>Immediate response recommended</span>
      </div>
    </section>
  `;
}
