Before we call the splash-hang fix (AuthContext.tsx, commit ba31e1d) done: can you confirm this doesn't change behavior for the native app (iOS/Android/TestFlight), not just web?

Specifically, since AuthContext.tsx is presumably shared between the web build and the native app:

1. The `onAuthStateChange` callback used to be `async` and directly awaited the hydrate calls inline. It's now synchronous, with all the awaits deferred via `setTimeout(0)`. Does that change timing-sensitive behavior anywhere on native (e.g. anything that assumed rounds/profile/groups were hydrated by the time a screen mounted right after sign-in)?

2. `setLoading(false)` now fires as soon as `getSession()` resolves, before rounds/profile/groups have hydrated. On native, is there anywhere that reads `loading === false` as a signal that the user's data is fully loaded (not just that a session exists)? If so, screens might briefly render with stale/empty rounds or profile data before the background hydrate finishes, where before they'd have waited.

3. The gotrue lock-contention issue itself is described as web-specific (Web Locks API), so I'd assume native was never hitting this deadlock in the first place, just want that confirmed rather than assumed, since the fix touches shared code.

If native is genuinely unaffected (splash timing, sign-in flow, first-load data state all behave the same as before), say so plainly and we'll consider this closed. If there's any risk, even minor, flag exactly what changed and whether it's worth a quick TestFlight sanity check before we consider this safe.
