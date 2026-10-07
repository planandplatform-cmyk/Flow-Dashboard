import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { extractionSchema, metricGuide, type Extraction, type ScreenshotPlatform } from "./screenshot";

const MODEL = "claude-opus-5-5";

export type ScreenshotImage = { data: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

export class ScreenshotReadError extends Error {}

export function screenshotReadingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You transcribe numbers from social media and ad analytics screenshots for a marketing agency's reporting portal.

Report only numbers that are printed on screen. Never estimate, calculate, or fill in a value from a chart's shape. If a number is cut off, blurry, or ambiguous, leave it out and say so in notes, or report it with low confidence.

Report the totals for the selected date range. Ignore comparison figures (percent changes, "vs previous period" values, previous-period totals) and ignore rates such as engagement rate, CTR, or cost per result: the portal calculates those itself.

Use only the metric keys you are given. If the same metric appears in more than one screenshot with the same value, report it once.`;

/**
 * Ask Claude to read the screenshots. Returns the structured reading; the
 * caller turns it into review items and nothing is saved until a person
 * confirms the values.
 */
export async function readScreenshots(images: ScreenshotImage[], platform: ScreenshotPlatform, today: string): Promise<Extraction> {
  const client = new Anthropic();
  const instructions = `Platform: ${SOURCE_LABELS[platform]}. Today is ${today}; use it to resolve dates shown without a year.

Metric keys you may report, with the labels this platform uses:
${metricGuide(platform)}

Also report any audience or discovery breakdowns shown as percentages (age, gender, country, city, language, where views came from such as Feed or Reels, followers vs non-followers, engagement by content format, and for LinkedIn job function, seniority, industry, company size).

Report the date range shown in the screenshots as exact dates if visible. If only a relative range such as "Last 28 days" is shown, set date_range to null and put that text in notes.`;

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
            ...images.flatMap((img, i) => [
              { type: "text" as const, text: `Screenshot ${i + 1}:` },
              { type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } },
            ]),
            { type: "text", text: instructions },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ScreenshotReadError("The Anthropic API key is missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new ScreenshotReadError("Too many requests right now. Wait a minute and try again.");
    if (error instanceof Anthropic.BadRequestError) throw new ScreenshotReadError(`The screenshots could not be read: ${error.message}`);
    if (error instanceof Anthropic.APIError) throw new ScreenshotReadError(`The AI service returned an error (${error.status}). Try again.`);
    throw new ScreenshotReadError("Could not reach the AI service. Try again.");
  }

  if (response.stop_reason === "refusal") throw new ScreenshotReadError("The AI declined to read these images.");
  if (response.stop_reason === "max_tokens") throw new ScreenshotReadError("The screenshots had too much on them to read at once. Upload fewer at a time.");
  if (!response.parsed_output) throw new ScreenshotReadError("The AI's answer could not be understood. Try again.");
  return response.parsed_output;
}
