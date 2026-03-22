# UPGRADE FIX PLAN

## Purpose
This file is the current handoff plan for the next Codex session.

It is intentionally narrowed to the two remaining improvement tracks:

1. `Nuvio edge-case hardening`
2. `Subtitle quality pass`

Use this file together with [CLAUDE.md](c:/Users/uchen/nova-stream-dev-test/CLAUDE.md).

---

## Current Architecture Summary

### Anime
- `Gogoanime` is the primary anime provider.
- `AnimePahe` is the current fallback provider behind Gogoanime.
- Anime is already absorbed in-project.
- Anime playback uses the native player and Rust-backed fetch / HLS transport.

Important consequence:
- Anime fallback is no longer the next major problem.
- The main unfinished work now is on Movies / Series / Animation and subtitle quality.

### Movies / Series / Animation
- `Nuvio` is now the active resolver path.
- It is no longer meant to depend on hosted Vercel as the final architecture.
- It is absorbed as an **embedded local sidecar runtime** managed by the app.
- Release builds embed the Nuvio runtime and extract it to local app data on launch.
- If the extracted runtime is deleted, the app should recreate it automatically on next launch.

Important consequence:
- Nuvio is self-contained for end users in practice, but it is not architecturally identical to Gogoanime.
- Gogoanime is true in-app resolver logic.
- Nuvio is an app-managed embedded sidecar.
- That distinction is acceptable for now as long as the app behaves self-contained for the end user.

---

## What Already Works

- Gogoanime primary anime flow works.
- AnimePahe fallback exists and is active.
- Movies / Series / Animation generally resolve and play through the absorbed Nuvio path.
- Nuvio now uses staged provider fetch and auto-fallback.
- Nuvio startup/install terminal exposure was already addressed in code and release packaging work.
- Subtitle selection already prefers better English / WEB-style candidates more than before.

---

## What Still Needs Work

The current remaining work is:

1. `Nuvio edge-case hardening`
2. `Subtitle quality pass`

Recommended order:

1. Nuvio edge-case hardening
2. Subtitle quality pass

Reason:
- Source/provider stability is the larger functional issue.
- Subtitle quality is important, but still partly depends on source/release matching and should be refined after playback stability.

---

## 1. Nuvio Edge-Case Hardening

### Goal
Harden the absorbed Nuvio movie/series/animation path so that edge-case titles fail less often and recover more intelligently.

### What problem this solves
Nuvio absorption is broadly working, but some titles still fail because of:
- bad provider links
- junk placeholder URLs
- HTML pages being returned where media was expected
- sources that validate shallowly but still fail at real playback startup
- poor provider selection for specific title/content-type combinations
- animation/movie edge cases where multiple providers return candidates but none actually start

### What this solves when completed
- fewer title-specific playback failures
- better source selection for Movies / Series / Animation
- cleaner fallback behavior when one provider family returns junk
- better confidence that Nuvio failures are true upstream issues rather than resolver mistakes

### What has already been done
- Nuvio runs as an embedded local sidecar.
- The resolver already uses staged provider fetching:
  - primary-provider
  - fast-providers
  - full-fallback
- Opaque token URLs, junk URLs, HTML pages, and dead direct hosts are already filtered in multiple places.
- The player already auto-falls back to the next validated stream when a stream fails.
- Provider ordering has already been tuned several times.
- Animation has its own provider preference path instead of blindly sharing the generic movie fast path.

### Remaining problem categories

#### A. Source-quality edge cases
Some titles still return:
- technically reachable but poor sources
- providers that validate at probe time but fail during actual startup
- provider combinations that are title-specific and unstable

#### B. Provider ranking edge cases
Some titles still pick weaker providers too early or keep failing across a low-quality cluster.

#### C. Runtime diagnostics gaps
It can still be hard to tell:
- which provider actually won first
- which providers were tried and failed during real playback
- whether the final failure is source quality or resolver logic

### Implementation plan

#### Stage 1: Better provider quality heuristics
- Keep preferring the better-performing providers by content type.
- Continue pushing lower-confidence providers down the order.
- Add narrow penalties or blacklists for recurring junk hosts if patterns are clear.

#### Stage 2: Better stage-to-stage fallback behavior
- Ensure staged fetch behavior always continues correctly when a stage returns candidates that later all fail.
- Keep the broader fallback stage available when earlier stages produce only bad outcomes.

#### Stage 3: Better runtime playback failure diagnostics
- Log provider progression more clearly:
  - first selected provider
  - validation success vs real startup failure
  - fallback progression
  - final chosen/failed provider

#### Stage 4: Content-type-specific tuning
- Movies: keep favoring the providers that start quickly and reliably.
- Series: preserve the currently good behavior unless regressions appear.
- Animation: treat as its own special case if needed, because animation titles have already shown different provider-quality behavior.

#### Stage 5: Decide whether another movie/series/animation fallback is needed
- Only consider another absorbed resolver if Nuvio still proves too inconsistent after hardening.
- Do not add another provider stack prematurely.

### Files likely involved
- [src-tauri/src/main.rs](c:/Users/uchen/nova-stream-dev-test/src-tauri/src/main.rs)
- [src/components/Player/MoviePlayer.jsx](c:/Users/uchen/nova-stream-dev-test/src/components/Player/MoviePlayer.jsx)
- [vendor/nuvio-streams-addon](c:/Users/uchen/nova-stream-dev-test/vendor/nuvio-streams-addon)

### Constraints
- Keep the embedded local-sidecar model working for end users.
- Do not reintroduce hosted Vercel Nuvio as the main runtime path.
- Do not break Movies / Series / Animation that already work.
- Avoid major UI changes.

---

## 2. Subtitle Quality Pass

### Goal
Improve subtitle quality and subtitle-source alignment, especially for Movies / Series / Animation.

### What problem this solves
Subtitle quality is still inconsistent because:
- subtitles come from a separate subtitle backend, not directly from the stream provider
- release matching is imperfect
- some English subtitles exist but are misaligned with the chosen source
- some titles show no useful subtitle even when another candidate might be better

### Important current reality
For Movies / Series / Animation:
- subtitles are currently coming from a separate backend
- not from Nuvio streams themselves

That means:
- some subtitle problems are source-specific
- some are release-specific
- some cannot be fully solved just by changing the player

### What this solves when completed
- better subtitle auto-selection
- fewer mismatched WEB/HDTS/CAM subtitle picks
- better user experience for movie and animation playback
- clearer behavior when no good subtitle exists

### What has already been done
- Subtitle ranking already prefers English tracks and WEB-style alignment more than before.
- The subtitle backend is already separated cleanly from the stream resolver.
- The native player already supports subtitle loading and toggle behavior.

### Remaining problem categories

#### A. Release mismatch
The chosen subtitle file may correspond to a different release than the selected source.

#### B. Missing good subtitle candidates
The subtitle backend may return results, but not necessarily the right one for the stream actually chosen.

#### C. Silent poor selection
The app may pick a technically valid subtitle that is still a poor user experience.

### Implementation plan

#### Stage 1: Improve subtitle ranking heuristics
- Favor better release alignment more strongly.
- Continue prioritizing WEB-aligned English subtitles.
- Penalize HDTS / CAM / obviously low-confidence subtitle candidates more strongly.

#### Stage 2: Improve missing-subtitle handling
- If no good subtitle exists, fail cleanly rather than silently selecting a poor mismatch.
- Prefer “no subtitle” over a clearly bad subtitle.

#### Stage 3: Improve diagnostics
- Log which subtitle candidate was selected and why.
- Make subtitle debugging easier without adding noisy user-facing UI.

#### Stage 4: Optional later refinement
- If needed later, expose smarter subtitle fallback or manual selection improvements.
- Do not start with a UI redesign.

### Files likely involved
- [src/lib/movieSubtitles.js](c:/Users/uchen/nova-stream-dev-test/src/lib/movieSubtitles.js)
- [src/components/Player/MoviePlayer.jsx](c:/Users/uchen/nova-stream-dev-test/src/components/Player/MoviePlayer.jsx)
- [src-tauri/src/main.rs](c:/Users/uchen/nova-stream-dev-test/src-tauri/src/main.rs)

### Constraints
- Treat this as refinement work after playback/source stability.
- Do not let subtitle tuning destabilize playback.
- Do not change the native player look/UX unnecessarily.

---

## Recommended Next Move

Start with:

### `Nuvio edge-case hardening`

Reason:
- It is the larger remaining functional risk.
- It affects movies / series / animation playback reliability.
- Subtitle work is easier to do well once the chosen playback source is more stable.

After that:

1. Subtitle quality pass

---

## Guidance For The Next Codex Session

When continuing from here:
- read [CLAUDE.md](c:/Users/uchen/nova-stream-dev-test/CLAUDE.md)
- read this file
- do not reopen AnimeKai work unless explicitly requested
- treat AnimePahe as the current anime fallback
- keep Nuvio self-contained for end users
- keep the focus on stability and source quality, not redesign

---

## Prompt For The Next Chat

Use this prompt in the next Codex chat:

```text
Read CLAUDE.md and UPGRADE-FIX-PLAN.MD first.

We are continuing Nova Stream from the current architecture:
- Gogoanime is the primary absorbed anime provider.
- AnimePahe is the current anime fallback.
- Nuvio is already absorbed as an embedded local sidecar for Movies / Series / Animation.

The next work is now only:
1. Nuvio edge-case hardening
2. Subtitle quality pass

Important requirements:
- Do not reintroduce hosted Nuvio/Vercel as the main runtime path.
- Keep the solution self-contained for end users.
- Do not change the native player UI/visual design unnecessarily.
- Do not reopen AnimeKai unless explicitly needed later.

What I want first:
1. Inspect the current Nuvio movie/series/animation resolver path and subtitle path.
2. Identify the remaining edge-case failure points and subtitle-quality gaps.
3. Return a grounded implementation plan if needed.
4. Then implement Nuvio edge-case hardening first.
5. After that, implement the subtitle quality pass.

Focus files:
- src-tauri/src/main.rs
- src/components/Player/MoviePlayer.jsx
- src/lib/movieSubtitles.js
- vendor/nuvio-streams-addon
```

