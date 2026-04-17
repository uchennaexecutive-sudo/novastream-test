import gogoanimeProvider from './providers/gogoanime'
import animekaiProvider from './providers/animekai'

export const animeAddonProviders = [
    gogoanimeProvider,
    animekaiProvider,
]

export function getAnimeAddonProvider(providerId) {
    return animeAddonProviders.find((provider) => provider.id === providerId) || null
}

export function getEnabledAnimeAddonProviders() {
    return animeAddonProviders.slice()
}

export default animeAddonProviders
