/**
 * Builds a tiny DOM lookup cache keyed by element id.
 *
 * Repeated dashboard renders touch the same DOM nodes many times, so caching
 * `getElementById` results avoids unnecessary lookups while still returning
 * `null` for missing elements in a predictable way.
 *
 * @returns {(id: string) => HTMLElement | null}
 */
export function createElementCache() {
  const cache = new Map();

  /**
   * Returns the cached element for an id, resolving it on first access only.
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
