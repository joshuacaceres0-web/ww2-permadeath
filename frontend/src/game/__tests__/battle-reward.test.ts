// RP every battle, win or lose, based on kills: every kill by one of
// your squad men pays 10 RP, win or lose. A win adds the mission
// reward on top. More kills means more RP, so a loss with a lot of
// kills still pays well.
import { describe, expect, it } from "vitest";
import { battleReward, KILL_RP } from "../data";

describe("battle reward", () => {
  it("a kill pays 10 RP, win or lose", () => {
    expect(KILL_RP).toBe(10);
    expect(battleReward(250, false, 1)).toBe(10);
    expect(battleReward(250, true, 1)).toBe(260);
  });

  it("a win adds the mission reward on top of the kill RP", () => {
    expect(battleReward(250, true, 15)).toBe(400);
    expect(battleReward(400, true, 15)).toBe(550);
    expect(battleReward(650, true, 15)).toBe(800);
    expect(battleReward(1000, true, 15)).toBe(1150);
  });

  it("a loss pays the kill RP only, and a loss with a lot of kills pays well", () => {
    expect(battleReward(250, false, 15)).toBe(150);
    expect(battleReward(1000, false, 15)).toBe(150);
    expect(battleReward(250, false, 20)).toBe(200);
  });

  it("loot from supply crates adds on top, win or lose", () => {
    expect(battleReward(250, true, 15, 50)).toBe(450);
    expect(battleReward(250, false, 15, 25)).toBe(175);
    expect(battleReward(250, false, 0, 50)).toBe(50);
    expect(battleReward(250, true, 0, 0)).toBe(250);
  });

  it("no kills means no RP on a loss, and more kills always means more RP", () => {
    expect(battleReward(250, false, 0)).toBe(0);
    expect(battleReward(250, true, 0)).toBe(250);
    for (const reward of [250, 400, 650, 1000]) {
      expect(battleReward(reward, false, 10)).toBeLessThan(battleReward(reward, false, 20));
      expect(battleReward(reward, true, 10)).toBeLessThan(battleReward(reward, true, 20));
      expect(battleReward(reward, false, 10)).toBeLessThan(battleReward(reward, true, 10));
    }
  });
});
