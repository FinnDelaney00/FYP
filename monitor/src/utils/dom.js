const HTML_ESCAPE_LOOKUP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/**
 * Escapes text for safe insertion into HTML content.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPE_LOOKUP[character]);
}

/**
 * Escapes text for safe insertion into HTML attributes. Backticks are handled
 * separately because they are valid HTML text but awkward inside template
 * literals used to build the markup strings.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
