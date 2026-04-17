/**
 * Builds a small DOM lookup cache by element id.
 *
 * Dashboard renders hit the same elements many times, so this avoids repeated
 * lookups while still returning `null` when something is missing.
 *
 * @returns {(id: string) => HTMLElement | null}
 */
export function createElementCache() {
  const cache = new Map();

  /**
   * Gets the cached element for an id, looking it up the first time only.
   *
   * @param {string} id
   * @returns {HTMLElement | null}
   */
  return function getElement(id) {
    if (!cache.has(id)) {
      cache.set(id, document.getElementById(id));
    }
    return cache.get(id);
  };
}
