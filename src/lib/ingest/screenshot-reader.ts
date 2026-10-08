import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { reportGuide, reportSchema, type ReportExtraction } from "./report-import";
import { extractionSchema, metricGuide, type Extraction, type ScreenshotPlatform } from "./screenshot";

const MODEL = "claude-opus-5-5";

/** A screenshot or a PDF report: a short-lived link to it in Storage, or (demo mode) its base64 data. */
export type ScreenshotImage = {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
} & ({ url: string; data?: undefined } | { data: string; url?: undefined });

/** The content block for one file. */
function fileBlock(img: ScreenshotImage): Anthropic.Beta.BetaContentBlockParam {
  if (img.mediaType === "application/pdf") {
    return img.url
      ? { type: "document", source: { type: "url", url: img.url } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.data! } };
  }
  return img.url
    ? { type: "image", source: { type: "url", url: img.url } }
    : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data! } };
}

export class ScreenshotReadError extends Error {}

export function screenshotReadingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You transcribe numbers from analytics screenshots and PDF reports (social media, ads, website analytics) for a marketing agency's reporting portal.

Report only numbers that are printed on screen. Durations such as watch time are reported in minutes (4h 58m is 298). Never estimate, calculate, or fill in a value from a chart's shape. If a number is cut off, blurry, or ambiguous, leave it out and say so in notes, or report it with low confidence.

Report the totals for the selected date range. Ignore comparison figures (percent changes, "vs previous period" values, previous-period totals) and ignore rates such as engagement rate, CTR, or cost per result: the portal calculates those itself.

Use only the metric keys you are given. If the same metric appears in more than one file with the same value, report it once. A PDF counts as one file; report its position in the list, not a page number.`;

/**
 * Ask Claude to read the screenshots and PDFs. Returns the structured reading; the
 * caller turns it into review items and nothing is saved until a person
 * confirms the values.
 */
export async function readScreenshots(images: ScreenshotImage[], platform: ScreenshotPlatform, today: string): Promise<Extraction> {
  const client = new Anthropic();
  const instructions = `Platform: ${SOURCE_LABELS[platform]}. Today is ${today}; use it to resolve dates shown without a year.

Metric keys you may report, with the labels this platform uses:
${metricGuide(platform)}

Also report any audience or discovery breakdowns shown as percentages (age, gender, country, city, language, where views came from such as Feed or Reels, followers vs non-followers, engagement by content format, views by content type when shown as percentages (format_views), and for LinkedIn job function, seniority, industry, company size).

For LinkedIn Competitors analytics (tables ranking companies by Total followers, New followers, Total post metrics, or Total engagement metrics), report every company row in competitors: posts for Total post metrics, engagements for Total engagement metrics. Mark the row labeled "Your Page". Report the percent change under each value if shown, negative for a down arrow.

Report the date range shown in the files as exact dates if visible. If only a relative range such as "Last 28 days" is shown, set date_range to null and put that text in notes.`;

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Reading small numbers on dense dashboards benefits from more care.
      output_config: { effort: "high", format: betaZodOutputFormat(extractionSchema(platform)) },
      // If the model declines, the API retries on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images.flatMap((img, i): Anthropic.Beta.BetaContentBlockParam[] => [
              { type: "text", text: `File ${i + 1} (${img.mediaType === "application/pdf" ? "PDF" : "screenshot"}):` },
              fileBlock(img),
            ]),
            { type: "text", text: instructions },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ScreenshotReadError("The Anthropic API key is missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new ScreenshotReadError("Too many requests right now. Wait a minute and try again.");
    if (error instanceof Anthropic.BadRequestError) throw new ScreenshotReadError(`The files could not be read: ${error.message}`);
    if (error instanceof Anthropic.APIError) throw new ScreenshotReadError(`The AI service returned an error (${error.status}). Try again.`);
    throw new ScreenshotReadError("Could not reach the AI service. Try again.");
  }

  if (response.stop_reason === "refusal") throw new ScreenshotReadError("The AI declined to read these files.");
  if (response.stop_reason === "max_tokens") throw new ScreenshotReadError("These files had too much on them to read at once. Upload fewer at a time, or only the pages with the numbers.");
  if (!response.parsed_output) throw new ScreenshotReadError("The AI's answer could not be understood. Try again.");
  return response.parsed_output;
}

const REPORT_SYSTEM = `You transcribe a complete monthly analytics report (website, social media, ads) into structured data for a marketing agency's reporting portal.

Report only numbers printed in the report, exactly as printed. Never estimate or calculate. Each metric belongs to the platform section it appears in; use the metric keys for that platform only. If a metric appears in several places with the same value (summary page and detail page), report it once.

Skip percent changes, prior-period values, and rates such as engagement rate, CTR, DAU/MAU, or cost per result: the portal calculates rates itself. Durations are reported in minutes.

For LinkedIn, report Reactions, Comments, and Reposts as their own keys; report New followers as li_net_new_followers and Total followers as li_followers. For website tables, report each row of sessions by channel, sessions by landing page, and views by page path in table_rows.

Copy the report's own headline or key takeaway, executive summary, and conclusion into commentary, word for word.`;

/** Read a full multi-channel report PDF for the client's channels. */
export async function readReport(file: ScreenshotImage, platforms: ScreenshotPlatform[], today: string): Promise<ReportExtraction> {
  const client = new Anthropic();
  const instructions = `Today is ${today}. The client's channels: ${platforms.map((p) => SOURCE_LABELS[p]).join(", ")}. Ignore sections for other channels and say so in notes.

Metric keys you may report, by platform, with the labels each platform uses:
${reportGuide(platforms)}

Also report audience and discovery shares as percentages in breakdowns with their platform (age, gender, country, city, language, job function, seniority, industry, company size, where views came from, followers vs non-followers, engagement or views by content type). Website users by country go under platform ga4 as country shares. LinkedIn follower or visitor tables with counts and percentages: report the percentages.

LinkedIn competitor rankings (new followers, total followers, posts, engagements, each with a change) go in competitors.

Report the reporting period as exact dates.`;

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 20000,
      output_config: { effort: "high", format: betaZodOutputFormat(reportSchema(platforms)) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: REPORT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            fileBlock(file),
            { type: "text", text: instructions },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ScreenshotReadError("The Anthropic API key is missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new ScreenshotReadError("Too many requests right now. Wait a minute and try again.");
    if (error instanceof Anthropic.BadRequestError) throw new ScreenshotReadError(`The report could not be read: ${error.message}`);
    if (error instanceof Anthropic.APIError) throw new ScreenshotReadError(`The AI service returned an error (${error.status}). Try again.`);
    throw new ScreenshotReadError("Could not reach the AI service. Try again.");
  }
  if (response.stop_reason === "refusal") throw new ScreenshotReadError("The AI declined to read this report.");
  if (response.stop_reason === "max_tokens") throw new ScreenshotReadError("This report has too much in it to read at once. Split it into the website and social pages and import each.");
  if (!response.parsed_output) throw new ScreenshotReadError("The AI's answer could not be understood. Try again.");
  return response.parsed_output;
}
