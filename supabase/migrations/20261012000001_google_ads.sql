-- Google Ads as its own channel. Its numbers are stored as metrics
-- (gads_*), by campaign, so they never mix with Meta Ads delivery.
alter type public.data_source add value if not exists 'google_ads';
