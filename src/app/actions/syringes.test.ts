import { beforeEach, describe, expect, it, vi } from "vitest";

const { syringeFindFirst, syringeDeleteMany, userUpdate, userFindUnique, currentUser, revalidatePath } = vi.hoisted(() => ({
  syringeFindFirst: vi.fn(),
  syringeDeleteMany: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  currentUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    syringe: { findFirst: syringeFindFirst, deleteMany: syringeDeleteMany, updateMany: vi.fn(), create: vi.fn() },
    user: { update: userUpdate, findUnique: userFindUnique },
  },
}));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: currentUser }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { setDefaultSyringe, deleteSyringe } from "./syringes";

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: "u1" });
  userUpdate.mockResolvedValue({});
});

describe("setDefaultSyringe", () => {
  it("sets the user's default to an own-or-shared syringe", async () => {
    syringeFindFirst.mockResolvedValue({ id: "s1" });
    const res = await setDefaultSyringe("s1");
    expect(res.ok).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { defaultSyringeId: "s1" } });
    // ownership scope: own OR shared (userId null), never another user's row
    expect(syringeFindFirst.mock.calls[0][0].where).toEqual({ id: "s1", OR: [{ userId: "u1" }, { userId: null }] });
  });

  it("refuses an unknown/foreign syringe without writing", async () => {
    syringeFindFirst.mockResolvedValue(null);
    const res = await setDefaultSyringe("sX");
    expect(res.ok).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("null clears the default", async () => {
    const res = await setDefaultSyringe(null);
    expect(res.ok).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { defaultSyringeId: null } });
    expect(syringeFindFirst).not.toHaveBeenCalled();
  });
});

describe("deleteSyringe clears a dangling default", () => {
  it("nulls the pointer when the deleted syringe was the default", async () => {
    syringeDeleteMany.mockResolvedValue({ count: 1 });
    userFindUnique.mockResolvedValue({ defaultSyringeId: "s1" });
    const res = await deleteSyringe("s1");
    expect(res.ok).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { defaultSyringeId: null } });
  });

  it("leaves the pointer alone when a different syringe is deleted", async () => {
    syringeDeleteMany.mockResolvedValue({ count: 1 });
    userFindUnique.mockResolvedValue({ defaultSyringeId: "s1" });
    const res = await deleteSyringe("s2");
    expect(res.ok).toBe(true);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
