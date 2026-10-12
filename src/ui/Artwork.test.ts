import { describe, expect, it } from "vitest";
import { MISSION_LIST } from "../game/content";
import { buildingPortrait } from "./Artwork";
import { campaignLandmark as landmark } from "./CampaignArtwork";

describe("building portraits", () => {
  it("uses the rendered siege workshop portrait", () => {
    const markup = buildingPortrait("siegeWorkshop");
    expect(markup).toContain("assets/ui/buildings/siegeWorkshop-model.png");
    expect(markup).not.toContain("siegeWorkshop.svg");
  });
});

describe("campaign landmarks", () => {
  it("draws a genuinely different emblem for every stage", () => {
    const markups = MISSION_LIST.map((mission) => landmark(mission.theme));
    expect(new Set(markups).size).toBe(6);
    for (const [index, mission] of MISSION_LIST.entries()) {
      expect(markups[index]).toContain(`data-landmark="${mission.theme}"`);
    }
  });

  it("uses the real fortress and siege portraits with opposing banners for the finale", () => {
    const markups = MISSION_LIST.map((mission) => landmark(mission.theme));
    const finale = markups.at(-1)!;
    expect(finale).toContain("buildings/keep.png");
    expect(finale).toContain("buildings/siegeWorkshop-model.png");
    expect(finale).toContain("#188c84");
    expect(finale).toContain("#b4473f");
  });
});
