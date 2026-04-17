/**
 * Browser-side settings store for theme, layout, accessibility, and landing
 * page choices.
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
 * Turns saved true/false-like values into real booleans.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
  return value === true || value === "true";
}

/**
 * Keeps only the saved preference values the app supports.
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
 * If the saved data is broken, the app falls back to the defaults.
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
 * Saves the current preferences.
 *
 * @param {typeof DEFAULT_PREFERENCES} state
 */
function saveStoredPreferences(state) {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Picks the actual theme when the user chooses "system".
 *
 * @param {MediaQueryList | null} mediaQuery
 * @returns {"dark" | "light"}
 */
function getSystemTheme(mediaQuery) {
  return mediaQuery?.matches ? "dark" : "light";
}

/**
 * Applies the current preferences to the page.
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
 * Tells local listeners and the rest of the page that preferences changed.
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
 * Creates the preference store used by the main app shell and settings page.
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
