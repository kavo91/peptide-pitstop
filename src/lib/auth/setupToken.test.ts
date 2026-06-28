import { describe, it, expect, afterEach } from "vitest";
import {
  checkSetupToken,
  setupTokenRequired,
  configuredSetupToken,
  SETUP_TOKEN_COOKIE,
} from "./setupToken";

/**
 * Gate for the public first-run /setup action (`finishSetup` in
 * src/app/actions/auth.ts). `finishSetup` calls `checkSetupToken(submittedToken)`
 * BEFORE the atomic `provisionOwner` claim; these tests cover the three contract
 * cases the setup action depends on. The TOCTOU atomic claim itself is unchanged
 * and remains covered by provision.test.ts.
 */
describe("setup token gate", () => {
  const original = process.env.SETUP_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = original;
  });

  it("SETUP_TOKEN unset → gate is a no-op, setup proceeds (back-compat)", () => {
    delete process.env.SETUP_TOKEN;
    expect(setupTokenRequired()).toBe(false);
    expect(configuredSetupToken()).toBeNull();
    // No submitted token at all still provisions when the gate is disabled.
    expect(checkSetupToken(undefined)).toEqual({ ok: true });
    expect(checkSetupToken("")).toEqual({ ok: true });
    expect(checkSetupToken("anything")).toEqual({ ok: true });
  });

  it("SETUP_TOKEN empty string → treated as unset (no gate)", () => {
    process.env.SETUP_TOKEN = "";
    expect(setupTokenRequired()).toBe(false);
    expect(checkSetupToken(undefined)).toEqual({ ok: true });
  });

  it("SETUP_TOKEN set + correct token → setup proceeds", () => {
    process.env.SETUP_TOKEN = "s3cret-token";
    expect(setupTokenRequired()).toBe(true);
    expect(checkSetupToken("s3cret-token")).toEqual({ ok: true });
  });

  it("SETUP_TOKEN set + wrong token → rejected", () => {
    process.env.SETUP_TOKEN = "s3cret-token";
    const res = checkSetupToken("nope");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid setup token.");
  });

  it("SETUP_TOKEN set + missing token → rejected", () => {
    process.env.SETUP_TOKEN = "s3cret-token";
    for (const missing of [undefined, null, ""] as const) {
      const res = checkSetupToken(missing);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("A setup token is required.");
    }
  });

  it("rejects a token that is a prefix/substring of the real one (constant-time, length-safe)", () => {
    process.env.SETUP_TOKEN = "s3cret-token";
    expect(checkSetupToken("s3cret").ok).toBe(false);
    expect(checkSetupToken("s3cret-token-extra").ok).toBe(false);
  });

  it("env can be injected explicitly (no global mutation)", () => {
    expect(checkSetupToken("x", { SETUP_TOKEN: "x" } as unknown as NodeJS.ProcessEnv)).toEqual({ ok: true });
    expect(checkSetupToken("y", { SETUP_TOKEN: "x" } as unknown as NodeJS.ProcessEnv).ok).toBe(false);
    expect(checkSetupToken(undefined, {} as NodeJS.ProcessEnv)).toEqual({ ok: true });
  });

  it("exposes a stable cookie name for the page↔action channel", () => {
    expect(SETUP_TOKEN_COOKIE).toBe("pt_setup_token");
  });
});
