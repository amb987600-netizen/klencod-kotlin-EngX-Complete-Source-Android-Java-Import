import { beforeEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn().mockResolvedValue(undefined);
const login = vi.fn();
const logout = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
}));
vi.mock("@capgo/capacitor-social-login", () => ({
  SocialLogin: { initialize, login, logout },
}));

describe("native Google sign-in guards", () => {
  beforeEach(() => {
    vi.resetModules();
    initialize.mockClear();
    login.mockReset();
    logout.mockClear();
  });

  it("rejects missing or placeholder backend web IDs before login", async () => {
    const { nativeGoogleCredential } = await import("../src/googleSignIn");
    await expect(nativeGoogleCredential("")).rejects.toThrow(/غير موجود أو غير صالح/);
    expect(login).not.toHaveBeenCalled();
  });

  it("initializes online with email/profile and returns only idToken", async () => {
    login.mockResolvedValue({ provider: "google", result: { idToken: "id-token", accessToken: { token: "do-not-store" } } });
    const { nativeGoogleCredential } = await import("../src/googleSignIn");
    await expect(nativeGoogleCredential("1234567890-web.apps.googleusercontent.com")).resolves.toBe("id-token");
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ google: expect.objectContaining({ webClientId: "1234567890-web.apps.googleusercontent.com", mode: "online" }) }));
    expect(login).toHaveBeenCalledWith({ provider: "google", options: { scopes: ["email", "profile"] } });
  });
});
