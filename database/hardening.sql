-- The Supabase "Enable automatic RLS" setup creates this event-trigger function.
-- Its trigger still runs as the database administrator; API callers need no EXECUTE grant.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
select
  has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') as anon_execute,
  has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') as authenticated_execute;
