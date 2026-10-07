import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cleanCopy } from "./copy";
import { factsToText, type MonthFacts } from "./facts";

const MODEL = "claude-opus-5-5";

export class DraftError extends Error {}

export function draftingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Sections the report shows notes for, when it has data for them. */
export const NOTE_SECTIONS = ["content", "demographics", "discovery", "video"] as const;

const schema = z.object({
  headline: z.string().describe("Six to twelve words. The single biggest factual takeaway of the month."),
  summary: z.string().describe("Two or three short paragraphs separated by a blank line."),
  platforms: z
    .array(
      z.object({
        section_id: z.string().describe("The section id from the fact sheet, e.g. meta_facebook, ga4, meta_ads"),
        headline: z.string().describe("Short headline led by the most important number"),
        body: z.string().describe("Two to four sentences"),
      }),
    )
    .describe("One entry per channel section in the fact sheet, except the combined section."),
  section_notes: z.object({
    content: z.string().nullable().describe("One or two sentences on top posts and formats, or null if no post data"),
    demographics: z.string().nullable().describe("One or two sentences on audience shares, or null if none"),
    discovery: z.string().nullable().describe("One or two sentences on where views came from, or null if none"),
    video: z.string().nullable().describe("One or two sentences on Reels or short-form video, or null if none"),
  }),
  conclusion: z.string().describe("Three or four sentences of factual outcomes"),
  recap_email: z.object({
    subject: z.string(),
    body: z.string().describe("The email body, from the greeting to the sign-off"),
  }),
});
export type Draft = z.infer<typeof schema>;

const SYSTEM = `You write the monthly performance commentary that Flow Forward Media, a Dallas digital marketing agency, publishes in each client's analytics portal.

Voice: composed, direct, premium agency voice. Confident and results-focused, in plain language a business owner understands. Complete sentences, short paragraphs. Tie numbers to business outcomes such as leads, website visits, and reach in the client's market.

Rules, all mandatory:
- Use only the numbers in the fact sheet, written exactly as given. Never estimate, calculate new figures, or round differently.
- Use each platform's metric names as given. Keep paid (Meta Ads) and organic results clearly separate.
- Do not blend different metrics across platforms. The combined totals in the fact sheet may be quoted as they are.
- A zero or flat value is a baseline, never a failure.
- If a value has no comparable prior value, do not describe it as a change.
- Factual and observational only. No recommendations, next steps, suggestions, or advice, and no words like "should", "we recommend", or "consider". This applies to the conclusion too.
- No em dashes or en dashes anywhere. Use commas, periods, or "to" for ranges.
- No hype, exclamation points, emoji, or filler. Never mention AI. The commentary is from Flow Forward Media.
- Events logged by Flow Forward Media (for example a budget change) may be used to explain what happened, stated as facts.`;

export async function draftCommentary(facts: MonthFacts, opts: { reportUrl: string; signer: string }): Promise<Draft> {
  const client = new Anthropic();
  const instructions = `Write the commentary for ${facts.clientName}, ${facts.monthLabel}.

Fact sheet:
${factsToText(facts)}

Also write the short recap email Flow Forward Media sends the client when the report is published. Shape:
Subject: ${facts.monthLabel.split(" ")[0]} Analytics Report, ${facts.clientName}
Body: "Hi [First name]," then one or two sentences saying the ${facts.monthLabel.split(" ")[0]} report is ready in their portal at ${opts.reportUrl} and what it covers compared with ${facts.previousLabel}, then "Quick highlight:" with one factual takeaway, then an invitation to reply with questions or hop on a quick call, then "Thanks," and the sign-off:
${opts.signer}
Flow Forward Media`;

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      // If the model declines, the API retries on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: instructions }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new DraftError("The Anthropic API key is missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new DraftError("Too many requests right now. Wait a minute and try again.");
    if (error instanceof Anthropic.APIError) throw new DraftError(`The AI service returned an error (${error.status}). Try again.`);
    throw new DraftError("Could not reach the AI service. Try again.");
  }
  if (response.stop_reason === "refusal") throw new DraftError("The AI declined to write this draft.");
  if (response.stop_reason === "max_tokens") throw new DraftError("The draft ran too long. Try again.");
  const draft = response.parsed_output;
  if (!draft) throw new DraftError("The AI's answer could not be understood. Try again.");
  return tidyDraft(draft, facts);
}

/** Apply the copy rules and drop narratives for sections that do not exist. */
export function tidyDraft(draft: Draft, facts: MonthFacts): Draft {
  const ids = new Set(facts.sections.map((s) => s.id).filter((id) => id !== "combined"));
  const note = (v: string | null) => (v && v.trim() ? cleanCopy(v) : null);
  return {
    headline: cleanCopy(draft.headline).replace(/!+/g, "."),
    summary: cleanCopy(draft.summary),
    platforms: draft.platforms
      .filter((p) => ids.has(p.section_id as never))
      .map((p) => ({ section_id: p.section_id, headline: cleanCopy(p.headline), body: cleanCopy(p.body) })),
    section_notes: {
      content: note(draft.section_notes.content),
      demographics: note(draft.section_notes.demographics),
      discovery: note(draft.section_notes.discovery),
      video: note(draft.section_notes.video),
    },
    conclusion: cleanCopy(draft.conclusion),
    recap_email: { subject: cleanCopy(draft.recap_email.subject), body: cleanCopy(draft.recap_email.body) },
  };
}
