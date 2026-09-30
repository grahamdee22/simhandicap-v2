Context first, since this changes how we want to work going forward: we want browser-based QA (via the app.sim-cap.com Vercel preview) to actually be reliable, because Claude is going to be doing QA passes directly in a browser from here on out — clicking through flows, reading console/network, screenshotting — instead of us pushing to TestFlight/Play Console every time we want to test a change. That only works if signing in and loading the web build actually works consistently. Right now it doesn't, and that's blocking us from testing the 9-hole build you just shipped.

## The bug

After signing in (or even just loading the app with a valid session already in localStorage), the web build hangs indefinitely on the splash screen. It never reaches the authenticated app. This is fully reproducible.

## What we checked before ruling out the easy explanations

Not a caching issue: reproduced in a brand new Chrome tab that had never loaded the app before (fresh navigation, no service worker, no prior cache).

Not multi-tab lock contention: closed every other app.sim-cap.com tab and reloaded in isolation. Still hangs.

## Diagnostics from the hung tab

Console shows exactly one relevant message:

```
@supabase/gotrue-js: Lock "lock:sb-alwsdzvqvwxvmzcyfvra-auth-token" was not released within 5000ms. This may indicate an orphaned lock from a component unmount (e.g., React Strict Mode). Forcefully acquiring the lock to recover.
```

After that warning fires, nothing else happens. Specifically, checked via `navigator.locks.query()` and localStorage directly:

- The lock is held cleanly by the tab itself (exclusive, no pending contention) — so it's not stuck waiting on another tab.
- `localStorage['sb-alwsdzvqvwxvmzcyfvra-auth-token']` exists, parses as valid JSON (2322 chars), has both `access_token` and `refresh_token`, and `expires_at` was ~59 minutes in the future at the time of the test — the stored session is not expired or corrupted.
- `document.readyState` is `"complete"` — the page and JS bundle finished loading normally.
- Zero network requests to any supabase.co / alwsdzvqvwxvmzcyfvra domain fire, even 90+ seconds after load. The app never even attempts to call Supabase to validate the session.

So: valid session sitting right there in storage, lock uncontended, page fully loaded, and the app still never progresses past the splash screen or makes the network call it needs to make. Whatever runs immediately after that forced-lock-recovery point looks like where it's actually hanging — possibly an unhandled/unresolved promise in the auth initialization path rather than anything about the lock itself.

## What we need

Can you dig into the web auth-initialization code path (wherever the app checks for an existing Supabase session on startup, probably in a root layout or auth provider/context) and find why it hangs after that lock-recovery warning instead of proceeding to `getSession()` and rendering the authenticated app?

Worth checking as part of this: does this reproduce on the commit before `c6c4d9c` (the 9-hole build)? That'll tell us whether this is a regression from that push specifically or a pre-existing issue on web that we're only now noticing because we're actually testing on web for the first time in a while. Either way it needs to get fixed before we can do the 9-hole QA pass, but the fix might be scoped differently depending on which it is.

Once this is fixed, we'll be leaning on the web preview for QA regularly, so if there's anything about the web build's auth flow that's fundamentally flaky (vs. this being one isolated bug), flag that too — worth knowing now rather than hitting it again next build.
