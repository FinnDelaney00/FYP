import { postJSON, requestJSON } from "./apiClient.js";

/**
 * Session lifecycle helpers for login, signup, token persistence, and
 * subscriber notifications across the workspace shell.
 */
const AUTH_TOKEN_KEY = "smartstream_auth_token";

const anonymousSession = Object.freeze({
  status: "anonymous",
  user: null,
  company: null,
  raw: null
});

let sessionState = anonymousSession;
const listeners = new Set();

/**
 * Notifies every subscriber that the in-memory session state changed.
 */
function emitSessionChange() {
  listeners.forEach((listener) => {
    listener(sessionState);
  });
}

/**
 * Replaces the current session snapshot and broadcasts the update.
 *
 * @param {Record<string, unknown>} nextState
 * @returns {Record<string, unknown>}
 */
function setSessionState(nextState) {
  sessionState = nextState;
  emitSessionChange();
  return sessionState;
}

/**
 * Normalizes the `/auth/me` payload into the shape the UI expects.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function normalizeSessionPayload(payload) {
  const rawUser = payload?.user || {};
  const rawCompany = payload?.company || {};
  const companyId = String(rawUser.company_id || rawCompany.company_id || "").trim();
  const companyName = String(rawCompany.company_name || rawCompany.name || "").trim();

  return {
    status: "authenticated",
    raw: payload || {},
    user: {
      id: String(rawUser.user_id || rawUser.id || "").trim(),
      name: String(rawUser.display_name || rawUser.name || rawUser.email || "SmartStream user").trim(),
      email: String(rawUser.email || "").trim(),
      companyId,
      role: String(rawUser.role || "member").trim().toLowerCase() || "member"
    },
    company: {
      id: companyId,
      name: companyName || "Company workspace",
      status: String(rawCompany.status || "").trim().toLowerCase(),
      trustedPrefix: String(rawCompany.trusted_prefix || "").trim(),
      analyticsPrefix: String(rawCompany.analytics_prefix || "").trim(),
      athenaDatabase: String(rawCompany.athena_database || "").trim()
    }
  };
}

/**
 * Detects auth failures that should clear the stored token.
 *
 * @param {any} error
 * @returns {boolean}
 */
function isAuthError(error) {
  return Number(error?.status) === 401 || Number(error?.status) === 403;
}

/**
 * Reads the persisted auth token from local storage.
 *
 * @returns {string}
 */
export function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

/**
 * Persists a bearer token for later session restoration.
 *
 * @param {string} token
 */
export function setStoredToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/**
 * Removes the persisted auth token.
 */
export function clearStoredToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

/**
 * Returns the latest in-memory session snapshot.
 *
 * @returns {Record<string, any>}
 */
export function getSessionState() {
  return sessionState;
}

/**
 * Subscribes to session updates and immediately receives the current state.
 *
 * @param {(state: Record<string, any>) => void} listener
 * @returns {() => void}
 */
export function subscribeSession(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  listener(sessionState);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Refreshes the authenticated session from the backend when a token exists.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function refreshSession() {
  if (!getStoredToken()) {
    return setSessionState(anonymousSession);
  }

  setSessionState({
    ...sessionState,
    status: "loading"
  });

  try {
    const payload = await requestJSON("/auth/me", undefined, getStoredToken);
    return setSessionState(normalizeSessionPayload(payload));
  } catch (error) {
    if (isAuthError(error)) {
      clearStoredToken();
      return setSessionState(anonymousSession);
    }
    throw error;
  }
}

/**
 * Restores the previous session on startup, falling back to anonymous state.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function restoreSession() {
  if (!getStoredToken()) {
    return setSessionState(anonymousSession);
  }

  try {
    return await refreshSession();
  } catch {
    return setSessionState(anonymousSession);
  }
}

/**
 * Authenticates a user via login or signup, then hydrates the full session.
 *
 * @param {{
 *   signupMode?: boolean,
 *   email: string,
 *   password: string,
 *   displayName?: string,
 *   inviteCode?: string
 * }} credentials
 * @returns {Promise<any>}
 */
export async function authenticate({
  signupMode = false,
  email,
  password,
  displayName,
  inviteCode
}) {
  const payload = await postJSON(
    signupMode ? "/auth/signup" : "/auth/login",
    signupMode
      ? {
          email,
          password,
          display_name: displayName,
          invite_code: inviteCode
        }
      : {
          email,
          password
        }
  );

  if (!payload?.token) {
    throw new Error("Authentication succeeded but no token was returned.");
  }

  setStoredToken(payload.token);

  try {
    await refreshSession();
  } catch (error) {
    clearStoredToken();
    throw error;
  }

  return payload;
}

/**
 * Clears the active session locally and returns the UI to anonymous mode.
 */
export function logoutSession() {
  clearStoredToken();
  setSessionState(anonymousSession);
}

/**
 * Explicit alias used by settings screens after account mutations.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function syncSessionFromServer() {
  return refreshSession();
}
