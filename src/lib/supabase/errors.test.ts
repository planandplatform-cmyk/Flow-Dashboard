import { describe, expect, it } from "vitest";
import { friendlyDbError } from "./errors";

describe("database errors", () => {
  it("names the update to run for a missing enum value", () => {
    const msg = friendlyDbError('invalid input value for enum public.breakdown_type: "format_views"');
    expect(msg).toContain("alter type public.breakdown_type add value if not exists 'format_views';");
  });
  it("passes other errors through", () => {
    expect(friendlyDbError("permission denied")).toBe("permission denied");
  });
});
