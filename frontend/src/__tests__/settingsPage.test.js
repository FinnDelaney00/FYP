import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted service mocks let the module under test bind to stable mock references.
const serviceMocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  createAdminInvite: vi.fn(),
  saveProfileChanges: vi.fn(),
  signOutAllSessions: vi.fn(),
}));

vi.mock("../settings/adminInviteService.js", () => ({
  createAdminInvite: serviceMocks.createAdminInvite,
}));

vi.mock("../settings/profileService.js", () => ({
  getProfileUpdateCapability: () => ({ supported: false }),
  saveProfileChanges: serviceMocks.saveProfileChanges,
}));

vi.mock("../settings/securityService.js", () => ({
  changePassword: serviceMocks.changePassword,
  getSecurityCapabilities: () => ({
    passwordChange: false,
    revokeSessions: false,
  }),
  signOutAllSessions: serviceMocks.signOutAllSessions,
}));

import { createSettingsPage } from "../settings/settingsPage.js";

/**
 * Creates a small in-memory preferences store for settings-page tests.
 */
function createPreferencesStore() {
  const defaults = {
    compactMode: false,
    fontSize: "default",
    highContrast: false,
    landingPage: "dashboard",
    reducedMotion: false,
    theme: "system",
  };
  let state = { ...defaults };
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    reset() {
      state = { ...defaults };
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      state = { ...state, ...(patch || {}) };
      listeners.forEach((listener) => listener(state));
    },
  };
}

/**
 * Creates an authenticated session fixture for the requested role.
 *
 * @param {"admin" | "member"} [role="member"]
 * @returns {Record<string, any>}
 */
function createSessionState(role = "member") {
  return {
    status: "authenticated",
    raw: {
      user: {
        updated_at: "2026-04-08T12:00:00Z",
      },
    },
    user: {
      id: "user-1",
      name: "Admin User",
      email: "admin@example.com",
      companyId: "acme",
      role,
    },
    company: {
      id: "acme",
      name: "Acme Ltd",
      status: "active",
      trustedPrefix: "trusted/acme/",
      analyticsPrefix: "trusted-analytics/acme/",
      athenaDatabase: "acme_db",
    },
  };
}

describe("createSettingsPage", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="settings-root"></div>`;
    serviceMocks.changePassword.mockReset();
    serviceMocks.createAdminInvite.mockReset();
    serviceMocks.saveProfileChanges.mockReset();
    serviceMocks.signOutAllSessions.mockReset();
  });

  it("lets admins generate invite codes from company access settings", async () => {
    const sessionState = createSessionState("admin");
    const preferencesStore = createPreferencesStore();
    serviceMocks.createAdminInvite.mockResolvedValue({
      ok: true,
      invite: {
        inviteCode: "ABCD2345WXYZ",
        companyId: "acme",
        role: "analyst",
        expiresAt: 1770000000,
        used: false,
        createdAt: "2026-04-08T12:30:00Z",
      },
    });

    const page = createSettingsPage({
      rootElement: document.getElementById("settings-root"),
      preferencesStore,
      getSessionState: () => sessionState,
      syncSessionFromServer: vi.fn(),
      getAuthToken: () => "token-123",
    });

    page.render();

    const roleSelect = document.getElementById("settings-invite-role");
    const expiryInput = document.getElementById("settings-invite-expiry-days");
    expect(roleSelect).not.toBeNull();
    expect(expiryInput).not.toBeNull();

    roleSelect.value = "analyst";
    roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expiryInput.value = "30";
    expiryInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-settings-action="create-invite"]').click();

    await vi.waitFor(() => {
      expect(serviceMocks.createAdminInvite).toHaveBeenCalledWith(
        {
          role: "analyst",
          expiresInDays: 30,
        },
        expect.any(Function)
      );
    });

    await vi.waitFor(() => {
      expect(document.getElementById("settings-generated-invite-code").value).toBe("ABCD2345WXYZ");
    });
    expect(document.getElementById("settings-company-access-status").textContent).toContain("Invite ready");
    expect(document.getElementById("settings-root").textContent).toContain("SmartStream does not send invite emails yet");
  });

  it("shows company access as read-only for non-admin users", () => {
    const sessionState = createSessionState("member");
    const preferencesStore = createPreferencesStore();

    const page = createSettingsPage({
      rootElement: document.getElementById("settings-root"),
      preferencesStore,
      getSessionState: () => sessionState,
      syncSessionFromServer: vi.fn(),
      getAuthToken: () => "token-123",
    });

    page.render();

    expect(document.getElementById("settings-invite-role")).toBeNull();
    expect(document.querySelector('[data-settings-action="create-invite"]')).toBeNull();
    expect(document.getElementById("settings-root").textContent).toContain("Ask a workspace admin to generate an invite code");
    expect(document.getElementById("settings-company-access-status").textContent).toContain(
      "Invite code creation is limited to admins in this workspace"
    );
  });
});
