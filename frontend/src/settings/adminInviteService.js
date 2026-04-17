import { requestJSON } from "../services/apiClient.js";

/**
 * Small service helper for admin invite creation.
 */
const ADMIN_INVITES_PATH = String(import.meta.env.VITE_AUTH_ADMIN_INVITES_PATH || "/admin/invites").trim();
const ADMIN_INVITES_METHOD = String(import.meta.env.VITE_AUTH_ADMIN_INVITES_METHOD || "POST").trim().toUpperCase();

/**
 * Renames the backend invite fields to the names the app uses.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function normalizeInvitePayload(payload) {
  const invite = payload?.invite || {};

  return {
    inviteCode: String(invite.invite_code || "").trim(),
    companyId: String(invite.company_id || "").trim(),
    role: String(invite.role || "member").trim().toLowerCase() || "member",
    expiresAt: Number(invite.expires_at || 0),
    used: Boolean(invite.used),
    createdAt: String(invite.created_at || "").trim()
  };
}

/**
 * Creates a one-time invite code for a new workspace member.
 *
 * @param {{ role?: string, expiresInDays?: number }} [options={}]
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<{ ok: boolean, invite: Record<string, any> }>}
 */
export async function createAdminInvite({ role = "member", expiresInDays = 14 } = {}, getAuthToken) {
  const payload = await requestJSON(
    ADMIN_INVITES_PATH,
    {
      method: ADMIN_INVITES_METHOD,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        role: String(role || "member").trim().toLowerCase() || "member",
        expires_in_days: Number(expiresInDays)
      })
    },
    getAuthToken
  );

  return {
    ok: true,
    invite: normalizeInvitePayload(payload)
  };
}
