import { requestJSON } from "../services/apiClient.js";

/**
 * Service helpers for profile updates.
 */
const PROFILE_UPDATE_PATH = String(import.meta.env.VITE_AUTH_PROFILE_UPDATE_PATH || "").trim();
const PROFILE_UPDATE_METHOD = String(import.meta.env.VITE_AUTH_PROFILE_UPDATE_METHOD || "PATCH").trim().toUpperCase();

/**
 * Tells the UI whether profile updates are available in this environment.
 *
 * @returns {{ supported: boolean, path: string | null, method: string }}
 */
export function getProfileUpdateCapability() {
  return {
    supported: Boolean(PROFILE_UPDATE_PATH),
    path: PROFILE_UPDATE_PATH || null,
    method: PROFILE_UPDATE_METHOD
  };
}

/**
 * Saves profile changes when this deployment supports it.
 *
 * @param {{ fullName: string }} payload
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<{ ok: boolean, supported: boolean, message: string }>}
 */
export async function saveProfileChanges({ fullName }, getAuthToken) {
  if (!PROFILE_UPDATE_PATH) {
    return {
      ok: false,
      supported: false,
      message: "Profile updates are not available yet in this environment."
    };
  }

  await requestJSON(
    PROFILE_UPDATE_PATH,
    {
      method: PROFILE_UPDATE_METHOD,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        display_name: String(fullName || "").trim(),
        name: String(fullName || "").trim()
      })
    },
    getAuthToken
  );

  return {
    ok: true,
    supported: true,
    message: "Profile updated."
  };
}
