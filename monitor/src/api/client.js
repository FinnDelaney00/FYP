export function createJsonClient({ baseUrl = "", fetchImpl = window.fetch.bind(window) } = {}) {
  const normalizedBaseUrl = String(baseUrl ?? "").trim().replace(/\/+$/, "");

  return {
    baseUrl: normalizedBaseUrl,
    async get(path) {
      const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response.json();
    }
  };
}
