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
| `src/app/c/[slug]` | Client report page, laid out like the monthly PDF. |
| `src/app/admin/c/[slug]/data` | FFM-only data page: file upload with preview, manual entry, upload history with rollback. |
| `src/lib/ingest` | File reading and one parser per platform export. See [docs/uploading-data.md](docs/uploading-data.md). |
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
2. **Run the migrations.** In the Supabase dashboard open *SQL Editor*, paste and run each
   file in `supabase/migrations` in filename order. Or, with the Supabase CLI:
   `supabase link --project-ref <ref>` then `supabase db push`.
3. **Load the demo client.** Paste and run `supabase/seed.sql` in the SQL Editor.
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
   - *Emails → SMTP Settings*: connect a real sender (Resend, Postmark...). Supabase's
     built-in sender is heavily rate-limited and not meant for production.
6. **Environment variables** (Vercel project settings, and `.env.local` for local dev).
   Copy `.env.example`. Values come from *Project Settings → API Keys*.
7. **Make yourself an admin.** Invite yourself from *Authentication → Users → Invite user*,
   then run in the SQL Editor:

   ```sql
   update public.users set role = 'ffm_admin' where email = 'you@flowforwardmedia.com';
   ```

   To give a client access to their report (admin screens for this arrive in Phase 4):

   ```sql
   insert into public.user_clients (user_id, client_id)
   select u.id, c.id from public.users u, public.clients c
   where u.email = 'owner@wielerroofing.com' and c.slug = 'wieler-roofing';
   ```

## Roles

| Role | Can see | Can change |
| --- | --- | --- |
| `ffm_admin` | Everything | Everything, including clients, users, connections |
| `ffm_staff` | Everything | Client data, uploads, commentary, annotations |
| `client_viewer` | Only linked clients; only published commentary | Nothing |

Platform credentials are stored in Supabase Vault and referenced by id; the
browser roles cannot read or write that column, even for admins.
