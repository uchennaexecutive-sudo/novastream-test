# Anime DUB / SUB Toggle Plan

## Intent
Add a proper DUB / SUB audio selection flow to NOVA STREAM’s anime experience so users can choose dubbed or subbed playback without changing the working anime streaming foundation.

The feature should:
- expose a global default audio preference
- allow users to switch between SUB and DUB per title
- make availability clear on anime cards and detail pages
- keep the current AniWatch + Rust HLS playback system intact

## Goal
Give users a clean, reliable way to watch anime in either sub or dub while preserving the stable anime playback path that already works.

Required product goals:
- global `Default Audio: SUB / DUB`
- DUB badge or availability indicator where possible
- detail-page `SUB / DUB` toggle
- anime player accepts selected audio category
- server labels reflect active category
- unavailable DUB episodes handled cleanly
- fallback to SUB if DUB stream resolution fails

## Non-Negotiables
- Do not break the current anime playback flow.
- Do not modify the Rust HLS architecture beyond what is necessary for existing working playback.
- Do not change `fetch_hls_segment` or `fetch_hls_manifest` behavior.
- Do not rewrite the core HLS.js loader logic if the feature can be implemented at the API/category layer.

## What Already Exists

### AniWatch API
The current HiAnime API already supports the needed audio split:
- episodes endpoint returns episode objects with a `dub` boolean
- sources endpoint accepts `category=sub` or `category=dub`

Current shape:
- `/api/v2/hianime/episode/sources?animeEpisodeId=...&server=hd-2&category=sub`

Changing to:
- `category=dub`

returns the dub stream for that same episode when available.

### AniList / Detail Data
Anime detail data may expose:
- `hasDub`
- `hasSub`

This is useful for UI hints, badges, and availability messaging, but the actual source of truth for playable DUB episodes should still be the HiAnime episode payload.

## Source of Truth

### Playback Availability
Use the AniWatch / HiAnime episode list as the source of truth for:
- which episodes exist
- which episodes have dub audio

### UI Hints
Use AniList detail data only for:
- DUB badges
- “Dub unavailable” messaging
- early availability hints on detail pages

## Recommended Product Behavior

### 1. Global Preference
Add `audioPreference` to Zustand:
- `sub`
- `dub`

Default:
- `sub`

Persist in localStorage with the rest of playback preferences.

### 2. Detail Page Audio Toggle
Add a `SUB / DUB` segmented control on anime detail pages.

Behavior:
- defaults from global `audioPreference`
- user can override per title in local component state
- selected value is passed into `AnimePlayer`

Important:
- do not silently overwrite the global preference when the user changes one title

### 3. Player Category Routing
`AnimePlayer.jsx` should accept:
- `category="sub"` or `category="dub"`

It should pass that category into the AniWatch sources request instead of hardcoding `sub`.

### 4. Episode Availability
When `DUB` is selected:
- show the full episode list
- disable episodes that do not have dub available yet

This is preferable to filtering them out entirely because:
- numbering remains consistent
- users can see dub release gaps clearly
- navigation is easier to understand

### 5. Fallback Behavior
If a DUB stream request fails:
- fallback to SUB for that playback session only
- show a short message/toast that dub was unavailable and sub was loaded instead

Do not:
- silently change the global preference
- permanently change the per-title toggle state unless the user does it

### 6. Server Labels
When current category is `sub`:
- `SUB 1`
- `SUB 2`
- `SUB 3`

When current category is `dub`:
- `DUB 1`
- `DUB 2`
- `DUB 3`

This is only a label change; the server resolution logic remains the same.

## What Should Not Change
- Rust HLS fetch commands
- manifest fetch logic
- segment fetch logic
- custom HLS loader architecture
- anime progress persistence behavior unless directly related to category tracking

## Implementation Strategy

### Phase 1: Global Preference
1. Add `audioPreference` to the Zustand store
2. Persist it with existing preferences
3. Add `Default Audio: SUB / DUB` control in Settings

### Phase 2: Availability Wiring
1. Surface `hasDub` / `hasSub` where already available on anime detail
2. Add DUB availability indicator on detail pages
3. Add DUB badge on anime cards only where the app already has this data without causing heavy extra fetches

### Phase 3: Detail Page Toggle
1. Add local `SUB / DUB` state to anime detail page
2. Initialize from global `audioPreference`
3. Pass selected category into `AnimePlayer`

### Phase 4: AnimePlayer Category Support
1. Accept `category` prop
2. Replace hardcoded `category=sub` in source resolution with the selected category
3. Update displayed server labels based on current category

### Phase 5: Episode List Awareness
1. Use episode payload `dub` boolean
2. Disable non-dub episodes when DUB is selected
3. Preserve episode order and numbering

### Phase 6: Fallback Handling
1. If DUB source resolution fails, try SUB automatically for that session
2. Show a clear notice/toast
3. Keep the toggle visible so users understand what happened

## File-Level Implementation Outline

### Likely Frontend Files
- `src/store/useAppStore.js`
  - add `audioPreference`

- `src/pages/Settings.jsx`
  - add default audio preference control

- `src/pages/Detail.jsx`
  - anime detail-level SUB / DUB toggle
  - pass `category` prop into `AnimePlayer`

- `src/components/Player/AnimePlayer.jsx`
  - accept `category`
  - pass selected category to source resolution
  - dynamic server labels
  - fallback to SUB when DUB fails
  - disable non-dub episodes in DUB mode

### Likely Existing Data Touchpoints
- `src/lib/consumet.js`
  - only if current anime source helper hardcodes `category=sub`
  - keep changes minimal and anime-specific

## Risks
- some anime may report dub availability inconsistently between AniList and HiAnime
- some episodes may have partial dub rollout
- silent fallback can confuse users if not messaged clearly
- card-level DUB badges may require careful caching if detail data is not already available

## Best UX Recommendation
- global preference in Settings
- per-title SUB/DUB toggle on detail page
- keep full episode list visible
- disable episodes with no dub instead of removing them
- session-only fallback to SUB with a clear notice

## MVP Order
1. Zustand audio preference
2. Settings toggle
3. Detail page SUB / DUB toggle
4. `AnimePlayer` category prop wiring
5. Dynamic server labels
6. Disable unavailable dub episodes
7. Session-only fallback to SUB

## Resume Note
If this feature is implemented later, begin from:
- Phase 1 global preference
- then Phase 3 detail page toggle
- then Phase 4 `AnimePlayer` wiring

Do not begin by rewriting playback internals. The value is already present at the API layer.
