const ANILIST_URL = 'https://graphql.anilist.co'

const MEDIA_FIELDS = `
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

async function postGraphQL(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  const json = await res.json()

  if (json.errors) {
    console.error('[AniList] GraphQL errors:', json.errors)
    return null
  }

  return json.data || null
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
            ${MEDIA_FIELDS}
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
            ${MEDIA_FIELDS}
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
            ${MEDIA_FIELDS}
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
            ${MEDIA_FIELDS}
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
          ${MEDIA_FIELDS}
        }
      }
    `,
    { id: Number(anilistId) }
  )

  return data?.Media ?? null
}