const DEFAULT_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DEFAULT_POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 3000);

function formatValue(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function toItemPreview(item) {
  if (!item || typeof item !== "object") {
    return formatValue(item);
  }

  const parts = Object.entries(item)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatValue(value)}`);
  return parts.join(" | ");
}

function renderList(listElement, items) {
  listElement.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No items in latest object.";
    listElement.append(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = toItemPreview(item);
    listElement.append(li);
  });
}

export function startLiveUpdates({
  listElement,
  metaElement,
  statusElement,
  limit = 50,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}) {
  if (!DEFAULT_API_BASE_URL) {
    metaElement.textContent = "Missing VITE_API_BASE_URL";
    statusElement.textContent = "Live Data: config required";
    statusElement.classList.add("is-error");
    return () => {};
  }

  let timer = null;

  const refresh = async () => {
    try {
      const response = await fetch(`${DEFAULT_API_BASE_URL}/latest?limit=${limit}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      renderList(listElement, payload.items || []);

      const lastModified = payload.last_modified ? new Date(payload.last_modified).toLocaleString() : "n/a";
      metaElement.textContent = `Object: ${payload.s3_key || "none"} | Last modified: ${lastModified}`;

      statusElement.textContent = `Live Data: updated ${new Date().toLocaleTimeString()}`;
      statusElement.classList.remove("is-error");
      statusElement.classList.add("is-live");
    } catch (error) {
      statusElement.textContent = `Live Data: error (${error.message})`;
      statusElement.classList.remove("is-live");
      statusElement.classList.add("is-error");
    }
  };

  refresh();
  timer = window.setInterval(refresh, pollIntervalMs);

  return () => {
    if (timer) {
      window.clearInterval(timer);
    }
  };
}
