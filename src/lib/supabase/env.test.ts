import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "./env";

describe("Supabase URL from pasted values", () => {
  it("accepts the common ways people paste it", () => {
    for (const v of [
      "https://abcdefgh.supabase.co",
      "abcdefgh.supabase.co",
      " https://abcdefgh.supabase.co/ ",
      '"https://abcdefgh.supabase.co"',
      "https://abcdefgh.supabase.co/rest/v1/",
    ]) {
      expect(normalizeSupabaseUrl(v)).toBe("https://abcdefgh.supabase.co");
    }
    expect(normalizeSupabaseUrl("")).toBe("");
  });
});
