import { describe, expect, it } from "vitest";
import { activityGroup, describeActivity } from "./activity";

describe("activity log wording", () => {
  it("describes uploads, commentary, events and syncs", () => {
    expect(describeActivity("upload.commit", { kind: "file", file_name: "ga4-sept.csv", source: "ga4", inserted: 1240, updated: 0 })).toBe(
      "Uploaded ga4-sept.csv (Website): 1,240 new, 0 updated",
    );
    expect(describeActivity("upload.commit", { kind: "manual", source: "meta_facebook", inserted: 3, updated: 1 })).toBe(
      "Entered Facebook numbers by hand: 3 new, 1 updated",
    );
    expect(describeActivity("commentary.publish", { month: "2026-07-01" })).toBe("Published commentary for July 2026");
    expect(describeActivity("event.create", { label: "New website launched" })).toBe("Added event: New website launched");
    expect(describeActivity("client.update", { turned_on: ["linkedin"], turned_off: [] })).toBe("Updated settings: turned on LinkedIn");
    expect(describeActivity("sync.scheduled", { source: "meta_ads", period_start: "2026-09-07", period_end: "2026-10-06", rows: 420 })).toBe(
      "Nightly sync of Meta Ads, Sep 7 to Oct 6, 2026: 420 values",
    );
  });

  it("groups actions for the filters", () => {
    expect(activityGroup("upload.rollback")).toBe("uploads");
    expect(activityGroup("sync.manual")).toBe("syncs");
    expect(activityGroup("client.user_added")).toBe("settings");
  });
});
