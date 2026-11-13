// @vitest-environment node
/**
 * The local save backend (itch build): the FastAPI rules
 * running on localStorage. Seeding, filing math, idempotency,
 * stores law and the wipe — the same numbers the server pays.
 */
import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

import { ApiError } from "../../lib/api";
import { localRequest } from "../../lib/localBackend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const get = (p: string) => localRequest<Any>("GET", p);
const post = (p: string, b?: unknown) => localRequest<Any>("POST", p, b);

beforeEach(() => store.clear());

describe("local save backend", () => {
  it("summary reads empty before the first touch, then the save seeds", async () => {
    expect(await get("/save/summary")).toEqual({ exists: false });
    const state = await get("/state");
    expect(state.requisition).toBe(300);
    expect(state.commander_rank).toBe("2nd Lt.");
    expect(state.max_squad).toBe(5);
    const squad = await get("/squad");
    expect(squad.map((s: Any) => s.name)).toEqual([
      "Frank Hayes", "Walter Kowalski", "James Baker", "Chester Pruitt", "Raymond Boyd",
      "Earl Whitaker", "Leroy Novak",
    ]);
    expect(squad[0].rank).toBe("Cpl.");
    expect(squad[5].status).toBe("reserve");
    const summary = await get("/save/summary");
    expect(summary.exists).toBe(true);
    expect(summary.squad_size).toBe(5);
    expect(summary.fallen).toBe(2);
    const memorial = await get("/memorial");
    expect(memorial.map((m: Any) => m.name).sort()).toEqual(["Dale Mercer", "Otis Crane"]);
    expect(memorial[0].grave_x).not.toBeNull();
  });

  it("filing pays kill RP + reward, etches the fallen, and never pays twice", async () => {
    const squad = await get("/squad");
    const frank = squad.find((s: Any) => s.name === "Frank Hayes");
    const james = squad.find((s: Any) => s.name === "James Baker");
    const report = {
      mission_id: "op_01", victory: true, duration_sec: 200, battle_id: "local-test-1",
      fallen: [{ soldier_id: james.id, cause: "MG42 fire", kills: 2, damage_taken: 60 }],
      survivors: [{ soldier_id: frank.id, kills: 4, damage_taken: 10 }],
      loot_rp: 25, loot_item: "canteen",
    };
    const result = await post("/battle/complete", report);
    // 300 + 250 reward + (2 + 4) kills * 10 + 25 looted.
    expect(result.requisition).toBe(635);
    expect(result.mission_index).toBe(1);
    expect(result.memorial_names).toEqual(["James Baker"]);
    expect(result.points_gained[frank.id]).toBe(4);
    expect(result.items_gained).toContainEqual({ item: "canteen", source: "loot" });
    expect(result.items_gained.some((g: Any) => g.source === "mission")).toBe(true);
    const memorial = await get("/memorial");
    const jamesEntry = memorial.find((m: Any) => m.name === "James Baker");
    expect(jamesEntry.cause).toBe("MG42 fire");
    expect(jamesEntry.story).toContain("was killed by MG42 fire");
    expect(jamesEntry.grave_x).not.toBeNull();
    const again = await post("/battle/complete", report);
    expect(again.requisition).toBe(635);
    expect(again.memorial_names).toEqual([]);
    const state = await get("/state");
    expect(state.battles_won).toBe(1);
  });

  it("stores law holds locally: refusal text, guns unsold, the Recon's glasses", async () => {
    const squad = await get("/squad");
    const frank = squad.find((s: Any) => s.name === "Frank Hayes");
    await post("/inventory/buy", { item: "binoculars" });
    await expect(post("/squad/equip", { soldier_id: frank.id, item: "binoculars" })).rejects.toMatchObject({
      status: 400, body: { detail: "Only recon can carry that" },
    });
    await expect(post("/inventory/buy", { item: "fg42" })).rejects.toMatchObject({ status: 400 });
    const recon = await post("/squad/hire", { type: "recon" });
    const equipped = await post("/squad/equip", { soldier_id: recon.id, item: "binoculars" });
    expect(equipped.equipment).toEqual(["binoculars"]);
    expect(equipped.status).toBe("reserve"); // squad already fields 5 actives
  });

  it("the radio gate and the wipe behave like the server's", async () => {
    await expect(post("/battle/reinforce", { mission_id: "op_01", kind: "rifle" })).rejects.toMatchObject({
      status: 409, body: { detail: "Radio is down — no radioman in the squad" },
    });
    await expect(post("/campaign/wipe", { confirm: "no" })).rejects.toMatchObject({ status: 400 });
    await post("/squad/hire", { type: "rifleman" });
    const wiped = await post("/campaign/wipe", { confirm: "RESET" });
    expect(wiped.requisition).toBe(300);
    const squad = await get("/squad");
    expect(squad).toHaveLength(7);
    const memorial = await get("/memorial");
    expect(memorial).toHaveLength(0); // a wipe clears the wall; only a brand-new save is seeded with the two founding stones
  });

  it("ApiError carries the FastAPI shape the pages read", async () => {
    const e = await post("/inventory/buy", { item: "nope" }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(e.body.detail).toBe("Unknown item");
  });
});
