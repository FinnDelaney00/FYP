/**
 * Client-side preference store for theme, density, accessibility, and landing
 * page settings.
 */
export const PREFERENCES_STORAGE_KEY = "smartstream_preferences";

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "system",
  compactMode: false,
  landingPage: "dashboard",
  fontSize: "default",
  reducedMotion: false,
  highContrast: false
});

const VALID_THEMES = new Set(["light", "dark", "system"]);
const VALID_FONT_SIZES = new Set(["small", "default", "large"]);
const VALID_LANDING_PAGES = new Set(["dashboard", "forecasts", "query"]);

/**
 * Normalizes persisted boolean-like values from storage.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
  return value === true || value === "true";
}

/**
 * Sanitizes partially trusted preference payloads against allowed values.
 *
 * @param {Record<string, any>} raw
 * @returns {typeof DEFAULT_PREFERENCES}
 */
function normalizePreferences(raw) {
  const source = raw || {};
  const theme = VALID_THEMES.has(source.theme) ? source.theme : DEFAULT_PREFERENCES.theme;
  const fontSize = VALID_FONT_SIZES.has(source.fontSize) ? source.fontSize : DEFAULT_PREFERENCES.fontSize;
  const landingPage = VALID_LANDING_PAGES.has(source.landingPage) ? source.landingPage : DEFAULT_PREFERENCES.landingPage;

  return {
    theme,
    compactMode: normalizeBoolean(source.compactMode),
    landingPage,
    fontSize,
    reducedMotion: normalizeBoolean(source.reducedMotion),
    highContrast: normalizeBoolean(source.highContrast)
  };
}

/**
 * Loads the last saved preferences from local storage.
 *
 * Invalid or corrupt payloads fall back to the application defaults.
 *
 * @returns {typeof DEFAULT_PREFERENCES}
 */
function loadStoredPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFERENCES };
    }
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Persists the current preference snapshot.
 *
 * @param {typeof DEFAULT_PREFERENCES} state
 */
function saveStoredPreferences(state) {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Resolves the effective theme when the user chooses "system".
 *
 * @param {MediaQueryList | null} mediaQuery
 * @returns {"dark" | "light"}
 */
function getSystemTheme(mediaQuery) {
  return mediaQuery?.matches ? "dark" : "light";
}

/**
 * Mirrors preference state onto document-level data attributes and color-scheme.
 *
 * @param {typeof DEFAULT_PREFERENCES} state
 * @param {MediaQueryList | null} mediaQuery
 */
function applyPreferencesToDocument(state, mediaQuery) {
  const root = document.documentElement;
  const resolvedTheme = state.theme === "system" ? getSystemTheme(mediaQuery) : state.theme;

  root.dataset.themeMode = state.theme;
  root.dataset.themeResolved = resolvedTheme;
  root.dataset.compact = state.compactMode ? "true" : "false";
  root.dataset.fontSize = state.fontSize;
  root.dataset.reducedMotion = state.reducedMotion ? "true" : "false";
  root.dataset.highContrast = state.highContrast ? "true" : "false";
  root.style.colorScheme = resolvedTheme;
}

/**
 * Notifies local subscribers and emits a window event for cross-feature updates.
 *
 * @param {Set<Function>} listeners
 * @param {typeof DEFAULT_PREFERENCES} state
 */
function notifyListeners(listeners, state) {
  listeners.forEach((listener) => {
    listener(state);
  });

  window.dispatchEvent(
    new CustomEvent("smartstream:preferences-changed", {
      detail: state
    })
  );
}

/**
 * Creates the in-browser preference store used by the main shell and settings page.
 *
 * @returns {{
 *   getState: () => typeof DEFAULT_PREFERENCES,
 *   subscribe: (listener: (state: typeof DEFAULT_PREFERENCES) => void) => () => void,
 *   update: (partialState: Partial<typeof DEFAULT_PREFERENCES>) => typeof DEFAULT_PREFERENCES,
 *   reset: () => typeof DEFAULT_PREFERENCES
 * }}
 */
export function createPreferencesStore() {
  let state = loadStoredPreferences();
  const listeners = new Set();
  const mediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const syncDocument = () => {
    applyPreferencesToDocument(state, mediaQuery);
  };

  const emit = ({ persist = true } = {}) => {
    if (persist) {
      saveStoredPreferences(state);
    }
    syncDocument();
    notifyListeners(listeners, state);
  };

  const handleMediaChange = () => {
    syncDocument();
    notifyListeners(listeners, state);
  };

  if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener("change", handleMediaChange);
  } else if (mediaQuery?.addListener) {
    mediaQuery.addListener(handleMediaChange);
  }

  syncDocument();

  window.addEventListener("storage", (event) => {
    if (event.key !== PREFERENCES_STORAGE_KEY) {
      return;
    }
    state = loadStoredPreferences();
    syncDocument();
    notifyListeners(listeners, state);
  });

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    update(partialState) {
      state = normalizePreferences({
        ...state,
        ...(partialState || {})
      });
      emit();
      return state;
    },
    reset() {
      state = { ...DEFAULT_PREFERENCES };
      emit();
      return state;
    }
  };
}
