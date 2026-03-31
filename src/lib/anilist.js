const ANILIST_URL = 'https://graphql.anilist.co'
const ANILIST_TIMEOUT_MS = 12000
const ANILIST_RETRY_DELAY_MS = 600

const CORE_MEDIA_FIELDS = `
  id
  idMal
  type
  format
  status
  season
  seasonYear
  startDate { year month day }
  episodes
  duration
  title { english romaji native }
  synonyms
  coverImage { large extraLarge }
  bannerImage
  averageScore
  popularity
  genres
  description(asHtml: false)
  nextAiringEpisode { episode }
`

const BROWSE_RELATION_FIELDS = `
  relations {
    edges {
      relationType
      node {
        id
        format
        title { english romaji native }
      }
    }
  }
`

const BROWSE_MEDIA_FIELDS = `
  ${CORE_MEDIA_FIELDS}
  ${BROWSE_RELATION_FIELDS}
`

const SEARCH_MEDIA_FIELDS = `
  id
  format
  seasonYear
  startDate { year month day }
  title { english romaji native }
  coverImage { large extraLarge }
  averageScore
  popularity
`

const DETAIL_MEDIA_FIELDS = `
  ${CORE_MEDIA_FIELDS}
  relations {
    edges {
      relationType
      node {
        ${CORE_MEDIA_FIELDS}
        relations {
          edges {
            relationType
            node {
              id
              idMal
              type
              format
              status
              season
              seasonYear
              startDate { year month day }
              episodes
              duration
              title { english romaji native }
              synonyms
              coverImage { large extraLarge }
              bannerImage
            }
          }
        }
      }
    }
  }
`

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function postGraphQL(query, variables = {}, attempt = 1) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANILIST_TIMEOUT_MS)

  try {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })

    const text = await res.text()
    let json = null

    try {
      json = text ? JSON.parse(text) : null
    } catch (parseError) {
      console.error('[AniList] Non-JSON response:', {
        status: res.status,
        preview: text.slice(0, 200),
        attempt,
      })

      if (attempt < 2) {
        await delay(ANILIST_RETRY_DELAY_MS)
        return postGraphQL(query, variables, attempt + 1)
      }

      return null
    }

    if (!res.ok) {
      console.error('[AniList] HTTP error:', {
        status: res.status,
        body: json,
        attempt,
      })

      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await delay(ANILIST_RETRY_DELAY_MS)
        return postGraphQL(query, variables, attempt + 1)
      }

      return null
    }

    if (json?.errors) {
      console.error('[AniList] GraphQL errors:', json.errors)

      const shouldRetry = json.errors.some((error) => {
        const status = Number(error?.status)
        return status === 429 || status >= 500
      })

      if (shouldRetry && attempt < 2) {
        await delay(ANILIST_RETRY_DELAY_MS)
        return postGraphQL(query, variables, attempt + 1)
      }

      return null
    }

    return json?.data || null
  } catch (error) {
    console.error('[AniList] Request failed:', {
      message: error?.message || String(error),
      attempt,
    })

    if (attempt < 2) {
      await delay(ANILIST_RETRY_DELAY_MS)
      return postGraphQL(query, variables, attempt + 1)
    }

    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function pageQuery(q, variables = {}) {
  const data = await postGraphQL(q, variables)
  return data?.Page?.media ?? []
}

export const getTrendingAnime = (page = 1, perPage = 28) =>
  pageQuery(
    `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
            ${BROWSE_MEDIA_FIELDS}
          }
        }
      }
    `,
    { page, perPage }
  )

export const getPopularAnime = (page = 1, perPage = 28) =>
  pageQuery(
    `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
            ${BROWSE_MEDIA_FIELDS}
          }
        }
      }
    `,
    { page, perPage }
  )

export const getTopRatedAnime = (page = 1, perPage = 28) =>
  pageQuery(
    `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(sort: SCORE_DESC, type: ANIME, isAdult: false) {
            ${BROWSE_MEDIA_FIELDS}
          }
        }
      }
    `,
    { page, perPage }
  )

export const searchAnime = (search) =>
  pageQuery(
    `
      query ($search: String) {
        Page(perPage: 12) {
          media(type: ANIME, search: $search, isAdult: false) {
            ${SEARCH_MEDIA_FIELDS}
          }
        }
      }
    `,
    { search }
  )

export async function getAnimeById(anilistId) {
  const data = await postGraphQL(
    `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${DETAIL_MEDIA_FIELDS}
        }
      }
    `,
    { id: Number(anilistId) }
  )

  return data?.Media ?? null
}
