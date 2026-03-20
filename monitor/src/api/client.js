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
