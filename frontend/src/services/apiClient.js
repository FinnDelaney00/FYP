const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export { API_BASE_URL };

export function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildUrl(path) {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  return `${API_BASE_URL}${path}`;
}

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

export function getJSON(path, options, getAuthToken) {
  return requestJSON(path, { ...(options || {}), method: options?.method || "GET" }, getAuthToken);
}

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
