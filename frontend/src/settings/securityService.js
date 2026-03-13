import { requestJSON } from "../services/apiClient.js";

const CHANGE_PASSWORD_PATH = String(import.meta.env.VITE_AUTH_CHANGE_PASSWORD_PATH || "").trim();
const CHANGE_PASSWORD_METHOD = String(import.meta.env.VITE_AUTH_CHANGE_PASSWORD_METHOD || "POST").trim().toUpperCase();
const REVOKE_SESSIONS_PATH = String(import.meta.env.VITE_AUTH_REVOKE_SESSIONS_PATH || "").trim();
const REVOKE_SESSIONS_METHOD = String(import.meta.env.VITE_AUTH_REVOKE_SESSIONS_METHOD || "POST").trim().toUpperCase();

export function getSecurityCapabilities() {
  return {
    passwordChange: Boolean(CHANGE_PASSWORD_PATH),
    revokeSessions: Boolean(REVOKE_SESSIONS_PATH)
  };
}

export async function changePassword({ currentPassword, newPassword, confirmPassword }, getAuthToken) {
  if (!CHANGE_PASSWORD_PATH) {
    return {
      ok: false,
      supported: false,
      message: "Password changes are not available yet in this environment."
    };
  }

  await requestJSON(
    CHANGE_PASSWORD_PATH,
    {
      method: CHANGE_PASSWORD_METHOD,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      })
    },
    getAuthToken
  );

  return {
    ok: true,
    supported: true,
    message: "Password updated."
  };
}

export async function signOutAllSessions(getAuthToken) {
  if (!REVOKE_SESSIONS_PATH) {
    return {
      ok: false,
      supported: false,
      message: "Session management is not available yet in this environment."
    };
  }

  await requestJSON(
    REVOKE_SESSIONS_PATH,
    {
      method: REVOKE_SESSIONS_METHOD
    },
    getAuthToken
  );

  return {
    ok: true,
    supported: true,
    message: "Other sessions were signed out."
  };
}
