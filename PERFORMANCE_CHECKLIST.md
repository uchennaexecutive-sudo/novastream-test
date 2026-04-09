# PERFORMANCE_CHECKLIST

Purpose: run a full **Codex-only** performance optimization pass on the current NOVA STREAM build.

This pass is about making the app:
- faster
- smoother to scroll
- more responsive
- lighter on CPU/GPU
- better behaved on lower-end systems

without redesigning the UI or changing the app’s visual identity.

## Core Rule

This is **not** a UI redesign pass.

Do not treat this as a frontend restyling task.
Do not remove the premium NOVA STREAM look.
Do not make broad visual changes unless they are strictly necessary for performance and can be done without materially changing the existing design.

This pass should focus on:
- render efficiency
- state efficiency
- fetch efficiency
- startup efficiency
- memory/background work
- scroll performance

## Scope Priority

Primary focus:
1. Home page performance
2. Scrolling smoothness
3. General responsiveness
4. Detail page performance
5. Startup responsiveness

Secondary focus:
6. Memory usage over time
7. Background timers/listeners/fetch noise
8. Only after the main pass: extra settings if still needed

## Existing Performance Context

The app already has some user-facing performance-related settings, such as:
- `Reduce Animations`
- `Reduced Visual Effects`

Those settings can remain as they are for now.

The main goal of this pass is:
- improve the default experience first
- make the app feel better even before users start toggling extra settings

## Critical Guardrails

- Do not break streaming.
- Do not break downloads.
- Do not break offline playback.
- Do not regress updater behavior.
- Do not redesign the UI.
- Do not make the app look obviously worse just to chase raw performance.
- Do not introduce platform-specific regressions while optimizing one area.

## Files To Read Before Implementation

Core context:
- `CLAUDE.md`
- `src/main.jsx`
- `src/App.jsx`
- `src/pages/Home.jsx`
- `src/pages/Detail.jsx`
- `src/pages/Settings.jsx`

Layout / rendering:
- `src/index.css`
- `src/themes/themes.css`
- `src/components/Layout/Layout.jsx`
- `src/components/Layout/Sidebar.jsx`
- `src/components/Layout/TopBar.jsx`
- `src/components/Layout/TitleBar.jsx`

Card / page surfaces:
- `src/components/Cards/HeroSlide.jsx`
- `src/components/Cards/MediaCard.jsx`
- `src/components/UI/*`

Player and detail:
- `src/components/Player/MoviePlayer.jsx`
- `src/components/Player/AnimePlayer.jsx`
- `src/components/Player/SharedNativePlayer.jsx`

State / startup:
- `src/store/useAppStore.js`
- `src/store/useAuthStore.js`
- `src/store/useDownloadStore.js`
- relevant `src/lib/*` files involved in initial fetches and cached data flows

Rust / runtime if startup or app responsiveness investigation points there:
- `src-tauri/src/main.rs`
- `src-tauri/build.rs`

## What This Pass Should Achieve

By the end of the pass, the app should:
- launch faster or at least feel interactive sooner
- scroll more smoothly, especially on Home
- navigate with less jank
- reduce unnecessary work during detail-page opens
- behave better on lower-end systems
- still look like NOVA STREAM

## Codex-Only Execution Rule

This performance pass is handled by Codex only.

That means:
- do not plan around Claude Code doing frontend work first
- do not depend on a separate UI implementation pass
- focus on performance-oriented code changes inside the existing UI structure

Allowed kinds of changes:
- render optimization
- memoization/selectors where justified
- deferring non-critical work
- lazy loading
- virtualization/windowing if needed
- reducing duplicate fetches
- startup scheduling improvements
- listener/timer cleanup
- smaller, targeted visual-effect reductions only when needed for performance

Not the goal:
- redesigning components
- changing product flow
- rewriting pages for aesthetics

## Recommended Phases

## Phase 0 - Baseline audit

Goal:
- identify the biggest performance hotspots before changing anything

Tasks:
- profile the Home page structure and identify the heaviest render paths
- profile scrolling-heavy pages
- inspect detail-page opening cost
- inspect startup sequence cost
- inspect long-lived listeners, timers, and background fetches
- identify duplicate or unnecessary state-driven rerenders

Deliverable:
- short baseline note listing the biggest hotspots and what to attack first

## Phase 1 - Home page optimization

Goal:
- produce the most obvious user-facing performance improvement first

Tasks:
- reduce initial Home render cost
- defer non-critical sections/rows
- reduce duplicate work during Home data load
- cut unnecessary rerenders across Home surfaces
- improve image/render behavior where it materially affects smoothness
- preserve the current UI design while making it cheaper to render

Deliverable:
- noticeably smoother and faster Home page

## Phase 2 - Scrolling and repeated card surface performance

Goal:
- make scrolling feel lighter across card-heavy views

Tasks:
- optimize repeated card rendering
- reduce rerender pressure in large lists/grids
- avoid rendering too many expensive surfaces at once when possible
- reduce costly repeated work tied to hover/animation/state churn

Deliverable:
- smoother scrolling and less jank across Home and similar views

## Phase 3 - Detail page optimization

Goal:
- make title pages open faster and feel lighter

Tasks:
- defer non-essential detail-page work
- reduce duplicate fetches and derived-state churn
- reduce expensive eager work such as trailer/backdrop-heavy logic where needed
- optimize episode section rendering and surrounding state changes

Deliverable:
- faster-feeling Detail pages with less open-time jank

## Phase 4 - Startup and app shell responsiveness

Goal:
- improve how quickly the app becomes useful after launch

Tasks:
- inspect and defer non-essential startup work
- ensure the first useful paint happens as early as possible
- reduce blocking initialization work where safe
- delay background tasks that do not need to run immediately

Deliverable:
- faster-feeling startup and shell responsiveness

## Phase 5 - Global render/compositing cost reduction

Goal:
- lower overall render cost without redesigning the interface

Tasks:
- audit the most expensive blur/glass/compositing hotspots
- reduce only the costliest patterns where they materially hurt performance
- keep the same visual identity while making rendering cheaper

Important:
- this is not a visual redesign
- changes here should be conservative and performance-motivated

Deliverable:
- lower render/compositing cost while keeping the app’s look intact

## Phase 6 - Memory, timers, listeners, and background work

Goal:
- stop performance from degrading during long sessions

Tasks:
- remove unnecessary intervals/timeouts/listeners
- tighten cleanup logic in long-lived components
- reduce unnecessary background fetches or cache churn
- reduce avoidable memory growth over time

Deliverable:
- better long-session stability and lighter idle/background behavior

## Phase 7 - Optional future settings expansion

Goal:
- only after the core pass, evaluate whether more performance toggles are still needed

Possible later ideas:
- stronger low-end compatibility mode
- lighter home mode
- more aggressive backdrop/image reduction mode

Important:
- do not start here
- only consider this after the default experience has already been improved

Deliverable:
- optional follow-up settings plan if still necessary

## Best Implementation Order

1. Phase 0 - Baseline audit
2. Phase 1 - Home page optimization
3. Phase 2 - Scrolling and repeated card surface performance
4. Phase 3 - Detail page optimization
5. Phase 4 - Startup and app shell responsiveness
6. Phase 5 - Global render/compositing cost reduction
7. Phase 6 - Memory / timers / background work
8. Phase 7 - Optional settings expansion

## What Success Looks Like

- Home feels clearly smoother
- Scrolling is less janky
- Detail pages open more cleanly
- Startup feels more responsive
- Lower-end systems handle the app better
- The app still looks like NOVA STREAM

## Notes For The Implementing Chat

- This is a performance pass, not a feature pass.
- This is a Codex-only pass.
- Preserve the current UI and product feel.
- Optimize the current experience instead of redesigning it.
- Read the relevant files and inspect current local changes before editing.
- After understanding the code, do not immediately start broad rewrites. First summarize the main hotspots and then implement in the recommended phase order.
