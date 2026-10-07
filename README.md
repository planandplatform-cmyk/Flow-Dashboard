# Flow Forward Media Client Portal

Client analytics portal for Flow Forward Media. Each client signs in with an
email link and sees their own marketing performance; FFM staff see every client.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4, Supabase (Postgres,
magic-link auth, row-level security), deployed on Vercel.

## Project layout

| Path | What it is |
| --- | --- |
| `src/lib/metrics/config.ts` | **Every metric**: display name, plain-language definition (tooltips), format, how it rolls up over a date range, and whether up is good. |
| `src/lib/metrics/aggregate.ts` | Rolls metrics up over any range. Ratios (engagement rate, CTR, CPL, frequency) are always recomputed from their parts, never averaged. |
| `src/lib/metrics/glossary.ts` | Key Terms glossary from the monthly report. |
| `src/lib/data/portal.ts` | All data reads. Queries run as the signed-in user, so RLS decides what comes back. |
| `src/app/c/[slug]` | Client report page, laid out like the monthly PDF, with date range, comparison and 12-month trend charts. |
| `src/lib/report` | Date range and comparison rules (`period.ts`) and monthly trend series (`trends.ts`). |
| `src/app/admin/c/[slug]/commentary` | Commentary editor with **Draft with AI**. The fact sheet the AI writes from is built in `src/lib/commentary/facts.ts`; the voice and rules are in `drafter.ts`. |
| `src/app/admin/c/[slug]/events` | Timeline events, shown as markers on every chart. |
| `src/app/admin/c/[slug]/activity` | Activity log: uploads, syncs, publishes and settings changes, from the append-only audit log. |
| `src/app/admin/c/[slug]/data` | FFM-only data page: file upload with preview, manual entry, upload history with rollback. |
| `src/lib/ingest` | File reading and one parser per platform export, plus AI reading of screenshots and PDFs (`screenshot.ts`, `screenshot-reader.ts`). See [docs/uploading-data.md](docs/uploading-data.md). |
| `supabase/migrations` | Schema and row-level security. |
| `supabase/seed.sql` | Demo client (Wieler Roofing). Generated, do not edit by hand. |
| `supabase/tests/rls.test.sql` | Proves a client user cannot read another client's data. |
| `supabase/tests/uploads.test.sql` | Proves upload commit and rollback restore data exactly. |
| `scripts/seed/wieler-roofing.ts` | Source numbers for the demo client, with provenance for each value. |
| `public/brand` | FFM logo and mark. |

## Run it locally

```bash
npm install
npm run dev
```

Without Supabase environment variables, the app runs in **demo mode** (development
only): no login, and it serves the seeded Wieler Roofing data from
`src/lib/demo/fixture.json`. Open http://localhost:3000.

## Checks

```bash
npm test            # metric math, report figures, copy rules
npm run test:rls    # schema, RLS, upload commit/rollback against a throwaway Postgres (needs Postgres binaries, no Docker)
npm run typecheck
npm run lint
npm run build
```

Regenerate the seed after editing `scripts/seed/wieler-roofing.ts`:

```bash
npm run seed:generate
```

## Setting up Supabase (one time)

1. **Create a project** at https://supabase.com (Pro plan recommended for daily backups).
2. **Create the tables.** In the Supabase dashboard open *SQL Editor*, paste all of
   `supabase/setup.sql` (every migration in one file) and press Run. Or, with the Supabase CLI:
   `supabase link --project-ref <ref>` then `supabase db push`.
   After later updates, run only the new files in `supabase/migrations`.
3. **Load the demo clients.** In the SQL Editor run `supabase/seed/01-wieler-roofing.sql`, then
   `supabase/seed/02-lubbock-med-spa.sql` (split in two because the editor rejects large queries;
   `supabase/seed.sql` is the same data in one file, for the CLI).
4. **Prove RLS works on the real database.** Paste and run `supabase/tests/rls.test.sql`,
   then `supabase/tests/uploads.test.sql`. They end with `RLS tests passed` and
   `Upload tests passed`, and roll everything back. (They expect the demo seed to be loaded.)
5. **Auth settings** (*Authentication* section):
   - *Sign In / Providers*: keep Email enabled, turn **off** "Allow new users to sign up".
     Only people FFM invites can sign in.
   - *URL Configuration*: set Site URL to the portal's address (for example
     `https://portal.flowforwardmedia.com`) and add `http://localhost:3000/**` to Redirect URLs.
   - *Emails → Templates → Magic Link*: change the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
     so links work even when opened on a different device than the one that asked for them.
   - *Emails → Templates → Invite user*: change the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
     (after signing in, client logins land straight on their own report).
   - *Emails → SMTP Settings*: connect a real sender (Resend, Postmark...). Supabase's
     built-in sender is heavily rate-limited and not meant for production.
6. **Environment variables** (Vercel project settings, and `.env.local` for local dev).
   Copy `.env.example`. Supabase values come from *Project Settings → API Keys*;
   `ANTHROPIC_API_KEY` (for reading screenshots and PDFs) from https://platform.claude.com.
7. **Make yourself an admin.** Invite yourself from *Authentication → Users → Invite user*,
   sign in once, then run in the SQL Editor:

   ```sql
   update public.users set role = 'ffm_admin' where email = 'you@flowforwardmedia.com';
   ```

   Everything after that happens in the portal.

## Deploying (Vercel)

The Vercel project builds automatically on every push to the production branch. Environment
variables live in Vercel under *Settings → Environment Variables*: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SITE_URL`, and optionally
`ANTHROPIC_API_KEY`. After changing a variable, redeploy (*Deployments → ⋯ → Redeploy*) for it to
take effect. Database changes are not deployed by Vercel: run new files in `supabase/migrations`
in the Supabase SQL Editor.

## Adding a client

1. On the client list, **+ New client**: name, market, time zone, and the channels this client
   uses (any mix of Website, Facebook, Instagram, Meta Ads, Shopify, TikTok, LinkedIn).
2. On the next screen, **invite** the people from that business. Each gets an email, signs in
   with their own address, and only ever sees that client. One person can be given access to
   several clients (an owner with two businesses sees a list to choose from).
3. **Manage data** to upload exports, screenshots or PDFs. Only the client's channels are accepted.

Channels can be changed later in **Settings**. Turning one off hides it from the report and keeps
its data. **Archive** hides a client from lists and blocks its logins (enforced in the database);
it can be restored. Admins invite and manage FFM staff under **Team**.

## Report views

The date picker on the report sets the range and the comparison, and both live in the URL, so
any view can be bookmarked or sent to a client:

| URL | Shows |
| --- | --- |
| `/c/wieler-roofing` | Latest month with published commentary (else latest month with data) vs the month before |
| `?month=2026-07` | July 2026 vs June 2026 |
| `?range=last_30` | Last 30 days, ending yesterday. Also `this_month`, `last_month`, `qtd`, `ytd`, `last_12` |
| `?range=custom&from=2026-04-01&to=2026-06-30` | Any range up to 3 years |
| `&compare=yoy` | Same period last year. Also `none`, or `custom&cfrom=…&cto=…` |

"Previous period" is the same stretch of time just before: a month compares with the month
before, quarter to date with the previous quarter to the same day, and day ranges with the same
number of days. Monthly commentary shows when the view is exactly one calendar month. Trend
charts cover the 12 months ending with the selected range, with the year before dashed and
annotated events marked.

## Monthly commentary

**Commentary** on a client (or from the client list) opens the editor for a month.

1. **Draft with AI** writes a headline, summary, a paragraph per channel, section notes, a
   conclusion and a recap email, from that month's numbers against the month before. It only
   uses the numbers shown in the panel on the right, keeps paid and organic apart, and follows
   the house rules: factual, no recommendations, no hype, no em dashes. Nothing is saved yet.
2. Edit anything. **Save draft** keeps it private to FFM; **Publish** shows it to the client.
   Published commentary can be updated or unpublished.
3. Copy the recap email into your email client. The portal never sends it.

Each draft costs a few cents and needs `ANTHROPIC_API_KEY`. Em dashes typed by hand are replaced
with commas on save. Every save, publish, AI draft, event change and upload is recorded in the
client's **Activity** log, which nobody can edit or delete.

The client list shows each client's health: how fresh the data is (flagged after 35 days), whether
last month's commentary is published, and failed syncs once connectors are running.

## Roles

| Role | Can see | Can change |
| --- | --- | --- |
| `ffm_admin` | Everything | Everything, including clients, users, connections |
| `ffm_staff` | Everything | Client data, uploads, commentary, annotations |
| `client_viewer` | Only linked clients; only published commentary | Nothing |

Platform credentials are stored in Supabase Vault and referenced by id; the
browser roles cannot read or write that column, even for admins.
