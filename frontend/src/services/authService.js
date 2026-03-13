import { postJSON, requestJSON } from "./apiClient.js";

const AUTH_TOKEN_KEY = "smartstream_auth_token";

const anonymousSession = Object.freeze({
  status: "anonymous",
  user: null,
  company: null,
  raw: null
});

let sessionState = anonymousSession;
const listeners = new Set();

function emitSessionChange() {
  listeners.forEach((listener) => {
    listener(sessionState);
  });
}

function setSessionState(nextState) {
  sessionState = nextState;
  emitSessionChange();
  return sessionState;
}

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

function isAuthError(error) {
  return Number(error?.status) === 401 || Number(error?.status) === 403;
}

export function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export function setStoredToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function getSessionState() {
  return sessionState;
}

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

export function logoutSession() {
  clearStoredToken();
  setSessionState(anonymousSession);
}

export async function syncSessionFromServer() {
  return refreshSession();
}
