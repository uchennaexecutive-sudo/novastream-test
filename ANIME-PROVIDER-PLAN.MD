# Anime Provider Plan

## Purpose

This document defines the next anime-provider roadmap after the successful Gogoanime absorption.

It focuses on:

1. keeping Gogoanime as the primary provider
2. adding a self-contained fallback provider path
3. deciding whether AnimeKai and AnimePahe are worth absorbing into the app
4. sequencing the work so the current working playback path is not destabilized

This is a plan only. No implementation is included in this document.

---

## Current State

### Gogoanime

What is already true:

- Gogoanime search, anime detail, episode list, and server discovery are now self-contained inside the app.
- The old localhost API dependency for Gogo has already been removed from the active flow.
- Final media resolution and playback work for the supported Gogo paths.
- Gogo is now the only enabled anime addon provider in:
  - `src/lib/animeAddons/index.js`

What is still imperfect:

- some Gogo entries expose bad or low-quality sources such as CAM/theater recordings
- some titles use alternate hosts instead of the main `newplayer -> megaplay/megacloud` path
- edge cases like specials, upcoming entries, or misleading season matches still need quality filtering

### AnimeKai

What already exists in the codebase:

- an in-app provider already exists:
  - `src/lib/animeAddons/providers/animekai.js`
- Rust already has AnimeKai-specific browser/session handling in:
  - `src-tauri/src/main.rs`

What is currently blocking true absorption:

- the current AnimeKai provider still depends on:
  - `https://enc-dec.app/api/enc-kai`
  - `https://enc-dec.app/api/dec-kai`
  - `https://enc-dec.app/api/dec-mega`
- that means AnimeKai is not actually self-contained yet

Conclusion:

- AnimeKai is a realistic fallback candidate
- the work is not to revive the old hosted API
- the work is to finish the in-app provider and remove the external token/decryption dependency

### AnimePahe

What already exists in the codebase:

- an in-app provider already exists:
  - `src/lib/animeAddons/providers/animepahe.js`
- search works
- anime detail / episode list works

What is missing:

- `getStreams()` is not implemented
- AnimePahe stream resolution depends on a harder downstream extraction path
- the likely hard part is `Kwik` / play-page resolution, not search or episode listing

Conclusion:

- AnimePahe is possible
- but it is harder, riskier, and lower priority than AnimeKai

---

## Final Provider Strategy

Recommended provider order:

1. `gogoanime`
2. `animekai`
3. `animepahe` only if AnimeKai also fails or remains too unstable

Recommended trigger behavior:

- do not query all providers in parallel by default
- keep Gogo as the first resolver path
- fall back only when:
  - Gogo returns no validated candidate
  - Gogo only returns rejected or obviously bad sources
  - Gogo resolves to known junk states like CAM/upcoming-only hosts

Why:

- this preserves current speed improvements
- it avoids multiplying startup latency on every anime load
- it keeps the happy path fast while still covering edge cases

---

## Phase A: Stabilize Gogo As Primary Provider

### Goal

Keep Gogo as the main provider, but make its failure and quality rules stricter before adding fallback complexity.

### Work

1. Expand bad-source filtering
   - reject obvious CAM/theater labels
   - reject known junk hosts where appropriate
   - distinguish proper episodic HD content from prerelease/special/cam entries

2. Improve title and season sanity checks
   - detect when a match is a special, movie, recap, or upcoming entry instead of the requested season
   - penalize misleading matches earlier in provider-state selection

3. Keep current working playback path unchanged
   - do not redesign the player
   - do not disturb the working Gogo resolver unless quality filtering requires it

### Success Criteria

- Gogo continues to work for the good path
- bad CAM-like entries are less likely to be selected as valid playback
- fallback only happens for genuine Gogo failure or junk-source cases

---

## Phase B: AnimeKai As The First Absorbed Fallback

### Goal

Enable AnimeKai as the first in-app fallback provider without reviving Railway or another hosted API.

### Why AnimeKai First

- a local provider already exists
- Rust already contains AnimeKai-aware fetch handling
- it is closer to working than AnimePahe
- it fits the same "absorb into the app" direction that Gogo now follows

### Main Problem To Solve

Remove the external `enc-dec.app` dependency from `animekai.js`.

### Implementation Direction

1. Audit the current AnimeKai provider flow
   - search
   - watch page
   - episode list ajax
   - server/link ajax
   - iframe token decoding
   - final source normalization

2. Replace external token/decryption endpoints
   - identify the token/encryption logic currently outsourced to `enc-dec.app`
   - reproduce it locally inside the project
   - prefer JS implementation first if the logic is provider-specific
   - only push into Rust if a browser/session/runtime dependency makes that necessary

3. Normalize AnimeKai output to the current candidate contract
   - preserve:
     - `url`
     - `streamType`
     - `headers`
     - `subtitles`
     - `resolution`
   - so `SharedNativePlayer` can consume it without UI changes

4. Add AnimeKai back to the provider registry
   - update `src/lib/animeAddons/index.js`
   - keep ordering: Gogo first, AnimeKai second

5. Add guarded fallback routing
   - only invoke AnimeKai when Gogo fails or returns junk
   - do not slow down good Gogo paths unnecessarily

### Validation

Test at least:

- a title where Gogo works
- a title where Gogo fails but AnimeKai works
- subtitles
- episode switching
- season-title matching

### Risks

- AnimeKai site/runtime changes
- hidden token logic changing over time
- browser/runtime behavior needed for some embeds

### Success Criteria

- AnimeKai works without Railway
- AnimeKai works without `enc-dec.app`
- app remains self-contained for AnimeKai fallback

---

## Phase C: AnimePahe Evaluation And Optional Adoption

### Goal

Decide whether AnimePahe is worth turning into a third fallback after AnimeKai.

### Why AnimePahe Is Harder

- search and episode list are the easy part and already mostly present
- stream resolution is the real blocker
- the likely hard piece is `Kwik` extraction and final source resolution

### Recommended Approach

1. Do not prioritize AnimePahe before AnimeKai
2. Treat AnimePahe as optional third-tier fallback
3. Reuse the current Tauri browser/session infrastructure instead of adopting an external anti-bot stack as the final architecture

### Implementation Direction

1. Finish `getStreams()` in `src/lib/animeAddons/providers/animepahe.js`
2. Port only the necessary source-resolution logic
   - play page parsing
   - resolution link parsing
   - final source extraction
3. Keep the implementation inside the app/project
4. Avoid making external bypass tools part of the permanent design

### Validation

Test:

- a title where both Gogo and AnimeKai fail
- AnimePahe-only success case
- subtitle behavior if provided
- final HLS/native-player compatibility

### Success Criteria

- AnimePahe can produce validated candidates in-app
- no hosted API is required
- no manual terminal API is required

---

## Suggested Execution Order

1. keep Gogo as primary and continue filtering bad sources
2. implement absorbed AnimeKai fallback
3. re-enable AnimeKai in the provider registry
4. validate fallback behavior only when Gogo fails
5. evaluate AnimePahe stream extraction in a contained spike
6. only implement AnimePahe if the value justifies the complexity

---

## Files Most Likely In Scope

Primary:

- `src/lib/animeAddons/index.js`
- `src/lib/animeAddons/providers/gogoanime.js`
- `src/lib/animeAddons/providers/animekai.js`
- `src/lib/animeAddons/providers/animepahe.js`
- `src/lib/animeAddons/resolveAnimeStreams.js`
- `src-tauri/src/main.rs`

Reference/supporting:

- `api.consumet.org/animekai-provider.txt`
- `api.consumet.org/megaup-extractor.txt`
- `api.consumet.org/animePahe-provider.txt`

---

## Final Recommendation

The best path is:

- keep Gogoanime as the primary provider
- add AnimeKai as the first absorbed fallback
- only consider AnimePahe after AnimeKai is stable

That gives the app a meaningful fallback path for bad Gogo edge cases without immediately taking on the higher-risk AnimePahe stream-resolution work.
