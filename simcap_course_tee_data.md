# SimCap Course Tee Data

Instructions for Cursor

For each course below, populate the `tees` array with accurate slope and rating data per tee.

- Use your training data where confident
- Mark courses with `// confident: false` where you are unsure — these will be manually verified on [ncrdb.usga.org](https://ncrdb.usga.org)
- Include Red (ladies), White, Blue, Black tees where applicable
- Some courses use named tees (Green, Gold, Tournament, Championship) — use the correct names
- Courses already populated with multi-tee data are marked ✅ — skip these

## Already Populated ✅ (skip these)

- pebble (Pebble Beach Golf Links)
- augusta (Augusta National Golf Club)
- sawgrass (TPC Sawgrass)
- bethpage (Bethpage Black)
- pinehurst (Pinehurst No. 2)
- st-andrews (St Andrews Old Course)
- torrey-south (Torrey Pines South)
- whistling (Whistling Straits)
- ocean (Kiawah Island Ocean)
- oakmont (Oakmont Country Club)
- merion-east (Merion Golf Club East)
- riviera (Riviera Country Club)
- erin-hills (Erin Hills)
- bandon-dunes (Bandon Dunes)
- spyglass (Spyglass Hill)

## Needs Tee Data (populate these)

### US Courses

- congressional-blue (Congressional Blue Course)
- olympic-lake (Olympic Club Lake Course)
- chambers-bay (Chambers Bay)
- hazeltine (Hazeltine National)
- southern-hills (Southern Hills Country Club)
- valhalla (Valhalla Golf Club)
- east-lake (East Lake Golf Club)
- bay-hill (Bay Hill Club)
- harbour-town (Harbour Town Golf Links)
- waste-mgmt (TPC Scottsdale Stadium Course)
- tpc-river-highlands (TPC River Highlands)
- muirfield-village (Muirfield Village)
- kapalua (Kapalua Plantation Course)
- waialae (Waialae Country Club)
- sea-island-seaside (Sea Island Seaside Course)
- poppy-hills (Poppy Hills)
- cypress-point (Cypress Point Club)
- shadow-creek (Shadow Creek)
- wynn-golf (Wynn Golf Club)
- streamsong-red (Streamsong Red)
- streamsong-blue (Streamsong Blue)
- streamsong-black (Streamsong Black)
- wolf-creek (Wolf Creek Golf Club)
- gamble-sands (Gamble Sands)
- arcadia-bluffs (Arcadia Bluffs)
- tobacco-road (Tobacco Road)
- pinehurst-4 (Pinehurst No. 4)
- sand-valley (Sand Valley)
- bandon-trails (Bandon Trails)
- pacific-dunes (Pacific Dunes)
- whistling-irish (Whistling Straits Irish Course)
- cabot-links (Cabot Links)
- cabot-cliffs (Cabot Cliffs)

### UK & European Courses

- carnoustie (Carnoustie Championship)
- royal-st-georges (Royal St Georges)
- muirfield (Muirfield)
- portrush-dunluce (Royal Portrush Dunluce)
- troon-old (Royal Troon Old Course)
- turnberry-ailsa (Turnberry Ailsa)
- belfry-brabazon (Belfry Brabazon)
- celtic-manor-twenty-ten (Celtic Manor Twenty Ten)
- gleneagles-kings (Gleneagles Kings Course)
- royal-birkdale (Royal Birkdale)
- royal-lytham-st-annes (Royal Lytham St Annes)
- wentworth-west (Wentworth West Course)
- sunningdale-old (Sunningdale Old Course)
- valderrama (Valderrama)
- el-saler (El Saler)

### Asia Pacific Courses

- hirono (Hirono Golf Club)
- kasumigaseki-east (Kasumigaseki East Course)
- kingston-heath (Kingston Heath)
- royal-melbourne-west (Royal Melbourne West)
- cape-kidnappers (Cape Kidnappers)
- kauri-cliffs (Kauri Cliffs)

## Expected Output Format (for courses.ts)

```ts
{
  id: 'congressional-blue',
  name: 'Congressional Blue Course',
  defaultTee: 'Blue',
  tees: [
    { name: 'Red', rating: 71.2, slope: 124 },
    { name: 'White', rating: 73.8, slope: 131 },
    { name: 'Blue', rating: 75.4, slope: 137 },
    { name: 'Black', rating: 77.1, slope: 143 },
  ],
  // confident: false <-- add this comment if unsure
  byPlatform: uniformByPlatform(75.4, 137),
  pars: P72,
}
```

## Notes

- For links courses (UK/Ireland), tee names may differ (Yellow, White, Championship)
- For international courses without USGA ratings, use R&A equivalent ratings
- Flag any course where you have low confidence with a `// confident: false` comment
- Verify flagged courses at: https://ncrdb.usga.org
