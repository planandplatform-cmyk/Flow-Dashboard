-- Website visitors by device (desktop, mobile, tablet), pulled from GA4.
alter type public.breakdown_type add value if not exists 'device';
