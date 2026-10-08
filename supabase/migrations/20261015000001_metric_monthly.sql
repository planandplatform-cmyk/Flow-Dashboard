-- Monthly totals for the report's 12-month charts, computed in the database
-- so the page receives a few hundred rows instead of every daily row.
-- security invoker: row-level security applies exactly as for a direct read.
create or replace function public.metric_monthly(p_client_id uuid, p_start date, p_end date, p_keys text[])
returns table (metric_key text, month date, total numeric, n integer, last_date date, last_value numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select m.metric_key,
         date_trunc('month', m.date)::date as month,
         sum(m.value) as total,
         count(*)::integer as n,
         max(m.date) as last_date,
         (array_agg(m.value order by m.date desc))[1] as last_value
  from public.metrics_daily m
  where m.client_id = p_client_id
    and m.date between p_start and p_end
    and m.dimension = ''
    and m.metric_key = any (p_keys)
  group by m.metric_key, date_trunc('month', m.date)
$$;

grant execute on function public.metric_monthly(uuid, date, date, text[]) to authenticated;
