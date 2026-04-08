import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe("adminInviteService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an invite and normalizes the response payload", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        invite: {
          invite_code: "ABCD2345WXYZ",
          company_id: "acme",
          role: "analyst",
          expires_at: 1770000000,
          used: false,
          created_at: "2026-04-08T12:00:00Z",
        },
      })
    );

    const adminInviteService = await import("../settings/adminInviteService.js");
    const result = await adminInviteService.createAdminInvite(
      {
        role: "analyst",
        expiresInDays: 21,
      },
      () => "token-123"
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/admin/invites",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          role: "analyst",
          expires_in_days: 21,
        }),
      })
    );
    expect(result).toEqual({
      ok: true,
      invite: {
        inviteCode: "ABCD2345WXYZ",
        companyId: "acme",
        role: "analyst",
        expiresAt: 1770000000,
        used: false,
        createdAt: "2026-04-08T12:00:00Z",
      },
    });
  });
});
