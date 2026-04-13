/**
 * Shared fetch helpers for authenticated JSON requests.
 *
 * Service modules use these wrappers to keep base URL handling, auth headers,
 * and JSON error normalization consistent across the frontend.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export { API_BASE_URL };

/**
 * Builds a bearer-token header when an auth token is available.
 *
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resolves an API path against the configured base URL.
 *
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  return `${API_BASE_URL}${path}`;
}

/**
 * Sends a JSON request and throws normalized errors for non-2xx responses.
 *
 * @param {string} path
 * @param {RequestInit} [options={}]
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<any>}
 */
export async function requestJSON(path, options = {}, getAuthToken) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...buildAuthHeaders(getAuthToken)
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

/**
 * Convenience wrapper for JSON GET requests.
 *
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<any>}
 */
export function getJSON(path, options, getAuthToken) {
  return requestJSON(path, { ...(options || {}), method: options?.method || "GET" }, getAuthToken);
}

/**
 * Convenience wrapper for JSON POST-style requests.
 *
 * @param {string} path
 * @param {unknown} body
 * @param {(() => string) | undefined} getAuthToken
 * @param {RequestInit} [options={}]
 * @returns {Promise<any>}
 */
export function postJSON(path, body, getAuthToken, options = {}) {
  return requestJSON(
    path,
    {
      ...options,
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: JSON.stringify(body || {})
    },
    getAuthToken
  );
}

/**
 * Creates a scoped GET helper for feature modules that work from one base URL.
 *
 * @param {string} [baseUrl=API_BASE_URL]
 * @returns {(path: string, options?: RequestInit, getAuthToken?: (() => string)) => Promise<any>}
 */
export function createGetJSON(baseUrl = API_BASE_URL) {
  return async function getJSONWithBase(path, options, getAuthToken) {
    if (!baseUrl) {
      throw new Error("VITE_API_BASE_URL is not configured.");
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...(options || {}),
      headers: {
        ...(options?.headers || {}),
        ...buildAuthHeaders(getAuthToken)
      }
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  };
}
