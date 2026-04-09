# Performance Phase 0 Audit

Purpose: capture the current frontend and app-shell performance hotspots before changing behavior, so the next optimization phases stay focused on the biggest wins first.

This document is an audit only. It does not change playback, downloads, offline playback, updater behavior, or the NOVA STREAM visual identity.

## Validation context

- Workspace: `C:\Users\uchen\nova-stream-dev-test`
- Audit date: 2026-04-09
- Scope reviewed:
  - `CLAUDE.md`
  - `PERFORMANCE_CHECKLIST.md`
  - app shell and startup files
  - Home, Detail, and Settings
  - layout, card, and player surfaces
  - supporting cache, TMDB, and progress utilities

## Current performance summary

- The app already includes some performance-aware behavior:
  - route-level lazy loading for most pages
  - reduced animation and reduced visual effects settings
  - in-memory session cache for Home rows and scroll positions
  - some use of `content-visibility` and `contain`
- The main bottlenecks are not one broken subsystem.
- The current cost is spread across:
  - eager Home rendering
  - scroll-driven rerender pressure
  - expensive shell compositing
  - detail-page overwork
  - startup-side background work clustered too close to mount

## Biggest hotspots

### 1. Home page mounts too much expensive UI at once

Primary files:

- `src/pages/Home.jsx`
- `src/components/Cards/HeroSlide.jsx`
- `src/components/Cards/MediaCard.jsx`

Observed behavior:

- Home renders the hero plus up to nine card-heavy rows immediately.
- Each row can create many `MediaCard` instances on first paint.
- The hero uses animated crossfades and a large backdrop image above the fold.
- Continue Watching and recommendation rows add more async work on initial load.

Why it matters:

- This is the first page most users feel.
- Initial interaction cost and perceived smoothness are dominated by Home.

Recommended attack:

- Defer non-critical rows after first useful paint.
- Keep hero and top rows responsive first, then stage the rest.
- Reduce repeated card work during initial Home render.

### 2. Scroll state is pushed through global store updates

Primary files:

- `src/components/Layout/Layout.jsx`
- `src/components/Cards/MediaCard.jsx`
- `src/store/useAppStore.js`

Observed behavior:

- `Layout.jsx` updates `isMainScrolling` in Zustand during main scroll activity.
- `MediaCard.jsx` subscribes to that state to disable hover effects while scrolling.
- This means scroll activity can fan out store-driven rerenders across many cards.

Why it matters:

- The app is most sensitive to extra work while scrolling.
- This pattern likely adds avoidable churn exactly when the UI should stay light.

Recommended attack:

- Remove or localize scroll-driven state updates from the global store path.
- Prefer CSS- or container-local approaches where possible.

### 3. Shell compositing cost is high by default

Primary files:

- `src/index.css`
- `src/themes/themes.css`
- `src/components/Layout/BackgroundOrbs.jsx`
- `src/components/Layout/Sidebar.jsx`
- `src/components/Layout/TopBar.jsx`
- `src/components/Cards/HeroSlide.jsx`

Observed behavior:

- Large blur and backdrop-filter layers are stacked across the shell.
- Background orbs use large animated blurred surfaces.
- Sidebar and TopBar use heavy glass treatment by default.
- Global transitions are applied to many common elements in `index.css`.

Why it matters:

- This affects every page, not just Home.
- Lower-end systems will feel the cost continuously, even when content itself is simple.

Recommended attack:

- Reduce only the most expensive compositing patterns.
- Keep the same look, but make the default path cheaper to paint and animate.
- Narrow global transitions to targeted classes instead of nearly all elements.

### 4. Detail page does too much eager work on open

Primary files:

- `src/pages/Detail.jsx`
- `src/lib/tmdb.js`
- `src/lib/progress.js`

Observed behavior:

- `getDetails()` appends `credits,videos,similar,images` in one request.
- Detail also fetches progress state, watchlist state, anime canonical data, supplemental AniList search, and optional anime preload work.
- `Detail.jsx` subscribes directly to the full downloads item list and derives multiple maps from it.
- Trailer and similar-title rendering are prepared eagerly.

Why it matters:

- Detail opens are likely doing more work than users need for first interaction.
- The page is state-rich and can rerender broadly when unrelated download state changes.

Recommended attack:

- Split essential and non-essential detail work.
- Narrow store subscriptions and derived-state churn.
- Defer trailer, similar, and other secondary surfaces until after the main detail content is stable.

### 5. Startup work is safe but front-loaded

Primary files:

- `src/main.jsx`
- `src/App.jsx`
- `src/store/useAuthStore.js`
- `src/store/useDownloadStore.js`

Observed behavior:

- Root startup performs runtime detection, auth bootstrap, updater scheduling, download listener setup, storage info fetch, completed-download metadata reconciliation, and settings sync.
- Some work is already wrapped in `scheduleNonCritical()`, but several mount-time tasks still cluster close together.
- Auth bootstrap installs `onAuthStateChange` in store init without an unsubscribe path.

Why it matters:

- Startup responsiveness is shaped by how quickly the shell becomes useful, not just how fast all background tasks finish.
- Long-session behavior can degrade if listeners and background work are not tightly scoped.

Recommended attack:

- Push non-essential startup work later.
- Keep the first interactive shell path lean.
- Clean up long-lived listener lifecycle in auth and similar global systems.

### 6. Player surfaces are heavy but not the first optimization target

Primary files:

- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`

Observed behavior:

- Players have many listeners, timers, blur-heavy overlays, and progress persistence intervals.
- They are complex, but they are isolated to playback flows rather than the Home browse path.

Why it matters:

- They matter for long sessions and lower-end systems.
- They are also higher-risk because they sit near streaming and offline playback behavior.

Recommended attack:

- Do not start here.
- Revisit after Home, scroll, detail, and shell improvements are done.

## Hotspot priority

1. Home initial render cost
2. Scroll-triggered rerender pressure
3. Shell compositing and global transition cost
4. Detail-page eager work and broad subscriptions
5. Startup scheduling and long-lived listener cleanup
6. Player overlay and playback-surface cost

## Recommended implementation order

### Phase 1

- Optimize Home first:
  - stage non-critical rows
  - reduce initial card count pressure
  - avoid duplicate first-load work

### Phase 2

- Fix repeated card and scroll-path cost:
  - remove global scroll rerender pressure
  - lighten repeated card hover/render behavior
  - preserve smooth browsing under load

### Phase 3

- Reduce detail open-time cost:
  - split essential versus secondary data/surfaces
  - reduce broad download-store subscriptions
  - defer trailer and similar sections where safe

### Phase 4

- Improve startup responsiveness:
  - delay non-essential background tasks
  - tighten listener lifecycle
  - keep the first useful shell paint clean

### Phase 5 and 6

- Audit shell blur/compositing and long-session background work only after the user-facing browse path is smoother.

## Guardrails for later phases

- Do not break movie, series, animation, or anime streaming.
- Do not break downloads or offline playback.
- Do not regress updater behavior.
- Do not redesign the interface.
- Keep changes additive and targeted.
- Prefer low-risk render, state, scheduling, and cleanup wins before touching runtime or Rust code.

## Phase 0 conclusion

- The biggest wins are available in the frontend without redesigning the app.
- The first pass should focus on Home, scroll behavior, and shell responsiveness.
- Rust/runtime files should remain out of scope unless later investigation shows a clear startup bottleneck there.
