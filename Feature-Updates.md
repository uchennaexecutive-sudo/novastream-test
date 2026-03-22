# Feature Updates

## Purpose
This file reformats the requested future feature list into a practical roadmap for Nova Stream.

It focuses on:
- features that are **not already implemented**
- the **best free tools/APIs** that fit the current app architecture
- what each feature solves
- the most realistic implementation direction for this project

Already completed and intentionally skipped here:
- Gogoanime in-project absorption
- AnimePahe fallback
- macOS DMG build
- AnimeKai fallback absorption idea

---

## Recommended Priority View

### High-value / low-to-medium risk
- Anime News Network feed on the Anime page
- KinoCheck official trailer integration
- IMDb rating alongside TMDB rating
- User accounts with Supabase Auth
- Generated profile pictures
- Source quality guardrails improvement
- Subtitle quality improvement

### High-value / higher-risk
- Download manager + offline playback
- Chromecast / DLNA casting
- Adaptive bitrate strategy improvements

### Long-term / platform expansion
- macOS signing + notarization
- Android + Android TV
- Samsung Tizen
- LG webOS

---

## Reformatted Checklist

## 1. Anime & Discovery

### [ ] Anime News Network feed on Anime browse page

**Why this is useful**
- Makes the anime section feel alive and current.
- Gives users a reason to revisit the Anime page even when they are not starting playback immediately.
- Adds editorial context around releases, announcements, delays, and adaptation news.

**Best free source**
- Anime News Network RSS feed
- Feed URL already identified by the project: `https://www.animenewsnetwork.com/all/rss.xml`

**Best fit for Nova Stream**
- Add a lightweight “Anime News” rail or sidebar card on the Anime page.
- Fetch and cache the feed in Rust or via a tiny in-app JS parser.
- Keep it read-only and link out to ANN articles rather than trying to scrape full pages.

**Implementation approach**
- Rust or JS fetches RSS on a reasonable cache interval.
- Parse title, link, publish date, thumbnail if present.
- Surface it in `src/pages/Anime.jsx`.
- Add local caching so opening the Anime page stays fast.

**Notes**
- This is a low-risk feature and a good polish win.

---

### [ ] KinoCheck API for high-quality official trailers

**Why this is useful**
- Improves trailer quality and reliability compared with relying only on TMDB/YouTube discoverability.
- Gives access to official trailer assets and better metadata matching.
- Strong fit for the “premium” goal of the app.

**Best free source**
- KinoCheck API
- Official and free for app/site integration with daily limits

**Best fit for Nova Stream**
- Use KinoCheck as the preferred trailer source for Movies / Series / Animation when TMDB/IMDb IDs are available.
- Fall back to current trailer behavior if KinoCheck has no result.

**Implementation approach**
- Add a small resolver module that queries KinoCheck by:
  - `tmdb_id`
  - or `imdb_id`
- Prefer the best official trailer result in English.
- Keep TMDB/YouTube fallback for titles missing in KinoCheck.

**Files likely involved**
- trailer resolution utilities
- `src/pages/Detail.jsx`

**Notes**
- Very good fit for current architecture.
- This is one of the strongest future discovery upgrades.

---

### [ ] IMDb rating alongside TMDB rating

**Why this is useful**
- Users often trust IMDb ratings differently from TMDB.
- Showing both gives more confidence and makes detail pages feel richer.
- Especially useful for older titles and cross-checking discovery quality.

**Best free source**
- IMDb non-commercial datasets (`title.ratings.tsv.gz`)

**Best fit for Nova Stream**
- Do **not** rely on fragile unofficial IMDb scraping at runtime if it can be avoided.
- Best path is to build a lightweight local/periodic lookup layer from IMDb’s non-commercial ratings dataset keyed by IMDb ID.

**Implementation approach**
- Since the app already resolves IMDb IDs for movies/series:
  - create a periodic build/update job or companion data task to ingest `title.ratings.tsv.gz`
  - generate a compact local lookup artifact keyed by `tt...`
- Display IMDb rating beside TMDB rating on detail pages.

**Alternative**
- If you want a quick prototype first, use a self-hosted unofficial IMDb API later, but dataset-based lookup is more stable.

**Notes**
- Best long-term choice is the dataset route, not scraping.

---

### [ ] Studio Ghibli section in Animation

**Why this is useful**
- Easy premium-feeling curation win.
- Ghibli is recognizable, discoverable, and ideal for a featured animation lane.
- Helps the Animation page feel editorial rather than generic.

**Best free source**
- The classic Studio Ghibli API ecosystem is free but unofficial/fan-made.
- It is mainly useful for metadata and curated listing, not playback.

**Best fit for Nova Stream**
- Use the Ghibli API only as a metadata/curation helper.
- Resolve actual titles through TMDB/Nova’s existing detail flow.

**Implementation approach**
- Build a small curated Ghibli dataset or API-backed list.
- Map Ghibli films to TMDB IDs.
- Render a dedicated “Studio Ghibli” rail in the Animation area.

**Recommendation**
- For stability, consider vendoring a static Ghibli film list instead of depending on a fragile hosted API at runtime.

**Notes**
- This is mainly a curation feature, not a streaming feature.

---

## 2. Download Manager & Offline Playback

### [ ] Download button on every detail page
### [ ] Resolution picker + episode selection grid
### [ ] Background download process + Downloads page
### [ ] Offline playback + storage indicator
### [ ] Embedded open source media engine for download/offline playback

**Why this is useful**
- This is one of the biggest “premium app” features in the whole roadmap.
- It creates real utility beyond streaming.
- Users gain background downloads, portable watching, and clearer device/storage ownership.

**What problem it solves**
- Temporary network issues
- Users wanting to save episodes/movies locally
- Travel / low-connectivity use

**Best free tools**
- `aria2` for robust background downloading
- `FFmpeg` for HLS remuxing / segment assembly / offline media finalization

**Best fit for Nova Stream**
- Use Rust to manage download jobs and persistent queue state.
- Use an embedded downloader engine rather than a hosted service.
- Use the existing resolved playback URLs as the source for downloads.

**Recommended architecture**

#### Phase A: Basic downloader
- Add a download button on detail pages.
- Let users choose:
  - movie quality
  - or episode + quality
- Queue downloads in Rust.
- Store progress in app state + persistent download metadata.

#### Phase B: Media engine
- For direct file URLs:
  - use `aria2`
- For HLS:
  - either download segments directly in Rust
  - or use `FFmpeg` to remux playlist content into a local playable file

#### Phase C: Offline playback
- Add a Downloads page.
- Show:
  - title
  - progress
  - storage used
  - status
- Let `MoviePlayer` / `AnimePlayer` open local offline files when available.

#### Phase D: Storage awareness
- Show storage consumed by downloads.
- Allow delete / cleanup from inside the app.

**Why `aria2` + `FFmpeg` is the best fit**
- Both are mature, free, cross-platform, and widely used.
- They fit the current “Rust orchestration + native player” architecture well.
- They avoid building a fragile custom downloader from scratch.

**Important caution**
- Offline downloads will increase complexity significantly.
- This should be a dedicated major phase, not a quick add-on.

---

## 3. Accounts & Personalization

### [ ] User sign-in system for cross-device watchlist and history

**Why this is useful**
- Makes the app feel like a real platform.
- Syncs watchlist and watch history across devices.
- Enables future features like user profiles, cloud saves, and personalized recommendations.

**Best free source**
- Supabase Auth

**Best fit for Nova Stream**
- Supabase is already in the project.
- Use Supabase Auth for:
  - sign-up
  - sign-in
  - session persistence
- Store user watchlist/history in Supabase tables with Row Level Security.

**Implementation approach**
- Start with email + password or magic-link auth.
- Migrate existing local watchlist/history into account-backed records after login.
- Keep offline/local fallback for signed-out users.

**Recommended sequence**
1. Auth
2. Watchlist sync
3. History sync
4. Continue Watching sync

**Notes**
- Very strong feature for long-term value.
- Also supports future mobile/TV clients later.

---

### [ ] Generated profile pictures

**Why this is useful**
- Gives the app a more polished account system.
- Makes profiles feel personal without forcing image uploads.
- Good UX win at low complexity.

**Best free tool**
- DiceBear

**Best fit for Nova Stream**
- Use deterministic generated avatars based on:
  - username
  - user id
  - chosen seed/theme
- Either:
  - use DiceBear’s free HTTP API for a quick start
  - or use the DiceBear JS library locally for full control and no runtime external dependency

**Recommended implementation**
- Prefer the local DiceBear JS library, not the hosted HTTP API, for consistency and privacy.
- Offer a curated set of styles that feel cinematic or stylized enough for Nova Stream.

**Notes**
- Easy win once accounts are in place.

---

### [ ] Adaptive bitrate / automatic quality switching

**Why this is useful**
- Makes playback feel smoother on unstable networks.
- Reduces manual quality switching.
- Better user experience for large HLS catalogs.

**What problem it solves**
- Startup delay
- buffering
- source quality mismatch

**Best fit for Nova Stream**
- This is already partly available whenever HLS.js is used, but it can be tuned much better.
- The real task is not “add ABR from zero”; it is:
  - improve startup level strategy
  - improve fallback behavior
  - expose smarter quality decisions

**Implementation approach**
- Tune HLS.js adaptive behavior in the native player path.
- Prefer lower startup levels and allow fast ramp-up.
- Add content-type-specific startup tuning if needed.

**Notes**
- This is more player tuning than new API integration.

---

### [ ] Chromecast / DLNA casting

**Why this is useful**
- One of the most premium-feeling upgrades for desktop users.
- Makes Nova Stream more useful in living-room scenarios.
- Strong perceived feature value.

**What problem it solves**
- Desktop-to-TV handoff
- Better shared viewing experience

**Best free tools**
- Chromecast:
  - Google Cast is free to develop against, but it has platform rules and registration requirements
  - open-source client libraries also exist, such as CastV2-based libraries
- DLNA / UPnP:
  - open-source ecosystems exist, but support quality varies by device

**Best fit for Nova Stream**
- Start with local-network casting from desktop to receiver.
- If implemented, make it an optional advanced feature, not a core playback dependency.

**Recommended implementation path**

#### Option A: Chromecast first
- Better brand recognition
- Better user value
- But involves Cast sender/receiver flow and more product surface

#### Option B: DLNA/UPnP first
- More open ecosystem
- Works with more TVs and renderers
- But less polished and more device-fragmented

**Most realistic recommendation**
- Defer until after account/download work unless casting becomes a top product priority.

---

## 4. Multi-Platform

### [ ] macOS signing + notarization

**Why this is useful**
- Removes trust warnings and blocked-launch friction on macOS.
- Critical if macOS is meant to be a real user-facing platform.

**What problem it solves**
- “Developer cannot be verified”
- “App is damaged” or similar gatekeeper issues

**Best official path**
- Apple code signing + notarization using `notarytool`

**Best fit for Nova Stream**
- Keep current DMG packaging.
- Add signing/notarization as the next macOS distribution step.

**Important note**
- This is not 100% free in practice because Apple Developer Program access is required.
- So this item is not a “free API/tool only” feature in the same sense as others.

**Recommendation**
- Treat as release/distribution work, not application feature work.

---

### [ ] Android + Android TV

**Why this is useful**
- Big user reach.
- Strong future growth path for synced accounts and downloads.

**Best official path**
- Tauri mobile / Android support

**Best fit for Nova Stream**
- The current React/Tauri stack can extend to Android, but not cheaply.
- The player, downloads, sidecar model, and local runtime assumptions would all need careful redesign.

**Recommendation**
- Only start after:
  - account sync exists
  - downloads are clearer
  - movie/anime providers are more stable

---

### [ ] Samsung Tizen

**Why this is useful**
- Direct TV platform presence.
- Big potential reach for living-room usage.

**Best official path**
- Tizen Web App model

**Best fit for Nova Stream**
- This would not reuse the desktop Tauri shell directly.
- Best long-term path is a separate TV web app client sharing the same app design language and backend/provider logic where possible.

**Recommendation**
- Treat this as a separate client target, not a simple extension of the desktop app.

---

### [ ] LG webOS

**Why this is useful**
- Same value proposition as Tizen: direct TV footprint.

**Best official path**
- webOS TV packaged web app

**Best fit for Nova Stream**
- Like Tizen, this is likely a separate TV client effort.
- Do not treat it as a small patch on top of the desktop app.

**Recommendation**
- Only pursue after desktop/mobile/account/download architecture is more mature.

---

## 5. Ongoing Improvements Still Worth Tracking

### [ ] Source quality guardrails improvement

**Why this is useful**
- Improves playback stability without visible UI changes.
- Prevents obvious junk providers/links from reaching the player.

**Best fit**
- This should continue as part of Nuvio and anime hardening.

---

### [ ] Subtitle quality improvement

**Why this is useful**
- Strongly affects perceived quality.
- Users notice subtitle mismatch immediately.

**Best fit**
- Keep improving subtitle ranking and release alignment.
- This is already one of the active roadmap items.

---

## Best Overall Implementation Order

Recommended future order:

1. Anime news feed
2. KinoCheck trailers
3. IMDb rating integration
4. Accounts + synced watchlist/history
5. Generated avatars
6. Nuvio/source-quality hardening
7. Subtitle quality pass
8. Download manager + offline playback
9. Adaptive bitrate tuning improvements
10. Casting
11. macOS signing/notarization
12. Android / Android TV
13. Samsung Tizen / LG webOS

---

## Best Tool / API Summary

| Feature | Best free tool / API | Fit |
|---|---|---|
| Anime news feed | Anime News Network RSS | Very strong |
| Official trailers | KinoCheck API | Very strong |
| IMDb ratings | IMDb non-commercial datasets | Strong |
| Ghibli section | Static curated mapping or Ghibli API metadata | Strong |
| Downloads | aria2 + FFmpeg | Very strong |
| Accounts | Supabase Auth | Very strong |
| Generated avatars | DiceBear JS library | Very strong |
| Adaptive bitrate | HLS.js tuning | Strong |
| Chromecast | Google Cast / CastV2-based libs | Medium |
| DLNA | UPnP/DLNA libraries | Medium |
| macOS trust | Apple signing + notarization | Required for smoother Mac distribution |
| Android | Tauri mobile | Long-term |
| Tizen | Tizen web app stack | Separate client |
| webOS | webOS TV web app stack | Separate client |

---

## Final Recommendation

If the goal is to make Nova Stream feel more premium without overextending too early, the strongest next additions are:

1. `KinoCheck API`
2. `IMDb rating integration`
3. `Anime News Network feed`
4. `Supabase accounts`
5. `Download manager + offline playback`

These give the highest visible user value while still fitting the current architecture.

