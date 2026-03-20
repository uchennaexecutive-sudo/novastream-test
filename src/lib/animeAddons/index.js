import gogoanimeProvider from './providers/gogoanime'

export const animeAddonProviders = [
    gogoanimeProvider,
]

export function getAnimeAddonProvider(providerId) {
    return animeAddonProviders.find((provider) => provider.id === providerId) || null
}

export function getEnabledAnimeAddonProviders() {
    return animeAddonProviders.slice()
}

export default animeAddonProviders