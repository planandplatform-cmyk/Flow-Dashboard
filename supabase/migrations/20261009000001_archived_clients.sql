-- Archived clients are invisible to their client logins (FFM still sees them).
-- Enforced here, in the one function every client-data policy uses.

create or replace function private.can_view_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_ffm()
      or exists (
           select 1
           from public.user_clients uc
           join public.clients c on c.id = uc.client_id
           where uc.user_id = (select auth.uid())
             and uc.client_id = target_client_id
             and c.archived_at is null
         );
$$;
