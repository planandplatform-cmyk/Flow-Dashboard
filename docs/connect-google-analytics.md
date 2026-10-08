# Connect Google Analytics (GA4) and Search Console

The portal pulls each client's website numbers from GA4 every night, and pulls
the last 13 months the moment a client is connected. It uses one Google
"service account": a robot login that can only read the GA4 properties you add
it to. Nothing in GA4 can be changed from the portal.

Cost: the GA4 Data API and Google Cloud project are free at this volume.

## One time: Google Cloud (about 10 minutes)

1. Go to https://console.cloud.google.com and sign in with the agency Google account.
2. Top bar, project picker, **New project**. Name it `FFM Portal`. Create, then select it.
3. Search bar: **Google Analytics Data API**. Open it and click **Enable**.
4. Menu, **IAM & Admin**, **Service accounts**, **Create service account**.
   Name: `flow-portal`. Click **Create and continue**, skip the optional role and
   user steps, then **Done**.
5. Click the new service account, **Keys** tab, **Add key**, **Create new key**,
   **JSON**, **Create**. A `.json` file downloads. Treat it like a password.
6. Copy the service account email (looks like
   `flow-portal@ffm-portal.iam.gserviceaccount.com`).

If Google blocks step 5 with "Service account key creation is disabled", your
organization has a policy against keys: in **IAM & Admin**, **Organization
policies**, find `iam.disableServiceAccountKeyCreation` and turn enforcement off
for this project (needs an organization admin).

## One time: Vercel

Project, **Settings**, **Environment Variables**, add for Production:

| Name | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Open the `.json` file in a text editor, copy everything, paste it |
| `CRON_SECRET` | Any long random string (for example from https://1password.com/password-generator) |
| `SUPABASE_SECRET_KEY` | Already set if invites work |

Then **Deployments**, latest, **Redeploy**. The nightly job runs at 5 AM Central
(`vercel.json`). Once a day is all this needs, so it works on any Vercel plan
(Pro is still the right plan for commercial use).

## Each client

1. In the client's GA4: **Admin** (gear), **Property access management**, **+**,
   **Add users**. Paste the service account email, role **Viewer**, uncheck
   "Notify", **Add**. (You need Administrator access on the property.)
2. In GA4 **Admin**, **Property details**, copy the **Property ID** (numbers
   only, like `412345678`; not the `G-` measurement ID).
3. In the portal: client, **Settings**, **Automatic data**, paste the Property
   ID, **Connect**. It checks access, then pulls the last 13 months (under a
   minute).

## What it pulls

- Daily: sessions, engaged sessions (engagement rate), key events, page views,
  visitors, and sessions by channel.
- Monthly: exact unique visitors, visitors by channel, top 50 landing pages,
  top 50 pages by views.
- The last 30 days are re-pulled every night, so late GA4 processing settles on
  its own.

Pulled numbers replace any GA4 numbers uploaded for the same dates. Uploads
still work for every other channel.

## If something goes wrong

The Settings card shows the last error in plain English, and each sync is listed
under **Recent syncs**. Common fixes:

- "cannot see this GA4 property": step 1 above was skipped or used another email.
- "API is not turned on": step 3 of the Google Cloud setup.
- "property ID was not found": the `G-` ID was used instead of the Property ID.
- Search Console "cannot see this site": the email was not added in Search
  Console, or the site does not match. The error lists the sites the portal can
  see, so copy one of those.

## What it pulls (GA4, continued)

- Average time on site (engagement time per visit), overall, by channel and by
  landing page.
- Online sales, orders, average order value and order rate, for sites with
  GA4 ecommerce tracking (Shopify and other stores). The Online sales row only
  appears when GA4 has sales.

# Google Search Console (search rankings)

Search Console shows which Google searches a client's website appears for,
where it ranks, and how many people click. It is its own channel: turn on
**Google Search** for a client under Settings, Details and channels.

## One time: Google Cloud

In the same `FFM Portal` project, search **Google Search Console API** and click
**Enable**. Nothing changes in Vercel; the same service account key is used.

## Each client

1. In the client's Search Console (https://search.google.com/search-console),
   pick the site, then **Settings**, **Users and permissions**, **Add user**.
   Paste the service account email, permission **Restricted**, **Add**. (You need
   Owner access to the site.)
2. Note the site exactly as Search Console lists it: `example.com` for a domain
   property, or `https://www.example.com/` for a URL-prefix property.
3. In the portal: client, **Settings**, **Automatic data**, **Google Search
   Console**, paste the site, **Connect**. It pulls the last 13 months.

## What it pulls

- Daily: clicks, impressions, average position and click rate for the site.
- Monthly: the top 100 search terms and top 50 pages, each with clicks,
  impressions, click rate and average position.

Search Console data runs 2 to 3 days behind, so the last few days fill in over
the next nightly syncs. The report shows a **Google Search Rankings** section
when there is data.
