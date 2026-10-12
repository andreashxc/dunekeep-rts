import { describe, expect, it } from "vitest";
import { GameSimulation } from "../game/simulation";
import { CampaignPilot } from "./CampaignPilot";

function startedRiver() {
  const sim = new GameSimulation();
  sim.selectMission("river"); sim.start(); sim.beginPreparation();
  return sim;
}

describe("opt-in public-command campaign pilot", () => {
  it("does not start, select, or unpause a mission", () => {
    const sim = new GameSimulation();
    const pilot = new CampaignPilot(sim);
    pilot.update();
    expect(sim.snapshot.status).toBe("title");
    expect(pilot.diagnostics().actions).toBe(0);
    sim.selectMission("river"); sim.start();
    const before = sim.snapshot.resources;
    pilot.update();
    expect(sim.snapshot.preparationStarted).toBe(false);
    expect(sim.snapshot.resources).toEqual(before);
    sim.beginPreparation(); sim.togglePause();
    pilot.update();
    expect(sim.snapshot.status).toBe("paused");
    expect(pilot.diagnostics().actions).toBe(0);
  });

  it("spends ordinary building costs without advancing time and throttles repeated frame calls", () => {
    const sim = startedRiver();
    const pilot = new CampaignPilot(sim);
    const before = sim.snapshot;
    pilot.update();
    expect(sim.snapshot.raidClock).toBe(before.raidClock);
    expect(sim.snapshot.elapsed).toBe(before.elapsed);
    expect(sim.snapshot.timeScale).toBe(before.timeScale);
    expect(sim.snapshot.resources.wood).toBeLessThan(before.resources.wood);
    expect(pilot.diagnostics().actions).toBeGreaterThan(0);
    const report = pilot.diagnostics();
    for (let frame = 0; frame < 120; frame++) pilot.update();
    expect(pilot.diagnostics()).toEqual(report);
    // Only the host's normal game loop advances simulation time.
    for (let frame = 0; frame < 20; frame++) sim.tick(.05);
    pilot.update();
    expect(pilot.diagnostics().decisions).toBe(report.decisions+1);
    report.actionCounts.build = 999;
    expect(pilot.diagnostics().actionCounts.build).not.toBe(999);
  });

  it.each(["river", "ruins", "siege"] as const)("plays %s using normal host ticks and preserves the victory screen", mission => {
    const sim = new GameSimulation();
    sim.selectMission(mission); sim.start(); sim.beginPreparation();
    const pilot = new CampaignPilot(sim);
    for (let frame = 0; frame < 24000 && sim.snapshot.status === "playing"; frame++) {
      pilot.update();
      sim.tick(.05);
    }
    const report = pilot.diagnostics();
    console.info("local-campaign-pilot", JSON.stringify({mission,status:sim.snapshot.status,seconds:Math.round(sim.snapshot.raidClock),...report}));
    expect(sim.snapshot.status, JSON.stringify(report)).toBe("victory");
    expect(report.actionCounts.build).toBeGreaterThan(0);
    expect(report.actionCounts.recruit).toBeGreaterThan(0);
    if (mission !== "river") expect(report.actionCounts.order).toBeGreaterThan(0);
    expect(report.decisions).toBeLessThanOrEqual(Math.ceil(sim.snapshot.raidClock)+1);
    expect(report.actions).toBeLessThanOrEqual(report.decisions*4);
    const victoryClock = sim.snapshot.raidClock;
    pilot.update();
    expect(sim.snapshot.status).toBe("victory");
    expect(sim.snapshot.raidClock).toBe(victoryClock);
    expect(pilot.diagnostics().state).toBe("completed");
    // Continuing is a separate normal user action. The pilot never resets or
    // starts another mission and can safely maintain the resulting free build.
    expect(sim.continueAfterVictory()).toBe(true);
    for (let frame = 0; frame < 400; frame++) { sim.tick(.05); pilot.update(); }
    expect(sim.snapshot.missionId).toBe(mission);
    expect(sim.snapshot.missionCompleted).toBe(true);
    expect(sim.snapshot.status).toBe("playing");
  }, 30000);
});
