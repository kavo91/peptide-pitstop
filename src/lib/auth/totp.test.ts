import { describe, it, expect } from "vitest";
import { generateSync } from "otplib";
import { generateTotpSecret, totpKeyUri, verifyTotp, verifyTotpWithReplay } from "./totp";

describe("totp", () => {
  it("verifies a freshly generated code", () => {
    const secret = generateTotpSecret();
    const code = generateSync({ secret });
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    const code = generateSync({ secret });
    const wrong = code === "000000" ? "111111" : "000000";
    expect(verifyTotp(wrong, secret)).toBe(false);
  });

  it("rejects a non-numeric / empty code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp("", secret)).toBe(false);
    expect(verifyTotp("abcdef", secret)).toBe(false);
  });

  it("builds an otpauth key URI with issuer and account", () => {
    const uri = totpKeyUri("user@example.com", "JBSWY3DPEHPK3PXP");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("Peptide%20Pitstop");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});

describe("totp replay protection", () => {
  const secret = generateTotpSecret();
  const t0 = 1_700_000_000; // fixed epoch in seconds (deterministic)
  const step0 = Math.floor(t0 / 30);

  it("accepts a fresh code and reports its RFC 6238 time-step", () => {
    const code = generateSync({ secret, epoch: t0 });
    const r = verifyTotpWithReplay(code, secret, null, t0);
    expect(r.valid).toBe(true);
    expect(r.timeStep).toBe(step0);
  });

  it("rejects the same code/time-step on a second use (replay)", () => {
    const code = generateSync({ secret, epoch: t0 });
    const first = verifyTotpWithReplay(code, secret, null, t0);
    expect(first.valid).toBe(true);
    // Replay the identical code with lastStep set to the step it just consumed.
    const replay = verifyTotpWithReplay(code, secret, first.timeStep, t0);
    expect(replay.valid).toBe(false);
    expect(replay.timeStep).toBeUndefined();
  });

  it("accepts a later code whose time-step is beyond lastStep", () => {
    const tLater = t0 + 60; // two periods later
    const code = generateSync({ secret, epoch: tLater });
    const r = verifyTotpWithReplay(code, secret, step0, tLater);
    expect(r.valid).toBe(true);
    expect(r.timeStep).toBe(Math.floor(tLater / 30));
    expect(r.timeStep!).toBeGreaterThan(step0);
  });

  it("disables the guard when lastStep is null (first-ever verification)", () => {
    const code = generateSync({ secret, epoch: t0 });
    expect(verifyTotpWithReplay(code, secret, null, t0).valid).toBe(true);
  });

  it("rejects a malformed code regardless of replay state", () => {
    expect(verifyTotpWithReplay("abc", secret, null, t0).valid).toBe(false);
  });
});
