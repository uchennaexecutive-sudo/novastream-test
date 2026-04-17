const fetch = require('node-fetch');

const BASE_URL = 'https://soapertv.io';

async function getSoaperTvStreams(tmdbId, mediaType = 'movie', season = '', episode = '') {
    console.log(`[Soaper TV] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${season}E:${episode}` : ''}`);

    try {
        const contentUrl = mediaType === 'tv'
            ? `${BASE_URL}/film/${tmdbId}/season/${season}/episode/${episode}/`
            : `${BASE_URL}/film/${tmdbId}/`;

        console.log(`[Soaper TV] Fetching page: ${contentUrl}`);

        const response = await fetch(contentUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Referer': BASE_URL,
            },
            redirect: 'manual',
            timeout: 15000,
        });

        if (response.status !== 200 && response.status !== 302) {
            console.log(`[Soaper TV] Page returned ${response.status} for ${contentUrl}`);
            return [];
        }

        const html = await response.text();

        // Extract direct streamx.me MP4 URL from the page
        const streamMatch = html.match(/src=["'](https?:\/\/streamx\.me\/[^"']+\.mp4[^"']*)['"]/);
        if (!streamMatch) {
            console.log(`[Soaper TV] No streamx.me URL found on page`);
            return [];
        }

        const streamUrl = streamMatch[1];
        console.log(`[Soaper TV] Found stream: ${streamUrl}`);

        return [{
            name: 'Soaper TV',
            title: mediaType === 'tv'
                ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
                : 'Auto Quality',
            url: streamUrl,
            quality: 'Auto',
            type: 'direct',
            subtitles: [],
        }];

    } catch (error) {
        console.error(`[Soaper TV] Error: ${error.message}`);
        return [];
    }
}

module.exports = { getSoaperTvStreams };
