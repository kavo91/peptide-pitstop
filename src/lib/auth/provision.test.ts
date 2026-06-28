import { describe, it, expect } from "vitest";
import { provisionOwner } from "./provision";

describe("provisionOwner (atomic first-run)", () => {
  it("claims the unprovisioned owner row exactly once under concurrent calls", async () => {
    // Model the DB's atomic guarded UPDATE ... WHERE role='owner' AND passwordHash=''.
    // The single-statement compare-and-set is what makes this TOCTOU-safe.
    let claimed = false;
    const wheres: Array<{ role: string; passwordHash: string }> = [];
    const updateMany = async (args: {
      where: { role: string; passwordHash: string };
      data: { passwordHash: string; totpSecret: string | null };
    }) => {
      wheres.push(args.where);
      if (!claimed && args.where.role === "owner" && args.where.passwordHash === "") {
        claimed = true;
        return { count: 1 };
      }
      return { count: 0 };
    };

    const results = await Promise.allSettled([
      provisionOwner(updateMany, "hash-A", "secret-A"),
      provisionOwner(updateMany, "hash-B", "secret-B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("already provisioned");
    // The guard lives in the WHERE clause (not a prior read), so both calls used it.
    expect(wheres.every((w) => w.role === "owner" && w.passwordHash === "")).toBe(true);
  });

  it("throws when the owner is already provisioned (no matching row)", async () => {
    const updateMany = async () => ({ count: 0 });
    await expect(provisionOwner(updateMany, "h", "s")).rejects.toThrow("already provisioned");
  });

  it("resolves when exactly one row is claimed", async () => {
    const updateMany = async () => ({ count: 1 });
    await expect(provisionOwner(updateMany, "h", "s")).resolves.toBeUndefined();
  });
});
