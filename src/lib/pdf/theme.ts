/**
 * PDF color themes. The dark theme uses the same values as the design tokens
 * in src/app/globals.css (the PDF renderer cannot read CSS variables). The
 * print theme is white with charcoal text; the core teal is too light for
 * text on white, so figures use a deeper teal there and the bright teal is
 * kept for rules, bars and chart lines.
 */
export interface PdfTheme {
  name: "dark" | "print";
  page: string;
  surface: string;
  raised: string;
  line: string;
  grid: string;
  fg: string;
  fgSecondary: string;
  fgMuted: string;
  /** Rules, bars, chart lines. */
  accent: string;
  /** Large figures and teal labels. */
  accentText: string;
  /** Comparison series and secondary accents. */
  accentDeep: string;
  heroBg: string;
  heroText: string;
  tableHead: string;
  tableHeadText: string;
  positive: string;
  negative: string;
  conclusionBg: string;
  conclusionText: string;
  logo: "ffm-logo-dark.png" | "ffm-logo-print.png";
}

export const DARK: PdfTheme = {
  name: "dark",
  page: "#000000",
  surface: "#111111",
  raised: "#1a1a1a",
  line: "#262626",
  grid: "#1f1f1f",
  fg: "#ffffff",
  fgSecondary: "#a3a3a3",
  fgMuted: "#858585",
  accent: "#31e4e4",
  accentText: "#31e4e4",
  accentDeep: "#0c8888",
  heroBg: "#073f3f",
  heroText: "#c9f8f8",
  tableHead: "#1a1a1a",
  tableHeadText: "#a3a3a3",
  positive: "#4ade80",
  negative: "#f87171",
  conclusionBg: "#111111",
  conclusionText: "#a3a3a3",
  logo: "ffm-logo-dark.png",
};

/** Matches FFM's printed reports: cool gray page, white cards, teal summary card, charcoal tables. */
export const PRINT: PdfTheme = {
  name: "print",
  page: "#f3f6f6",
  surface: "#ffffff",
  raised: "#f3f6f6",
  line: "#e1e8e8",
  grid: "#e6ecec",
  fg: "#1a1a1a",
  fgSecondary: "#4a4a4a",
  fgMuted: "#6b6b6b",
  accent: "#31e4e4",
  accentText: "#0a6e6e",
  accentDeep: "#8cf0f0",
  heroBg: "#31e4e4",
  heroText: "#0b2424",
  tableHead: "#1a1a1a",
  tableHeadText: "#ffffff",
  positive: "#15803d",
  negative: "#b91c1c",
  conclusionBg: "#1a1a1a",
  conclusionText: "#e5e5e5",
  logo: "ffm-logo-print.png",
};
