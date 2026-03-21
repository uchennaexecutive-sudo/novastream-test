import gogoanimeProvider from './providers/gogoanime'
import animepaheProvider from './providers/animepahe'

export const animeAddonProviders = [
    gogoanimeProvider,
    animepaheProvider,
]

export function getAnimeAddonProvider(providerId) {
    return animeAddonProviders.find((provider) => provider.id === providerId) || null
}

export function getEnabledAnimeAddonProviders() {
    return animeAddonProviders.slice()
}

export default animeAddonProviders
