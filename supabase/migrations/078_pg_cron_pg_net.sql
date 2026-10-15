-- Enable Postgres cron + async HTTP so edge functions can be scheduled
-- (e.g. refresh-gspro-courses Mon/Wed/Fri). Job definitions live in cron.job /
-- Vault, not in migrations (they need project URL + service role secrets).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
