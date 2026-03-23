import { invoke } from '@tauri-apps/api/core'

async function fetchResolvedStreams(tmdbId, contentType, season, episode, imdbId, options = {}) {
  return invoke('fetch_movie_resolver_streams', {
    payload: {
      tmdbId: String(tmdbId),
      contentType,
      season: season ?? null,
      episode: episode ?? null,
      imdbId: imdbId || null,
      forceRefresh: Boolean(options.forceRefresh),
      excludeUrls: Array.isArray(options.excludeUrls) ? options.excludeUrls : [],
      excludeProviders: Array.isArray(options.excludeProviders) ? options.excludeProviders : [],
    },
  })
}

export async function getMovieStreams(tmdbId, imdbId = null, options = {}) {
  return fetchResolvedStreams(tmdbId, 'movie', null, null, imdbId, options)
}

export async function getSeriesStreams(tmdbId, season, episode, imdbId = null, options = {}) {
  return fetchResolvedStreams(tmdbId, 'series', season, episode, imdbId, options)
}

export async function getAnimationStreams(tmdbId, imdbId = null, options = {}) {
  return fetchResolvedStreams(tmdbId, 'animation', null, null, imdbId, options)
}

export async function getMovieStream(tmdbId, imdbId = null) {
  const streams = await getMovieStreams(tmdbId, imdbId)
  return streams[0]
}

export async function getSeriesStream(tmdbId, season, episode, imdbId = null) {
  const streams = await getSeriesStreams(tmdbId, season, episode, imdbId)
  return streams[0]
}

export const getAnimationStream = getMovieStream
