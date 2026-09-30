Before I run the migration and start testing on device, three quick confirms on the 9-hole build:

1. `league_rounds` trigger — is that table actually what backs the "Apply this round to [tournament]?" flow for all three formats (Stroke Play, Scramble, Best Ball), or just Stroke Play? Want to make sure the 9-hole block covers all three, not just one.

2. Test coverage — can you confirm the test suite explicitly covers (a) the null-index gate (first-ever logged round must be 18, 9-hole options blocked until then) and (b) tournament-apply suppression across all three formats? The summary named "resolver, index contribution, MP gate" but didn't call those two out by name, and they're two of the four locked decisions, so want to make sure they're not just implicitly covered.

3. Custom tee entry on a 9-hole round — when someone picks Custom instead of a catalog tee, do they type in the actual 9-hole rating/slope directly, or does the derived resolver (18-hole ÷ 2) still try to apply to what they enter? Since Custom is already user-supplied data, it should probably bypass the resolver entirely and just use whatever they type as the 9-hole numbers.

Once these are confirmed I'll run migration 065_rounds_holes_played.sql and start device testing.
