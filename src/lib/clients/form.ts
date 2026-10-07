/**
 * Client settings form: validation shared by the create and edit screens.
 * Pure, so it is unit tested.
 */
import { DATA_SOURCES, type DataSource } from "@/lib/metrics/types";

export const TIMEZONES = [
  { value: "America/Chicago", label: "Central (Dallas, Chicago)" },
  { value: "America/New_York", label: "Eastern (New York, Miami)" },
  { value: "America/Denver", label: "Mountain (Denver, El Paso)" },
  { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles, Seattle)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

/** What each channel means, in plain words, for the settings screen. */
export const SOURCE_DESCRIPTIONS: Record<DataSource, string> = {
  ga4: "Google Analytics 4: website visits, engagement, key events",
  meta_facebook: "Facebook Page: views, engagement, followers",
  meta_instagram: "Instagram account: views, engagement, followers",
  meta_ads: "Meta Ads: leads, spend, reach, cost per lead",
  shopify: "Shopify store: sales, orders, customers",
  tiktok: "TikTok account: video views, engagement, followers",
  linkedin: "LinkedIn company page: impressions, engagement, followers",
};

export interface ClientFormValues {
  name: string;
  slug: string;
  market: string | null;
  timezone: string;
  brand_color: string | null;
  logo_url: string | null;
  enabled_sources: DataSource[];
}

export type FieldErrors = Partial<Record<keyof ClientFormValues, string>>;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function parseClientForm(form: FormData): { values: ClientFormValues; errors: FieldErrors } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const errors: FieldErrors = {};

  const name = text("name");
  if (name.length < 2) errors.name = "Enter the business name.";
  else if (name.length > 80) errors.name = "Keep the name under 80 characters.";

  const slug = text("slug") || slugify(name);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    errors.slug = "Use lowercase letters, numbers and single dashes, like wieler-roofing.";
  }

  const market = text("market") || null;
  if (market && market.length > 80) errors.market = "Keep the market under 80 characters.";

  const timezone = text("timezone") || "America/Chicago";
  if (!TIMEZONES.some((t) => t.value === timezone)) errors.timezone = "Choose a time zone.";

  let brand_color = text("brand_color") || null;
  if (brand_color && !/^#[0-9a-fA-F]{6}$/.test(brand_color)) errors.brand_color = "Use a hex color like #31E4E4.";
  if (brand_color) brand_color = brand_color.toUpperCase();

  const logo_url = text("logo_url") || null;
  if (logo_url) {
    try {
      if (new URL(logo_url).protocol !== "https:") errors.logo_url = "The logo link must start with https://";
    } catch {
      errors.logo_url = "Enter a full link to the logo image, starting with https://";
    }
  }

  const picked = form.getAll("enabled_sources").map(String);
  const enabled_sources = DATA_SOURCES.filter((s) => picked.includes(s));
  if (enabled_sources.length === 0) errors.enabled_sources = "Turn on at least one channel.";

  return { values: { name, slug, market, timezone, brand_color, logo_url, enabled_sources }, errors };
}

export function normalizeEmail(raw: FormDataEntryValue | null): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null;
}
