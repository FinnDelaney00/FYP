import { postJSON, requestJSON } from "./apiClient.js";

/**
 * Helpers for sign-in, sign-up, saved tokens, and session updates across the
 * app shell.
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
 * Tells every subscriber that the saved session state changed.
 */
function emitSessionChange() {
  listeners.forEach((listener) => {
    listener(sessionState);
  });
}

/**
 * Replaces the current session state and shares the update.
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
 * Turns the `/auth/me` response into the shape the UI uses.
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
 * Checks whether an auth error should clear the saved token.
 *
 * @param {any} error
 * @returns {boolean}
 */
function isAuthError(error) {
  return Number(error?.status) === 401 || Number(error?.status) === 403;
}

/**
 * Gets the saved auth token from local storage.
 *
 * @returns {string}
 */
export function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

/**
 * Saves a token so the session can be restored later.
 *
 * @param {string} token
 */
export function setStoredToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/**
 * Removes the saved auth token.
 */
export function clearStoredToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

/**
 * Gets the latest session state kept in memory.
 *
 * @returns {Record<string, any>}
 */
export function getSessionState() {
  return sessionState;
}

/**
 * Subscribes to session updates and sends the current state right away.
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
 * Reloads the signed-in session from the backend when a token exists.
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
 * Restores the previous session on startup, or falls back to logged out.
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
 * Signs a user in or up, then loads the full session.
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
 * Clears the local session and returns the UI to logged-out mode.
 */
export function logoutSession() {
  clearStoredToken();
  setSessionState(anonymousSession);
}

/**
 * Alias the settings page uses after account changes.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function syncSessionFromServer() {
  return refreshSession();
}
