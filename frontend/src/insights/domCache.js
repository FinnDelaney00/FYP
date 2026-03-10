export function createElementCache() {
  const cache = new Map();

  return function getElement(id) {
    if (!cache.has(id)) {
      cache.set(id, document.getElementById(id));
    }
    return cache.get(id);
  };
}
