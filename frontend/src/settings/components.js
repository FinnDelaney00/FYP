import { escapeHtml } from "../insights/formatters.js";

/**
 * HTML builders used by the settings page.
 *
 * Keeping these helpers here makes the main settings file easier to read and
 * keeps the markup style consistent.
 */

/**
 * Builds the `<option>` tags and keeps the selected value selected.
 *
 * @param {{ value: string, label?: string }[]} options
 * @param {string} selectedValue
 * @returns {string}
 */
function renderOptions(options, selectedValue) {
  return (Array.isArray(options) ? options : [])
    .map((option) => {
      const value = String(option.value || "");
      const label = String(option.label || value);
      return `<option value="${escapeHtml(value)}" ${value === String(selectedValue || "") ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

/**
 * Builds the main settings page layout.
 *
 * @param {{ companyName: string, companyId: string, navHtml: string, contentHtml: string }} payload
 * @returns {string}
 */
export function createSettingsLayout({ companyName, companyId, navHtml, contentHtml }) {
  return `
    <section class="settings-page-shell">
      <header class="settings-page-header">
        <div>
          <p class="section-kicker">Workspace settings</p>
          <h2>Keep your account and preferences under control</h2>
          <p class="settings-page-description">
            Account and tenant details come from your secure SmartStream session. Appearance and accessibility changes save automatically on this device.
          </p>
        </div>
        <div class="settings-page-trust">
          <span class="settings-trust-label">Current workspace</span>
          <strong>${escapeHtml(companyName || "Company workspace")}</strong>
          <p>${escapeHtml(companyId || "Company ID unavailable")}</p>
        </div>
      </header>

      <div class="settings-layout">
        <aside class="settings-layout-sidebar">
          ${navHtml}
        </aside>
        <div class="settings-layout-main">
          ${contentHtml}
        </div>
      </div>
    </section>
  `;
}

/**
 * Builds the sidebar links for the settings sections.
 *
 * @param {{ sections: Array<{ id: string, label: string, helper: string }>, activeSection: string }} payload
 * @returns {string}
 */
export function createSettingsNav({ sections, activeSection }) {
  const items = (Array.isArray(sections) ? sections : [])
    .map((section) => `
      <button
        type="button"
        class="settings-nav-link ${section.id === activeSection ? "is-active" : ""}"
        data-settings-section="${escapeHtml(section.id)}"
        aria-current="${section.id === activeSection ? "true" : "false"}"
      >
        <span>${escapeHtml(section.label)}</span>
        <small>${escapeHtml(section.helper)}</small>
      </button>
    `)
    .join("");

  return `
    <div class="settings-nav">
      <div class="settings-nav-intro">
        <h3>Sections</h3>
        <p>Choose a section to jump directly to it.</p>
      </div>
      <div class="settings-nav-list">
        ${items}
      </div>
    </div>
  `;
}

/**
 * Wraps a settings section in the shared card layout.
 *
 * @param {{ sectionId: string, title: string, description: string, badge?: string, content: string, footer?: string }} payload
 * @returns {string}
 */
export function createSettingsCard({ sectionId, title, description, badge, content, footer }) {
  return `
    <article id="settings-section-${escapeHtml(sectionId)}" class="settings-card panel" tabindex="-1">
      <header class="settings-card-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
        </div>
        ${badge ? `<span class="settings-card-badge">${escapeHtml(badge)}</span>` : ""}
      </header>
      <div class="settings-card-body">
        ${content}
      </div>
      ${footer ? `<footer class="settings-card-footer">${footer}</footer>` : ""}
    </article>
  `;
}

/**
 * Builds a labeled text input with helper text.
 *
 * @param {{
 *   id: string,
 *   label: string,
 *   value?: string,
 *   description?: string,
 *   type?: string,
 *   readOnly?: boolean,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   inputAttributes?: string
 * }} payload
 * @returns {string}
 */
export function createTextField({
  id,
  label,
  value = "",
  description = "",
  type = "text",
  readOnly = false,
  disabled = false,
  placeholder = "",
  inputAttributes = ""
}) {
  const helpId = `${id}-help`;
  return `
    <label class="settings-field" for="${escapeHtml(id)}">
      <span class="settings-field-label">${escapeHtml(label)}</span>
      <input
        id="${escapeHtml(id)}"
        class="settings-input"
        type="${escapeHtml(type)}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        aria-describedby="${escapeHtml(helpId)}"
        ${readOnly ? "readonly" : ""}
        ${disabled ? "disabled" : ""}
        ${inputAttributes}
      />
      <span id="${escapeHtml(helpId)}" class="settings-field-help">${escapeHtml(description)}</span>
    </label>
  `;
}

/**
 * Builds a read-only field for account and company details from the server.
 *
 * @param {{ label: string, value: string, description?: string }} payload
 * @returns {string}
 */
export function createReadOnlyField({ label, value, description = "" }) {
  return `
    <div class="settings-field settings-field-readonly">
      <span class="settings-field-label">${escapeHtml(label)}</span>
      <div class="settings-readonly-value">${escapeHtml(value || "Not available")}</div>
      <span class="settings-field-help">${escapeHtml(description)}</span>
    </div>
  `;
}

/**
 * Builds a labeled select box with helper text.
 *
 * @param {{ id: string, label: string, value: string, options: Array<{ value: string, label: string }>, description?: string }} payload
 * @returns {string}
 */
export function createSelectField({ id, label, value, options, description = "" }) {
  const helpId = `${id}-help`;
  return `
    <label class="settings-field" for="${escapeHtml(id)}">
      <span class="settings-field-label">${escapeHtml(label)}</span>
      <select
        id="${escapeHtml(id)}"
        class="settings-select"
        aria-describedby="${escapeHtml(helpId)}"
      >
        ${renderOptions(options, value)}
      </select>
      <span id="${escapeHtml(helpId)}" class="settings-field-help">${escapeHtml(description)}</span>
    </label>
  `;
}

/**
 * Builds a switch-style checkbox for on/off preferences.
 *
 * @param {{ id: string, label: string, description?: string, checked?: boolean, disabled?: boolean }} payload
 * @returns {string}
 */
export function createToggleField({ id, label, description = "", checked = false, disabled = false }) {
  const helpId = `${id}-help`;
  return `
    <label class="settings-toggle-field" for="${escapeHtml(id)}">
      <span class="settings-toggle-copy">
        <span class="settings-field-label">${escapeHtml(label)}</span>
        <span id="${escapeHtml(helpId)}" class="settings-field-help">${escapeHtml(description)}</span>
      </span>
      <span class="settings-switch">
        <input
          id="${escapeHtml(id)}"
          class="settings-switch-input"
          type="checkbox"
          aria-describedby="${escapeHtml(helpId)}"
          ${checked ? "checked" : ""}
          ${disabled ? "disabled" : ""}
        />
        <span class="settings-switch-ui" aria-hidden="true"></span>
      </span>
    </label>
  `;
}

/**
 * Builds the small preview shown in the appearance section.
 *
 * @returns {string}
 */
export function createPreferencePreview() {
  return `
    <div class="settings-preview" aria-hidden="true">
      <div class="settings-preview-header">
        <div>
          <span class="settings-preview-label">Preview</span>
          <strong>How this workspace will feel</strong>
        </div>
        <span id="settings-preview-theme-label" class="metric-trend" data-tone="muted">Theme: System</span>
      </div>
      <div class="settings-preview-grid">
        <article class="settings-preview-card">
          <span class="settings-preview-card-label">Cards</span>
          <strong>Executive summary</strong>
          <p id="settings-preview-density-label">Balanced spacing and readable forms.</p>
        </article>
        <article class="settings-preview-table">
          <div class="settings-preview-table-head">
            <span>Table</span>
            <span>Readable</span>
          </div>
          <div class="settings-preview-table-row">
            <span>Labels</span>
            <i></i>
          </div>
          <div class="settings-preview-table-row">
            <span id="settings-preview-accessibility-label">Default accessibility</span>
            <i></i>
          </div>
        </article>
      </div>
    </div>
  `;
}
