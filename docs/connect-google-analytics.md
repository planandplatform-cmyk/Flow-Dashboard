# Connect Google Analytics (GA4)

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
