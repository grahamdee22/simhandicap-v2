-- Speed up "recent matches for this crew" queries: filter by group_id + order by played_at desc.
create index if not exists social_group_matches_group_id_played_at_desc_idx
  on public.social_group_matches (group_id, played_at desc);
