# Uploading client data

Where: open a client, then **Manage data** (top right), or **Manage data** on the client
list. Only FFM staff see this.

1. **Upload a file.** Choose the export, press **Preview**. Nothing is saved yet.
2. Check the **Totals in this file** against what the platform shows. The preview also says how
   many existing values would be replaced.
3. Press **Save**. The original file is kept, and every save appears in **Upload history**,
   where it can be **rolled back**. Rolling back removes what that upload added and restores
   any values it replaced (unless a newer upload has replaced them again).

Uploading the same report twice is safe: values for the same days are replaced, not added
twice. The platform is detected automatically; pick it by hand only if the preview gets it wrong.

**Period covered** is only needed when a file has no dates in it (the preview tells you).

## Which export to use

Exports with a **day-by-day** breakdown are best: they work with any date range the client
picks. Monthly totals work too, but a custom range that cuts through a month is shown as an
estimate.

### Google Analytics 4 (Website)
GA4 > **Reports** > pick the report > set the date range > **Share this report** (top right)
> **Download File** > **Download CSV**.

| Report | Gives |
| --- | --- |
| Acquisition > Traffic acquisition | Sessions, engaged sessions, key events by channel, plus site totals |
| Engagement > Landing page | Sessions and key events by landing page |
| Engagement > Pages and screens | Views by page |

For daily numbers, add **Date** as a dimension in an Exploration and export that.

### Facebook and Instagram (Meta Business Suite)
Business Suite > **Insights**, choose Facebook or Instagram:

- **Overview/Results > Export data**: one file per metric (Views, Reach, Content interactions,
  Visits, Follows). Upload each file.
- **Content > Export**: one row per post, used for the top posts table.

If the preview can't tell Facebook from Instagram, choose the platform and preview again.
Follower totals, demographics (age, gender, country, language) and discovery (Feed vs Reels,
non-followers) are easiest to enter with **Enter manually**.

### Meta Ads (Ads Manager)
Ads Manager > Campaigns > set the date range > **Reports > Export table data** (CSV or Excel).
Include the columns **Amount spent**, **Impressions**, **Reach**, **Link clicks** and **Leads**
(or Results with a lead result type).

- Without a day breakdown you get exact **reach** for the date range. Do this every month.
- With **Breakdown > By time > Day** you also get daily numbers for custom ranges.

Reach can't be added up across campaigns (the same person can see several campaigns). With more
than one campaign, export at account level or enter total reach with **Enter manually**.

### Google Ads
Google Ads > **Campaigns** > set the date range > **Download** (the arrow above the table) > **CSV**
or **Excel .csv**. Keep the Cost, Impr., Clicks, Conversions and Conv. value columns.

- Without a Day segment: totals for the date range shown at the top of the file, per campaign.
- With **Segment > Time > Day**: daily numbers, so any date range works.

**Search terms** and **Keywords** reports (Insights and reports > Search terms, or Keywords)
work too: each term or keyword is saved for the "Top search terms" table, and totals come from
Google's own "Total: Account" or "Total: Campaign" row, which includes the "Other search terms"
Google does not list. If a search terms report was filtered to one campaign, upload the
Campaigns export as well for account totals.

In a Campaigns export, Google's "Total:" row is used for the account totals. CTR, Avg.
CPC, Cost / conv., Conv. rate and ROAS are recalculated by the portal, never taken from the
file. Google Ads screenshots and full reports that include Google Ads can also be read with AI.

### Shopify
Shopify admin > **Analytics > Reports** > open a report > set the dates > **Export**.
Useful reports: Total sales over time (by day), Sales by channel, Sales by product,
Sessions over time, Customers over time.

### TikTok
TikTok Studio > **Analytics** > **Download data**. Upload the files from the download one at a
time (Overview, Follower history, Content, Gender, Top territories). TikTok dates often have
no year; set **Period covered** if the export is from a previous year.

### LinkedIn (company page)
Page admin view > **Analytics** > Content, Followers or Visitors > **Export**. Each export is an
Excel file with several sheets; upload it as is. LinkedIn exports don't include the running
follower total, so enter it with **Enter manually** each month.

## Screenshots and PDFs (Google Analytics, Facebook, Instagram, Meta Ads, LinkedIn)

For numbers that are easier to screenshot or save as a PDF than export as a spreadsheet.
**Manage data > Screenshots & PDFs**:

1. Choose the platform. Add up to 20 files: drag them in, choose them, or paste a screenshot with
   Ctrl+V / Cmd+V straight after taking it. PDFs (a GA4 or Meta report export, or a page saved as
   PDF) can be up to 25 MB each; keep a batch to about 100 PDF pages in total.
2. **Read numbers.** AI reads the numbers (15 to 60 seconds). Nothing is saved yet.
3. Check every value against the original (click **#1**, **#2** to see which file it came
   from). Fix anything wrong, untick anything you don't want, and confirm the dates.
4. **Save checked values.** The files are kept with the upload, and it can be rolled
   back from the history like any other upload.

Who reads what: CSV and Excel files on **Upload a file** are read by fixed rules, with no AI.
Only this tab uses AI, and nothing it reads is saved until a person checks it.

## Importing a full past report

For months you already reported on: **Manage data > Import a full report**. Drop in the whole
monthly report PDF (website, social and ads together, up to 25 MB and about 100 pages) and press **Read report**.

- AI reads every section and files each number under its platform for the report's month:
  totals, website tables (sessions by channel, landing pages, top pages), audience and follower
  shares, LinkedIn competitor rankings.
- Everything is shown grouped by platform with the page it came from. Fix or untick anything,
  confirm the month, then **Save checked values**.
- One upload is saved per platform, so each shows in Upload history and can be rolled back
  on its own. Importing the same month again replaces the earlier numbers.
- Tick **Save the report's summary as this month's commentary** to keep the report's own
  headline, summary and conclusion as a commentary draft (only if the month has none yet).

Rates and percent changes in the report are skipped on purpose; the portal recalculates them.
A long report takes one to three minutes to read.

## LinkedIn competitor comparison

LinkedIn page analytics > **Competitors**: screenshot the Total followers, New followers, Total
post metrics and Total engagement metrics lists and add them on **Screenshots & PDFs** with
LinkedIn chosen. Each company's value and change are read, with your page marked. They can also
be typed on **Enter manually** (metric "Posts", "Engagements"..., breakdown "Competitor" or "Your
page", and the company name). Set the dates to the period LinkedIn shows, e.g. the last 30 days.

What makes screenshots and PDFs read well:

- Set the date range in the platform first and keep the dates visible. If the screen only says
  "Last 28 days", enter the exact dates yourself.
- Exact numbers, not rounded ones. Platforms often show 21.2K; those are flagged, and you should
  type the exact figure from the detail view.
- No tooltips or pop-ups covering numbers. One platform per batch.

Rates (engagement rate, CTR, cost per lead) are ignored on purpose: the portal works them out
from the underlying numbers. On LinkedIn, reactions, comments, reposts and clicks are added up into
Interactions.

Files go straight from your browser to the portal's private storage, and the AI reads them
from there through links that expire after an hour.

Reading costs roughly 5 to 25 cents per batch of a few files; a 20-file batch or a long report
costs more, up to about a dollar. It needs `ANTHROPIC_API_KEY` set in Vercel.

## Enter manually

- **A single number**: any metric for a date range, for example LinkedIn followers on the last
  day of the month, or account-level Meta Ads reach. Rates (engagement rate, CTR, cost per lead)
  are always calculated, so they can't be typed in.
- **Audience breakdown**: percentages for age, gender, country, language, where views came
  from, followers vs non-followers, or engagement by format. Saving replaces that breakdown for
  the chosen date.

Manual entries show in the upload history and can be rolled back the same way.

## The parsers were built from the platforms' documented export formats
They have not yet been tested against FFM's own downloads. If a file is rejected, or a column you
need shows under **Not recognized**, send the file to the developer: supporting a new layout is
usually a one-line change.
