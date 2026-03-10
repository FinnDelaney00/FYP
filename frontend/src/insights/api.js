export function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function createGetJSON(API_BASE_URL) {
  return function getJSON(path, options, getAuthToken) {
    if (!API_BASE_URL) {
      throw new Error("VITE_API_BASE_URL is not configured");
    }

    const headers = {
      ...(options?.headers || {}),
      ...buildAuthHeaders(getAuthToken)
    };

    return fetch(`${API_BASE_URL}${path}`, {
      ...(options || {}),
      headers
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload;
    });
  };
}
