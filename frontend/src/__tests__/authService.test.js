import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Builds a mocked fetch response for auth service tests.
 *
 * @param {unknown} payload
 * @param {{ ok?: boolean, status?: number }} [options={}]
 * @returns {{ ok: boolean, status: number, json: ReturnType<typeof vi.fn> }}
 */
function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe("authService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates a user and refreshes session state", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token-123" }))
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            user_id: "user-1",
            email: "member@example.com",
            display_name: "Member",
            company_id: "acme",
            role: "analyst",
          },
          company: {
            company_id: "acme",
            company_name: "Acme Ltd",
            status: "active",
            trusted_prefix: "trusted/acme/",
            analytics_prefix: "trusted-analytics/acme/",
          },
        })
      );

    const authService = await import("../services/authService.js");
    const observedStates = [];
    const unsubscribe = authService.subscribeSession((state) => {
      observedStates.push(state.status);
    });

    await authService.authenticate({
      email: "member@example.com",
      password: "Password123",
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/auth/login",
      expect.objectContaining({ method: "POST" })
    );
    expect(authService.getStoredToken()).toBe("token-123");
    expect(authService.getSessionState()).toMatchObject({
      status: "authenticated",
      user: {
        email: "member@example.com",
        companyId: "acme",
        role: "analyst",
      },
      company: {
        id: "acme",
        name: "Acme Ltd",
      },
    });
    expect(observedStates).toContain("loading");
    expect(observedStates.at(-1)).toBe("authenticated");

    authService.logoutSession();
    expect(authService.getSessionState().status).toBe("anonymous");
    expect(authService.getStoredToken()).toBe("");
    unsubscribe();
  });

  it("restores anonymous state when the stored token is rejected", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    window.localStorage.setItem("smartstream_auth_token", "stale-token");
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "Auth token expired." }, { ok: false, status: 401 })
    );

    const authService = await import("../services/authService.js");

    await authService.restoreSession();

    expect(authService.getSessionState().status).toBe("anonymous");
    expect(authService.getStoredToken()).toBe("");
  });
});
