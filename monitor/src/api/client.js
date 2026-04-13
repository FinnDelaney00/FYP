/**
 * Creates a minimal JSON GET client that centralizes auth token lookup and
 * error normalization for monitor API requests.
 *
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   getAuthToken?: () => string
 * }} [options]
 * @returns {{ baseUrl: string, get: (path: string) => Promise<any> }}
 */
export function createJsonClient({
  baseUrl = "",
  fetchImpl = typeof window !== "undefined" ? window.fetch.bind(window) : fetch,
  getAuthToken = getDefaultAuthToken
} = {}) {
  const normalizedBaseUrl = String(baseUrl ?? "").trim().replace(/\/+$/, "");

  return {
    baseUrl: normalizedBaseUrl,
    async get(path) {
      const headers = {
        Accept: "application/json"
      };
      const token = getAuthToken();

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: "GET",
        headers: {
          ...headers
        }
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        const error = new Error(
          payload?.message || payload?.error || `Request failed with status ${response.status}`
        );
        error.statusCode = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    }
  };
}

/**
 * Resolves the auth token from environment configuration first and then from
 * local storage so local development can mimic the deployed monitor.
 *
 * @returns {string}
 */
function getDefaultAuthToken() {
  const envToken = String(import.meta.env.VITE_MONITOR_AUTH_TOKEN ?? "").trim();
  if (envToken) {
    return envToken;
  }

  const storageKey = String(
    import.meta.env.VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY ?? "smartstream_auth_token"
  ).trim();

  if (!storageKey || typeof window === "undefined" || !window.localStorage) {
    return "";
  }

  try {
    return String(window.localStorage.getItem(storageKey) ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Parses a response body as JSON when possible while still surfacing plain-text
 * responses as structured error messages.
 *
 * @param {{ text: () => Promise<string> }} response
 * @returns {Promise<any>}
 */
async function parseJsonResponse(response) {
  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {
      message: rawBody
    };
  }
}
