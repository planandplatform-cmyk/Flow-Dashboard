import { describe, expect, it } from "vitest";
import { normalizeEmail, parseClientForm, slugify } from "./form";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

describe("client settings form", () => {
  it("accepts a client with its own set of channels", () => {
    const { values, errors } = parseClientForm(
      form({ name: "Lubbock Med Spa & Wellness", market: "Lubbock, TX", timezone: "America/Chicago", brand_color: "#aa33cc", enabled_sources: ["meta_instagram", "ga4", "meta_facebook"] }),
    );
    expect(errors).toEqual({});
    expect(values.slug).toBe("lubbock-med-spa-and-wellness");
    expect(values.brand_color).toBe("#AA33CC");
    // Stored in a fixed order regardless of how the boxes were ticked.
    expect(values.enabled_sources).toEqual(["ga4", "meta_facebook", "meta_instagram"]);
  });

  it("requires a name and at least one channel, and ignores unknown channels", () => {
    const { values, errors } = parseClientForm(form({ name: "", enabled_sources: ["snapchat"] }));
    expect(errors.name).toBeDefined();
    expect(errors.enabled_sources).toBeDefined();
    expect(values.enabled_sources).toEqual([]);
  });

  it("rejects bad slugs, colors, logo links and time zones", () => {
    const { errors } = parseClientForm(
      form({ name: "Ok Name", slug: "Bad Slug!", brand_color: "teal", logo_url: "http://x.com/logo.png", timezone: "Mars/Base", enabled_sources: "ga4" }),
    );
    expect(Object.keys(errors).sort()).toEqual(["brand_color", "logo_url", "slug", "timezone"]);
  });

  it("makes clean slugs and emails", () => {
    expect(slugify("  Café Olé -- Dallas!! ")).toBe("cafe-ole-dallas");
    expect(normalizeEmail(" Owner@WielerRoofing.com ")).toBe("owner@wielerroofing.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
