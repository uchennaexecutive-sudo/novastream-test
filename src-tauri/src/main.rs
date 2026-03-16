#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures_util::StreamExt;
use regex::Regex;
use reqwest::Url;
use tauri::ipc::Response;
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewUrl};
use tokio::sync::oneshot;

const STREAM_CAPTURE_SCHEME: &str = "novastream-capture";
const ANIME_DEBUG_LOG_FILE: &str = "nova-stream-anime-debug.log";
const RESOLVER_DEBUG_LOG_FILE: &str = "nova-stream-resolver-debug.log";
const ANIWATCH_BASE_URL: &str = "https://aniwatch-api-orcin-six.vercel.app";
const ANIME_ROUGE_BASE_URL: &str = "https://api-anime-rouge.vercel.app";
const TMDB_API_KEY: &str = "49bd672b0680fac7de50e5b9f139a98b";
const TMDB_BASE_URL: &str = "https://api.themoviedb.org/3";
const NUVIO_STREAMS_BASE_URL: &str = "https://nuvio-streams-addon-fawn.vercel.app";
const WYZIE_SUBTITLES_BASE_URL: &str = "https://sub.wyzie.io";
const IFRAME_PLAYER_WINDOW_LABEL: &str = "iframe-player";
const BROWSER_FETCH_BRIDGE_WINDOW_LABEL: &str = "browser-fetch-bridge";
const IFRAME_PLAYER_BROWSER_ARGS: &str =
    "--disable-web-security --allow-running-insecure-content --disable-features=IsolateOrigins,site-per-process";
const IFRAME_PLAYER_DATA_DIR: &str = "iframe-player-webview";
const STREAM_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (window.__NOVA_STREAM_CAPTURE__) return;
  window.__NOVA_STREAM_CAPTURE__ = true;

  const patterns = [
    /\.m3u8(?:$|[?#])/i,
    /\.mp4(?:$|[?#])/i,
    /\/hls-playback\//i,
    /\/master\.m3u8(?:$|[?#])/i,
    /\/playlist(?:\.m3u8)?(?:$|[?#])/i
  ];
  const framePatterns = [
    /\/embed\//i,
    /cloudnestra/i,
    /vidora/i,
    /vidsrc/i,
    /vsembed/i,
    /autoembed/i,
    /moviesapi/i,
    /nontonfilm/i
  ];
  let reported = false;

  const matches = (value) => {
    const url = String(value || '');
    return url && patterns.some((pattern) => pattern.test(url));
  };

  const matchesFrame = (value) => {
    const url = String(value || '');
    return url && !matches(url) && framePatterns.some((pattern) => pattern.test(url));
  };

  const report = (value, kind = 'stream') => {
    const url = String(value || '');
    const isValid = kind === 'frame' ? matchesFrame(url) : matches(url);
    if (!isValid || reported) return;
    reported = true;
    window.location.replace(
      'novastream-capture://capture?kind='
      + encodeURIComponent(kind)
      + '&url='
      + encodeURIComponent(url)
      + '&page='
      + encodeURIComponent(window.location.href)
    );
  };

  const scanPage = () => {
    try {
      performance.getEntriesByType('resource').forEach((entry) => report(entry.name));
    } catch (_) {}

    try {
      document.querySelectorAll('video, source').forEach((node) => {
        if (node.src) report(node.src);
        if (node.currentSrc) report(node.currentSrc);
      });
    } catch (_) {}

    try {
      document.querySelectorAll('iframe').forEach((node) => {
        if (node.src) report(node.src, 'frame');
      });
    } catch (_) {}
  };

  const attemptPlay = () => {
    try {
      document.querySelectorAll('video').forEach((node) => {
        try {
          node.muted = true;
          const result = node.play && node.play();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch (_) {}
      });
    } catch (_) {}

    try {
      const player = typeof window.jwplayer === 'function' ? window.jwplayer() : null;
      if (player) {
        try { if (typeof player.setMute === 'function') player.setMute(true); } catch (_) {}
        try { if (typeof player.play === 'function') player.play(true); } catch (_) {}
      }
    } catch (_) {}

    try {
      const candidates = [
        '.jw-display-icon-container',
        '.jw-icon-display',
        '.jwplayer',
        '.vjs-big-play-button',
        '.plyr__control--overlaid',
        '[aria-label*="Play"]',
        '[title*="Play"]',
        'button'
      ];

      for (const selector of candidates) {
        const element = document.querySelector(selector);
        if (element && typeof element.click === 'function') {
          element.click();
          break;
        }
      }
    } catch (_) {}
  };

  const wrapProperty = (prototype, property) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor || !descriptor.set) return;

      Object.defineProperty(prototype, property, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          report(value, prototype === HTMLIFrameElement.prototype ? 'frame' : 'stream');
          return descriptor.set.call(this, value);
        }
      });
    } catch (_) {}
  };

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      try {
        report(typeof input === 'string' ? input : input && input.url);
      } catch (_) {}

      return originalFetch.apply(this, arguments).then((response) => {
        try {
          report(response && response.url);
        } catch (_) {}
        return response;
      });
    };
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    report(url);
    return originalXhrOpen.apply(this, arguments);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const lowerName = String(name).toLowerCase();
    if (['src', 'data-src', 'href'].includes(lowerName)) {
      const isIframe = typeof HTMLIFrameElement !== 'undefined' && this instanceof HTMLIFrameElement;
      report(value, isIframe ? 'frame' : 'stream');
    }
    return originalSetAttribute.apply(this, arguments);
  };

  if (typeof HTMLMediaElement !== 'undefined') {
    wrapProperty(HTMLMediaElement.prototype, 'src');
  }
  if (typeof HTMLSourceElement !== 'undefined') {
    wrapProperty(HTMLSourceElement.prototype, 'src');
  }
  if (typeof HTMLIFrameElement !== 'undefined') {
    wrapProperty(HTMLIFrameElement.prototype, 'src');
  }

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => report(entry.name));
      });
      observer.observe({ entryTypes: ['resource'] });
    } catch (_) {}
  }

  window.addEventListener('load', scanPage);
  window.addEventListener('load', attemptPlay);
  document.addEventListener('DOMContentLoaded', scanPage);
  document.addEventListener('DOMContentLoaded', attemptPlay);
  setInterval(() => {
    scanPage();
    attemptPlay();
  }, 1000);
  attemptPlay();
  scanPage();
})();
"#;

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    window.minimize().unwrap();
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap() {
        window.unmaximize().unwrap();
    } else {
        window.maximize().unwrap();
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    window.close().unwrap();
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IframePlayerWindowPayload {
    tmdb_id: String,
    media_type: String,
    title: String,
    poster_path: String,
    backdrop_path: String,
    season: u32,
    episode: u32,
    resume_at: u32,
    duration_hint_seconds: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CaptureKind {
    Stream,
    Frame,
}

#[derive(Clone, Debug)]
struct CapturedNavigation {
    url: String,
    page_url: Option<String>,
    kind: CaptureKind,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedEmbedStream {
    stream_url: String,
    stream_type: String,
    provider_host: String,
    page_url: Option<String>,
    headers: HashMap<String, String>,
    session_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveEmbedStreamPayload {
    provider_id: Option<String>,
    embed_url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovieSubtitleRequest {
    tmdb_id: String,
    imdb_id: Option<String>,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedMovieSubtitle {
    url: String,
    label: String,
    language: String,
    format: String,
    source: String,
    hearing_impaired: bool,
}

struct StaticCaptureResolution {
    resolved_stream: Option<ResolvedEmbedStream>,
    next_url: String,
    session_client: reqwest::Client,
    final_page_url: Option<String>,
    session_cookie_header: Option<String>,
}

#[derive(Clone)]
struct ResolverPlaybackSession {
    client: reqwest::Client,
    page_url: Option<String>,
    window_label: Option<String>,
    window_loaded: bool,
    cookie_header: Option<String>,
}

static RESOLVER_SESSIONS: OnceLock<Mutex<HashMap<String, ResolverPlaybackSession>>> = OnceLock::new();
static BROWSER_FETCH_COUNTER: AtomicU64 = AtomicU64::new(1);
static BROWSER_FETCH_BRIDGE_READY: AtomicBool = AtomicBool::new(false);
static PENDING_BROWSER_FETCHES: OnceLock<
    Mutex<HashMap<String, oneshot::Sender<Result<BrowserFetchResponse, String>>>>,
> = OnceLock::new();

fn resolver_sessions() -> &'static Mutex<HashMap<String, ResolverPlaybackSession>> {
    RESOLVER_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_browser_fetches(
) -> &'static Mutex<HashMap<String, oneshot::Sender<Result<BrowserFetchResponse, String>>>> {
    PENDING_BROWSER_FETCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFetchRequestEvent {
    request_id: String,
    url: String,
    response_type: String,
    page_url: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFetchCompletePayload {
    request_id: String,
    ok: bool,
    response_type: String,
    text: Option<String>,
    data_base64: Option<String>,
    error: Option<String>,
    status: Option<u16>,
}

struct BrowserFetchResponse {
    text: Option<String>,
    bytes: Option<Vec<u8>>,
    status: Option<u16>,
}

fn build_resolver_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .cookie_store(true)
        .build()
        .map_err(|e| e.to_string())
}

fn generate_resolver_session_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("resolver-session-{timestamp}")
}

fn store_resolver_session(
    client: reqwest::Client,
    page_url: Option<String>,
    cookie_header: Option<String>,
    _provider_id: Option<String>,
) -> Option<String> {
    let session_id = generate_resolver_session_id();
    let session = ResolverPlaybackSession {
        client,
        page_url,
        window_label: None,
        window_loaded: false,
        cookie_header,
    };

    if let Ok(mut sessions) = resolver_sessions().lock() {
        if sessions.len() > 24 {
            let stale_keys = sessions
                .keys()
                .take(sessions.len().saturating_sub(24))
                .cloned()
                .collect::<Vec<_>>();
            for key in stale_keys {
                sessions.remove(&key);
            }
        }

        sessions.insert(session_id.clone(), session);
        return Some(session_id);
    }

    None
}

fn update_resolver_session_page_url(session_id: &str, page_url: Option<String>) {
    if let Ok(mut sessions) = resolver_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            if page_url.is_some() {
                session.page_url = page_url;
            }
        }
    }
}

fn update_resolver_session_window(
    session_id: &str,
    window_label: Option<String>,
    window_loaded: Option<bool>,
) {
    if let Ok(mut sessions) = resolver_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            if window_label.is_some() {
                session.window_label = window_label;
            }
            if let Some(window_loaded) = window_loaded {
                session.window_loaded = window_loaded;
            }
        }
    }
}

fn clear_resolver_session_window(label: &str) {
    if let Ok(mut sessions) = resolver_sessions().lock() {
        for session in sessions.values_mut() {
            if session.window_label.as_deref() == Some(label) {
                session.window_label = None;
                session.window_loaded = false;
            }
        }
    }
}

fn resolver_session(session_id: Option<&str>) -> Option<ResolverPlaybackSession> {
    let session_id = session_id?;
    resolver_sessions()
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

fn aniwatch_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .expect("failed to build AniWatch client")
}

fn aniwatch_api_url(path: &str) -> Result<Url, String> {
    let base = Url::parse(ANIWATCH_BASE_URL).map_err(|e| e.to_string())?;
    base.join(path.trim_start_matches('/'))
        .map_err(|e| e.to_string())
}

fn anime_rouge_api_url(path: &str) -> Result<Url, String> {
    let base = Url::parse(ANIME_ROUGE_BASE_URL).map_err(|e| e.to_string())?;
    base.join(path.trim_start_matches('/'))
        .map_err(|e| e.to_string())
}

async fn fetch_aniwatch_json(url: Url) -> Result<serde_json::Value, String> {
    log_anime_debug(&format!("[aniwatch] URL: {}", url));

    let response = aniwatch_client()
        .get(url.clone())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            log_anime_debug(&format!("[aniwatch] Request error: {e}"));
            e.to_string()
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|e| {
        log_anime_debug(&format!("[aniwatch] Body read error: {e}"));
        e.to_string()
    })?;
    let preview: String = body.chars().take(300).collect();

    log_anime_debug(&format!("[aniwatch] Status: {}", status));
    log_anime_debug(&format!("[aniwatch] Body preview: {}", preview));

    if !status.is_success() {
        return Err(format!("AniWatch request failed: HTTP {}", status));
    }

    serde_json::from_str(&body).map_err(|e| {
        log_anime_debug(&format!("[aniwatch] JSON parse error: {e}"));
        e.to_string()
    })
}

async fn fetch_anime_rouge_json(url: Url) -> Result<serde_json::Value, String> {
    log_anime_debug(&format!("[anime-rouge] URL: {}", url));

    let response = aniwatch_client()
        .get(url.clone())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            log_anime_debug(&format!("[anime-rouge] Request error: {e}"));
            e.to_string()
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|e| {
        log_anime_debug(&format!("[anime-rouge] Body read error: {e}"));
        e.to_string()
    })?;
    let preview: String = body.chars().take(300).collect();

    log_anime_debug(&format!("[anime-rouge] Status: {}", status));
    log_anime_debug(&format!("[anime-rouge] Body preview: {}", preview));

    if !status.is_success() {
        return Err(format!("Anime Rouge request failed: HTTP {}", status));
    }

    serde_json::from_str(&body).map_err(|e| {
        log_anime_debug(&format!("[anime-rouge] JSON parse error: {e}"));
        e.to_string()
    })
}

fn normalize_anime_rouge_track(track: &serde_json::Value) -> Option<serde_json::Value> {
    let file = track
        .get("file")
        .or_else(|| track.get("url"))
        .and_then(|value| value.as_str())?;
    let lang = track
        .get("lang")
        .or_else(|| track.get("label"))
        .and_then(|value| value.as_str())
        .unwrap_or("Unknown");

    Some(serde_json::json!({
        "kind": if lang.eq_ignore_ascii_case("thumbnails") { "thumbnails" } else { "captions" },
        "lang": lang,
        "label": lang,
        "file": file,
        "url": file,
        "default": track.get("default").and_then(|value| value.as_bool()).unwrap_or(false),
    }))
}

fn normalize_anime_rouge_source_payload(payload: &serde_json::Value) -> serde_json::Value {
    let sources = payload
        .get("sources")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|source| {
            let url = source.get("url").and_then(|value| value.as_str())?;
            let source_type = if source
                .get("type")
                .and_then(|value| value.as_str())
                .map(|value| value.eq_ignore_ascii_case("hls"))
                .unwrap_or(false)
                || source
                    .get("isM3U8")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
            {
                "hls"
            } else {
                "mp4"
            };

            Some(serde_json::json!({
                "url": url,
                "type": source_type,
                "quality": source.get("quality").cloned().unwrap_or(serde_json::Value::Null),
            }))
        })
        .collect::<Vec<_>>();

    let subtitles = payload
        .get("subtitles")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let tracks = subtitles
        .into_iter()
        .filter_map(|track| normalize_anime_rouge_track(&track))
        .collect::<Vec<_>>();

    serde_json::json!({
        "sources": sources,
        "tracks": tracks,
        "headers": {},
    })
}

#[tauri::command]
async fn search_hianime(title: String) -> Result<serde_json::Value, String> {
    let mut url = aniwatch_api_url("/api/v2/hianime/search")?;
    url.query_pairs_mut()
        .append_pair("q", &title)
        .append_pair("page", "1");

    let payload = fetch_aniwatch_json(url).await?;
    let anime = payload
        .pointer("/data/animes/0")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    if !anime.is_null() {
        return Ok(anime);
    }

    let mut rouge_url = anime_rouge_api_url("/aniwatch/search")?;
    rouge_url
        .query_pairs_mut()
        .append_pair("keyword", &title)
        .append_pair("page", "1");

    let rouge_payload = fetch_anime_rouge_json(rouge_url).await?;
    Ok(rouge_payload
        .pointer("/animes/0")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
async fn get_hianime_episodes(anime_id: String) -> Result<serde_json::Value, String> {
    let url = aniwatch_api_url(&format!("/api/v2/hianime/anime/{anime_id}/episodes"))?;
    let payload = fetch_aniwatch_json(url).await?;
    let episodes = payload
        .pointer("/data/episodes")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));

    if episodes.as_array().map(|items| !items.is_empty()).unwrap_or(false) {
        return Ok(episodes);
    }

    let rouge_url = anime_rouge_api_url(&format!("/aniwatch/episodes/{anime_id}"))?;
    let rouge_payload = fetch_anime_rouge_json(rouge_url).await?;
    let rouge_episodes = rouge_payload
        .get("episodes")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|episode| {
            let number = episode
                .get("number")
                .or_else(|| episode.get("episodeNo"))
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let title = episode
                .get("title")
                .or_else(|| episode.get("name"))
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            serde_json::json!({
                "number": number,
                "title": title,
                "episodeId": episode.get("episodeId").cloned().unwrap_or(serde_json::Value::Null),
                "isFiller": episode.get("isFiller").or_else(|| episode.get("filler")).cloned().unwrap_or(serde_json::Value::Bool(false)),
                "dub": episode.get("dub").cloned().unwrap_or(serde_json::Value::Bool(false)),
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::Value::Array(rouge_episodes))
}

#[tauri::command]
async fn get_hianime_stream(
    episode_id: String,
    server: String,
    category: String,
    fresh: bool,
) -> Result<serde_json::Value, String> {
    let mut url = aniwatch_api_url("/api/v2/hianime/episode/sources")?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("animeEpisodeId", &episode_id)
            .append_pair("server", &server)
            .append_pair("category", &category);

        if fresh {
            query.append_pair("_ts", &SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .to_string());
        }
    }

    match fetch_aniwatch_json(url).await {
        Ok(payload) => {
            let data = payload.get("data").cloned().unwrap_or(serde_json::Value::Null);
            let has_sources = data
                .get("sources")
                .and_then(|value| value.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);

            if has_sources {
                return Ok(data);
            }

            log_anime_debug("[aniwatch] Source payload empty, falling back to Anime Rouge");
        }
        Err(error) => {
            log_anime_debug(&format!(
                "[aniwatch] Source request failed, falling back to Anime Rouge: {error}"
            ));
        }
    }

    let mut rouge_url = anime_rouge_api_url("/aniwatch/episode-srcs")?;
    rouge_url.query_pairs_mut().append_pair("id", &episode_id);
    let rouge_payload = fetch_anime_rouge_json(rouge_url).await?;
    Ok(normalize_anime_rouge_source_payload(&rouge_payload))
}

#[tauri::command]
async fn fetch_anime_text(url: String, headers: HashMap<String, String>) -> Result<String, String> {
    log_anime_debug(&format!("[fetch_anime_text] URL: {}", url));
    log_anime_debug(&format!("[fetch_anime_text] Headers sent: {:?}", headers));

    let client = reqwest::Client::new();
    let mut request = client.get(&url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_anime_text] Request error: {e}"));
        e.to_string()
    })?;
    let status = response.status();
    let body = response.text().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_anime_text] Body read error: {e}"));
        e.to_string()
    })?;
    let preview: String = body.chars().take(300).collect();

    log_anime_debug(&format!("[fetch_anime_text] Status: {}", status));
    log_anime_debug(&format!("[fetch_anime_text] Body preview: {}", preview));

    if !status.is_success() {
        return Err(format!("Anime text fetch failed: HTTP {}", status));
    }

    Ok(body)
}

fn iframe_player_route(payload: &IframePlayerWindowPayload) -> Result<String, String> {
    let mut url = Url::parse("https://novastream.local/player-window").map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("tmdbId", &payload.tmdb_id);
        query.append_pair("mediaType", &payload.media_type);
        query.append_pair("title", &payload.title);
        query.append_pair("posterPath", &payload.poster_path);
        query.append_pair("backdropPath", &payload.backdrop_path);
        query.append_pair("season", &payload.season.to_string());
        query.append_pair("episode", &payload.episode.to_string());
        query.append_pair("resumeAt", &payload.resume_at.to_string());
        query.append_pair(
            "durationHintSeconds",
            &payload.duration_hint_seconds.to_string(),
        );
    }

    Ok(format!(
        "/player-window?{}",
        url.query().unwrap_or_default()
    ))
}

fn browser_fetch_bridge_route() -> String {
    "/fetch-bridge".to_string()
}

fn resolver_session_window_label() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("resolver-session-window-{timestamp}")
}

fn iframe_player_data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(IFRAME_PLAYER_DATA_DIR);
    fs::create_dir_all(&data_directory).map_err(|e| e.to_string())?;
    Ok(data_directory)
}

fn generate_browser_fetch_request_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let counter = BROWSER_FETCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("browser-fetch-{timestamp}-{counter}")
}

fn ensure_browser_fetch_bridge_window(
    app: &tauri::AppHandle,
) -> Result<(tauri::WebviewWindow, bool), String> {
    if let Some(existing) = app.get_webview_window(BROWSER_FETCH_BRIDGE_WINDOW_LABEL) {
        return Ok((existing, false));
    }

    BROWSER_FETCH_BRIDGE_READY.store(false, Ordering::SeqCst);

    let data_directory = iframe_player_data_directory(app)?;
    let route = browser_fetch_bridge_route();
    let window = tauri::WebviewWindowBuilder::new(
        app,
        BROWSER_FETCH_BRIDGE_WINDOW_LABEL,
        WebviewUrl::App(route.into()),
    )
    .title("browser-fetch-bridge")
    .inner_size(320.0, 240.0)
    .visible(false)
    .focused(false)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(false)
    .additional_browser_args(IFRAME_PLAYER_BROWSER_ARGS)
    .data_directory(data_directory)
    .build()
    .map_err(|e| e.to_string())?;

    Ok((window, true))
}

async fn wait_for_resolver_session_window_load(session_id: &str) -> Result<(), String> {
    for _ in 0..120 {
        let loaded = resolver_sessions()
            .lock()
            .map_err(|e| e.to_string())?
            .get(session_id)
            .map(|session| session.window_loaded)
            .unwrap_or(false);

        if loaded {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err("Resolver session window did not finish loading".to_string())
}

fn resolver_session_page_url(
    session_id: &str,
    fallback_page_url: Option<String>,
) -> Result<String, String> {
    if let Some(page_url) = resolver_session(Some(session_id)).and_then(|session| session.page_url) {
        return Ok(page_url);
    }

    fallback_page_url.ok_or_else(|| "Resolver session has no page URL".to_string())
}

async fn ensure_resolver_session_window(
    app: &tauri::AppHandle,
    session_id: &str,
    fallback_page_url: Option<String>,
) -> Result<tauri::WebviewWindow, String> {
    let page_url = resolver_session_page_url(session_id, fallback_page_url)?;
    let existing_label = resolver_session(Some(session_id)).and_then(|session| session.window_label);

    if let Some(label) = existing_label {
        if let Some(existing) = app.get_webview_window(&label) {
            if !resolver_session(Some(session_id))
                .map(|session| session.window_loaded)
                .unwrap_or(false)
            {
                wait_for_resolver_session_window_load(session_id).await?;
            }
            return Ok(existing);
        }

        update_resolver_session_window(session_id, None, Some(false));
    }

    let target_url = Url::parse(&page_url).map_err(|e| e.to_string())?;
    let label = resolver_session_window_label();
    let data_directory = iframe_player_data_directory(app)?;
    let session_id_owned = session_id.to_string();
    let label_for_load = label.clone();

    update_resolver_session_window(session_id, Some(label.clone()), Some(false));

    tauri::WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::External(target_url))
        .title("resolver-session")
        .visible(false)
        .focused(false)
        .decorations(false)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(1.0, 1.0)
        .additional_browser_args(IFRAME_PLAYER_BROWSER_ARGS)
        .data_directory(data_directory)
        .on_page_load(move |_window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                log_resolver_debug(&format!(
                    "[resolver_session_window] loaded session_id={} label={} url={}",
                    session_id_owned,
                    label_for_load,
                    payload.url()
                ));
                update_resolver_session_page_url(&session_id_owned, Some(payload.url().to_string()));
                update_resolver_session_window(&session_id_owned, Some(label_for_load.clone()), Some(true));
            }
        })
        .build()
        .map_err(|e| {
            update_resolver_session_window(session_id, None, Some(false));
            e.to_string()
        })?;

    wait_for_resolver_session_window_load(session_id).await?;

    app.get_webview_window(&label)
        .ok_or_else(|| "Resolver session window not found after creation".to_string())
}

fn browser_fetch_eval_script(
    request_id: &str,
    url: &str,
    response_type: &str,
    page_url: &str,
) -> Result<String, String> {
    let request_id_json = serde_json::to_string(request_id).map_err(|e| e.to_string())?;
    let url_json = serde_json::to_string(url).map_err(|e| e.to_string())?;
    let response_type_json = serde_json::to_string(response_type).map_err(|e| e.to_string())?;
    let page_url_json = serde_json::to_string(page_url).map_err(|e| e.to_string())?;

    Ok(format!(
        r#"
(() => {{
  const requestId = {request_id_json};
  const url = {url_json};
  const responseType = {response_type_json};
  const pageUrl = {page_url_json};

  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;

  const arrayBufferToBase64 = (buffer) => {{
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {{
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }}

    return btoa(binary);
  }};

  const complete = async (payload) => {{
    if (!invoke) {{
      throw new Error('Tauri invoke unavailable in resolver session window');
    }}

    await invoke('complete_browser_fetch', {{ payload }});
  }};

  void (async () => {{
    try {{
      const response = await fetch(url, {{
        credentials: 'include',
        cache: 'no-store',
        referrer: pageUrl || undefined,
        referrerPolicy: pageUrl ? 'unsafe-url' : undefined,
      }});

      if (responseType === 'arrayBuffer') {{
        const buffer = await response.arrayBuffer();
        await complete({{
          requestId,
          ok: response.ok,
          responseType,
          dataBase64: arrayBufferToBase64(buffer),
          status: response.status,
          error: response.ok ? null : `HTTP ${{response.status}}`,
        }});
        return;
      }}

      const text = await response.text();
      await complete({{
        requestId,
        ok: response.ok,
        responseType,
        text,
        status: response.status,
        error: response.ok ? null : `HTTP ${{response.status}}`,
      }});
    }} catch (error) {{
      await complete({{
        requestId,
        ok: false,
        responseType,
        error: error instanceof Error ? error.message : String(error),
      }});
    }}
  }})();
}})();
"#
    ))
}

async fn browser_fetch_via_session_window(
    app: tauri::AppHandle,
    url: String,
    response_type: &str,
    session_id: &str,
    fallback_page_url: Option<String>,
) -> Result<BrowserFetchResponse, String> {
    let page_url = resolver_session_page_url(session_id, fallback_page_url.clone())?;
    let window = ensure_resolver_session_window(&app, session_id, fallback_page_url).await?;
    let request_id = generate_browser_fetch_request_id();
    let (tx, rx) = oneshot::channel();

    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] queued request_id={} session_id={} response_type={} url={} page_url={}",
        request_id,
        session_id,
        response_type,
        url,
        page_url
    ));

    pending_browser_fetches()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), tx);

    let script = browser_fetch_eval_script(&request_id, &url, response_type, &page_url)?;
    if let Err(error) = window.eval(script.as_str()) {
        let _ = pending_browser_fetches()
            .lock()
            .map(|mut pending| pending.remove(&request_id));
        return Err(error.to_string());
    }

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => {
            log_resolver_debug(&format!(
                "[browser_fetch_via_session_window] completed request_id={} status={:?}",
                request_id,
                result.as_ref().ok().and_then(|value| value.status)
            ));
            result
        }
        Ok(Err(_)) => {
            log_resolver_debug(&format!(
                "[browser_fetch_via_session_window] channel closed request_id={}",
                request_id
            ));
            Err("Browser fetch channel closed".to_string())
        }
        Err(_) => {
            let _ = pending_browser_fetches()
                .lock()
                .map(|mut pending| pending.remove(&request_id));
            log_resolver_debug(&format!(
                "[browser_fetch_via_session_window] timeout request_id={}",
                request_id
            ));
            Err("Browser fetch timed out".to_string())
        }
    }
}

#[tauri::command]
fn browser_fetch_bridge_ready(window: tauri::Window) -> Result<(), String> {
    if window.label() == BROWSER_FETCH_BRIDGE_WINDOW_LABEL {
        BROWSER_FETCH_BRIDGE_READY.store(true, Ordering::SeqCst);
        log_resolver_debug("[browser_fetch_bridge] ready");
    }

    Ok(())
}

async fn browser_fetch_via_bridge(
    app: tauri::AppHandle,
    url: String,
    response_type: &str,
    session_id: Option<&str>,
    fallback_page_url: Option<String>,
) -> Result<BrowserFetchResponse, String> {
    if let Some(session_id) = session_id {
        return browser_fetch_via_session_window(
            app,
            url,
            response_type,
            session_id,
            fallback_page_url,
        )
        .await;
    }

    let session_page_url = resolver_session(session_id).and_then(|session| session.page_url);
    let page_url = session_page_url.or(fallback_page_url);
    let request_id = generate_browser_fetch_request_id();
    let (tx, rx) = oneshot::channel();

    log_resolver_debug(&format!(
        "[browser_fetch_via_bridge] queued request_id={} response_type={} url={} page_url={:?} session_id={:?}",
        request_id,
        response_type,
        url,
        page_url,
        session_id
    ));

    pending_browser_fetches()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), tx);

    let emit_result = async {
        let (window, created) = ensure_browser_fetch_bridge_window(&app)?;
        if created {
            log_resolver_debug("[browser_fetch_via_bridge] created bridge window");
        }

        for _ in 0..50 {
            if BROWSER_FETCH_BRIDGE_READY.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        if !BROWSER_FETCH_BRIDGE_READY.load(Ordering::SeqCst) {
            return Err("Browser fetch bridge not ready".to_string());
        }

        log_resolver_debug(&format!(
            "[browser_fetch_via_bridge] emitting request_id={}",
            request_id
        ));

        window
            .emit(
                "browser-fetch-request",
                BrowserFetchRequestEvent {
                    request_id: request_id.clone(),
                    url,
                    response_type: response_type.to_string(),
                    page_url,
                },
            )
            .map_err(|e| e.to_string())
    }
    .await;

    if let Err(error) = emit_result {
        let _ = pending_browser_fetches()
            .lock()
            .map(|mut pending| pending.remove(&request_id));
        return Err(error);
    }

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => {
            log_resolver_debug(&format!(
                "[browser_fetch_via_bridge] completed request_id={} status={:?}",
                request_id,
                result.as_ref().ok().and_then(|value| value.status)
            ));
            result
        }
        Ok(Err(_)) => {
            log_resolver_debug(&format!(
                "[browser_fetch_via_bridge] channel closed request_id={}",
                request_id
            ));
            Err("Browser fetch channel closed".to_string())
        }
        Err(_) => {
            let _ = pending_browser_fetches()
                .lock()
                .map(|mut pending| pending.remove(&request_id));
            log_resolver_debug(&format!(
                "[browser_fetch_via_bridge] timeout request_id={}",
                request_id
            ));
            Err("Browser fetch timed out".to_string())
        }
    }
}

#[tauri::command]
fn complete_browser_fetch(payload: BrowserFetchCompletePayload) -> Result<(), String> {
    log_resolver_debug(&format!(
        "[complete_browser_fetch] request_id={} ok={} response_type={} status={:?} error={:?}",
        payload.request_id,
        payload.ok,
        payload.response_type,
        payload.status,
        payload.error
    ));

    let sender = pending_browser_fetches()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&payload.request_id);

    let Some(sender) = sender else {
        return Ok(());
    };

    if !payload.ok {
        let error = payload
            .error
            .unwrap_or_else(|| "Browser fetch failed".to_string());
        let _ = sender.send(Err(error));
        return Ok(());
    }

    let bytes = match payload.response_type.as_str() {
        "arrayBuffer" => {
            let encoded = payload
                .data_base64
                .ok_or_else(|| "Browser fetch response missing binary payload".to_string())?;
            Some(
                BASE64_STANDARD
                    .decode(encoded)
                    .map_err(|e| e.to_string())?,
            )
        }
        _ => None,
    };

    let _ = sender.send(Ok(BrowserFetchResponse {
        text: payload.text,
        bytes,
        status: payload.status,
    }));

    Ok(())
}

#[tauri::command]
async fn open_iframe_player_window(
    app: tauri::AppHandle,
    payload: IframePlayerWindowPayload,
) -> Result<(), String> {
    let route = iframe_player_route(&payload)?;
    let data_directory = iframe_player_data_directory(&app)?;
    let main_window = app.get_webview_window("main");
    let title = if payload.title.trim().is_empty() {
        "NOVA STREAM".to_string()
    } else {
        format!("{} - NOVA STREAM", payload.title.trim())
    };

    if let Some(existing) = app.get_webview_window(IFRAME_PLAYER_WINDOW_LABEL) {
        let _ = existing.close();
        let _ = existing.destroy();
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        IFRAME_PLAYER_WINDOW_LABEL,
        WebviewUrl::App(route.into()),
    )
    .title(&title)
    .inner_size(1440.0, 900.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .shadow(false)
    .skip_taskbar(true)
    .focused(true)
    .visible(true)
    .always_on_top(true)
    .transparent(true)
    .devtools(cfg!(debug_assertions))
    .additional_browser_args(IFRAME_PLAYER_BROWSER_ARGS)
    .data_directory(data_directory);

    if let Some(main_window) = main_window.as_ref() {
        builder = builder.owner(main_window).map_err(|e| e.to_string())?;

        if let Ok(position) = main_window.outer_position() {
            builder = builder.position(position.x as f64, position.y as f64);
        } else {
            builder = builder.center();
        }

        if let Ok(size) = main_window.outer_size() {
            builder = builder.inner_size(size.width as f64, size.height as f64);
        }
    } else {
        builder = builder.center();
    }

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

fn prepare_playback_request(
    url: &str,
    headers: &HashMap<String, String>,
    session_id: Option<&str>,
) -> Result<reqwest::RequestBuilder, String> {
    let session = resolver_session(session_id);
    let client = session
        .as_ref()
        .map(|value| value.client.clone())
        .unwrap_or_else(reqwest::Client::new);
    let mut request = client.get(url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if !headers.contains_key("Cookie") {
        if let Some(cookie_header) = session
            .as_ref()
            .and_then(|value| value.cookie_header.as_ref())
        {
            request = request.header("Cookie", cookie_header.as_str());
        }
    }

    if !headers.contains_key("Referer") {
        if let Some(page_url) = session.as_ref().and_then(|value| value.page_url.as_ref()) {
            request = request.header("Referer", page_url.as_str());
        }
    }

    if !headers.contains_key("Origin") {
        if let Some(page_url) = session.as_ref().and_then(|value| value.page_url.as_ref()) {
            if let Ok(parsed) = Url::parse(page_url) {
                let origin = parsed.origin().ascii_serialization();
                if origin != "null" {
                    request = request.header("Origin", origin);
                }
            }
        }
    }

    Ok(request)
}

fn should_use_browser_bridge(session_id: Option<&str>) -> bool {
    resolver_session(session_id)
        .and_then(|session| session.window_label)
        .is_some()
}

#[tauri::command]
async fn fetch_hls_segment(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    session_id: Option<String>,
) -> Result<Response, String> {
    log_anime_debug(&format!("[fetch_hls_segment] URL: {}", url));
    log_anime_debug(&format!("[fetch_hls_segment] Headers sent: {:?}", headers));
    log_anime_debug(&format!("[fetch_hls_segment] Session ID: {:?}", session_id));

    if should_use_browser_bridge(session_id.as_deref()) {
        let bridge_response = browser_fetch_via_bridge(
            app,
            url.clone(),
            "arrayBuffer",
            session_id.as_deref(),
            headers.get("Referer").cloned(),
        )
        .await?;

        let status = bridge_response.status.unwrap_or(200);
        let bytes = bridge_response.bytes.unwrap_or_default();

        log_anime_debug(&format!(
            "[fetch_hls_segment][bridge] Status: {}",
            status
        ));
        log_anime_debug(&format!(
            "[fetch_hls_segment][bridge] Bytes: {}",
            bytes.len()
        ));

        if status != 200 && status != 206 {
            return Err(format!("HLS browser fetch failed: HTTP {}", status));
        }

        return Ok(Response::new(bytes));
    }

    let request = prepare_playback_request(&url, &headers, session_id.as_deref())?;

    let response = request.send().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_segment] Request error: {e}"));
        e.to_string()
    })?;
    let status = response.status();
    let content_length = response.content_length().unwrap_or(0);
    let content_type = response.headers().get("content-type").cloned();

    log_anime_debug(&format!("[fetch_hls_segment] Status: {}", status));
    log_anime_debug(&format!("[fetch_hls_segment] Content-Type: {:?}", content_type));
    log_anime_debug(&format!("[fetch_hls_segment] Content-Length: {}", content_length));

    if status.as_u16() != 200 && status.as_u16() != 206 {
        let error = format!("HLS fetch failed: HTTP {}", status);
        log_anime_debug(&format!("[fetch_hls_segment] Error: {}", error));
        return Err(error);
    }

    let bytes = response.bytes().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_segment] Bytes read error: {e}"));
        e.to_string()
    })?;

    log_anime_debug(&format!("[fetch_hls_segment] Bytes: {}", bytes.len()));
    log_anime_debug(&format!("[fetch_hls_segment] Empty body: {}", bytes.is_empty()));

    Ok(Response::new(bytes.to_vec()))
}

fn absolutize_reference(reference: &str, base_url: &Url) -> String {
    base_url
        .join(reference)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| reference.to_string())
}

fn rewrite_uri_attributes(line: &str, base_url: &Url) -> String {
    let mut output = String::new();
    let mut remaining = line;

    while let Some(start) = remaining.find("URI=\"") {
        output.push_str(&remaining[..start]);
        output.push_str("URI=\"");

        let after_prefix = &remaining[start + 5..];
        if let Some(end) = after_prefix.find('"') {
            let raw_uri = &after_prefix[..end];
            output.push_str(&absolutize_reference(raw_uri, base_url));
            output.push('"');
            remaining = &after_prefix[end + 1..];
        } else {
            output.push_str(after_prefix);
            remaining = "";
            break;
        }
    }

    output.push_str(remaining);
    output
}

fn rewrite_manifest_line(line: &str, base_url: &Url) -> String {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return line.to_string();
    }

    if trimmed.starts_with('#') {
        return rewrite_uri_attributes(line, base_url);
    }

    absolutize_reference(trimmed, base_url)
}

#[tauri::command]
async fn fetch_hls_manifest(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    session_id: Option<String>,
) -> Result<String, String> {
    log_anime_debug(&format!("[fetch_hls_manifest] URL: {}", url));
    log_anime_debug(&format!("[fetch_hls_manifest] Session ID: {:?}", session_id));

    if should_use_browser_bridge(session_id.as_deref()) {
        let bridge_response = browser_fetch_via_bridge(
            app,
            url.clone(),
            "text",
            session_id.as_deref(),
            headers.get("Referer").cloned(),
        )
        .await?;

        let status = bridge_response.status.unwrap_or(200);
        let manifest_text = bridge_response.text.unwrap_or_default();
        let manifest_preview: String = manifest_text.chars().take(500).collect();

        log_anime_debug(&format!(
            "[fetch_hls_manifest][bridge] Status: {}",
            status
        ));
        log_anime_debug(&format!(
            "[fetch_hls_manifest][bridge] Body preview: {}",
            manifest_preview
        ));

        if !(200..300).contains(&status) {
            return Err(format!("Manifest browser fetch failed: HTTP {}", status));
        }

        let base_url = Url::parse(&url).map_err(|e| e.to_string())?;
        let rewritten = manifest_text
            .lines()
            .map(|line| rewrite_manifest_line(line, &base_url))
            .collect::<Vec<_>>()
            .join("\n");

        return Ok(rewritten);
    }

    let request = prepare_playback_request(&url, &headers, session_id.as_deref())?;

    let response = request.send().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_manifest] Request error: {e}"));
        e.to_string()
    })?;
    let status = response.status();
    let content_type = response.headers().get("content-type").cloned();

    log_anime_debug(&format!("[fetch_hls_manifest] Headers sent: {:?}", headers));
    log_anime_debug(&format!("[fetch_hls_manifest] Status: {}", status));
    log_anime_debug(&format!("[fetch_hls_manifest] Content-Type: {:?}", content_type));

    if !status.is_success() {
        let error = format!("Manifest fetch failed: HTTP {}", status);
        log_anime_debug(&format!("[fetch_hls_manifest] Error: {}", error));
        return Err(error);
    }

    let manifest_text = response.text().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_manifest] Body read error: {e}"));
        e.to_string()
    })?;
    let manifest_preview: String = manifest_text.chars().take(500).collect();

    log_anime_debug(&format!("[fetch_hls_manifest] Body preview: {}", manifest_preview));
    let base_url = Url::parse(&url).map_err(|e| e.to_string())?;
    let rewritten = manifest_text
        .lines()
        .map(|line| rewrite_manifest_line(line, &base_url))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(rewritten)
}

#[tauri::command]
async fn fetch_movie_segment(
    url: String,
    headers: HashMap<String, String>,
) -> Result<Response, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(&url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    if status.as_u16() != 200 && status.as_u16() != 206 {
        return Err(format!("Movie segment fetch failed: HTTP {}", status));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes.to_vec()))
}

#[tauri::command]
async fn fetch_movie_manifest(
    url: String,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(&url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("Movie manifest fetch failed: HTTP {}", status));
    }

    let final_url = response.url().clone();
    let manifest_text = response.text().await.map_err(|e| e.to_string())?;
    let rewritten = manifest_text
        .lines()
        .map(|line| rewrite_manifest_line(line, &final_url))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(rewritten)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MovieStreamProbeResult {
    ok: bool,
    status: Option<u16>,
    final_url: Option<String>,
    content_type: Option<String>,
    content_length: Option<u64>,
    error: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ResolvedMovieStream {
    url: String,
    quality: String,
    provider: String,
    headers: HashMap<String, String>,
    title: String,
    source: String,
    stream_type: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovieResolverRequest {
    tmdb_id: String,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
    imdb_id: Option<String>,
}

#[tauri::command]
async fn probe_movie_stream(
    url: String,
    headers: HashMap<String, String>,
    stream_type: Option<String>,
) -> Result<MovieStreamProbeResult, String> {
    Ok(probe_movie_stream_inner(url, headers, stream_type).await)
}

async fn probe_movie_stream_inner(
    url: String,
    headers: HashMap<String, String>,
    stream_type: Option<String>,
) -> MovieStreamProbeResult {
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            log_resolver_debug(&format!(
                "[probe_movie_stream] client build error url={} error={}",
                url, error
            ));
            return MovieStreamProbeResult {
                ok: false,
                status: None,
                final_url: None,
                content_type: None,
                content_length: None,
                error: Some(error.to_string()),
            };
        }
    };

    let normalized_stream_type = stream_type.unwrap_or_else(|| infer_stream_type(&url));
    let mut request = client.get(&url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if normalized_stream_type != "hls" {
        request = request.header("Range", "bytes=0-1");
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return MovieStreamProbeResult {
                ok: false,
                status: None,
                final_url: None,
                content_type: None,
                content_length: None,
                error: Some(error.to_string()),
            };
        }
    };

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_length = response.content_length();

    let ok = if normalized_stream_type == "hls" {
        if !status.is_success() {
            false
        } else {
            match response.text().await {
                Ok(body) => looks_like_valid_hls_manifest(&body),
                Err(_) => false,
            }
        }
    } else {
        status.is_success() || status.as_u16() == 206
    };

    let error = if ok {
        None
    } else {
        Some(if normalized_stream_type == "hls" && status.is_success() {
            "Movie stream probe failed: manifest was not a playable HLS playlist".to_string()
        } else {
            format!("Movie stream probe failed: HTTP {}", status)
        })
    };

    MovieStreamProbeResult {
        ok,
        status: Some(status.as_u16()),
        final_url: Some(final_url),
        content_type,
        content_length,
        error,
    }
}

fn movie_quality_score(value: &str) -> i32 {
    match value {
        "1080p" => 4,
        "4k" => 3,
        "720p" => 2,
        "auto" => 1,
        _ => 0,
    }
}

fn parse_movie_quality(value: &str) -> String {
    let normalized = value.to_ascii_lowercase();
    if normalized.contains("1080") {
        "1080p".to_string()
    } else if normalized.contains("4k") || normalized.contains("2160") {
        "4k".to_string()
    } else if normalized.contains("720") {
        "720p".to_string()
    } else {
        "auto".to_string()
    }
}

fn is_base64_like_token(value: &str) -> bool {
    let candidate = value.trim();
    candidate.len() >= 40
        && candidate
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '/' | '='))
}

fn is_direct_playable_movie_url(value: &str) -> bool {
    let candidate = value.trim();
    candidate.starts_with("https://") && !is_base64_like_token(candidate)
}

fn looks_like_valid_hls_manifest(body: &str) -> bool {
    let trimmed = body.trim_start();
    if !trimmed.starts_with("#EXTM3U") {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("<html") || lower.contains("<!doctype") {
        return false;
    }

    let has_playlist_markers = trimmed.contains("#EXTINF")
        || trimmed.contains("#EXT-X-STREAM-INF")
        || trimmed.contains("#EXT-X-TARGETDURATION")
        || trimmed.contains("#EXT-X-MEDIA-SEQUENCE");

    if !has_playlist_markers {
        return false;
    }

    trimmed.lines().any(|line| {
        let candidate = line.trim();
        !candidate.is_empty()
            && !candidate.starts_with('#')
            && !candidate.contains('<')
            && !candidate.contains('>')
    })
}

async fn fetch_json_value(client: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    let response = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    response.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

fn normalize_nuvio_streams(value: &serde_json::Value) -> Vec<ResolvedMovieStream> {
    value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .into_iter()
        .flatten()
        .filter_map(|stream| {
            let url = stream.get("url")?.as_str()?.to_string();
            if !is_direct_playable_movie_url(&url) {
                return None;
            }

            let headers = stream
                .get("behaviorHints")
                .and_then(|hints| hints.get("headers"))
                .and_then(|headers| serde_json::from_value::<HashMap<String, String>>(headers.clone()).ok())
                .unwrap_or_default();
            let quality = parse_movie_quality(
                stream
                    .get("name")
                    .and_then(|value| value.as_str())
                    .or_else(|| stream.get("title").and_then(|value| value.as_str()))
                    .unwrap_or("auto"),
            );

            Some(ResolvedMovieStream {
                stream_type: infer_stream_type(&url),
                url,
                quality,
                provider: stream
                    .get("name")
                    .and_then(|value| value.as_str())
                    .or_else(|| stream.get("provider").and_then(|value| value.as_str()))
                    .unwrap_or("Nuvio")
                    .to_string(),
                headers,
                title: stream
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                source: "nuvio-streams".to_string(),
            })
        })
        .collect()
}

async fn resolve_tmdb_external_imdb_id(
    client: &reqwest::Client,
    tmdb_id: &str,
    content_type: &str,
) -> Result<String, String> {
    let endpoint = if content_type == "series" { "tv" } else { "movie" };
    let url = format!(
        "{TMDB_BASE_URL}/{endpoint}/{tmdb_id}/external_ids?api_key={TMDB_API_KEY}"
    );
    let data = fetch_json_value(client, &url).await?;
    data.get("imdb_id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("No IMDb ID found for this {}", if content_type == "series" { "episode" } else { "movie" }))
}

fn normalize_wyzie_subtitles(data: &serde_json::Value) -> Vec<ResolvedMovieSubtitle> {
    let Some(streams) = data.as_array() else {
        return Vec::new();
    };

    let mut subtitles = streams
        .iter()
        .filter_map(|item| {
            let url = item.get("url")?.as_str()?.trim().to_string();
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return None;
            }

            let language = item
                .get("language")
                .and_then(|value| value.as_str())
                .unwrap_or("en")
                .to_string();
            let display = item
                .get("display")
                .and_then(|value| value.as_str())
                .unwrap_or("English")
                .to_string();
            let format = item
                .get("format")
                .and_then(|value| value.as_str())
                .unwrap_or("srt")
                .to_string();
            let source = item
                .get("source")
                .and_then(|value| value.as_str())
                .unwrap_or("wyzie")
                .to_string();
            let hearing_impaired = item
                .get("isHearingImpaired")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let label = if hearing_impaired {
                format!("{display} (CC)")
            } else {
                display.clone()
            };

            Some(ResolvedMovieSubtitle {
                url,
                label,
                language,
                format,
                source,
                hearing_impaired,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        a.hearing_impaired
            .cmp(&b.hearing_impaired)
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

#[tauri::command]
async fn fetch_movie_subtitles(
    payload: MovieSubtitleRequest,
) -> Result<Vec<ResolvedMovieSubtitle>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let normalized_content_type = if payload.content_type == "series" {
        "series".to_string()
    } else {
        "movie".to_string()
    };

    let imdb_id = match payload.imdb_id.clone() {
        Some(imdb_id) if !imdb_id.trim().is_empty() => imdb_id,
        _ => resolve_tmdb_external_imdb_id(&client, &payload.tmdb_id, &normalized_content_type).await?,
    };

    let mut url = Url::parse(&format!("{WYZIE_SUBTITLES_BASE_URL}/search")).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("id", &imdb_id)
            .append_pair("language", "en")
            .append_pair("format", "srt");

        if normalized_content_type == "series" {
            query.append_pair("season", &payload.season.unwrap_or(1).to_string());
            query.append_pair("episode", &payload.episode.unwrap_or(1).to_string());
        }
    }

    log_resolver_debug(&format!(
        "[fetch_movie_subtitles] tmdbId={} contentType={} imdbId={} url={}",
        payload.tmdb_id, normalized_content_type, imdb_id, url
    ));

    let response = client.get(url.clone()).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if status == reqwest::StatusCode::BAD_REQUEST {
        log_resolver_debug(&format!(
            "[fetch_movie_subtitles] no subtitles tmdbId={} imdbId={} status={}",
            payload.tmdb_id, imdb_id, status
        ));
        return Ok(Vec::new());
    }

    if !status.is_success() {
        return Err(format!("Movie subtitle request failed: HTTP {}", status));
    }

    let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let subtitles = normalize_wyzie_subtitles(&value);

    log_resolver_debug(&format!(
        "[fetch_movie_subtitles] subtitle_count={} tmdbId={} imdbId={}",
        subtitles.len(), payload.tmdb_id, imdb_id
    ));

    Ok(subtitles)
}

#[tauri::command]
async fn fetch_movie_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Movie subtitle text fetch failed: HTTP {}", status));
    }

    Ok(body)
}

#[tauri::command]
async fn fetch_movie_resolver_streams(
    payload: MovieResolverRequest,
) -> Result<Vec<ResolvedMovieStream>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let normalized_content_type = if payload.content_type == "series" {
        "series".to_string()
    } else {
        "movie".to_string()
    };

    let resolved_imdb_id = match payload.imdb_id.clone() {
        Some(imdb_id) if !imdb_id.trim().is_empty() => Ok(imdb_id),
        _ => resolve_tmdb_external_imdb_id(&client, &payload.tmdb_id, &normalized_content_type).await,
    };

    let nuvio_url = resolved_imdb_id.as_ref().ok().map(|imdb_id| {
        if normalized_content_type == "series" {
            format!(
                "{NUVIO_STREAMS_BASE_URL}/stream/series/{}:{}:{}.json",
                imdb_id,
                payload.season.unwrap_or(1),
                payload.episode.unwrap_or(1)
            )
        } else {
            format!("{NUVIO_STREAMS_BASE_URL}/stream/movie/{}.json", imdb_id)
        }
    });

    log_resolver_debug(&format!(
        "[fetch_movie_resolver_streams] tmdbId={} contentType={} imdbId={:?}",
        payload.tmdb_id, normalized_content_type, resolved_imdb_id
    ));

    let nuvio_future = async {
        match nuvio_url.as_ref() {
            Some(url) => fetch_json_value(&client, url).await,
            None => Err(resolved_imdb_id
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_else(|| "No IMDb ID available for Nuvio".to_string())),
        }
    };

    let nuvio_result = nuvio_future.await;
    if let Err(error) = &nuvio_result {
        log_resolver_debug(&format!(
            "[fetch_movie_resolver_streams] Nuvio failed tmdbId={} error={}",
            payload.tmdb_id, error
        ));
    }

    let mut merged_streams = Vec::new();
    if let Ok(data) = nuvio_result {
        merged_streams.extend(normalize_nuvio_streams(&data));
    }

    if merged_streams.is_empty() {
        return Err(format!(
            "No direct playable streams available for this {}",
            if normalized_content_type == "series" { "episode" } else { "movie" }
        ));
    }

    merged_streams.sort_by(|a, b| {
        movie_quality_score(&b.quality)
            .cmp(&movie_quality_score(&a.quality))
            .then_with(|| a.provider.cmp(&b.provider))
            .then_with(|| a.url.cmp(&b.url))
    });
    merged_streams.dedup_by(|left, right| left.url == right.url);

    let mut validated_streams = Vec::new();
    for stream in merged_streams {
        let probe_result = probe_movie_stream_inner(
            stream.url.clone(),
            stream.headers.clone(),
            Some(stream.stream_type.clone()),
        )
        .await;

        if probe_result.ok {
            let validated_stream = ResolvedMovieStream {
                url: probe_result.final_url.unwrap_or_else(|| stream.url.clone()),
                ..stream
            };
            log_resolver_debug(&format!(
                "[fetch_movie_resolver_streams] accepted stream provider={} source={} streamType={} quality={} url={}",
                validated_stream.provider,
                validated_stream.source,
                validated_stream.stream_type,
                validated_stream.quality,
                validated_stream.url
            ));
            validated_streams.push(validated_stream);
        } else {
            log_resolver_debug(&format!(
                "[fetch_movie_resolver_streams] rejected stream provider={} source={} url={} error={}",
                stream.provider,
                stream.source,
                stream.url,
                probe_result.error.unwrap_or_else(|| "validation failed".to_string())
            ));
        }
    }

    if validated_streams.is_empty() {
        return Err(format!(
            "No validated playable streams available for this {}",
            if normalized_content_type == "series" { "episode" } else { "movie" }
        ));
    }

    log_resolver_debug(&format!(
        "[fetch_movie_resolver_streams] validated_count={} tmdbId={}",
        validated_streams.len(),
        payload.tmdb_id
    ));

    Ok(validated_streams)
}

fn parse_captured_navigation(url: &reqwest::Url) -> Option<CapturedNavigation> {
    if url.scheme() != STREAM_CAPTURE_SCHEME {
        return None;
    }

    let captured_url = url
        .query_pairs()
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.into_owned())?;
    let kind = url
        .query_pairs()
        .find(|(key, _)| key == "kind")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| "stream".to_string());
    let page_url = url
        .query_pairs()
        .find(|(key, _)| key == "page")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.trim().is_empty());

    Some(CapturedNavigation {
        url: captured_url,
        page_url,
        kind: if kind == "frame" {
            CaptureKind::Frame
        } else {
            CaptureKind::Stream
        },
    })
}

fn infer_stream_type(stream_url: &str) -> String {
    let lower = stream_url.to_ascii_lowercase();
    if lower.contains(".m3u8")
        || lower.contains("/playlist/")
        || lower.contains("/manifest")
        || lower.contains("/hls/")
        || lower.contains("format=m3u8")
    {
        "hls".to_string()
    } else if lower.contains(".mp4") {
        "mp4".to_string()
    } else {
        "unknown".to_string()
    }
}

fn resolve_provider_host(stream_url: &str, page_url: Option<&str>) -> String {
    page_url
        .and_then(|value| Url::parse(value).ok())
        .and_then(|url| url.host_str().map(str::to_string))
        .or_else(|| {
            Url::parse(stream_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
        })
        .unwrap_or_default()
}

fn build_stream_headers(stream_url: &str, page_url: Option<&str>) -> HashMap<String, String> {
    let mut headers = HashMap::new();

    let fallback_referer = Url::parse(stream_url)
        .ok()
        .map(|url| format!("{}://{}/", url.scheme(), url.host_str().unwrap_or_default()));

    if let Some(page_url) = page_url {
        if let Ok(parsed) = Url::parse(page_url) {
            headers.insert("Referer".to_string(), page_url.to_string());

            let origin = parsed.origin().ascii_serialization();
            if origin != "null" {
                headers.insert("Origin".to_string(), origin);
            }

            return headers;
        }
    }

    if let Some(referer) = fallback_referer {
        headers.insert("Referer".to_string(), referer.clone());

        if let Ok(parsed) = Url::parse(&referer) {
            let origin = parsed.origin().ascii_serialization();
            if origin != "null" {
                headers.insert("Origin".to_string(), origin);
            }
        }
    }

    headers
}

fn to_resolved_embed_stream(captured: CapturedNavigation, session_id: Option<String>) -> ResolvedEmbedStream {
    let page_url = captured.page_url.clone();

    ResolvedEmbedStream {
        stream_type: infer_stream_type(&captured.url),
        provider_host: resolve_provider_host(&captured.url, page_url.as_deref()),
        headers: build_stream_headers(&captured.url, page_url.as_deref()),
        stream_url: captured.url,
        page_url,
        session_id,
    }
}

fn capture_window_label() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("stream-capture-{timestamp}")
}

fn resolver_timeout_for_provider(provider_id: Option<&str>) -> Duration {
    match provider_id.unwrap_or_default() {
        "moviesapi" => Duration::from_secs(12),
        "nontonfilm" => Duration::from_secs(10),
        "vidsrc-me" => Duration::from_secs(9),
        "vidsrc-net" | "vidsrc-xyz" => Duration::from_secs(8),
        "autoembed" => Duration::from_secs(9),
        _ => Duration::from_secs(10),
    }
}

fn vidora_cookie_regex() -> Regex {
    Regex::new(r#"\$\.cookie\(\s*'([^']+)'\s*,\s*'([^']*)'"#).unwrap()
}

fn packer_script_regex() -> Regex {
    Regex::new(
        r#"(?s)eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(?P<p>.*?)',\s*(?P<a>\d+),\s*(?P<c>\d+),\s*'(?P<k>.*?)'\.split\('\|'\)\)"#,
    )
    .unwrap()
}

fn to_radix(mut value: usize, radix: usize) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

    if radix < 2 || radix > DIGITS.len() {
        return value.to_string();
    }

    if value == 0 {
        return "0".to_string();
    }

    let mut chars = Vec::new();
    while value > 0 {
        chars.push(DIGITS[value % radix] as char);
        value /= radix;
    }
    chars.iter().rev().collect()
}

fn unpack_packer_script(html: &str) -> Option<String> {
    let captures = packer_script_regex().captures(html)?;
    let mut payload = captures.name("p")?.as_str().replace("\\/", "/");
    let radix = captures.name("a")?.as_str().parse::<usize>().ok()?;
    let token_count = captures.name("c")?.as_str().parse::<usize>().ok()?;
    let tokens = captures
        .name("k")?
        .as_str()
        .split('|')
        .map(str::to_string)
        .collect::<Vec<_>>();

    for index in (0..token_count).rev() {
        let Some(token) = tokens.get(index) else {
            continue;
        };

        if token.is_empty() {
            continue;
        }

        let pattern = format!(r"\b{}\b", to_radix(index, radix));
        let regex = Regex::new(&pattern).ok()?;
        payload = regex.replace_all(&payload, token.as_str()).into_owned();
    }

    Some(payload)
}

fn extract_cookie_header(html: &str) -> Option<String> {
    let cookies = vidora_cookie_regex()
        .captures_iter(html)
        .filter_map(|captures| {
            let key = captures.get(1)?.as_str().trim();
            let value = captures.get(2)?.as_str().trim();
            Some(format!("{key}={value}"))
        })
        .collect::<Vec<_>>();

    if cookies.is_empty() {
        None
    } else {
        Some(cookies.join("; "))
    }
}

fn extract_moviesapi_direct_media_url(html: &str, base_url: &Url) -> Option<String> {
    let unpacked = unpack_packer_script(html)?;
    direct_media_regex()
        .find_iter(&unpacked)
        .find_map(|value| normalize_candidate_url(value.as_str(), base_url))
}

fn normalize_candidate_url(value: &str, base_url: &Url) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty()
        || trimmed.starts_with("javascript:")
        || trimmed.starts_with("data:")
        || trimmed.starts_with('#')
    {
        return None;
    }

    if let Ok(url) = Url::parse(trimmed) {
        return Some(url.to_string());
    }

    if trimmed.starts_with("//") {
        return Some(format!("{}:{}", base_url.scheme(), trimmed));
    }

    base_url.join(trimmed).ok().map(|url| url.to_string())
}

fn direct_media_regex() -> Regex {
    Regex::new(r#"https?://[^\s"'<>]+(?:\.m3u8|\.mp4)[^\s"'<>]*"#).unwrap()
}

fn iframe_src_regex() -> Regex {
    Regex::new(r#"(?is)<iframe[^>]+src\s*=\s*["']([^"']+)["']"#).unwrap()
}

fn extract_direct_media_url(html: &str, base_url: &Url) -> Option<String> {
    let decoded = html.replace("\\/", "/");
    direct_media_regex()
        .find_iter(&decoded)
        .find_map(|value| normalize_candidate_url(value.as_str(), base_url))
}

fn extract_iframe_url(html: &str, base_url: &Url) -> Option<String> {
    iframe_src_regex()
        .captures_iter(html)
        .find_map(|captures| captures.get(1))
        .and_then(|capture| normalize_candidate_url(capture.as_str(), base_url))
}

async fn fetch_resolver_page(
    client: &reqwest::Client,
    url: &str,
) -> Result<(Url, reqwest::StatusCode, String), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let final_url = response.url().clone();
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok((final_url, status, body))
}

async fn resolve_embed_stream_static(
    provider_id: Option<&str>,
    embed_url: &str,
) -> Result<StaticCaptureResolution, String> {
    let client = build_resolver_client()?;
    let mut current_url = embed_url.to_string();
    let mut session_cookie_header = None;

    for depth in 0..=4 {
        let (final_url, status, body) = fetch_resolver_page(&client, &current_url).await?;
        let preview: String = body.chars().take(220).collect();
        if let Some(cookie_header) = extract_cookie_header(&body) {
            log_resolver_debug(&format!(
                "[resolve_embed_stream][static] provider={:?} depth={} cookies={}",
                provider_id,
                depth,
                cookie_header
            ));
            session_cookie_header = Some(cookie_header);
        }

        log_resolver_debug(&format!(
            "[resolve_embed_stream][static] provider={:?} depth={} url={} final_url={} status={} preview={:?}",
            provider_id,
            depth,
            current_url,
            final_url,
            status,
            preview
        ));

        if !status.is_success() {
            return Err(format!("Resolver request failed: HTTP {}", status));
        }

        if matches!(infer_stream_type(final_url.as_str()).as_str(), "hls" | "mp4") {
            return Ok(StaticCaptureResolution {
                resolved_stream: Some(ResolvedEmbedStream {
                    stream_url: final_url.to_string(),
                    stream_type: infer_stream_type(final_url.as_str()),
                    provider_host: resolve_provider_host(final_url.as_str(), Some(final_url.as_str())),
                    page_url: Some(final_url.to_string()),
                    headers: build_stream_headers(final_url.as_str(), Some(final_url.as_str())),
                    session_id: None,
                }),
                next_url: final_url.to_string(),
                session_client: client.clone(),
                final_page_url: Some(final_url.to_string()),
                session_cookie_header: session_cookie_header.clone(),
            });
        }

        let direct_media_url = if provider_id == Some("moviesapi")
            || final_url
                .host_str()
                .map(|host| host.contains("vidora.stream"))
                .unwrap_or(false)
        {
            extract_moviesapi_direct_media_url(&body, &final_url)
                .or_else(|| extract_direct_media_url(&body, &final_url))
        } else {
            extract_direct_media_url(&body, &final_url)
        };

        if let Some(stream_url) = direct_media_url {
            log_resolver_debug(&format!(
                "[resolve_embed_stream][static] provider={:?} depth={} direct_media={}",
                provider_id,
                depth,
                stream_url
            ));

            return Ok(StaticCaptureResolution {
                resolved_stream: Some(ResolvedEmbedStream {
                    stream_url: stream_url.clone(),
                    stream_type: infer_stream_type(&stream_url),
                    provider_host: resolve_provider_host(&stream_url, Some(final_url.as_str())),
                    page_url: Some(final_url.to_string()),
                    headers: build_stream_headers(&stream_url, Some(final_url.as_str())),
                    session_id: None,
                }),
                next_url: final_url.to_string(),
                session_client: client.clone(),
                final_page_url: Some(final_url.to_string()),
                session_cookie_header: session_cookie_header.clone(),
            });
        }

        if let Some(frame_url) = extract_iframe_url(&body, &final_url) {
            if frame_url != current_url {
                log_resolver_debug(&format!(
                    "[resolve_embed_stream][static] provider={:?} depth={} iframe={}",
                    provider_id,
                    depth,
                    frame_url
                ));
                current_url = frame_url;
                continue;
            }
        }

        return Ok(StaticCaptureResolution {
            resolved_stream: None,
            next_url: final_url.to_string(),
            session_client: client.clone(),
            final_page_url: Some(final_url.to_string()),
            session_cookie_header: session_cookie_header.clone(),
        });
    }

    Ok(StaticCaptureResolution {
        resolved_stream: None,
        next_url: current_url.clone(),
        session_client: client,
        final_page_url: Some(current_url),
        session_cookie_header,
    })
}

fn destroy_capture_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
        let _ = window.destroy();
    }
    clear_resolver_session_window(label);
}

fn handle_capture_navigation(
    app: &tauri::AppHandle,
    label: &str,
    capture_complete: &Arc<AtomicBool>,
    url: &reqwest::Url,
) -> bool {
    let Some(captured) = parse_captured_navigation(url) else {
        return true;
    };

    if capture_complete.swap(true, Ordering::SeqCst) {
        return false;
    }

    let _ = app.emit("stream-captured", captured.url);

    destroy_capture_window(app, label);
    false
}

fn create_capture_window(app: tauri::AppHandle, embed_url: String) -> Result<(), String> {
    let embed_url = reqwest::Url::parse(&embed_url).map_err(|e| e.to_string())?;
    let label = capture_window_label();
    let capture_complete = Arc::new(AtomicBool::new(false));
    let app_for_navigation = app.clone();
    let app_for_timeout = app.clone();
    let label_for_navigation = label.clone();
    let label_for_timeout = label.clone();
    let capture_for_navigation = capture_complete.clone();
    let capture_for_timeout = capture_complete.clone();

    tauri::WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::External(embed_url))
        .title("stream-capture")
        .visible(false)
        .focused(false)
        .decorations(false)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(1.0, 1.0)
        .initialization_script_for_all_frames(STREAM_CAPTURE_SCRIPT)
        .on_navigation(move |url| {
            handle_capture_navigation(
                &app_for_navigation,
                &label_for_navigation,
                &capture_for_navigation,
                url,
            )
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;

        if !capture_for_timeout.swap(true, Ordering::SeqCst) {
            let _ = app_for_timeout.emit("stream-capture-failed", ());
            destroy_capture_window(&app_for_timeout, &label_for_timeout);
        }
    });

    Ok(())
}

#[tauri::command]
async fn capture_stream(app: tauri::AppHandle, embed_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || create_capture_window(app, embed_url))
        .await
        .map_err(|e| e.to_string())??;

    Ok(())
}

fn create_resolve_capture_window(
    app: tauri::AppHandle,
    provider_id: Option<String>,
    embed_url: String,
    session_id: Option<String>,
    depth: u8,
    sender: Arc<Mutex<Option<oneshot::Sender<Result<ResolvedEmbedStream, String>>>>>,
) -> Result<(), String> {
    let embed_url = reqwest::Url::parse(&embed_url).map_err(|e| e.to_string())?;
    if depth > 4 {
        return Err("Stream capture exceeded iframe follow depth".to_string());
    }
    let label = capture_window_label();
    let timeout = resolver_timeout_for_provider(provider_id.as_deref());
    let capture_complete = Arc::new(AtomicBool::new(false));
    let data_directory = iframe_player_data_directory(&app)?;
    let app_for_navigation = app.clone();
    let app_for_timeout = app.clone();
    let label_for_navigation = label.clone();
    let label_for_timeout = label.clone();
    let capture_for_navigation = capture_complete.clone();
    let capture_for_timeout = capture_complete.clone();
    let sender_for_navigation = sender.clone();
    let sender_for_timeout = sender.clone();
    let provider_for_navigation = provider_id.clone();
    let provider_for_timeout = provider_id.clone();
    let session_for_navigation = session_id.clone();

    log_resolver_debug(&format!(
        "[resolve_embed_stream] start provider={:?} embed_url={} timeout={}s session_id={:?}",
        provider_id,
        embed_url,
        timeout.as_secs(),
        session_id
    ));

    tauri::WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::External(embed_url))
        .title("stream-resolver")
        .visible(false)
        .focused(false)
        .decorations(false)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(1.0, 1.0)
        .additional_browser_args(IFRAME_PLAYER_BROWSER_ARGS)
        .data_directory(data_directory)
        .initialization_script_for_all_frames(STREAM_CAPTURE_SCRIPT)
        .on_navigation(move |url| {
            log_resolver_debug(&format!(
                "[resolve_embed_stream] navigation provider={:?} depth={} url={}",
                provider_for_navigation,
                depth,
                url
            ));

            let Some(captured) = parse_captured_navigation(url) else {
                return true;
            };

            if capture_for_navigation.swap(true, Ordering::SeqCst) {
                return false;
            }

            log_resolver_debug(&format!(
                "[resolve_embed_stream] captured provider={:?} depth={} kind={:?} url={} page_url={:?}",
                provider_for_navigation,
                depth,
                captured.kind,
                captured.url,
                captured.page_url
            ));

            if captured.kind == CaptureKind::Frame {
                let next_url = captured.url.clone();
                destroy_capture_window(&app_for_navigation, &label_for_navigation);
                if let Err(error) = create_resolve_capture_window(
                    app_for_navigation.clone(),
                    provider_for_navigation.clone(),
                    next_url,
                    session_for_navigation.clone(),
                    depth + 1,
                    sender_for_navigation.clone(),
                ) {
                    if let Ok(mut guard) = sender_for_navigation.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(Err(error));
                        }
                    }
                }
                return false;
            }

            if let Ok(mut guard) = sender_for_navigation.lock() {
                if let Some(sender) = guard.take() {
                    if let Some(session_id) = session_for_navigation.clone() {
                        update_resolver_session_page_url(&session_id, captured.page_url.clone());
                        update_resolver_session_window(
                            &session_id,
                            Some(label_for_navigation.clone()),
                            Some(true),
                        );
                    }
                    let _ = sender.send(Ok(to_resolved_embed_stream(
                        captured,
                        session_for_navigation.clone(),
                    )));
                }
            }
            false
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(timeout).await;

        if !capture_for_timeout.swap(true, Ordering::SeqCst) {
            log_resolver_debug(&format!(
                "[resolve_embed_stream] timeout provider={:?} label={}",
                provider_for_timeout,
                label_for_timeout
            ));
            if let Ok(mut guard) = sender_for_timeout.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("Stream capture timed out".to_string()));
                }
            }

            destroy_capture_window(&app_for_timeout, &label_for_timeout);
        }
    });

    Ok(())
}

#[tauri::command]
async fn resolve_embed_stream(
    app: tauri::AppHandle,
    payload: ResolveEmbedStreamPayload,
) -> Result<ResolvedEmbedStream, String> {
    let static_resolution =
        resolve_embed_stream_static(payload.provider_id.as_deref(), &payload.embed_url).await?;
    let session_id = store_resolver_session(
        static_resolution.session_client.clone(),
        static_resolution.final_page_url.clone(),
        static_resolution.session_cookie_header.clone(),
        payload.provider_id.clone(),
    );

    if let Some(mut resolved_stream) = static_resolution.resolved_stream {
        resolved_stream.session_id = session_id.clone();
        return Ok(resolved_stream);
    }

    let (tx, rx) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));

    log_resolver_debug(&format!(
        "[resolve_embed_stream] launching dynamic capture provider={:?} target_url={}",
        payload.provider_id,
        static_resolution.next_url
    ));

    create_resolve_capture_window(
        app,
        payload.provider_id,
        static_resolution.next_url,
        session_id,
        0,
        sender,
    )?;

    rx.await
        .map_err(|_| "Stream capture channel closed".to_string())?
}

fn append_updater_log(message: &str) {
    let log_path = env::temp_dir().join("nova-stream-updater.log");

    if let Ok(mut log_file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(log_file, "[{timestamp}] {message}");
    }
}

fn append_anime_debug_log(message: &str) {
    let log_path = env::temp_dir().join(ANIME_DEBUG_LOG_FILE);

    if let Ok(mut log_file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(log_file, "[{timestamp}] {message}");
    }
}

fn log_anime_debug(message: &str) {
    eprintln!("{message}");
    append_anime_debug_log(message);
}

fn append_resolver_debug_log(message: &str) {
    let log_path = env::temp_dir().join(RESOLVER_DEBUG_LOG_FILE);

    if let Ok(mut log_file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(log_file, "[{timestamp}] {message}");
    }
}

fn log_resolver_debug(message: &str) {
    eprintln!("{message}");
    append_resolver_debug_log(message);
}

#[tauri::command]
fn get_anime_debug_log_path() -> String {
    env::temp_dir()
        .join(ANIME_DEBUG_LOG_FILE)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let update_dir = current_exe.parent().ok_or("No parent dir")?.join("_update");
    fs::create_dir_all(&update_dir).map_err(|e| e.to_string())?;
    let update_path = update_dir.join("nova-stream.exe");
    let temp_update_path = update_dir.join("nova-stream.exe.part");

    append_updater_log(&format!("download start url={} target={}", url, update_path.display()));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent("NOVA STREAM Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            append_updater_log(&format!("download request failed url={} error={e}", url));
            e.to_string()
        })?;

    if !response.status().is_success() {
        append_updater_log(&format!(
            "download failed url={} status={}",
            url,
            response.status()
        ));
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    append_updater_log(&format!(
        "download response status={} content_length={}",
        response.status(),
        total
    ));
    let mut downloaded: u64 = 0;
    let mut file_bytes: Vec<u8> = if total > 0 {
        Vec::with_capacity(total as usize)
    } else {
        Vec::new()
    };

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            append_updater_log(&format!(
                "download stream failed url={} downloaded={} error={e}",
                url, downloaded
            ));
            e.to_string()
        })?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);

        if total > 0 {
            let percent = (downloaded * 100 / total) as u8;
            let _ = app.emit("download-progress", percent);
        }
    }

    if total > 0 && downloaded != total {
        append_updater_log(&format!(
            "download size mismatch url={} expected={} actual={}",
            url, total, downloaded
        ));
        return Err("Download incomplete".to_string());
    }

    if downloaded < 1_000_000 {
        append_updater_log(&format!(
            "download too small url={} bytes={}",
            url, downloaded
        ));
        return Err("Downloaded file is unexpectedly small".to_string());
    }

    let _ = app.emit("download-progress", 100u8);

    tokio::fs::write(&temp_update_path, &file_bytes)
        .await
        .map_err(|e| {
            append_updater_log(&format!(
                "download write failed path={} error={e}",
                temp_update_path.display()
            ));
            e.to_string()
        })?;

    if update_path.exists() {
        let _ = fs::remove_file(&update_path);
    }

    tokio::fs::rename(&temp_update_path, &update_path)
        .await
        .map_err(|e| {
            append_updater_log(&format!(
                "download rename failed from={} to={} error={e}",
                temp_update_path.display(),
                update_path.display()
            ));
            e.to_string()
        })?;

    let file_size = fs::metadata(&update_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    append_updater_log(&format!(
        "download complete path={} bytes={}",
        update_path.display(),
        file_size
    ));

    Ok(update_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn apply_update() -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let current_path = current_exe.to_string_lossy().to_string();
    let update_exe = current_exe
        .parent().ok_or("No parent dir")?
        .join("_update")
        .join("nova-stream.exe");
    let update_path = update_exe.to_string_lossy().to_string();
    let updater_log_path = env::temp_dir().join("nova-stream-updater.log");

    append_updater_log(&format!(
        "apply start current={} update={}",
        current_path, update_path
    ));

    if !update_exe.exists() {
        append_updater_log("apply aborted: update file not found");
        return Err("Update file not found".to_string());
    }

    let batch_path = current_exe
        .parent().ok_or("No parent dir")?
        .join("_update.bat");

    let script = format!(
        "@echo off\r\n\
         echo [%date% %time%] apply script started >> \"{}\"\r\n\
         timeout /t 2 /nobreak >nul\r\n\
         copy /y \"{}\" \"{}\" >> \"{}\" 2>&1\r\n\
         if errorlevel 1 exit /b 1\r\n\
         echo [%date% %time%] copy succeeded >> \"{}\"\r\n\
         rmdir /s /q \"{}\" >nul 2>&1\r\n\
         echo [%date% %time%] cleanup complete >> \"{}\"\r\n\
         start \"\" \"{}\"\r\n\
         echo [%date% %time%] restart launched >> \"{}\"\r\n\
         del \"%~f0\" >nul 2>&1\r\n",
        updater_log_path.to_string_lossy(),
        update_path,
        current_path,
        updater_log_path.to_string_lossy(),
        updater_log_path.to_string_lossy(),
        current_exe.parent().unwrap().join("_update").to_string_lossy(),
        updater_log_path.to_string_lossy(),
        current_path,
        updater_log_path.to_string_lossy(),
    );

    fs::write(&batch_path, &script).map_err(|e| {
        append_updater_log(&format!("apply failed writing batch file error={e}"));
        e.to_string()
    })?;

    Command::new("cmd")
        .args(["/C", "start", "/min", "", &batch_path.to_string_lossy()])
        .spawn()
        .map_err(|e| {
            append_updater_log(&format!("apply failed launching batch file error={e}"));
            e.to_string()
        })?;

    append_updater_log(&format!(
        "apply launched batch file={}",
        batch_path.display()
    ));

    std::process::exit(0)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize,
            close_window,
            open_iframe_player_window,
            search_hianime,
            get_hianime_episodes,
            get_hianime_stream,
            fetch_anime_text,
            get_anime_debug_log_path,
            browser_fetch_bridge_ready,
            complete_browser_fetch,
            fetch_hls_segment,
            fetch_hls_manifest,
            fetch_movie_segment,
            fetch_movie_manifest,
            fetch_movie_subtitles,
            fetch_movie_text,
            fetch_movie_resolver_streams,
            probe_movie_stream,
            capture_stream,
            resolve_embed_stream,
            download_update,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

