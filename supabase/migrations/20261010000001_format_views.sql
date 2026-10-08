-- Share of views by content type (Facebook Insights: Reels 76.3%, Photos 22.6%...).
-- Instagram gives absolute counts per content type, stored as metrics instead.
alter type public.breakdown_type add value if not exists 'format_views';
