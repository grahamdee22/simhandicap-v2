-- Run in Supabase Dashboard → SQL Editor (or psql against your project).
-- Lists RLS state and every policy on public.group_members with full expressions.

-- 1) Table-level RLS flags
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_for_table_owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'group_members';

-- 2) Every policy on group_members (name, command, roles, USING / WITH CHECK text)
select
  pol.polname as policy_name,
  case pol.polcmd
    when 'r' then 'SELECT'
    when 'a' then 'INSERT'
    when 'w' then 'UPDATE'
    when 'd' then 'DELETE'
    when '*' then 'ALL'
    else pol.polcmd::text
  end as command,
  pol.polpermissive as permissive,
  coalesce(
    (
      select string_agg(r.rolname, ', ' order by r.rolname)
      from pg_roles r
      where r.oid = any (pol.polroles)
    ),
    '(default: PUBLIC)'
  ) as policy_roles,
  pg_get_expr(pol.polqual, pol.polrelid, true) as using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid, true) as with_check_expression
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'group_members'
order by command, policy_name;

-- 3) Same data via pg_policies (handy cross-check; qual may truncate in some clients)
select *
from pg_policies
where schemaname = 'public'
  and tablename = 'group_members'
order by policyname;
