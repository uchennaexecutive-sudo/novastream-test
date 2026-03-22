# Anime Routing And Performance Plan

## Goal
Fix the connected anime browse/routing problems without undoing the AniList season/franchise work that already protects:

- correct season grouping on anime detail pages
- correct episode numbering for provider matching
- long-runner exceptions like One Piece

The target outcome is:

- Anime browse loads faster
- anime titles stop leaking into the wrong TMDB/Nuvio playback path
- Home / Series / Animation route anime correctly
- existing AniList season buckets stay intact

## Core Principle
Do **not** solve anime speed by weakening AniList season mapping.

The heavy season/franchise logic is important because it prevents:

- Season 2 Episode 1 showing up as Episode 13 or Episode 25 in a flattened list
- movies / ONA / specials being mixed into Season 1
- provider episode matching breaking for anime playback

The safer optimization path is:

1. keep AniList as the anime authority
2. reduce unnecessary TMDB work
3. route likely-anime TMDB cards into the anime flow

## Problems To Solve

### 1. Anime browse is noticeably slower
Main reason:

- `src/pages/Anime.jsx` loads AniList results
- then performs TMDB matching for many browse cards during page load

That creates one AniList request plus many TMDB searches before the page settles.

### 2. Anime leaks into TMDB-driven surfaces
Anime appears under:

- Home rows
- Series
- Animation

When clicked, those items can go through the TMDB movie/series route and eventually into the Nuvio playback path, which is the wrong architecture for anime.

### 3. Existing season grouping must not regress
The current AniList mapping work in the app correctly handles titles like Jujutsu Kaisen while preserving long-runner exceptions like One Piece.

That logic should be protected.

## Recommended Solution

### Stage 1. Add Shared Anime Classification
Create one shared anime-detection utility for TMDB-driven content.

Purpose:

- detect when a TMDB card is likely anime
- reuse that decision consistently across Home / Series / Animation / search

Recommended classification rules:

- TMDB genre contains Animation
- and original language is Japanese or origin country includes Japan
- or the title already has known anime identity from existing anime matching logic

This should be a heuristic layer, not a replacement for AniList detail mapping.

### Stage 2. Fix Route Selection For Detected Anime
When a TMDB item is classified as anime:

- route it into the anime detail flow
- do not open it as normal movie/series/animation playback

Expected behavior:

- Home cards can still show anime if desired
- clicking those cards should open the anime detail route
- Nuvio should stop being asked to play anime titles

### Stage 3. Remove Eager TMDB Matching From Anime Browse
Anime browse should render quickly from AniList data first.

Current problem:

- `Anime.jsx` eagerly resolves TMDB matches for many cards at load time

Recommended change:

- render AniList cards immediately
- resolve TMDB only on click
- optionally prefetch for a very small visible subset later

Use cache aggressively so already-matched titles do not repeat work.

### Stage 4. Preserve Existing Detail/Mapper Logic
Do not flatten the existing anime detail season logic.

Preserve:

- franchise grouping
- sequel handling
- movies / ONA / OVA / specials buckets
- long-runner exceptions

This stage is mostly “protect and reuse,” not rewrite.

### Stage 5. Decide Visibility Rules
Recommended visibility policy:

- Home:
  - anime may appear, but must route into anime detail
- Series:
  - filter anime out
- Animation:
  - either filter anime out if Animation means non-anime animation
  - or allow anime but still route it into anime detail

Recommended default:

- Home: keep visible but route correctly
- Series: filter out
- Animation: product decision, but route correctly either way

### Stage 6. Re-measure Performance
After the routing fix and removal of eager TMDB matching:

- test Anime browse initial load time
- test click-to-detail transition
- test Home anime-card routing
- test Series / Animation leakage behavior

Only if Anime browse still feels heavy after this should we consider a lighter AniList browse payload.

## Files Likely Affected

### Primary Files

- `src/pages/Anime.jsx`
  - remove eager per-card TMDB resolution on initial load
  - keep AniList-first rendering
  - trigger TMDB resolution later/on click

- `src/components/Search/SearchOverlay.jsx`
  - ensure anime-like search results route into anime flow consistently where appropriate

- `src/pages/Home.jsx`
  - apply shared anime classification to TMDB-driven home cards
  - route detected anime into anime detail flow

- `src/pages/Series.jsx`
  - filter out likely-anime items or reroute them properly

- `src/pages/Animation.jsx`
  - decide whether to filter anime or allow them while routing properly

- `src/pages/Detail.jsx`
  - confirm anime detail routing remains the entry point for detected anime
  - preserve existing anime-specific state handling

### Supporting Files

- `src/lib/animeMapper.js`
  - do not rewrite casually
  - may be referenced for known anime identity decisions

- `src/lib/anilist.js`
  - possible future optimization only if browse still feels slow after click-time TMDB matching change
  - likely left mostly intact in the first pass

- `src/lib/tmdb.js`
  - reuse existing anime/TMDB matching helpers
  - may add a shared helper if needed for route-time matching

### New Helper File Recommended

- `src/lib/animeClassification.js`
  - shared `isLikelyAnimeTmdbItem(...)`
  - possible shared route helper
  - centralizes rules so Home / Series / Animation do not drift apart

## What Should Not Be Touched Aggressively

- anime provider chain
- anime playback resolver logic
- Gogoanime / AnimePahe provider internals
- AniList detail season/franchise mapping rules that already fixed JJK / One Piece style issues

## Suggested Implementation Order

1. Create `animeClassification.js`
2. Apply it to Home route handling
3. Apply it to Series and Animation browse behavior
4. Remove eager TMDB matching from `Anime.jsx`
5. Keep click-time TMDB matching with cache
6. Regression-test anime detail grouping and episode numbering

## Success Criteria

- Anime browse feels materially faster
- JJK-style season buckets remain correct
- One Piece-style long-runner behavior remains correct
- anime no longer routes into Nuvio by mistake from Home / Series / Animation
- clicking likely-anime cards consistently opens the anime detail flow

## Risks

- overly aggressive anime filtering may hide legitimate animation content
- weak classification may still leak anime into TMDB/Nuvio routes
- changing `Anime.jsx` carelessly could regress click routing if cache and fallback are not preserved

## Recommendation
Implement this as a routing/performance cleanup focused on:

- classification
- route correctness
- removing eager TMDB work

Do **not** treat it as a mapper rewrite.
