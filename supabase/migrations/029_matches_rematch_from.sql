-- Link a direct rematch challenge to the prior completed match (for accept-flow prefill).

alter table public.matches
  add column if not exists rematch_from uuid null references public.matches (id) on delete set null;

comment on column public.matches.rematch_from is
  'Optional: completed match this direct rematch was created from (acceptor can prefill settings photo / tee).';
