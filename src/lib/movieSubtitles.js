import { invoke } from '@tauri-apps/api/core'

export async function getMovieSubtitles(tmdbId, imdbId = null, streamTitle = null) {
  return invoke('fetch_movie_subtitles', {
    payload: {
      tmdbId: String(tmdbId),
      imdbId: imdbId || null,
      contentType: 'movie',
      season: null,
      episode: null,
      streamTitle: streamTitle || null,
    },
  })
}

export async function getSeriesSubtitles(tmdbId, season, episode, imdbId = null, streamTitle = null) {
  return invoke('fetch_movie_subtitles', {
    payload: {
      tmdbId: String(tmdbId),
      imdbId: imdbId || null,
      contentType: 'series',
      season: season ?? 1,
      episode: episode ?? 1,
      streamTitle: streamTitle || null,
    },
  })
}

export async function getAnimationSubtitles(tmdbId, imdbId = null, streamTitle = null) {
  return invoke('fetch_movie_subtitles', {
    payload: {
      tmdbId: String(tmdbId),
      imdbId: imdbId || null,
      contentType: 'animation',
      season: null,
      episode: null,
      streamTitle: streamTitle || null,
    },
  })
}
