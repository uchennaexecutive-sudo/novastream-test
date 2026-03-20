# Nuvio Sidecar Notes

This directory vendors the forked `NuvioStreamsAddon` source so Nova Stream can run it locally as an internal sidecar.

The active app runtime no longer depends on a hosted Nuvio/Vercel endpoint. The sidecar is started by Tauri on demand and used through loopback only.

## What Nova Stream Uses

Nova Stream currently depends on these routes only:

- `/stream/movie/{imdb}.json`
- `/stream/series/{imdb}:{season}:{episode}.json`
- `/manifest.json` for local health checks

Rust normalizes the returned Stremio-style `streams[]` into the native player contract used by Movies / Series / Animation.

## Current Runtime Model

- Rust starts the sidecar locally on `http://127.0.0.1:7779`
- Rust health-checks `/manifest.json`
- Rust uses staged provider fetches:
  - primary provider pass
  - fast provider pass
  - full fallback pass
- Rust validates candidate URLs before they reach the native player
- The sidecar is stopped on app exit

## Local Runtime Notes

- The app sets `PORT=7779` when starting the sidecar
- `node_modules` are installed locally on first sidecar startup if missing
- Redis and external-provider mode are disabled by default
- Stream cache is enabled in the vendored `.env`

## Known Limitations

- Some titles still fail because returned provider links are bad, expired, HTML pages, or otherwise not truly playable
- Subtitle alignment for Movies / Animation is still source-dependent because subtitles come from Wyzie, not from Nuvio itself
- Problematic providers are filtered and deprioritized, but not every bad upstream title can be recovered automatically

## Diagnostics

Relevant Rust log prefixes:

- `[nuvio_sidecar] ...`
- `[fetch_movie_resolver_streams] ...`
- `[fetch_movie_subtitles] ...`

These logs are the primary source of truth when a title fails during sidecar startup, provider staging, validation, or player startup.

## Source

- Origin fork: `https://github.com/uchennaexecutive-sudo/NuvioStreamsAddon`
