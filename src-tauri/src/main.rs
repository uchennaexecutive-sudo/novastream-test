#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path as StdPath, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use regex::Regex;
use reqwest::Url;
use tauri::ipc::Response;
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewUrl};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::oneshot;
use serde_json::Value;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use axum::{
    body::Body,
    extract::{Json, Path, State},
    http::{HeaderMap as AxumHeaderMap, StatusCode},
    routing::{get, post},
    Router,
};
use futures_util::TryStreamExt;
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use zip::ZipArchive;

static PLAYER_FULLSCREEN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

const STREAM_CAPTURE_SCHEME: &str = "novastream-capture";
const ANIME_DEBUG_LOG_FILE: &str = "nova-stream-anime-debug.log";
const RESOLVER_DEBUG_LOG_FILE: &str = "nova-stream-resolver-debug.log";
const ANIWATCH_BASE_URL: &str = "https://aniwatch-api-orcin-six.vercel.app";
const ANIME_ROUGE_BASE_URL: &str = "https://api-anime-rouge.vercel.app";
const TMDB_API_KEY: &str = "49bd672b0680fac7de50e5b9f139a98b";
const TMDB_BASE_URL: &str = "https://api.themoviedb.org/3";
const NUVIO_SIDECAR_BASE_URL: &str = "http://127.0.0.1:7779";
const NUVIO_SIDECAR_PORT: u16 = 7779;
const NUVIO_SIDECAR_STARTUP_TIMEOUT_SECS: u64 = 45;
const NUVIO_STREAM_FETCH_TIMEOUT_SECS: u64 = 75;
const NUVIO_FAST_STAGE_TIMEOUT_SECS: u64 = 18;
const NUVIO_MEDIUM_STAGE_TIMEOUT_SECS: u64 = 30;
const MOVIE_STREAM_CACHE_VERSION: &str = "v3";
const MOVIE_SUBTITLE_CACHE_VERSION: &str = "v4";
const NUVIO_FAST_PROVIDER_SET_MOVIE: &str = "vixsrc,moviesmod,4khdhub,moviesdrive";
const NUVIO_FAST_PROVIDER_SET_ANIMATION: &str = "vixsrc,moviesmod,4khdhub,moviesdrive,moviebox";
const NUVIO_FAST_PROVIDER_SET_SERIES: &str = "vixsrc,moviesdrive,moviesmod";
const NUVIO_PRIMARY_PROVIDER_MOVIE: &str = "vixsrc";
const NUVIO_PRIMARY_PROVIDER_ANIMATION: &str = "vixsrc,moviesmod";
const NUVIO_PRIMARY_PROVIDER_SERIES: &str = "vixsrc,moviesdrive";
const NUVIO_FULL_PROVIDER_SET_MOVIE: &str =
    "vixsrc,moviesmod,4khdhub,moviesdrive,moviebox,hdhub4u,topmovies,soapertv,vidzee,mp4hydra,vidsrc,showbox";
const NUVIO_FULL_PROVIDER_SET_ANIMATION: &str =
    "vixsrc,moviesmod,4khdhub,moviesdrive,moviebox,hdhub4u,topmovies,soapertv,vidzee,mp4hydra,vidsrc,showbox";
const NUVIO_FULL_PROVIDER_SET_SERIES: &str =
    "vixsrc,moviesdrive,moviesmod,4khdhub,moviebox,hdhub4u,topmovies,soapertv,vidzee,mp4hydra,vidsrc,showbox";
const MOVIE_STREAM_CACHE_TTL_SECS: u64 = 20 * 60;
const MOVIE_SUBTITLE_CACHE_TTL_SECS: u64 = 60 * 60;
const WYZIE_SUBTITLES_BASE_URL: &str = "https://sub.wyzie.io";
const SUBDL_API_BASE_URL: &str = "https://api.subdl.com/api/v1";
const SUBDL_DOWNLOAD_BASE_URL: &str = "https://dl.subdl.com";
const SUBF2M_BASE_URL: &str = "https://subf2m.co";
const OPENSUBTITLES_API_BASE_URL: &str = "https://api.opensubtitles.com/api/v1";
const OPENSUBTITLES_CLIENT_USER_AGENT: &str = "NOVA STREAM v1.5.5";
const DEFAULT_WYZIE_MOVIE_SOURCES: &str = "subdl,podnapisi,opensubtitles,yify";
const DEFAULT_WYZIE_SERIES_SOURCES: &str = "gestdown,subdl,podnapisi,opensubtitles";
const DEFAULT_WYZIE_ANIMATION_SOURCES: &str =
    "jimaku,ajatttools,animetosho,kitsunekko,subdl,opensubtitles";
const IFRAME_PLAYER_WINDOW_LABEL: &str = "iframe-player";
const BROWSER_FETCH_BRIDGE_WINDOW_LABEL: &str = "browser-fetch-bridge";
const IFRAME_PLAYER_BROWSER_ARGS: &str =
    "--disable-web-security --allow-running-insecure-content --disable-features=IsolateOrigins,site-per-process";
const IFRAME_PLAYER_DATA_DIR: &str = "iframe-player-webview";
const DOWNLOADS_ROOT_DIR_NAME: &str = "downloads";
const DOWNLOAD_SETTINGS_FILE_NAME: &str = "download-settings.json";
const VIDEO_DOWNLOAD_DEFAULT_MAX_CONCURRENT: usize = 2;
const VIDEO_DOWNLOAD_MAX_CONCURRENT_ANIME: usize = 2;
const EMBEDDED_NUVIO_RUNTIME_ARCHIVE: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/nuvio-runtime.zip"));
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

  const dedupeTracks = (tracks) => {
    const seen = new Set();
    const output = [];

    for (const track of tracks || []) {
      if (!track || typeof track !== 'object') continue;

      const file = String(track.file || track.src || track.url || '').trim();
      if (!file || seen.has(file)) continue;
      seen.add(file);

      const label = String(track.label || track.lang || track.srclang || track.kind || 'Unknown').trim() || 'Unknown';
      output.push({
        file,
        url: file,
        label,
        lang: label,
        kind: String(track.kind || 'captions').trim() || 'captions',
        default: Boolean(track.default)
      });
    }

    return output;
  };

  const pushUrl = (output, value) => {
    const url = String(value || '').trim();
    if (!url) return;
    output.push(url);
  };

  const extractUrlsFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return [];

    const urls = [];
    pushUrl(urls, payload.file);
    pushUrl(urls, payload.url);
    pushUrl(urls, payload.src);

    if (payload.sources && typeof payload.sources === 'object' && !Array.isArray(payload.sources)) {
      pushUrl(urls, payload.sources.file);
      pushUrl(urls, payload.sources.url);
      pushUrl(urls, payload.sources.src);
    }

    [
      payload.sources,
      payload.source,
      payload.backup,
      payload.backups,
      payload.playlist,
      payload.playlist && payload.playlist[0] && payload.playlist[0].sources
    ].forEach((sourceList) => {
      if (!Array.isArray(sourceList)) return;
      sourceList.forEach((source) => {
        if (!source || typeof source !== 'object') return;
        pushUrl(urls, source.file);
        pushUrl(urls, source.url);
        pushUrl(urls, source.src);
      });
    });

    return Array.from(new Set(urls));
  };

  const extractTracksFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return [];

    const tracks = [];
    [
      payload.tracks,
      payload.subtitles,
      payload.captions,
      payload.playlist && payload.playlist[0] && payload.playlist[0].tracks
    ].forEach((trackList) => {
      if (!Array.isArray(trackList)) return;
      trackList.forEach((track) => tracks.push(track));
    });

    return dedupeTracks(tracks);
  };

  const collectDomTracks = () => {
    const tracks = [];

    try {
      document.querySelectorAll('track').forEach((node) => {
        tracks.push({
          file: node.src || node.getAttribute('src') || '',
          label: node.label || node.srclang || node.kind || 'Unknown',
          kind: node.kind || 'captions',
          default: node.default || node.hasAttribute('default')
        });
      });
    } catch (_) {}

    return dedupeTracks(tracks);
  };

  const collectPlayerTracks = () => {
    const tracks = [];

    try {
      const player = typeof window.jwplayer === 'function' ? window.jwplayer() : null;
      if (player) {
        if (typeof player.getPlaylistItem === 'function') {
          tracks.push(...extractTracksFromPayload(player.getPlaylistItem()));
        }
        if (typeof player.getConfig === 'function') {
          tracks.push(...extractTracksFromPayload(player.getConfig()));
        }
        if (typeof player.getPlaylist === 'function') {
          const playlist = player.getPlaylist();
          if (Array.isArray(playlist) && playlist[0]) {
            tracks.push(...extractTracksFromPayload(playlist[0]));
          }
        }
      }
    } catch (_) {}

    return dedupeTracks(tracks);
  };

  const collectTracks = (extraTracks = []) => (
    dedupeTracks([
      ...extraTracks,
      ...collectDomTracks(),
      ...collectPlayerTracks()
    ])
  );

  const matches = (value) => {
    const url = String(value || '');
    return url && patterns.some((pattern) => pattern.test(url));
  };

  const matchesFrame = (value) => {
    const url = String(value || '');
    return url && !matches(url) && framePatterns.some((pattern) => pattern.test(url));
  };

  const report = (value, kind = 'stream', extraTracks = []) => {
    const url = String(value || '');
    const isValid = kind === 'frame' ? matchesFrame(url) : matches(url);
    if (!isValid || reported) return;

    reported = true;
    const tracks = kind === 'stream' ? collectTracks(extraTracks) : [];

    window.location.replace(
      'novastream-capture://capture?kind='
      + encodeURIComponent(kind)
      + '&url='
      + encodeURIComponent(url)
      + '&page='
      + encodeURIComponent(window.location.href)
      + '&tracks='
      + encodeURIComponent(JSON.stringify(tracks))
    );
  };

  const inspectPayload = (payload) => {
    const urls = extractUrlsFromPayload(payload);
    const tracks = extractTracksFromPayload(payload);
    urls.forEach((url) => report(url, 'stream', tracks));
  };

  const inspectTextPayload = (text) => {
    const value = String(text || '').trim();
    if (!value || (!value.startsWith('{') && !value.startsWith('['))) return;

    try {
      inspectPayload(JSON.parse(value));
    } catch (_) {}
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
      const player = typeof window.jwplayer === 'function' ? window.jwplayer() : null;
      if (player) {
        if (typeof player.getPlaylistItem === 'function') {
          inspectPayload(player.getPlaylistItem());
        }
        if (typeof player.getConfig === 'function') {
          inspectPayload(player.getConfig());
        }
      }
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

  const wrapJwplayerInstance = (instance) => {
    if (!instance || instance.__NOVA_CAPTURE_WRAPPED__) return instance;

    if (typeof instance.setup === 'function') {
      const originalSetup = instance.setup;
      instance.setup = function(config) {
        try {
          inspectPayload(config);
        } catch (_) {}
        return originalSetup.apply(this, arguments);
      };
    }

    if (typeof instance.on === 'function') {
      try {
        instance.on('ready', () => {
          try {
            if (typeof instance.getPlaylistItem === 'function') {
              inspectPayload(instance.getPlaylistItem());
            }
            if (typeof instance.getConfig === 'function') {
              inspectPayload(instance.getConfig());
            }
          } catch (_) {}
        });
      } catch (_) {}
    }

    instance.__NOVA_CAPTURE_WRAPPED__ = true;
    return instance;
  };

  const wrapJwplayerFactory = (factory) => {
    if (typeof factory !== 'function' || factory.__NOVA_CAPTURE_FACTORY__) return factory;

    const wrapped = function() {
      return wrapJwplayerInstance(factory.apply(this, arguments));
    };

    try {
      Object.keys(factory).forEach((key) => {
        wrapped[key] = factory[key];
      });
    } catch (_) {}

    wrapped.__NOVA_CAPTURE_FACTORY__ = true;
    return wrapped;
  };

  try {
    let currentJwplayer = typeof window.jwplayer === 'function'
      ? wrapJwplayerFactory(window.jwplayer)
      : window.jwplayer;

    Object.defineProperty(window, 'jwplayer', {
      configurable: true,
      enumerable: true,
      get() {
        return currentJwplayer;
      },
      set(value) {
        currentJwplayer = wrapJwplayerFactory(value);
      }
    });
  } catch (_) {}

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

        try {
          const clone = response && typeof response.clone === 'function' ? response.clone() : null;
          if (clone && typeof clone.text === 'function') {
            clone.text().then((text) => inspectTextPayload(text)).catch(() => {});
          }
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

  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    try {
      this.addEventListener('loadend', () => {
        try {
          report(this.responseURL);
        } catch (_) {}

        try {
          if (typeof this.responseText === 'string') {
            inspectTextPayload(this.responseText);
          }
        } catch (_) {}
      });
    } catch (_) {}

    return originalXhrSend.apply(this, arguments);
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

/// Polls GetForegroundWindow() every 50 ms while the player is fullscreen.
/// Drops TOPMOST when another process owns the foreground (Alt+Tab away),
/// restores it when we become foreground again.
#[cfg(target_os = "windows")]
fn start_fullscreen_focus_monitor(hwnd: *mut std::ffi::c_void) {
    // Cast to usize so it's Send — safe because the main window lives for the app lifetime.
    let hwnd_usize = hwnd as usize;

    std::thread::spawn(move || {
        use std::ffi::c_void;
        type HWND = *mut c_void;
        extern "system" {
            fn GetForegroundWindow() -> HWND;
            fn GetCurrentProcessId() -> u32;
            fn GetWindowThreadProcessId(hwnd: HWND, lpdw_process_id: *mut u32) -> u32;
        }
        let hwnd = hwnd_usize as HWND;
        let our_pid = unsafe { GetCurrentProcessId() };
        while PLAYER_FULLSCREEN.load(std::sync::atomic::Ordering::Relaxed) {
            let fg = unsafe { GetForegroundWindow() };
            let mut fg_pid: u32 = 0;
            unsafe { GetWindowThreadProcessId(fg, &mut fg_pid) };
            win32_set_topmost(hwnd, fg_pid == our_pid);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

#[cfg(target_os = "windows")]
fn win32_set_topmost(hwnd: *mut std::ffi::c_void, topmost: bool) {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    const SWP_NOMOVE: u32       = 0x0002;
    const SWP_NOSIZE: u32       = 0x0001;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    let hwnd_topmost:   HWND = (-1isize) as usize as HWND;
    let hwnd_notopmost: HWND = (-2isize) as usize as HWND;
    extern "system" {
        fn SetWindowPos(hwnd: HWND, hwnd_insert_after: HWND,
                        x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }
    let insert_after = if topmost { hwnd_topmost } else { hwnd_notopmost };
    unsafe { SetWindowPos(hwnd, insert_after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED); }
}

#[tauri::command]
fn set_topmost_state(window: tauri::Window, topmost: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        win32_set_topmost(hwnd, topmost);
    }
    Ok(())
}

#[tauri::command]
fn set_player_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<(), String> {
    PLAYER_FULLSCREEN.store(fullscreen, std::sync::atomic::Ordering::Relaxed);

    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        type HWND     = *mut c_void;
        type HMONITOR = *mut c_void;

        #[repr(C)]
        struct RECT { left: i32, top: i32, right: i32, bottom: i32 }

        #[repr(C)]
        struct MONITORINFO {
            cb_size: u32,
            rc_monitor: RECT,
            rc_work:    RECT,
            dw_flags:   u32,
        }

        const MONITOR_DEFAULTTONEAREST: u32 = 2;
        const SWP_NOSIZE: u32       = 0x0001;
        const SWP_NOMOVE: u32       = 0x0002;
        const SWP_FRAMECHANGED: u32 = 0x0020;
        let hwnd_topmost:   HWND = (-1isize) as usize as HWND;
        let hwnd_notopmost: HWND = (-2isize) as usize as HWND;

        extern "system" {
            fn MonitorFromWindow(hwnd: HWND, dw_flags: u32) -> HMONITOR;
            fn GetMonitorInfoW(h_monitor: HMONITOR, lpmi: *mut MONITORINFO) -> i32;
            fn SetWindowPos(hwnd: HWND, hwnd_insert_after: HWND,
                            x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        }

        let hwnd: HWND = window.hwnd().map_err(|e| e.to_string())?.0;

        if fullscreen {
            let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
            let mut info = MONITORINFO {
                cb_size:    std::mem::size_of::<MONITORINFO>() as u32,
                rc_monitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
                rc_work:    RECT { left: 0, top: 0, right: 0, bottom: 0 },
                dw_flags:   0,
            };
            unsafe { GetMonitorInfoW(monitor, &mut info) };
            let r = &info.rc_monitor;
            unsafe {
                SetWindowPos(
                    hwnd, hwnd_topmost,
                    r.left, r.top, r.right - r.left, r.bottom - r.top,
                    SWP_FRAMECHANGED,
                );
            }
            // Start background thread: drops/restores TOPMOST based on foreground process
            start_fullscreen_focus_monitor(hwnd);
        } else {
            unsafe {
                SetWindowPos(
                    hwnd, hwnd_notopmost,
                    0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
                );
            }
            window.maximize().map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if fullscreen {
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
        } else {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.maximize().map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
async fn fetch_anime_json(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut header_map = HeaderMap::new();

    if let Some(headers) = headers {
        for (key, value) in headers {
            let name = HeaderName::from_bytes(key.as_bytes()).map_err(|e| e.to_string())?;
            let val = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
            header_map.insert(name, val);
        }
    }

    let method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();

    let request = match method.as_str() {
        "POST" => client.post(&url).headers(header_map),
        _ => client.get(&url).headers(header_map),
    };

    let request = if let Some(body) = body {
        request.json(&body)
    } else {
        request
    };

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {} {}", status.as_u16(), text));
    }

    response.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    let _ = window.close();
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimeTextWithSessionResponse {
    text: String,
    session_id: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolverEvalRequestEvent {
    request_id: String,
    script: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolverEvalResultPayload {
    request_id: String,
    ok: bool,
    value: Option<String>,
    error: Option<String>,
}

fn pending_resolver_evals(
) -> &'static Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>> =
        OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn generate_resolver_eval_request_id() -> String {
    format!(
        "resolver-eval-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
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
    tracks: Vec<Value>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedEmbedStream {
    stream_url: String,
    stream_type: String,
    provider_host: String,
    page_url: Option<String>,
    headers: HashMap<String, String>,
    subtitles: Vec<Value>,
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
    release: Option<String>,
    origin: Option<String>,
    file_name: Option<String>,
}

#[derive(Clone)]
struct CachedValue<T> {
    value: T,
    stored_at_ms: u128,
}

#[derive(Clone)]
struct OpenSubtitlesSession {
    base_url: String,
    token: String,
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
static NUVIO_SIDECAR_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static MOVIE_STREAM_CACHE: OnceLock<Mutex<HashMap<String, CachedValue<Vec<ResolvedMovieStream>>>>> =
    OnceLock::new();
static MOVIE_SUBTITLE_CACHE: OnceLock<Mutex<HashMap<String, CachedValue<Vec<ResolvedMovieSubtitle>>>>> =
    OnceLock::new();
static OPENSUBTITLES_SESSION_CACHE: OnceLock<Mutex<Option<CachedValue<OpenSubtitlesSession>>>> =
    OnceLock::new();
static VIDEO_DOWNLOAD_MANAGER: OnceLock<Arc<Mutex<VideoDownloadManager>>> = OnceLock::new();
static BROWSER_FETCH_COUNTER: AtomicU64 = AtomicU64::new(1);
static BROWSER_FETCH_BRIDGE_READY: AtomicBool = AtomicBool::new(false);
static PENDING_BROWSER_FETCHES: OnceLock<
    Mutex<HashMap<String, oneshot::Sender<Result<BrowserFetchResponse, String>>>>,
> = OnceLock::new();

fn resolver_sessions() -> &'static Mutex<HashMap<String, ResolverPlaybackSession>> {
    RESOLVER_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn nuvio_sidecar_child() -> &'static Mutex<Option<Child>> {
    NUVIO_SIDECAR_CHILD.get_or_init(|| Mutex::new(None))
}

fn movie_stream_cache() -> &'static Mutex<HashMap<String, CachedValue<Vec<ResolvedMovieStream>>>> {
    MOVIE_STREAM_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn movie_subtitle_cache() -> &'static Mutex<HashMap<String, CachedValue<Vec<ResolvedMovieSubtitle>>>> {
    MOVIE_SUBTITLE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn opensubtitles_session_cache() -> &'static Mutex<Option<CachedValue<OpenSubtitlesSession>>> {
    OPENSUBTITLES_SESSION_CACHE.get_or_init(|| Mutex::new(None))
}

fn video_download_manager() -> Arc<Mutex<VideoDownloadManager>> {
    VIDEO_DOWNLOAD_MANAGER
        .get_or_init(|| Arc::new(Mutex::new(VideoDownloadManager::default())))
        .clone()
}

fn pending_browser_fetches(
) -> &'static Mutex<HashMap<String, oneshot::Sender<Result<BrowserFetchResponse, String>>>> {
    PENDING_BROWSER_FETCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoDownloadRequest {
    id: String,
    content_id: String,
    content_type: String,
    title: String,
    poster: Option<String>,
    season: Option<u32>,
    episode: Option<u32>,
    episode_title: Option<String>,
    quality: Option<String>,
    imdb_id: Option<String>,
    stream_url: Option<String>,
    stream_type: Option<String>,
    headers: Option<HashMap<String, String>>,
    subtitle_url: Option<String>,
    total_bytes: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDownloadStatusEvent {
    id: String,
    content_id: String,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
    stream_type: Option<String>,
    resume_supported: Option<bool>,
    status: String,
    error_message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDownloadProgressEvent {
    id: String,
    content_id: String,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
    stream_type: Option<String>,
    resolved_quality: Option<String>,
    resume_supported: Option<bool>,
    status: String,
    progress: u8,
    bytes_downloaded: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_sec: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDownloadCompletedEvent {
    id: String,
    content_id: String,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
    stream_type: Option<String>,
    resolved_quality: Option<String>,
    resume_supported: Option<bool>,
    bytes_downloaded: u64,
    total_bytes: u64,
    file_path: String,
    subtitle_file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadsStorageInfo {
    used_bytes: u64,
    total_bytes: u64,
    free_bytes: u64,
    breakdown: HashMap<String, u64>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadSettings {
    custom_root: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadLocationInfo {
    current_path: String,
    default_path: String,
    is_custom: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteVideoDownloadRequest {
    id: String,
    file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetVideoDownloadMaxConcurrentRequest {
    max_concurrent: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeDownloadStatus {
    Queued,
    Downloading,
    Paused,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Clone)]
struct ActiveVideoDownloadControl {
    cancel_flag: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    stop_action: Arc<Mutex<ActiveVideoDownloadStopAction>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveVideoDownloadStopAction {
    None,
    Pause,
    Cancel,
}

struct ManagedVideoDownload {
    request: VideoDownloadRequest,
    status: RuntimeDownloadStatus,
    active: Option<ActiveVideoDownloadControl>,
    file_path: Option<PathBuf>,
    stream_type: Option<String>,
    resume_supported: Option<bool>,
}

struct VideoDownloadManager {
    entries: HashMap<String, ManagedVideoDownload>,
    queue: VecDeque<String>,
    active_count: usize,
    max_concurrent: Option<usize>,
}

impl Default for VideoDownloadManager {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            queue: VecDeque::new(),
            active_count: 0,
            max_concurrent: Some(VIDEO_DOWNLOAD_DEFAULT_MAX_CONCURRENT),
        }
    }
}

fn reconcile_active_download_state(state: &mut VideoDownloadManager) {
    state.active_count = state
        .entries
        .values()
        .filter(|entry| {
            entry.status == RuntimeDownloadStatus::Downloading && entry.active.is_some()
        })
        .count();
}

fn is_anime_video_download(request: &VideoDownloadRequest) -> bool {
    normalize_video_download_content_type(&request.content_type) == "anime"
}

fn active_anime_download_count(state: &VideoDownloadManager) -> usize {
    state
        .entries
        .values()
        .filter(|entry| {
            entry.status == RuntimeDownloadStatus::Downloading
                && entry.active.is_some()
                && is_anime_video_download(&entry.request)
        })
        .count()
}

fn pop_next_schedulable_download_id(
    state: &mut VideoDownloadManager,
    active_anime_count: usize,
) -> Option<String> {
    let mut index = 0usize;

    while index < state.queue.len() {
        let Some(candidate_id) = state.queue.get(index).cloned() else {
            break;
        };

        let Some(entry) = state.entries.get(&candidate_id) else {
            state.queue.remove(index);
            continue;
        };

        if entry.status != RuntimeDownloadStatus::Queued {
            state.queue.remove(index);
            continue;
        }

        if is_anime_video_download(&entry.request) && active_anime_count >= VIDEO_DOWNLOAD_MAX_CONCURRENT_ANIME {
            index += 1;
            continue;
        }

        return state.queue.remove(index);
    }

    None
}

enum VideoDownloadTaskOutcome {
    Completed {
        file_path: PathBuf,
        bytes_downloaded: u64,
        total_bytes: u64,
    },
    Stopped,
    Failed(String),
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn get_cached_value<T: Clone>(
    cache: &Mutex<HashMap<String, CachedValue<T>>>,
    key: &str,
    ttl_secs: u64,
) -> Option<T> {
    let guard = cache.lock().ok()?;
    let entry = guard.get(key)?;
    let age_ms = now_ms().saturating_sub(entry.stored_at_ms);
    if age_ms > u128::from(ttl_secs) * 1000 {
        return None;
    }
    Some(entry.value.clone())
}

fn set_cached_value<T: Clone>(
    cache: &Mutex<HashMap<String, CachedValue<T>>>,
    key: String,
    value: T,
) {
    if let Ok(mut guard) = cache.lock() {
        guard.insert(
            key,
            CachedValue {
                value,
                stored_at_ms: now_ms(),
            },
        );
    }
}

fn embedded_nuvio_runtime_version() -> String {
    format!(
        "{}-{}-{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        env!("NUVIO_RUNTIME_BUILD_ID")
    )
}

fn read_env_assignment_from_file(path: &std::path::Path, key: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let (entry_key, entry_value) = trimmed.split_once('=')?;
        if entry_key.trim() != key {
            continue;
        }

        let value = entry_value.trim().trim_matches('"').trim_matches('\'');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    None
}

fn resolve_wyzie_api_key() -> Option<String> {
    if let Ok(value) = env::var("WYZIE_API_KEY") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    for sidecar_dir in nuvio_sidecar_dir_candidates() {
        let env_path = sidecar_dir.join(".env");
        if let Some(value) = read_env_assignment_from_file(&env_path, "WYZIE_API_KEY") {
            return Some(value);
        }
    }

    None
}

fn resolve_subdl_api_key() -> Option<String> {
    resolve_optional_sidecar_env("SUBDL_API_KEY")
}

fn is_subdl_fallback_enabled() -> bool {
    match resolve_optional_sidecar_env("ENABLE_SUBDL_FALLBACK") {
        Some(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        }
        None => false,
    }
}

fn is_wyzie_fallback_enabled() -> bool {
    match resolve_optional_sidecar_env("ENABLE_WYZIE_FALLBACK") {
        Some(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        }
        None => false,
    }
}

fn resolve_opensubtitles_api_key() -> Option<String> {
    resolve_optional_sidecar_env("OPENSUBTITLES_API_KEY")
}

fn resolve_opensubtitles_username() -> Option<String> {
    resolve_optional_sidecar_env("OPENSUBTITLES_USERNAME")
}

fn resolve_opensubtitles_password() -> Option<String> {
    resolve_optional_sidecar_env("OPENSUBTITLES_PASSWORD")
}

fn normalize_opensubtitles_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return OPENSUBTITLES_API_BASE_URL.to_string();
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if trimmed.ends_with("/api/v1") {
            trimmed.to_string()
        } else {
            format!("{trimmed}/api/v1")
        }
    } else if trimmed.ends_with("/api/v1") {
        format!("https://{trimmed}")
    } else {
        format!("https://{trimmed}/api/v1")
    }
}

fn clear_opensubtitles_session_cache() {
    if let Ok(mut guard) = opensubtitles_session_cache().lock() {
        *guard = None;
    }
}

async fn login_opensubtitles(client: &reqwest::Client) -> Result<OpenSubtitlesSession, String> {
    if let Ok(guard) = opensubtitles_session_cache().lock() {
        if let Some(cached) = guard.as_ref() {
            let age_ms = now_ms().saturating_sub(cached.stored_at_ms);
            if age_ms <= 6 * 60 * 60 * 1000 {
                return Ok(cached.value.clone());
            }
        }
    }

    let api_key = resolve_opensubtitles_api_key()
        .ok_or_else(|| "OpenSubtitles API key is not configured".to_string())?;
    let username = resolve_opensubtitles_username()
        .ok_or_else(|| "OpenSubtitles username is not configured".to_string())?;
    let password = resolve_opensubtitles_password()
        .ok_or_else(|| "OpenSubtitles password is not configured".to_string())?;

    let response = client
        .post(format!("{OPENSUBTITLES_API_BASE_URL}/login"))
        .header("Api-Key", api_key)
        .header("User-Agent", OPENSUBTITLES_CLIENT_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "username": username,
            "password": password
        }))
        .send()
        .await
        .map_err(|e| format!("OpenSubtitles login request failed: {e}"))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenSubtitles login failed: HTTP {}", status));
    }

    let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let token = value
        .get("token")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "OpenSubtitles login response missing token".to_string())?
        .to_string();
    let base_url = normalize_opensubtitles_base_url(
        value
            .get("base_url")
            .and_then(|value| value.as_str())
            .unwrap_or("api.opensubtitles.com"),
    );

    let session = OpenSubtitlesSession { base_url, token };
    if let Ok(mut guard) = opensubtitles_session_cache().lock() {
        *guard = Some(CachedValue {
            value: session.clone(),
            stored_at_ms: now_ms(),
        });
    }

    Ok(session)
}

fn resolve_optional_sidecar_env(key: &str) -> Option<String> {
    if let Ok(value) = env::var(key) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    for sidecar_dir in nuvio_sidecar_dir_candidates() {
        let env_path = sidecar_dir.join(".env");
        if let Some(value) = read_env_assignment_from_file(&env_path, key) {
            return Some(value);
        }
    }

    None
}

fn wyzie_sources_for_content_type(content_type: &str) -> String {
    let (env_key, default_sources) = match content_type {
        "series" => ("WYZIE_SERIES_SOURCES", DEFAULT_WYZIE_SERIES_SOURCES),
        "animation" => ("WYZIE_ANIMATION_SOURCES", DEFAULT_WYZIE_ANIMATION_SOURCES),
        _ => ("WYZIE_MOVIE_SOURCES", DEFAULT_WYZIE_MOVIE_SOURCES),
    };

    resolve_optional_sidecar_env(env_key).unwrap_or_else(|| default_sources.to_string())
}

fn embedded_nuvio_runtime_root() -> Result<PathBuf, String> {
    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or("failed to resolve local app data directory".to_string())?;

    Ok(base_dir.join("NOVA STREAM").join("runtime"))
}

fn stop_nuvio_sidecar_for_runtime_refresh() {
    log_resolver_debug("[nuvio_sidecar] stopping existing sidecar before runtime refresh");
    stop_nuvio_sidecar();
    stop_process_on_port(NUVIO_SIDECAR_PORT);
    std::thread::sleep(std::time::Duration::from_millis(500));
}

fn clear_embedded_nuvio_runtime(runtime_root: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(runtime_root)
        .map_err(|e| format!("failed to create Nuvio runtime root: {e}"))?;

    for (path, label) in [
        (runtime_root.join("vendor"), "embedded Nuvio vendor directory"),
        (runtime_root.join("node"), "embedded Nuvio node directory"),
    ] {
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("failed to remove {label}: {e}"))?;
        }
    }

    Ok(())
}

fn extract_embedded_nuvio_runtime() -> Result<PathBuf, String> {
    let runtime_root = embedded_nuvio_runtime_root()?;
    let version_file = runtime_root.join(".nuvio-runtime-version");
    let version = embedded_nuvio_runtime_version();
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let sidecar_dir = runtime_root.join("vendor").join("nuvio-streams-addon");
    let ffmpeg_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let ffmpeg_path = runtime_root.join("vendor").join("tools").join(ffmpeg_name);
    let node_path = runtime_root.join("node").join(node_name);

    if version_file.exists()
        && fs::read_to_string(&version_file).ok().as_deref() == Some(version.as_str())
        && sidecar_dir.join("server.js").exists()
        && sidecar_dir.join("package.json").exists()
        && node_path.exists()
        && (!cfg!(target_os = "windows") || ffmpeg_path.exists())
    {
        return Ok(runtime_root);
    }

    for attempt in 0..2 {
        if attempt > 0 {
            stop_nuvio_sidecar_for_runtime_refresh();
        }

        let extraction_result = (|| -> Result<(), String> {
            clear_embedded_nuvio_runtime(&runtime_root)?;

            let reader = Cursor::new(EMBEDDED_NUVIO_RUNTIME_ARCHIVE);
            let mut archive = ZipArchive::new(reader)
                .map_err(|e| format!("failed to open embedded Nuvio archive: {e}"))?;

            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| format!("failed to read embedded Nuvio archive entry: {e}"))?;

                let enclosed = entry
                    .enclosed_name()
                    .map(|path| path.to_owned())
                    .ok_or("embedded Nuvio archive contained an unsafe path".to_string())?;
                let output_path = runtime_root.join(enclosed);

                if entry.is_dir() {
                    fs::create_dir_all(&output_path)
                        .map_err(|e| format!("failed to create embedded Nuvio directory: {e}"))?;
                    continue;
                }

                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("failed to create embedded Nuvio parent directory: {e}"))?;
                }

                let mut file = fs::File::create(&output_path)
                    .map_err(|e| format!("failed to create embedded Nuvio file: {e}"))?;
                std::io::copy(&mut entry, &mut file)
                    .map_err(|e| format!("failed to extract embedded Nuvio file: {e}"))?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;

                    if let Some(mode) = entry.unix_mode() {
                        let _ = fs::set_permissions(&output_path, fs::Permissions::from_mode(mode));
                    } else if output_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        == Some(node_name)
                    {
                        let _ = fs::set_permissions(&output_path, fs::Permissions::from_mode(0o755));
                    }
                }
            }

            fs::write(&version_file, &version)
                .map_err(|e| format!("failed to write embedded Nuvio runtime version: {e}"))?;

            Ok(())
        })();

        match extraction_result {
            Ok(()) => return Ok(runtime_root),
            Err(error) if attempt == 0 => {
                log_resolver_debug(&format!(
                    "[nuvio_sidecar] embedded runtime extraction failed on first attempt: {}",
                    error
                ));
            }
            Err(error) => return Err(error),
        }
    }

    Ok(runtime_root)
}

fn nuvio_sidecar_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf());

    if cfg!(debug_assertions) {
        if let Some(repo_root) = repo_root.as_ref() {
            candidates.push(repo_root.join("vendor").join("nuvio-streams-addon"));
        }
    } else if let Ok(runtime_root) = extract_embedded_nuvio_runtime() {
        candidates.push(runtime_root.join("vendor").join("nuvio-streams-addon"));
    }

    if !cfg!(debug_assertions) {
        if let Some(repo_root) = repo_root.as_ref() {
            candidates.push(repo_root.join("vendor").join("nuvio-streams-addon"));
        }
    } else if let Some(repo_root) = repo_root.as_ref() {
        candidates.push(repo_root.join("vendor").join("nuvio-streams-addon"));
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("vendor")
                    .join("nuvio-streams-addon"),
            );
            candidates.push(exe_dir.join("vendor").join("nuvio-streams-addon"));
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn resolve_nuvio_sidecar_dir() -> Result<PathBuf, String> {
    for candidate in nuvio_sidecar_dir_candidates() {
        if candidate.join("server.js").exists() && candidate.join("package.json").exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Nuvio sidecar source not found. Checked: {:?}",
        nuvio_sidecar_dir_candidates()
    ))
}

fn npm_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn resolve_node_binary() -> PathBuf {
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    if cfg!(debug_assertions) {
        if let Some(repo_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
            let candidate = repo_root.join("vendor").join("tools").join(node_name);
            if candidate.exists() {
                return candidate;
            }
        }
    } else if let Ok(runtime_root) = extract_embedded_nuvio_runtime() {
        let candidate = runtime_root.join("node").join(node_name);
        if candidate.exists() {
            return candidate;
        }
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for candidate in [
                exe_dir.join("resources").join("node").join(node_name),
                exe_dir.join("node").join(node_name),
            ] {
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    PathBuf::from(node_name)
}

fn install_nuvio_sidecar_dependencies(sidecar_dir: PathBuf) -> Result<(), String> {
    if sidecar_dir.join("node_modules").exists() {
        return Ok(());
    }

    log_resolver_debug(&format!(
        "[nuvio_sidecar] installing dependencies in {}",
        sidecar_dir.display()
    ));

    let mut command = Command::new(npm_command());
    command
        .arg("install")
        .arg("--omit=dev")
        .arg("--no-audit")
        .arg("--no-fund")
        .current_dir(&sidecar_dir)
        .env("PUPPETEER_SKIP_DOWNLOAD", "true")
        .env("PUPPETEER_SKIP_CHROMIUM_DOWNLOAD", "true");
    configure_background_process(&mut command)?;

    let status = command
        .status()
        .map_err(|e| format!("failed to start npm install: {e}"))?;

    if !status.success() {
        return Err(format!(
            "npm install failed for Nuvio sidecar with status {}",
            status
        ));
    }

    Ok(())
}

fn spawn_nuvio_sidecar(sidecar_dir: PathBuf) -> Result<Child, String> {
    log_resolver_debug(&format!(
        "[nuvio_sidecar] starting local addon from {} on port {}",
        sidecar_dir.display(),
        NUVIO_SIDECAR_PORT
    ));

    let mut command = Command::new(resolve_node_binary());
    command
        .arg("server.js")
        .current_dir(&sidecar_dir)
        .env("PORT", NUVIO_SIDECAR_PORT.to_string())
        .env("USE_REDIS_CACHE", "false")
        .env("USE_EXTERNAL_PROVIDERS", "false")
        .env("ENABLE_PSTREAM_API", "false")
        .env("TMDB_API_KEY", TMDB_API_KEY);
    if let Some(wyzie_api_key) = resolve_wyzie_api_key() {
        command.env("WYZIE_API_KEY", wyzie_api_key);
    }
    configure_background_process(&mut command)?;

    command
        .spawn()
        .map_err(|e| format!("failed to start Nuvio sidecar: {e}"))
}

async fn nuvio_sidecar_is_healthy(client: &reqwest::Client) -> bool {
    match client
        .get(format!("{NUVIO_SIDECAR_BASE_URL}/manifest.json"))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn ensure_nuvio_sidecar(client: &reqwest::Client) -> Result<(), String> {
    if nuvio_sidecar_is_healthy(client).await {
        let managed_running = {
            let mut guard = nuvio_sidecar_child()
                .lock()
                .map_err(|_| "failed to lock Nuvio sidecar state".to_string())?;

            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(_)) => {
                        *guard = None;
                        false
                    }
                    Ok(None) => true,
                    Err(_) => {
                        *guard = None;
                        false
                    }
                },
                None => false,
            }
        };

        if managed_running {
            return Ok(());
        }

        log_resolver_debug("[nuvio_sidecar] replacing unmanaged sidecar process");
        stop_process_on_port(NUVIO_SIDECAR_PORT);
        tokio::time::sleep(Duration::from_millis(350)).await;
    }

    {
        let mut guard = nuvio_sidecar_child()
            .lock()
            .map_err(|_| "failed to lock Nuvio sidecar state".to_string())?;

        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    log_resolver_debug(&format!(
                        "[nuvio_sidecar] previous process exited with status {}",
                        status
                    ));
                    *guard = None;
                }
                Ok(None) => {}
                Err(error) => {
                    log_resolver_debug(&format!(
                        "[nuvio_sidecar] failed to inspect child status: {}",
                        error
                    ));
                    *guard = None;
                }
            }
        }
    }

    if nuvio_sidecar_is_healthy(client).await {
        return Ok(());
    }

    let sidecar_dir = resolve_nuvio_sidecar_dir()?;
    let install_dir = sidecar_dir.clone();

    tokio::task::spawn_blocking(move || install_nuvio_sidecar_dependencies(install_dir))
        .await
        .map_err(|e| format!("failed to join Nuvio dependency installer: {e}"))??;

    {
        let mut guard = nuvio_sidecar_child()
            .lock()
            .map_err(|_| "failed to lock Nuvio sidecar state".to_string())?;

        if guard.is_none() {
            *guard = Some(spawn_nuvio_sidecar(sidecar_dir.clone())?);
        }
    }

    let deadline =
        tokio::time::Instant::now() + Duration::from_secs(NUVIO_SIDECAR_STARTUP_TIMEOUT_SECS);

    while tokio::time::Instant::now() < deadline {
        if nuvio_sidecar_is_healthy(client).await {
            log_resolver_debug("[nuvio_sidecar] health check passed");
            return Ok(());
        }

        {
            let mut guard = nuvio_sidecar_child()
                .lock()
                .map_err(|_| "failed to lock Nuvio sidecar state".to_string())?;

            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    *guard = None;
                    return Err(format!("Nuvio sidecar exited during startup with status {status}"));
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err(format!(
        "Nuvio sidecar did not become healthy within {} seconds",
        NUVIO_SIDECAR_STARTUP_TIMEOUT_SECS
    ))
}

fn stop_nuvio_sidecar() {
    if let Ok(mut guard) = nuvio_sidecar_child().lock() {
        if let Some(mut child) = guard.take() {
            log_resolver_debug("[nuvio_sidecar] stopping local addon");
            #[cfg(target_os = "windows")]
            {
                let _ = kill_process_tree(child.id());
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to run taskkill for Nuvio sidecar: {e}"))?;

    if !status.success() {
        return Err(format!(
            "taskkill failed for Nuvio sidecar pid {} with status {}",
            pid, status
        ));
    }

    Ok(())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFetchRequestEvent {
    request_id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
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
    error: Option<String>,
}

#[derive(Clone)]
struct MediaProxyEntry {
    url: Option<String>,
    headers: HashMap<String, String>,
    session_id: Option<String>,
    file_path: Option<String>,
    content_type: Option<String>,
}

fn media_proxy_entries() -> &'static Mutex<HashMap<String, MediaProxyEntry>> {
    static ENTRIES: OnceLock<Mutex<HashMap<String, MediaProxyEntry>>> = OnceLock::new();
    ENTRIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn media_proxy_base_url() -> &'static OnceLock<String> {
    static BASE_URL: OnceLock<String> = OnceLock::new();
    &BASE_URL
}

fn guess_local_media_content_type(file_path: &str) -> &'static str {
    match StdPath::new(file_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4") => "video/mp4",
        Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("srt") => "application/x-subrip",
        Some("vtt") => "text/vtt",
        _ => "application/octet-stream",
    }
}

fn parse_single_http_range(
    range_header: Option<&axum::http::HeaderValue>,
    total_size: u64,
) -> Result<Option<(u64, u64)>, (StatusCode, String)> {
    let Some(value) = range_header else {
        return Ok(None);
    };

    let range_str = value
        .to_str()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Range header".to_string()))?
        .trim();

    if !range_str.starts_with("bytes=") {
        return Err((StatusCode::BAD_REQUEST, "Unsupported Range unit".to_string()));
    }

    let spec = &range_str[6..];
    if spec.contains(',') {
        return Err((StatusCode::BAD_REQUEST, "Multiple ranges are not supported".to_string()));
    }

    let Some((start_raw, end_raw)) = spec.split_once('-') else {
        return Err((StatusCode::BAD_REQUEST, "Malformed Range header".to_string()));
    };

    if total_size == 0 {
        return Err((
            StatusCode::RANGE_NOT_SATISFIABLE,
            "Range requested for empty file".to_string(),
        ));
    }

    if start_raw.is_empty() {
        let suffix_len = end_raw
            .parse::<u64>()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Range suffix".to_string()))?;
        if suffix_len == 0 {
            return Err((StatusCode::BAD_REQUEST, "Invalid Range suffix".to_string()));
        }
        let start = total_size.saturating_sub(suffix_len);
        let end = total_size.saturating_sub(1);
        return Ok(Some((start, end)));
    }

    let start = start_raw
        .parse::<u64>()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Range start".to_string()))?;

    if start >= total_size {
        return Err((
            StatusCode::RANGE_NOT_SATISFIABLE,
            format!("Range start {} exceeds file size {}", start, total_size),
        ));
    }

    let end = if end_raw.is_empty() {
        total_size.saturating_sub(1)
    } else {
        let parsed_end = end_raw
            .parse::<u64>()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Range end".to_string()))?;
        parsed_end.min(total_size.saturating_sub(1))
    };

    if end < start {
        return Err((StatusCode::BAD_REQUEST, "Invalid Range bounds".to_string()));
    }

    Ok(Some((start, end)))
}

async fn media_proxy_local_file_response(
    file_path: String,
    content_type: Option<String>,
    request_headers: AxumHeaderMap,
) -> Result<http::Response<Body>, (StatusCode, String)> {
    let path = PathBuf::from(&file_path);
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("Local media file not found: {e}")))?;

    if !metadata.is_file() {
        return Err((StatusCode::BAD_REQUEST, "Local media path is not a file".to_string()));
    }

    let total_size = metadata.len();
    let byte_range = parse_single_http_range(request_headers.get("range"), total_size)?;
    let (start, end, status) = if let Some((start, end)) = byte_range {
        (start, end, StatusCode::PARTIAL_CONTENT)
    } else if total_size == 0 {
        (0, 0, StatusCode::OK)
    } else {
        (0, total_size.saturating_sub(1), StatusCode::OK)
    };

    let content_length = if total_size == 0 { 0 } else { end - start + 1 };
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("Failed to open local media file: {e}")))?;

    if content_length > 0 {
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to seek local media file: {e}")))?;
    }

    let body = if content_length > 0 {
        Body::from_stream(ReaderStream::new(file.take(content_length)))
    } else {
        Body::empty()
    };

    let mut response = http::Response::builder()
        .status(status)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", content_length.to_string())
        .header(
            "Content-Type",
            content_type.unwrap_or_else(|| guess_local_media_content_type(&file_path).to_string()),
        );

    if status == StatusCode::PARTIAL_CONTENT && total_size > 0 {
        response = response.header(
            "Content-Range",
            format!("bytes {}-{}/{}", start, end, total_size),
        );
    }

    response
        .body(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn build_resolver_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
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
        .gzip(true)
        .brotli(true)
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
async fn fetch_anime_text(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<String>,
) -> Result<String, String> {
    log_anime_debug(&format!("[fetch_anime_text] URL: {}", url));
    log_anime_debug(&format!("[fetch_anime_text] Method: {:?}", method));
    log_anime_debug(&format!("[fetch_anime_text] Headers sent: {:?}", headers));
    log_anime_debug(&format!(
        "[fetch_anime_text] Body preview: {:?}",
        body.as_deref()
            .map(|b| b.chars().take(200).collect::<String>())
    ));

    let http_method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();

    let should_use_animekai_session =
    url.contains("anikai.to/browser")
        || url.contains("anikai.to/watch/")
        || url.contains("anikai.to/ajax/episodes/list")
        || url.contains("anikai.to/ajax/links/list");

if should_use_animekai_session {
    let fallback_page_url = headers
        .get("Referer")
        .cloned()
        .or_else(|| Some("https://anikai.to/".to_string()));

    let session_client = build_resolver_client()?;
    let session_id = store_resolver_session(
        session_client,
        fallback_page_url.clone(),
        None,
        None,
    )
    .ok_or_else(|| "Failed to create AnimeKai resolver session".to_string())?;

    let bridge_response = browser_fetch_via_bridge(
        app,
        url.clone(),
        http_method.clone(),
        headers.clone(),
        body.clone(),
        "text",
        Some(session_id.as_str()),
        fallback_page_url,
    )
    .await?;

    let text = bridge_response.text.unwrap_or_default();
    let preview: String = text.chars().take(300).collect();

    log_anime_debug(&format!(
        "[fetch_anime_text] AnimeKai session fetch status: {:?}",
        bridge_response.status
    ));
    log_anime_debug(&format!(
        "[fetch_anime_text] AnimeKai session body preview: {}",
        preview
    ));

    let bridge_status = bridge_response.status.unwrap_or(0);

    if bridge_status < 200 || bridge_status >= 300 {
        return Err(format!(
            "Anime text fetch failed: HTTP {} {}",
            bridge_status,
            preview
        ));
    }

    return Ok(text);
}

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .gzip(true)
        .brotli(true)
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = match http_method.as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    }
    .header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if let Some(body) = body {
        request = request.body(body);
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
        return Err(format!("Anime text fetch failed: HTTP {} {}", status, preview));
    }

    Ok(body)
}

#[tauri::command]
async fn fetch_anime_text_with_session(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<String>,
    session_id: Option<String>,
) -> Result<AnimeTextWithSessionResponse, String> {
    let http_method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let should_use_animepahe_browser_session = url.contains("animepahe.com")
        || url.contains("animepahe.si")
        || url.contains("animepahe.org")
        || url.contains("pahe.win")
        || url.contains("kwik.");

    let should_use_resolver_session =
        url.contains("gogoanime.me.uk")
            || url.contains("megaplay.buzz")
            || url.contains("megacloud.bloggy.click")
            || url.contains("mewcdn.online")
            || url.contains("dotstream.buzz")
            || should_use_animepahe_browser_session;

    let mut effective_session_id = session_id;

    if should_use_resolver_session && effective_session_id.is_none() {
        let fallback_page_url = headers
            .get("Referer")
            .cloned()
            .or_else(|| Some(url.clone()));

        let session_client = build_resolver_client()?;
        effective_session_id = store_resolver_session(
            session_client,
            fallback_page_url,
            None,
            None,
        );
    }

    if should_use_animepahe_browser_session {
        let fallback_page_url = if url.contains("kwik.") || url.contains("pahe.win") {
            Some(url.clone())
        } else {
            headers
                .get("Referer")
                .cloned()
                .or_else(|| Some(url.clone()))
        };

        let bridge_response = browser_fetch_via_bridge(
            app.clone(),
            url.clone(),
            http_method.clone(),
            headers.clone(),
            body.clone(),
            "text",
            effective_session_id.as_deref(),
            fallback_page_url,
        )
        .await?;

        let text = bridge_response.text.unwrap_or_default();
        let preview: String = text.chars().take(300).collect();
        let bridge_status = bridge_response.status.unwrap_or(0);

        log_anime_debug(&format!(
            "[fetch_anime_text_with_session] AnimePahe browser session status: {:?} error={:?}",
            bridge_response.status,
            bridge_response.error
        ));
        log_anime_debug(&format!(
            "[fetch_anime_text_with_session] AnimePahe browser session body preview: {}",
            preview
        ));

        if bridge_status < 200 || bridge_status >= 300 {
            let page_extract_mode = if url.contains("/api?") || url.contains("kwik.") {
                "text"
            } else {
                "html"
            };

            log_anime_debug(&format!(
                "[fetch_anime_text_with_session] AnimePahe browser fetch failed, trying page extract mode={} url={}",
                page_extract_mode,
                url
            ));

            let page_response = browser_extract_page_via_session_window(
                app.clone(),
                effective_session_id
                    .as_deref()
                    .ok_or_else(|| "Resolver session missing for AnimePahe extract".to_string())?,
                &url,
                page_extract_mode,
            )
            .await?;

            let page_text = page_response.text.unwrap_or_default();
            let page_preview: String = page_text.chars().take(300).collect();

            log_anime_debug(&format!(
                "[fetch_anime_text_with_session] AnimePahe page extract status: {:?} error={:?}",
                page_response.status,
                page_response.error
            ));
            log_anime_debug(&format!(
                "[fetch_anime_text_with_session] AnimePahe page extract preview: {}",
                page_preview
            ));

            if page_text.trim().is_empty() {
                return Err(format!(
                    "Anime text fetch with session failed: HTTP {} {}",
                    bridge_status,
                    preview
                ));
            }

            return Ok(AnimeTextWithSessionResponse {
                text: page_text,
                session_id: effective_session_id,
            });
        }

        return Ok(AnimeTextWithSessionResponse {
            text,
            session_id: effective_session_id,
        });
    }

    let client = if let Some(ref sid) = effective_session_id {
        resolver_session(Some(sid))
            .map(|session| session.client)
            .unwrap_or(build_resolver_client()?)
    } else {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .gzip(true)
            .brotli(true)
            .build()
            .map_err(|e| e.to_string())?
    };

    let mut request = match http_method.as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    }
    .header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "Anime text fetch with session failed: HTTP {} {}",
            status,
            text.chars().take(300).collect::<String>()
        ));
    }

    Ok(AnimeTextWithSessionResponse {
        text,
        session_id: effective_session_id,
    })
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
.on_page_load(move |_window, payload| {
    if payload.event() == tauri::webview::PageLoadEvent::Finished {
        BROWSER_FETCH_BRIDGE_READY.store(true, Ordering::SeqCst);
        log_resolver_debug(&format!(
            "[browser_fetch_bridge] page loaded url={}",
            payload.url()
        ));
    }
})
.build()
.map_err(|e| e.to_string())?;
    Ok((window, true))
}

async fn wait_for_resolver_session_window_load(session_id: &str) -> Result<(), String> {
    for _ in 0..300 {
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
    if let Some(page_url) = fallback_page_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(page_url.to_string());
    }

    if let Some(page_url) = resolver_session(Some(session_id)).and_then(|session| session.page_url) {
        return Ok(page_url);
    }

    Err("Resolver session has no page URL".to_string())
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
    log_resolver_debug(&format!(
        "[resolver_session_window] page load event={:?} session_id={} label={} url={}",
        payload.event(),
        session_id_owned,
        label_for_load,
        payload.url()
    ));

    update_resolver_session_page_url(&session_id_owned, Some(payload.url().to_string()));

    match payload.event() {
        tauri::webview::PageLoadEvent::Started => {
            update_resolver_session_window(
                &session_id_owned,
                Some(label_for_load.clone()),
                Some(false),
            );
        }
        tauri::webview::PageLoadEvent::Finished => {
            update_resolver_session_window(
                &session_id_owned,
                Some(label_for_load.clone()),
                Some(true),
            );
        }
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

async fn sync_resolver_session_window_to_page_url(
    app: &tauri::AppHandle,
    session_id: &str,
    page_url: &str,
) -> Result<tauri::WebviewWindow, String> {
    let window = ensure_resolver_session_window(
        app,
        session_id,
        Some(page_url.to_string()),
    )
    .await?;

    let current_page_url = resolver_session(Some(session_id))
        .and_then(|session| session.page_url)
        .unwrap_or_default();

    if current_page_url != page_url {
        log_resolver_debug(&format!(
            "[browser_fetch_via_session_window] navigating session_id={} from={} to={}",
            session_id,
            current_page_url,
            page_url
        ));

        update_resolver_session_window(session_id, None, Some(false));
        window
            .navigate(Url::parse(page_url).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

        wait_for_resolver_session_window_load(session_id).await?;
    } else {
        log_resolver_debug(&format!(
            "[browser_fetch_via_session_window] session_id={} already on page_url={}",
            session_id,
            page_url
        ));
    }

    Ok(window)
}

async fn warm_up_dotstream_session_window(
    app: &tauri::AppHandle,
    session_id: &str,
    target_url: &str,
    return_page_url: &str,
) -> Result<(), String> {
    let target = Url::parse(target_url).map_err(|e| e.to_string())?;
    let return_page = Url::parse(return_page_url).map_err(|e| e.to_string())?;

    let window = ensure_resolver_session_window(
        app,
        session_id,
        Some(return_page_url.to_string()),
    )
    .await?;

    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] dotstream warmup start session_id={} target_url={} return_page_url={}",
        session_id,
        target_url,
        return_page_url
    ));

    update_resolver_session_window(session_id, None, Some(false));
    window.navigate(target).map_err(|e| e.to_string())?;
    wait_for_resolver_session_window_load(session_id).await?;

    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] dotstream warmup target loaded session_id={} active_page_url={}",
        session_id,
        resolver_session(Some(session_id))
            .and_then(|session| session.page_url)
            .unwrap_or_default()
    ));

    tokio::time::sleep(Duration::from_millis(1500)).await;

    update_resolver_session_window(session_id, None, Some(false));
    window.navigate(return_page).map_err(|e| e.to_string())?;
    wait_for_resolver_session_window_load(session_id).await?;

    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] dotstream warmup returned session_id={} active_page_url={}",
        session_id,
        resolver_session(Some(session_id))
            .and_then(|session| session.page_url)
            .unwrap_or_default()
    ));

    tokio::time::sleep(Duration::from_millis(500)).await;

    Ok(())
}

fn browser_fetch_eval_script(
    request_id: &str,
    url: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
    response_type: &str,
    page_url: &str,
    callback_url: &str,
) -> Result<String, String> {
    let request_id_json = serde_json::to_string(request_id).map_err(|e| e.to_string())?;
    let url_json = serde_json::to_string(url).map_err(|e| e.to_string())?;
    let method_json = serde_json::to_string(method).map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(headers).map_err(|e| e.to_string())?;
    let body_json = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let response_type_json = serde_json::to_string(response_type).map_err(|e| e.to_string())?;
    let page_url_json = serde_json::to_string(page_url).map_err(|e| e.to_string())?;
    let callback_url_json = serde_json::to_string(callback_url).map_err(|e| e.to_string())?;

        Ok(format!(
        r#"
(() => {{
  const requestId = {request_id_json};
  const url = {url_json};
  const method = {method_json};
  const headers = {headers_json};
  const body = {body_json};
  const responseType = {response_type_json};
  const pageUrl = {page_url_json};
  const callbackUrl = {callback_url_json};

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
    await fetch(callbackUrl, {{
      method: 'POST',
      headers: {{
        'Content-Type': 'application/json',
      }},
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
    }});
  }};

  void (async () => {{
    try {{
      const response = await fetch(url, {{
        method,
        headers,
        body: body ?? undefined,
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
      try {{
        await complete({{
          requestId,
          ok: false,
          responseType,
          error: error instanceof Error ? error.message : String(error),
        }});
      }} catch (reportError) {{
        console.error('Failed to report browser fetch error back to local callback endpoint', {{
          requestId,
          originalError: error instanceof Error ? error.message : String(error),
          reportError: reportError instanceof Error ? reportError.message : String(reportError),
        }});
      }}
    }}
  }})();
}})();
"#,
    ))
}

fn browser_page_extract_eval_script(
    request_id: &str,
    callback_url: &str,
    extract_mode: &str,
) -> Result<String, String> {
    let request_id_json = serde_json::to_string(request_id).map_err(|e| e.to_string())?;
    let callback_url_json = serde_json::to_string(callback_url).map_err(|e| e.to_string())?;
    let extract_mode_json = serde_json::to_string(extract_mode).map_err(|e| e.to_string())?;

    Ok(format!(
        r#"
(() => {{
  const requestId = {request_id_json};
  const callbackUrl = {callback_url_json};
  const extractMode = {extract_mode_json};

  const complete = async (payload) => {{
    await fetch(callbackUrl, {{
      method: 'POST',
      headers: {{
        'Content-Type': 'application/json',
      }},
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
    }});
  }};

  const readPageText = () => {{
    if (extractMode === 'html') {{
      return document.documentElement?.outerHTML || '';
    }}

    return (
      document.body?.innerText ||
      document.body?.textContent ||
      document.documentElement?.textContent ||
      ''
    );
  }};

  void (async () => {{
    try {{
      const text = readPageText();
      await complete({{
        requestId,
        ok: true,
        responseType: 'text',
        text,
        status: 200,
        error: null,
      }});
    }} catch (error) {{
      await complete({{
        requestId,
        ok: false,
        responseType: 'text',
        text: null,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      }});
    }}
  }})();
}})();
"#,
    ))
}

async fn browser_fetch_via_session_window(
    app: tauri::AppHandle,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    response_type: &str,
    session_id: &str,
    fallback_page_url: Option<String>,
) -> Result<BrowserFetchResponse, String> {
    let page_url = resolver_session_page_url(session_id, fallback_page_url.clone())?;
    let callback_base_url = ensure_media_proxy_server(app.clone()).await?;
    let callback_url = format!("{}/browser-fetch-complete", callback_base_url);
    let window = sync_resolver_session_window_to_page_url(&app, session_id, &page_url).await?;
    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] window synced session_id={} page_url={} callback_url={}",
        session_id,
        page_url,
        callback_url
    ));

    let active_page_url = resolver_session(Some(session_id))
        .and_then(|session| session.page_url)
        .unwrap_or_default();

    log_resolver_debug(&format!(
        "[browser_fetch_via_session_window] pre-eval session_id={} active_page_url={} target_url={}",
        session_id,
        active_page_url,
        url
    ));
        async fn run_browser_fetch_eval(
        window: &tauri::WebviewWindow,
        request_id: String,
        session_id: &str,
        url: &str,
        method: &str,
        headers: &HashMap<String, String>,
        body: Option<&str>,
        response_type: &str,
        page_url: &str,
        callback_url: &str,
    ) -> Result<BrowserFetchResponse, String> {
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

        let script = browser_fetch_eval_script(
            &request_id,
            url,
            method,
            headers,
            body,
            response_type,
            page_url,
            callback_url,
        )?;

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

    let first_request_id = generate_browser_fetch_request_id();
    let first_result = run_browser_fetch_eval(
        &window,
        first_request_id,
        session_id,
        &url,
        &method,
        &headers,
        body.as_deref(),
        response_type,
        &page_url,
        &callback_url,
    )
    .await?;

    let first_status = first_result.status.unwrap_or(0);
    let first_body = first_result.text.clone().unwrap_or_default();
    let looks_like_cloudflare = first_status == 403
        && first_body.contains("Attention Required! | Cloudflare");

    if looks_like_cloudflare && url.contains("cdn.dotstream.buzz") {
        log_resolver_debug(&format!(
            "[browser_fetch_via_session_window] cloudflare challenge detected session_id={} url={} retrying_after_warmup=true",
            session_id,
            url
        ));

        warm_up_dotstream_session_window(&app, session_id, &url, &page_url).await?;

        let retry_request_id = generate_browser_fetch_request_id();
        return run_browser_fetch_eval(
            &window,
            retry_request_id,
            session_id,
            &url,
            &method,
            &headers,
            body.as_deref(),
            response_type,
            &page_url,
            &callback_url,
        )
        .await;
    }

    Ok(first_result)
}

async fn browser_extract_page_via_session_window(
    app: tauri::AppHandle,
    session_id: &str,
    page_url: &str,
    extract_mode: &str,
) -> Result<BrowserFetchResponse, String> {
    let callback_base_url = ensure_media_proxy_server(app.clone()).await?;
    let callback_url = format!("{}/browser-fetch-complete", callback_base_url);
    let window = sync_resolver_session_window_to_page_url(&app, session_id, page_url).await?;
    let request_id = generate_browser_fetch_request_id();
    let (tx, rx) = oneshot::channel();

    pending_browser_fetches()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), tx);

    let script = browser_page_extract_eval_script(&request_id, &callback_url, extract_mode)?;

    if let Err(error) = window.eval(script.as_str()) {
        let _ = pending_browser_fetches()
            .lock()
            .map(|mut pending| pending.remove(&request_id));
        return Err(error.to_string());
    }

    match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(result)) => {
            log_resolver_debug(&format!(
                "[browser_extract_page_via_session_window] completed request_id={} status={:?} error={:?}",
                request_id,
                result.as_ref().ok().and_then(|value| value.status),
                result.as_ref().ok().and_then(|value| value.error.clone())
            ));
            result
        }
        Ok(Err(_)) => Err("Browser page extract channel closed".to_string()),
        Err(_) => {
            let _ = pending_browser_fetches()
                .lock()
                .map(|mut pending| pending.remove(&request_id));
            Err("Browser page extract timed out".to_string())
        }
    }
}

async fn eval_in_resolver_session_window(
    app: tauri::AppHandle,
    session_id: &str,
    script: String,
    fallback_page_url: Option<String>,
) -> Result<String, String> {
    let window = ensure_resolver_session_window(&app, session_id, fallback_page_url).await?;
    wait_for_resolver_session_window_load(session_id).await?;

    let request_id = generate_resolver_eval_request_id();
    let (tx, rx) = oneshot::channel();

    pending_resolver_evals()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), tx);

    let request_id_json = serde_json::to_string(&request_id).map_err(|e| e.to_string())?;
    let script_json = serde_json::to_string(&script).map_err(|e| e.to_string())?;

    let wrapped = format!(
        r#"
(() => {{
  const requestId = {request_id_json};
  const userScript = {script_json};
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;

  const complete = async (payload) => {{
    if (!invoke) {{
      throw new Error('Tauri invoke unavailable in resolver session window');
    }}
    await invoke('complete_resolver_eval', {{ payload }});
  }};

  void (async () => {{
    try {{
      const value = await (0, eval)(userScript);
      await complete({{
        requestId,
        ok: true,
        value: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      }});
    }} catch (error) {{
      await complete({{
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }});
    }}
  }})();
}})();
"#
    );

    window.eval(&wrapped).map_err(|e| e.to_string())?;

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Resolver eval channel closed".to_string()),
        Err(_) => {
            let _ = pending_resolver_evals()
                .lock()
                .map(|mut pending| pending.remove(&request_id));
            Err("Resolver eval timed out".to_string())
        }
    }
}

#[tauri::command]
async fn resolver_session_eval(
    app: tauri::AppHandle,
    session_id: String,
    script: String,
    fallback_page_url: Option<String>,
) -> Result<String, String> {
    eval_in_resolver_session_window(app, &session_id, script, fallback_page_url).await
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
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    response_type: &str,
    session_id: Option<&str>,
    fallback_page_url: Option<String>,
) -> Result<BrowserFetchResponse, String> {
    if let Some(session_id) = session_id {
        return browser_fetch_via_session_window(
            app,
            url,
            method,
            headers,
            body,
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
                    method,
                    headers,
                    body,
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
        error: payload.error,
    }));

    Ok(())
}

#[tauri::command]
fn complete_resolver_eval(payload: ResolverEvalResultPayload) -> Result<(), String> {
    let tx = pending_resolver_evals()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&payload.request_id);

    if let Some(tx) = tx {
        let result = if payload.ok {
            Ok(payload.value.unwrap_or_default())
        } else {
            Err(payload
                .error
                .unwrap_or_else(|| "Resolver eval failed".to_string()))
        };

        let _ = tx.send(result);
    }

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
        builder = builder.parent(main_window).map_err(|e| e.to_string())?;

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

    request = request
        .header(
            "Accept",
            "application/vnd.apple.mpegurl, application/x-mpegURL, application/x-mpegurl, */*",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Connection", "keep-alive")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "cross-site");

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
    let use_dotstream_bridge = session_id.is_some() && url.contains("cdn.dotstream.buzz");
log_anime_debug(&format!(
    "[fetch_hls_segment] DotStream bridge eligible: {}",
    use_dotstream_bridge
));

if use_dotstream_bridge {
    log_anime_debug("[fetch_hls_segment][bridge] Starting browser bridge fetch");
    let bridge_response = tokio::time::timeout(
    std::time::Duration::from_secs(20),
    browser_fetch_via_bridge(
        app,
        url.clone(),
        "GET".to_string(),
        headers.clone(),
        None,
        "arrayBuffer",
        session_id.as_deref(),
        headers.get("Referer").cloned(),
    ),
)
.await
.map_err(|_| "Segment browser fetch bridge timed out".to_string())??;

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

    let mut request = prepare_playback_request(&url, &headers, session_id.as_deref())?;
request = request.header("Accept", "*/*");

    let response = request.send().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_segment] Request error: {e}"));
        log_anime_debug("[fetch_hls_segment] Browser-like defaults applied: User-Agent, Accept, Accept-Language, Connection, Sec-Fetch-*");
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
    let use_dotstream_bridge = session_id.is_some() && url.contains("cdn.dotstream.buzz");
log_anime_debug(&format!(
    "[fetch_hls_manifest] DotStream bridge eligible: {}",
    use_dotstream_bridge
));

if use_dotstream_bridge {
    log_anime_debug("[fetch_hls_manifest][bridge] Starting browser bridge fetch");
    let bridge_response = tokio::time::timeout(
    std::time::Duration::from_secs(20),
    browser_fetch_via_bridge(
        app,
        url.clone(),
        "GET".to_string(),
        headers.clone(),
        None,
        "text",
        session_id.as_deref(),
        headers.get("Referer").cloned(),
    ),
)
.await
.map_err(|_| "Manifest browser fetch bridge timed out".to_string())??;

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

    let mut request = prepare_playback_request(&url, &headers, session_id.as_deref())?;
    request = request.header(
    "Accept",
    "application/vnd.apple.mpegurl, application/x-mpegURL, application/x-mpegurl, */*",
);

    let response = request.send().await.map_err(|e| {
        log_anime_debug(&format!("[fetch_hls_manifest] Request error: {e}"));
        log_anime_debug("[fetch_hls_manifest] Browser-like defaults applied: User-Agent, Accept, Accept-Language, Connection, Sec-Fetch-*");
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

async fn media_proxy_handler(
    State(_app): State<tauri::AppHandle>,
    Path(id): Path<String>,
    request_headers: AxumHeaderMap,
) -> Result<http::Response<Body>, (StatusCode, String)> {
    let entry = media_proxy_entries()
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .get(&id)
        .cloned()
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Media proxy entry not found".to_string()))?;

    if let Some(file_path) = entry.file_path.clone() {
        return media_proxy_local_file_response(file_path, entry.content_type.clone(), request_headers).await;
    }

    let client = if let Some(session_id) = entry.session_id.clone() {
        resolver_session(Some(&session_id))
            .map(|session| session.client)
            .unwrap_or(build_resolver_client().map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            })?)
    } else {
        build_resolver_client().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?
    };

    let entry_url = entry
        .url
        .clone()
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Media proxy URL missing".to_string()))?;

    let mut upstream_request = client.get(&entry_url);

    for (key, value) in &entry.headers {
        upstream_request = upstream_request.header(key.as_str(), value.as_str());
    }

    if let Some(range_value) = request_headers.get("range") {
        if let Ok(range_str) = range_value.to_str() {
            upstream_request = upstream_request.header("Range", range_str);
        }
    }

    let upstream_response = upstream_request.send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Media proxy upstream request failed: {e}"),
        )
    })?;

    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();

    let stream = upstream_response
        .bytes_stream()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));

   let mut response = http::Response::builder().status(status);

    for (key, value) in upstream_headers.iter() {
        if let Ok(value_str) = value.to_str() {
            response = response.header(key.as_str(), value_str);
        }
    }

    response
        .body(Body::from_stream(stream))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn browser_fetch_complete_http(
    Json(payload): Json<BrowserFetchCompletePayload>,
) -> Result<StatusCode, (StatusCode, String)> {
    let tx = pending_browser_fetches()
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .remove(&payload.request_id);

    if let Some(tx) = tx {
        let result = Ok(BrowserFetchResponse {
            text: payload.text,
            bytes: payload
                .data_base64
                .as_deref()
                .map(|value| base64::engine::general_purpose::STANDARD.decode(value))
                .transpose()
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
            status: payload.status,
            error: payload.error,
        });

        let _ = tx.send(result);
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_media_proxy_server(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(base_url) = media_proxy_base_url().get() {
        return Ok(base_url.clone());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind media proxy server: {e}"))?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to read media proxy address: {e}"))?;

    let base_url = format!("http://127.0.0.1:{}", addr.port());

    let router = Router::new()
    .route("/media/:id", get(media_proxy_handler))
    .route("/browser-fetch-complete", post(browser_fetch_complete_http))
    .with_state(app.clone());

    let _ = media_proxy_base_url().set(base_url.clone());

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            log_anime_debug(&format!("[media_proxy] server error: {error}"));
        }
    });

    log_anime_debug(&format!("[media_proxy] started at {}", base_url));

    Ok(base_url)
}

#[tauri::command]
async fn register_media_proxy_stream(
    app: tauri::AppHandle,
    url: String,
    headers: HashMap<String, String>,
    session_id: Option<String>,
) -> Result<String, String> {
    let base_url = ensure_media_proxy_server(app).await?;
    let id = Uuid::new_v4().to_string();

    media_proxy_entries()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            id.clone(),
            MediaProxyEntry {
                url: Some(url),
                headers,
                session_id,
                file_path: None,
                content_type: None,
            },
        );

    Ok(format!("{}/media/{}", base_url, id))
}

#[tauri::command]
async fn register_media_proxy_file(
    app: tauri::AppHandle,
    file_path: String,
    content_type: Option<String>,
) -> Result<String, String> {
    let normalized = PathBuf::from(&file_path);
    if !normalized.exists() {
        return Err(format!("Local media file does not exist: {}", file_path));
    }

    let base_url = ensure_media_proxy_server(app).await?;
    let id = Uuid::new_v4().to_string();

    media_proxy_entries()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            id.clone(),
            MediaProxyEntry {
                url: None,
                headers: HashMap::new(),
                session_id: None,
                file_path: Some(file_path.clone()),
                content_type: Some(
                    content_type.unwrap_or_else(|| guess_local_media_content_type(&file_path).to_string()),
                ),
            },
        );

    Ok(format!("{}/media/{}", base_url, id))
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
        .gzip(true)
        .brotli(true)
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

fn extract_hls_attribute(line: &str, attribute: &str) -> Option<String> {
    let escaped_attribute = regex::escape(attribute);
    let quoted_pattern = format!(r#"(?:^|[,:]){escaped_attribute}="([^"]+)""#);
    if let Ok(regex) = Regex::new(&quoted_pattern) {
        if let Some(captures) = regex.captures(line) {
            if let Some(value) = captures.get(1) {
                return Some(value.as_str().to_string());
            }
        }
    }

    let plain_pattern = format!(r"(?:^|[,:]){escaped_attribute}=([^,]+)");
    if let Ok(regex) = Regex::new(&plain_pattern) {
        if let Some(captures) = regex.captures(line) {
            if let Some(value) = captures.get(1) {
                return Some(value.as_str().to_string());
            }
        }
    }

    None
}

fn normalize_hls_subtitle_language(language: Option<&str>, label: &str) -> String {
    let normalized = language
        .unwrap_or(label)
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    let primary = normalized.split('-').next().unwrap_or("en");

    match primary {
        "eng" | "en" => "en",
        "ger" | "deu" | "de" => "de",
        "fre" | "fra" | "fr" => "fr",
        "ita" | "it" => "it",
        "jpn" | "ja" => "ja",
        "ukr" | "uk" => "uk",
        "por" | "pt" => "pt",
        "spa" | "es" => "es",
        other if !other.is_empty() => other,
        _ => "en",
    }
    .to_string()
}

#[derive(Clone, Debug)]
struct HlsAudioTrackDescriptor {
    language: Option<String>,
    normalized_language: String,
    name: String,
    default: bool,
    autoselect: bool,
    channels: Option<String>,
}

#[derive(Clone, Debug)]
struct HlsVideoVariantDescriptor {
    bandwidth: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Clone, Debug)]
struct HlsVideoSelection {
    selector: String,
    quality_label: String,
}

fn normalize_hls_audio_language(language: Option<&str>, name: &str) -> String {
    normalize_hls_subtitle_language(language, name)
}

fn parse_hls_audio_tracks(manifest_text: &str) -> Vec<HlsAudioTrackDescriptor> {
    let mut tracks = manifest_text
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with("#EXT-X-MEDIA:") {
                return None;
            }

            let media_type = extract_hls_attribute(trimmed, "TYPE")?;
            if media_type != "AUDIO" {
                return None;
            }

            let name = extract_hls_attribute(trimmed, "NAME").unwrap_or_else(|| "Unknown".to_string());
            let language = extract_hls_attribute(trimmed, "LANGUAGE");
            let normalized_language = normalize_hls_audio_language(language.as_deref(), &name);
            let default = extract_hls_attribute(trimmed, "DEFAULT")
                .map(|value| value.eq_ignore_ascii_case("yes"))
                .unwrap_or(false);
            let autoselect = extract_hls_attribute(trimmed, "AUTOSELECT")
                .map(|value| value.eq_ignore_ascii_case("yes"))
                .unwrap_or(false);
            let channels = extract_hls_attribute(trimmed, "CHANNELS");

            Some(HlsAudioTrackDescriptor {
                language,
                normalized_language,
                name,
                default,
                autoselect,
                channels,
            })
        })
        .collect::<Vec<_>>();

    tracks.sort_by(|a, b| a.name.cmp(&b.name));
    tracks.dedup_by(|left, right| {
        left.language == right.language
            && left.name.eq_ignore_ascii_case(&right.name)
            && left.channels == right.channels
    });
    tracks
}

fn parse_hls_video_variants(manifest_text: &str) -> Vec<HlsVideoVariantDescriptor> {
    manifest_text
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with("#EXT-X-STREAM-INF:") {
                return None;
            }

            let bandwidth = extract_hls_attribute(trimmed, "BANDWIDTH")
                .and_then(|value| value.parse::<u64>().ok());
            let (width, height) = extract_hls_attribute(trimmed, "RESOLUTION")
                .and_then(|value| {
                    let mut parts = value.split('x');
                    let width = parts.next()?.trim().parse::<u32>().ok()?;
                    let height = parts.next()?.trim().parse::<u32>().ok()?;
                    Some((Some(width), Some(height)))
                })
                .unwrap_or((None, None));

            Some(HlsVideoVariantDescriptor {
                bandwidth,
                width,
                height,
            })
        })
        .collect()
}

fn hls_audio_track_score(track: &HlsAudioTrackDescriptor) -> i32 {
    let mut score = 0;
    let language = track.normalized_language.to_ascii_lowercase();
    let name = track.name.to_ascii_lowercase();

    if language == "en" || language == "eng" {
        score += 120;
    }

    if track.default {
        score += 18;
    }
    if track.autoselect {
        score += 10;
    }

    let english_markers = ["english", "eng", "original", "main"];
    if english_markers.iter().any(|marker| name.contains(marker)) {
        score += 40;
    }

    let non_english_markers = [
        "hindi",
        "tam",
        "tamil",
        "tel",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "urdu",
        "arabic",
        "korean",
        "japanese",
        "jpn",
        "french",
        "german",
        "italian",
        "ita",
        "russian",
        "spanish",
        "spa",
        "latino",
        "chinese",
        "mandarin",
        "ukrainian",
        "ukr",
    ];
    let non_english_hits = non_english_markers
        .iter()
        .filter(|marker| name.contains(**marker))
        .count() as i32;
    if non_english_hits > 0 {
        score -= non_english_hits * 40;
    }

    if !matches!(language.as_str(), "" | "en" | "eng" | "unknown") {
        score -= 28;
    }

    score
}

async fn discover_preferred_hls_audio_selector(
    stream: &ResolvedMovieStream,
) -> Option<String> {
    if stream.stream_type != "hls" {
        return None;
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;

    let mut request = client.get(&stream.url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    for (key, value) in &stream.headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let manifest_text = response.text().await.ok()?;
    let tracks = parse_hls_audio_tracks(&manifest_text);
    let best = tracks.into_iter().max_by_key(hls_audio_track_score)?;

    let mut parts = Vec::new();
    if let Some(language) = best.language.as_deref().filter(|value| !value.trim().is_empty()) {
        parts.push(format!("lang=\"^{}$\"", regex::escape(language.trim())));
    } else if !best.normalized_language.is_empty() && best.normalized_language != "unknown" {
        parts.push(format!(
            "lang=\"^{}$\"",
            regex::escape(best.normalized_language.trim())
        ));
    }
    if !best.name.trim().is_empty() && !best.name.eq_ignore_ascii_case("unknown") {
        parts.push(format!("name=\"^{}$\"", regex::escape(best.name.trim())));
    }
    parts.push("for=best".to_string());

    if parts.len() <= 1 {
        Some("lang=\"en|eng\":for=best".to_string())
    } else {
        Some(parts.join(":"))
    }
}

fn pick_preferred_hls_video_variant(
    variants: &[HlsVideoVariantDescriptor],
    requested_quality: Option<&str>,
) -> Option<HlsVideoVariantDescriptor> {
    let mut variants = variants.to_vec();
    variants.sort_by(|a, b| {
        let ah = a.height.unwrap_or(0);
        let bh = b.height.unwrap_or(0);
        let ab = a.bandwidth.unwrap_or(0);
        let bb = b.bandwidth.unwrap_or(0);
        ah.cmp(&bh).then_with(|| ab.cmp(&bb))
    });

    if variants.is_empty() {
        return None;
    }

    match requested_quality.unwrap_or("high").trim().to_ascii_lowercase().as_str() {
        "standard" => variants
            .iter()
            .filter(|variant| variant.height.unwrap_or(u32::MAX) <= 540)
            .max_by_key(|variant| (variant.height.unwrap_or(0), variant.bandwidth.unwrap_or(0)))
            .cloned()
            .or_else(|| variants.first().cloned()),
        "highest" => variants.last().cloned(),
        _ => variants
            .iter()
            .filter(|variant| {
                let height = variant.height.unwrap_or(0);
                height <= 1080 && height >= 720
            })
            .max_by_key(|variant| (variant.height.unwrap_or(0), variant.bandwidth.unwrap_or(0)))
            .cloned()
            .or_else(|| {
                variants
                    .iter()
                    .filter(|variant| variant.height.unwrap_or(0) <= 1080)
                    .max_by_key(|variant| (variant.height.unwrap_or(0), variant.bandwidth.unwrap_or(0)))
                    .cloned()
            })
            .or_else(|| variants.last().cloned()),
    }
}

fn build_hls_video_selector(
    variant: &HlsVideoVariantDescriptor,
    requested_quality: Option<&str>,
) -> String {
    if let (Some(width), Some(height)) = (variant.width, variant.height) {
        return format!("res=\"^{width}x{height}$\":for=best");
    }

    if let Some(bandwidth) = variant.bandwidth {
        return format!("bwMin={bandwidth}:bwMax={bandwidth}:for=best");
    }

    match requested_quality.unwrap_or("high").trim().to_ascii_lowercase().as_str() {
        "standard" => "worst".to_string(),
        "highest" => "best".to_string(),
        _ => "best".to_string(),
    }
}

fn describe_hls_video_variant_quality(
    variant: &HlsVideoVariantDescriptor,
    requested_quality: Option<&str>,
) -> String {
    if let Some(height) = variant.height {
        if height >= 2000 {
            return "4K".to_string();
        }
        if height >= 1400 {
            return "1440p".to_string();
        }
        if height >= 1000 {
            return "1080p".to_string();
        }
        if height >= 700 {
            return "720p".to_string();
        }
        if height >= 500 {
            return "540p".to_string();
        }
        if height > 0 {
            return format!("{height}p");
        }
    }

    match requested_quality.unwrap_or("high").trim().to_ascii_lowercase().as_str() {
        "standard" => "SD".to_string(),
        "highest" => "Best".to_string(),
        _ => "HD".to_string(),
    }
}

async fn discover_preferred_hls_video_selector(
    stream: &ResolvedMovieStream,
    requested_quality: Option<&str>,
) -> Option<HlsVideoSelection> {
    if stream.stream_type != "hls" {
        return None;
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;

    let mut request = client.get(&stream.url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    for (key, value) in &stream.headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let manifest_text = response.text().await.ok()?;
    let variants = parse_hls_video_variants(&manifest_text);
    let chosen = pick_preferred_hls_video_variant(&variants, requested_quality)?;
    Some(HlsVideoSelection {
        selector: build_hls_video_selector(&chosen, requested_quality),
        quality_label: describe_hls_video_variant_quality(&chosen, requested_quality),
    })
}

fn parse_hls_subtitle_tracks(
    manifest_text: &str,
    manifest_url: &Url,
    provider: &str,
) -> Vec<ResolvedMovieSubtitle> {
    let mut subtitles = manifest_text
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with("#EXT-X-MEDIA:") {
                return None;
            }

            let media_type = extract_hls_attribute(trimmed, "TYPE")?;
            if media_type != "SUBTITLES" {
                return None;
            }

            let uri = extract_hls_attribute(trimmed, "URI")?;
            let subtitle_url = manifest_url.join(&uri).ok()?.to_string();
            let label = extract_hls_attribute(trimmed, "NAME").unwrap_or_else(|| "Unknown".to_string());
            let language = normalize_hls_subtitle_language(
                extract_hls_attribute(trimmed, "LANGUAGE").as_deref(),
                &label,
            );
            let hearing_impaired = label.to_ascii_lowercase().contains("[cc]");

            Some(ResolvedMovieSubtitle {
                url: subtitle_url,
                label,
                language,
                format: "vtt".to_string(),
                source: provider.to_string(),
                hearing_impaired,
                release: None,
                origin: None,
                file_name: None,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

fn should_probe_provider_hls_subtitles(stream: &ResolvedMovieStream) -> bool {
    let provider = stream.provider.trim().to_ascii_lowercase();
    stream.subtitles.is_empty()
        && stream.stream_type == "hls"
        && (provider.contains("vixsrc")
            || provider.contains("moviesmod")
            || provider.contains("4khdhub"))
}

async fn discover_provider_hls_subtitles(
    client: &reqwest::Client,
    stream: &ResolvedMovieStream,
) -> Vec<ResolvedMovieSubtitle> {
    if !should_probe_provider_hls_subtitles(stream) {
        return Vec::new();
    }

    let mut request = client.get(&stream.url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    for (key, value) in &stream.headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            log_resolver_debug(&format!(
                "[provider_subtitles] manifest request failed provider={} url={} error={}",
                stream.provider, stream.url, error
            ));
            return Vec::new();
        }
    };

    if !response.status().is_success() {
        log_resolver_debug(&format!(
            "[provider_subtitles] manifest request rejected provider={} url={} status={}",
            stream.provider,
            stream.url,
            response.status()
        ));
        return Vec::new();
    }

    let final_url = response.url().clone();
    let manifest_text = match response.text().await {
        Ok(text) => text,
        Err(error) => {
            log_resolver_debug(&format!(
                "[provider_subtitles] manifest text read failed provider={} url={} error={}",
                stream.provider, stream.url, error
            ));
            return Vec::new();
        }
    };

    let subtitles = parse_hls_subtitle_tracks(&manifest_text, &final_url, &stream.provider);
    if !subtitles.is_empty() {
        log_resolver_debug(&format!(
            "[provider_subtitles] discovered native tracks provider={} subtitleCount={} url={}",
            stream.provider,
            subtitles.len(),
            stream.url
        ));
    }

    subtitles
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
    content_type: Option<String>,
    strategy: String,
    subtitles: Vec<ResolvedMovieSubtitle>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovieResolverRequest {
    tmdb_id: String,
    content_type: String,
    season: Option<u32>,
    episode: Option<u32>,
    imdb_id: Option<String>,
    force_refresh: Option<bool>,
    exclude_urls: Option<Vec<String>>,
    exclude_providers: Option<Vec<String>>,
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
        request = request.header("Range", "bytes=0-511");
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
    } else if !(status.is_success() || status.as_u16() == 206) {
        false
    } else {
        match response.bytes().await {
            Ok(bytes) => {
                let media_like_content_type = is_media_like_content_type(content_type.as_deref());
                let matroska_signature = bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]);

                media_like_content_type
                    && (matroska_signature || !looks_like_non_media_payload_prefix(&bytes))
            }
            Err(_) => false,
        }
    };

    let error = if ok {
        None
    } else {
        Some(if normalized_stream_type == "hls" && status.is_success() {
            "Movie stream probe failed: manifest was not a playable HLS playlist".to_string()
        } else if normalized_stream_type != "hls"
            && (status.is_success() || status.as_u16() == 206)
        {
            format!(
                "Movie stream probe failed: non-media content type {:?}",
                content_type
            )
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

fn movie_stream_type_score(value: &str) -> i32 {
    match value {
        "hls" => 3,
        "mp4" => 1,
        _ => 0,
    }
}

fn movie_provider_preference_score(provider: &str, content_type: &str) -> i32 {
    let normalized = provider.to_ascii_lowercase();

    if content_type == "animation" {
        if normalized.contains("vixsrc") {
            6
        } else if normalized.contains("moviesmod") {
            5
        } else if normalized.contains("4khdhub") {
            4
        } else if normalized.contains("moviesdrive") || normalized.contains("moviebox") {
            1
        } else if normalized.contains("showbox") {
            -2
        } else if normalized.contains("vidsrc") || normalized.contains("vidzee") {
            -4
        } else if normalized.contains("topmovies") || normalized.contains("mp4hydra") {
            -5
        } else if normalized.contains("auto") {
            1
        } else {
            0
        }
    } else {
        if normalized.contains("vixsrc") {
            6
        } else if normalized.contains("moviesmod") {
            5
        } else if normalized.contains("4khdhub") {
            4
        } else if normalized.contains("moviesdrive") || normalized.contains("moviebox") {
            2
        } else if normalized.contains("showbox") {
            -1
        } else if normalized.contains("vidsrc") || normalized.contains("vidzee") {
            -3
        } else if normalized.contains("topmovies") || normalized.contains("mp4hydra") {
            -4
        } else if normalized.contains("auto") {
            1
        } else {
            0
        }
    }
}

fn movie_stream_host(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|value| value.host_str().map(str::to_string))
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_known_bad_movie_direct_host(url: &str) -> bool {
    let host = movie_stream_host(url);
    host.ends_with("video-leech.pro")
}

fn movie_host_preference_score(provider: &str, url: &str, content_type: &str) -> i32 {
    let normalized_provider = provider.to_ascii_lowercase();
    let host = movie_stream_host(url);

    if host.is_empty() {
        return 0;
    }

    if is_known_bad_movie_direct_host(url) {
        return -100;
    }

    if normalized_provider.contains("moviesmod") {
        if host.ends_with("workers.dev") {
            return 40;
        }
        if host.ends_with("googleusercontent.com") {
            return 34;
        }
        if host.ends_with("moviesmod.cafe") {
            return 26;
        }
        return 0;
    }

    if normalized_provider.contains("4khdhub") {
        if host.ends_with("pixeldrain.dev") {
            return 10;
        }
        if host.ends_with("hub.mayhem.buzz") || host.ends_with("hub.oreao-cdn.buzz") {
            return -8;
        }
    }

    if normalized_provider.contains("uhdmovies") {
        if host.ends_with("googleusercontent.com") {
            return if content_type == "animation" { 16 } else { 12 };
        }
    }

    0
}

fn movie_variant_preference_score(stream: &ResolvedMovieStream, content_type: &str) -> i32 {
    let provider = stream.provider.to_ascii_lowercase();
    let title = stream.title.to_ascii_lowercase();
    let url = stream.url.to_ascii_lowercase();
    let mut score = 0;

    if provider.contains("moviesmod") {
        if url.contains("workers.dev") {
            score += 18;
        }
        if title.contains("10bit") {
            score -= if content_type == "animation" { 10 } else { 8 };
        }
        if title.contains("web-dl") {
            score += 3;
        }
        if title.contains("moviesmod.cafe") {
            score += 2;
        }
    }

    if provider.contains("4khdhub") {
        if title.contains("dv") || title.contains("hdr") || title.contains("atmos") {
            score -= 4;
        }
    }

    score
}

fn movie_audio_preference_score(stream: &ResolvedMovieStream) -> i32 {
    let title = stream.title.to_ascii_lowercase();
    let provider = stream.provider.to_ascii_lowercase();
    let url = stream.url.to_ascii_lowercase();
    let combined = format!("{title} {provider} {url}");

    let english_markers = [
        "english",
        "eng",
        "english dub",
        "dubbed",
        "amzn",
        "itunes",
    ];
    let non_english_markers = [
        "hindi",
        "tam",
        "tamil",
        "tel",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "urdu",
        "arabic",
        "korean",
        "japanese",
        "jpn",
        "french",
        "german",
        "italian",
        "russian",
        "spanish",
        "latino",
        "chinese",
        "mandarin",
        "dual audio",
        "multi audio",
        "multi-audio",
        "esubs",
    ];

    let mut score = 0;

    if english_markers.iter().any(|marker| combined.contains(marker)) {
        score += 10;
    }

    let non_english_hits = non_english_markers
        .iter()
        .filter(|marker| combined.contains(**marker))
        .count() as i32;

    if non_english_hits > 0 {
        score -= non_english_hits * 18;
        if !combined.contains("english") && !combined.contains("eng") {
            score -= 12;
        }
    }

    score
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
    if !candidate.starts_with("https://") || is_base64_like_token(candidate) {
        return false;
    }

    let lower = candidate.to_ascii_lowercase();
    if lower.contains("github.com/")
        || lower.contains("githubusercontent.com/")
        || lower.contains("raw.githubusercontent.com/")
        || lower.contains("youtube.com/")
        || lower.contains("youtu.be/")
        || lower.ends_with(".html")
        || lower.contains("/embed/")
        || lower.contains("/iframe/")
        || lower.contains("autoembed")
        || lower.contains("vidsrc.")
        || lower.contains("vidsrc/")
        || lower.contains("watch.html")
        || lower.contains("index.html")
        || lower.contains("/blob/")
        || lower.contains("/tree/")
        || lower.contains("video-leech.pro/")
    {
        return false;
    }

    true
}

fn looks_like_non_media_payload_prefix(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }

    if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return false;
    }

    let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).to_ascii_lowercase();
    let trimmed = preview.trim_start_matches('\u{feff}').trim_start();

    trimmed.starts_with("<!doctype")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<?xml")
        || trimmed.starts_with("{\"")
        || trimmed.starts_with("[")
        || trimmed.contains("<title>")
        || trimmed.contains("cloudflare")
        || trimmed.contains("access denied")
        || trimmed.contains("captcha")
        || trimmed.contains("forbidden")
}

fn is_media_like_content_type(content_type: Option<&str>) -> bool {
    let normalized = content_type
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    if normalized.is_empty() {
        return false;
    }

    normalized.starts_with("video/")
        || normalized.starts_with("audio/")
        || normalized.contains("application/octet-stream")
        || normalized.contains("binary/octet-stream")
        || normalized.contains("application/mp4")
        || normalized.contains("application/vnd.apple.mpegurl")
        || normalized.contains("application/x-mpegurl")
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

async fn fetch_json_value_with_timeout(
    client: &reqwest::Client,
    url: &str,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    match tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        fetch_json_value(client, url),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(format!("timeout after {}s", timeout_secs)),
    }
}

fn build_nuvio_stream_urls(
    imdb_id: &str,
    content_type: &str,
    season: Option<u32>,
    episode: Option<u32>,
) -> Vec<(String, &'static str, u64)> {
    let (primary_provider_set, fast_provider_set, full_provider_set) = match content_type {
        "series" => (
            NUVIO_PRIMARY_PROVIDER_SERIES,
            NUVIO_FAST_PROVIDER_SET_SERIES,
            NUVIO_FULL_PROVIDER_SET_SERIES,
        ),
        "animation" => (
            NUVIO_PRIMARY_PROVIDER_ANIMATION,
            NUVIO_FAST_PROVIDER_SET_ANIMATION,
            NUVIO_FULL_PROVIDER_SET_ANIMATION,
        ),
        _ => (
            NUVIO_PRIMARY_PROVIDER_MOVIE,
            NUVIO_FAST_PROVIDER_SET_MOVIE,
            NUVIO_FULL_PROVIDER_SET_MOVIE,
        ),
    };

    let base_path = if content_type == "series" {
        format!(
            "{NUVIO_SIDECAR_BASE_URL}/stream/series/{}:{}:{}.json",
            imdb_id,
            season.unwrap_or(1),
            episode.unwrap_or(1)
        )
    } else {
        format!("{NUVIO_SIDECAR_BASE_URL}/stream/movie/{}.json", imdb_id)
    };

    vec![
        (
            format!("{base_path}?providers={primary_provider_set}"),
            "primary-provider",
            NUVIO_FAST_STAGE_TIMEOUT_SECS,
        ),
        (
            format!("{base_path}?providers={fast_provider_set}"),
            "fast-providers",
            NUVIO_MEDIUM_STAGE_TIMEOUT_SECS,
        ),
        (
            format!("{base_path}?providers={full_provider_set}"),
            "full-fallback",
            NUVIO_STREAM_FETCH_TIMEOUT_SECS,
        ),
    ]
}

fn normalize_nuvio_streams(value: &serde_json::Value, strategy: &str) -> Vec<ResolvedMovieStream> {
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
            let provider = stream
                .get("provider")
                .and_then(|value| value.as_str())
                .or_else(|| stream.get("name").and_then(|value| value.as_str()))
                .unwrap_or("Nuvio")
                .to_string();
            let subtitles = stream
                .get("subtitles")
                .map(|value| normalize_provider_subtitles(value, &provider))
                .unwrap_or_default();

            Some(ResolvedMovieStream {
                stream_type: infer_stream_type(&url),
                url,
                quality,
                provider,
                headers,
                title: stream
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                source: "nuvio-streams".to_string(),
                content_type: None,
                strategy: strategy.to_string(),
                subtitles,
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
            let release = item
                .get("release")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let origin = item
                .get("origin")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let file_name = item
                .get("fileName")
                .and_then(|value| value.as_str())
                .map(str::to_string);
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
                release,
                origin,
                file_name,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

fn normalize_subdl_download_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed.trim_start_matches('/');
    if normalized.is_empty() {
        return None;
    }

    if normalized.starts_with("subtitle/") {
        return Some(format!("{SUBDL_DOWNLOAD_BASE_URL}/{normalized}"));
    }

    if normalized.ends_with(".zip") {
        return Some(format!("{SUBDL_DOWNLOAD_BASE_URL}/subtitle/{normalized}"));
    }

    None
}

fn normalize_subdl_subtitles(data: &serde_json::Value) -> Vec<ResolvedMovieSubtitle> {
    let Some(streams) = data.get("subtitles").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    let mut subtitles = streams
        .iter()
        .filter_map(|item| {
            let url = item
                .get("url")
                .or_else(|| item.get("download_url"))
                .or_else(|| item.get("downloadUrl"))
                .or_else(|| item.get("download_link"))
                .or_else(|| item.get("downloadLink"))
                .or_else(|| item.get("link"))
                .and_then(|value| value.as_str())
                .and_then(normalize_subdl_download_url)?;

            let language = item
                .get("language")
                .or_else(|| item.get("lang"))
                .and_then(|value| value.as_str())
                .unwrap_or("en")
                .to_ascii_lowercase();
            let release = item
                .get("release_name")
                .or_else(|| item.get("release"))
                .or_else(|| item.get("name"))
                .or_else(|| item.get("file_name"))
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let comment = item
                .get("comment")
                .or_else(|| item.get("author_comment"))
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let hearing_impaired = item
                .get("hi")
                .or_else(|| item.get("isHearingImpaired"))
                .or_else(|| item.get("hearing_impaired"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let label = release
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "English".to_string());
            let format = if url.to_ascii_lowercase().ends_with(".zip") {
                "zip".to_string()
            } else if url.to_ascii_lowercase().contains(".vtt") {
                "vtt".to_string()
            } else {
                "srt".to_string()
            };

            Some(ResolvedMovieSubtitle {
                url,
                label,
                language,
                format,
                source: "subdl-direct".to_string(),
                hearing_impaired,
                release: release.clone(),
                origin: comment,
                file_name: release,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

fn parse_opensubtitles_file_id(url: &str) -> Option<u64> {
    url.strip_prefix("opensubtitles://")
        .and_then(|value| value.parse::<u64>().ok())
}

fn normalize_opensubtitles_subtitles(data: &serde_json::Value) -> Vec<ResolvedMovieSubtitle> {
    let Some(streams) = data.get("data").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    let mut subtitles = streams
        .iter()
        .filter_map(|item| {
            let attributes = item.get("attributes")?;
            let files = attributes.get("files")?.as_array()?;
            let file_id = files
                .iter()
                .filter_map(|file| {
                    file.get("file_id")
                        .or_else(|| file.get("fileId"))
                        .and_then(|value| value.as_u64())
                })
                .next()?;

            let language = attributes
                .get("language")
                .or_else(|| attributes.get("language_code"))
                .and_then(|value| value.as_str())
                .unwrap_or("en")
                .to_ascii_lowercase();
            let release = attributes
                .get("release")
                .or_else(|| attributes.get("movie_name"))
                .or_else(|| attributes.get("feature_details").and_then(|value| value.get("movie_name")))
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let file_name = files
                .iter()
                .filter_map(|file| {
                    file.get("file_name")
                        .or_else(|| file.get("fileName"))
                        .and_then(|value| value.as_str())
                })
                .next()
                .map(str::to_string);
            let hearing_impaired = attributes
                .get("hearing_impaired")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let format = attributes
                .get("format")
                .and_then(|value| value.as_str())
                .unwrap_or("srt")
                .to_string();
            let label = release
                .clone()
                .or_else(|| file_name.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "English".to_string());

            Some(ResolvedMovieSubtitle {
                url: format!("opensubtitles://{file_id}"),
                label,
                language,
                format,
                source: "opensubtitles-direct".to_string(),
                hearing_impaired,
                release,
                origin: None,
                file_name,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

async fn fetch_opensubtitles_subtitles(
    client: &reqwest::Client,
    imdb_id: &str,
    content_type: &str,
    season: Option<u32>,
    episode: Option<u32>,
) -> Result<Vec<ResolvedMovieSubtitle>, String> {
    let api_key = match resolve_opensubtitles_api_key() {
        Some(value) => value,
        None => return Ok(Vec::new()),
    };

    async fn request_once(
        client: &reqwest::Client,
        api_key: &str,
        imdb_id: &str,
        content_type: &str,
        season: Option<u32>,
        episode: Option<u32>,
    ) -> Result<reqwest::Response, String> {
        let session = login_opensubtitles(client).await?;
        let mut url = Url::parse(&format!("{}/subtitles", session.base_url)).map_err(|e| e.to_string())?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("imdb_id", imdb_id)
                .append_pair("languages", "en")
                .append_pair("order_by", "download_count")
                .append_pair("order_direction", "desc");

            if content_type == "series" {
                query
                    .append_pair("season_number", &season.unwrap_or(1).to_string())
                    .append_pair("episode_number", &episode.unwrap_or(1).to_string());
            }
        }

        client
            .get(url)
            .header("Api-Key", api_key)
            .header("User-Agent", OPENSUBTITLES_CLIENT_USER_AGENT)
            .header(reqwest::header::ACCEPT, "application/json")
            .bearer_auth(session.token)
            .send()
            .await
            .map_err(|e| format!("OpenSubtitles search request failed: {e}"))
    }

    let mut response = request_once(client, &api_key, imdb_id, content_type, season, episode).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_opensubtitles_session_cache();
        response = request_once(client, &api_key, imdb_id, content_type, season, episode).await?;
    }

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenSubtitles search failed: HTTP {}", status));
    }

    let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(normalize_opensubtitles_subtitles(&value))
}

async fn resolve_opensubtitles_download_link(
    client: &reqwest::Client,
    file_id: u64,
) -> Result<String, String> {
    let api_key = resolve_opensubtitles_api_key()
        .ok_or_else(|| "OpenSubtitles API key is not configured".to_string())?;

    async fn request_once(
        client: &reqwest::Client,
        api_key: &str,
        file_id: u64,
    ) -> Result<reqwest::Response, String> {
        let session = login_opensubtitles(client).await?;
        client
            .post(format!("{}/download", session.base_url))
            .header("Api-Key", api_key)
            .header("User-Agent", OPENSUBTITLES_CLIENT_USER_AGENT)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .bearer_auth(session.token)
            .json(&serde_json::json!({
                "file_id": file_id,
                "sub_format": "srt"
            }))
            .send()
            .await
            .map_err(|e| format!("OpenSubtitles download request failed: {e}"))
    }

    let mut response = request_once(client, &api_key, file_id).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        clear_opensubtitles_session_cache();
        response = request_once(client, &api_key, file_id).await?;
    }

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenSubtitles download failed: HTTP {}", status));
    }

    let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    value
        .get("link")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "OpenSubtitles download response missing link".to_string())
}

async fn resolve_tmdb_subtitle_query(
    client: &reqwest::Client,
    tmdb_id: &str,
    content_type: &str,
) -> Result<(String, Option<String>), String> {
    let endpoint = if content_type == "series" { "tv" } else { "movie" };
    let url = format!("{TMDB_BASE_URL}/{endpoint}/{tmdb_id}?api_key={TMDB_API_KEY}");
    let data = fetch_json_value(client, &url).await?;
    let title = data
        .get("title")
        .or_else(|| data.get("name"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "TMDB title is missing".to_string())?
        .to_string();
    let year = data
        .get("release_date")
        .or_else(|| data.get("first_air_date"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.split('-').next())
        .filter(|value| value.len() == 4)
        .map(str::to_string);

    Ok((title, year))
}

async fn fetch_subf2m_subtitles(
    client: &reqwest::Client,
    tmdb_id: &str,
    imdb_id: &str,
    content_type: &str,
) -> Result<Vec<ResolvedMovieSubtitle>, String> {
    if content_type == "series" {
        return Ok(Vec::new());
    }

    let (title, year) = resolve_tmdb_subtitle_query(client, tmdb_id, content_type).await?;
    let mut search_url = Url::parse(&format!("{SUBF2M_BASE_URL}/subtitles/searchbytitle"))
        .map_err(|e| e.to_string())?;
    {
        let mut query = search_url.query_pairs_mut();
        query.append_pair("query", &title);
    }

    let search_html = client
        .get(search_url.clone())
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("subf2m search failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let slug_pattern = Regex::new(r#"href="(/subtitles/[^"/?]+)""#).map_err(|e| e.to_string())?;
    let mut candidate_paths = slug_pattern
        .captures_iter(&search_html)
        .filter_map(|captures| captures.get(1).map(|value| value.as_str().to_string()))
        .filter(|path| !path.contains("/searchbytitle"))
        .collect::<Vec<_>>();
    candidate_paths.sort();
    candidate_paths.dedup();

    let imdb_marker = format!("/title/{imdb_id}");
    let expected_year = year.as_deref();
    let mut matched_path: Option<String> = None;

    for path in candidate_paths.iter().take(8) {
        let page_url = format!("{SUBF2M_BASE_URL}{path}");
        let page_html = client
            .get(&page_url)
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await
            .map_err(|e| format!("subf2m title page failed: {e}"))?
            .text()
            .await
            .map_err(|e| e.to_string())?;

        if page_html.contains(&imdb_marker) {
            matched_path = Some(path.clone());
            break;
        }

        if matched_path.is_none() {
            let title_matches = page_html.to_ascii_lowercase().contains(&title.to_ascii_lowercase());
            let year_matches = expected_year
                .map(|value| page_html.contains(value))
                .unwrap_or(true);
            if title_matches && year_matches {
                matched_path = Some(path.clone());
            }
        }
    }

    let Some(path) = matched_path else {
        return Ok(Vec::new());
    };

    let language_url = format!("{SUBF2M_BASE_URL}{path}/english");
    let language_html = client
        .get(&language_url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("subf2m language page failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let item_pattern = Regex::new(
        r#"(?s)<li class='item[^']*'>.*?<span class='language [^']*'>English</span>.*?<span class='rate ([^']+)'></span>.*?<ul class='scrolllist'>\s*<li>(.*?)</li>.*?<div class='vertical-middle'>.*?<p>(.*?)</p>.*?<a class='download icon-download' href='([^']+/english/\d+)'"#,
    )
    .map_err(|e| e.to_string())?;

    let mut subtitles = item_pattern
        .captures_iter(&language_html)
        .filter_map(|captures| {
            let rating = captures.get(1)?.as_str().trim().to_string();
            let release = captures.get(2)?.as_str().trim().replace("&amp;", "&");
            let comment = captures.get(3)?.as_str().trim().replace("&amp;", "&");
            let detail_path = captures.get(4)?.as_str().trim();
            let download_url = format!("{SUBF2M_BASE_URL}{detail_path}/download");

            Some(ResolvedMovieSubtitle {
                url: download_url,
                label: format!("English - {release}"),
                language: "en".to_string(),
                format: "zip".to_string(),
                source: "subf2m-direct".to_string(),
                hearing_impaired: comment.to_ascii_lowercase().contains("hi"),
                release: Some(release),
                origin: Some(format!("subf2m:{rating}")),
                file_name: None,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    Ok(subtitles)
}

fn normalize_provider_subtitles(data: &serde_json::Value, fallback_source: &str) -> Vec<ResolvedMovieSubtitle> {
    let Some(streams) = data.as_array() else {
        return Vec::new();
    };

    let mut subtitles = streams
        .iter()
        .filter_map(|item| {
            let url = item
                .get("url")
                .or_else(|| item.get("file"))
                .and_then(|value| value.as_str())?
                .trim()
                .to_string();

            if !url.starts_with("http://") && !url.starts_with("https://") {
                return None;
            }

            let language = item
                .get("language")
                .or_else(|| item.get("lang"))
                .and_then(|value| value.as_str())
                .unwrap_or("en")
                .to_string();
            let label = item
                .get("label")
                .or_else(|| item.get("display"))
                .and_then(|value| value.as_str())
                .unwrap_or("English")
                .to_string();
            let format = item
                .get("format")
                .and_then(|value| value.as_str())
                .unwrap_or_else(|| {
                    if url.to_ascii_lowercase().contains(".vtt") {
                        "vtt"
                    } else {
                        "srt"
                    }
                })
                .to_string();
            let source = item
                .get("source")
                .and_then(|value| value.as_str())
                .unwrap_or(fallback_source)
                .to_string();
            let release = item
                .get("release")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let origin = item
                .get("origin")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let file_name = item
                .get("fileName")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let hearing_impaired = item
                .get("isHearingImpaired")
                .or_else(|| item.get("hearingImpaired"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false);

            Some(ResolvedMovieSubtitle {
                url,
                label,
                language,
                format,
                source,
                hearing_impaired,
                release,
                origin,
                file_name,
            })
        })
        .collect::<Vec<_>>();

    subtitles.sort_by(|a, b| {
        subtitle_preference_score(b)
            .cmp(&subtitle_preference_score(a))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });
    subtitles.dedup_by(|left, right| left.url == right.url);
    subtitles
}

fn subtitle_preference_score(subtitle: &ResolvedMovieSubtitle) -> i32 {
    let label = subtitle.label.to_ascii_lowercase();
    let url = subtitle.url.to_ascii_lowercase();
    let source = subtitle.source.to_ascii_lowercase();
    let release_hint = subtitle
        .release
        .as_deref()
        .or(subtitle.file_name.as_deref())
        .unwrap_or(&subtitle.label)
        .to_ascii_lowercase();

    let mut score = 0;

    if !subtitle.hearing_impaired {
        score += 40;
    }

    if subtitle.language.eq_ignore_ascii_case("en") || label.contains("english") {
        score += 20;
    }

    if label.contains("cc") {
        score -= 8;
    }

    if source.contains("subdl") {
        score += 10;
    } else if source.contains("gestdown") {
        score += 9;
    } else if source.contains("podnapisi") {
        score += 8;
    } else if source.contains("jimaku") {
        score += 8;
    } else if source.contains("ajatttools") {
        score += 8;
    } else if source.contains("subf2m") {
        score += 8;
    } else if source.contains("opensubtitles") {
        score += 6;
    } else if source.contains("kitsunekko") {
        score += 5;
    } else if source.contains("yify") {
        score += 4;
    } else if source.contains("animetosho") {
        score += 3;
    }

    if release_hint.contains("web") || release_hint.contains("webrip") || release_hint.contains("web-dl") || url.contains("web") {
        score += 25;
    }

    if release_hint.contains("bluray") || release_hint.contains("bdrip") || url.contains("bluray") {
        score += 8;
    }

    if release_hint.contains("hdts")
        || release_hint.contains("cam")
        || release_hint.contains("chew edition")
        || url.contains("hdts")
        || url.contains("cam")
    {
        score -= 40;
    }

    score
}

#[tauri::command]
async fn fetch_movie_subtitles(
    payload: MovieSubtitleRequest,
) -> Result<Vec<ResolvedMovieSubtitle>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .gzip(true)
        .brotli(true)
        .build()
        .map_err(|e| e.to_string())?;

    let normalized_content_type = match payload.content_type.as_str() {
        "series" => "series".to_string(),
        "animation" => "animation".to_string(),
        _ => "movie".to_string(),
    };
    let imdb_lookup_content_type = if normalized_content_type == "series" {
        "series"
    } else {
        "movie"
    };
    let imdb_id = match payload.imdb_id.clone() {
        Some(imdb_id) if !imdb_id.trim().is_empty() => imdb_id,
        _ => resolve_tmdb_external_imdb_id(&client, &payload.tmdb_id, imdb_lookup_content_type).await?,
    };
    let wyzie_sources = wyzie_sources_for_content_type(&normalized_content_type);

    let cache_key = format!(
        "{}:{}:{}:{}:{}:{}:{}",
        MOVIE_SUBTITLE_CACHE_VERSION,
        imdb_id,
        normalized_content_type,
        "subdl-first-wyzie-second",
        wyzie_sources,
        payload.season.unwrap_or(1),
        payload.episode.unwrap_or(1)
    );

    if let Some(cached) = get_cached_value(
        movie_subtitle_cache(),
        &cache_key,
        MOVIE_SUBTITLE_CACHE_TTL_SECS,
    ) {
        log_resolver_debug(&format!(
            "[fetch_movie_subtitles] cache_hit tmdbId={} imdbId={} subtitle_count={}",
            payload.tmdb_id,
            imdb_id,
            cached.len()
        ));
        return Ok(cached);
    }

    if is_subdl_fallback_enabled() {
        if let Some(subdl_api_key) = resolve_subdl_api_key() {
            let mut subdl_url =
                Url::parse(&format!("{SUBDL_API_BASE_URL}/subtitles")).map_err(|e| e.to_string())?;
            {
                let mut query = subdl_url.query_pairs_mut();
                query
                    .append_pair("api_key", &subdl_api_key)
                    .append_pair("imdb_id", &imdb_id)
                    .append_pair("type", if normalized_content_type == "series" { "tv" } else { "movie" })
                    .append_pair("languages", "EN")
                    .append_pair("subs_per_page", "30")
                    .append_pair("comment", "1")
                    .append_pair("releases", "1")
                    .append_pair("hi", "1");

                if normalized_content_type == "series" {
                    query
                        .append_pair("season_number", &payload.season.unwrap_or(1).to_string())
                        .append_pair("episode_number", &payload.episode.unwrap_or(1).to_string());
                }
            }

            log_resolver_debug(&format!(
                "[fetch_movie_subtitles] tmdbId={} contentType={} imdbId={} source=subdl-direct url={}",
                payload.tmdb_id, normalized_content_type, imdb_id, subdl_url
            ));

            match client.get(subdl_url.clone()).send().await {
                Ok(response) => {
                    let status = response.status();
                    let body = response.text().await.map_err(|e| e.to_string())?;

                    if status.is_success() {
                        let value: serde_json::Value =
                            serde_json::from_str(&body).map_err(|e| e.to_string())?;
                        let subtitles = normalize_subdl_subtitles(&value);

                        if !subtitles.is_empty() {
                            set_cached_value(movie_subtitle_cache(), cache_key.clone(), subtitles.clone());

                            log_resolver_debug(&format!(
                                "[fetch_movie_subtitles] subtitle_count={} source=subdl-direct tmdbId={} imdbId={}",
                                subtitles.len(),
                                payload.tmdb_id,
                                imdb_id
                            ));

                            return Ok(subtitles);
                        }

                        log_resolver_debug(&format!(
                            "[fetch_movie_subtitles] subtitle_count=0 source=subdl-direct tmdbId={} imdbId={}",
                            payload.tmdb_id, imdb_id
                        ));
                    } else {
                        log_resolver_debug(&format!(
                            "[fetch_movie_subtitles] subdl request failed tmdbId={} imdbId={} status={}",
                            payload.tmdb_id, imdb_id, status
                        ));
                    }
                }
                Err(error) => {
                    log_resolver_debug(&format!(
                        "[fetch_movie_subtitles] subdl request error tmdbId={} imdbId={} error={}",
                        payload.tmdb_id, imdb_id, error
                    ));
                }
            }
        }
    } else {
        log_resolver_debug(&format!(
            "[fetch_movie_subtitles] subdl disabled tmdbId={} contentType={} imdbId={}",
            payload.tmdb_id, normalized_content_type, imdb_id
        ));
    }

    if !is_wyzie_fallback_enabled() {
        log_resolver_debug(&format!(
            "[fetch_movie_subtitles] wyzie disabled tmdbId={} contentType={} imdbId={}",
            payload.tmdb_id, normalized_content_type, imdb_id
        ));
        return Ok(Vec::new());
    }

    let mut url = Url::parse(&format!("{WYZIE_SUBTITLES_BASE_URL}/search")).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("id", &imdb_id)
            .append_pair("language", "en")
            .append_pair("format", "srt")
            .append_pair("source", &wyzie_sources);

        if let Some(wyzie_api_key) = resolve_wyzie_api_key() {
            query.append_pair("key", &wyzie_api_key);
        }

        if normalized_content_type == "series" {
            query.append_pair("season", &payload.season.unwrap_or(1).to_string());
            query.append_pair("episode", &payload.episode.unwrap_or(1).to_string());
        }
    }

    log_resolver_debug(&format!(
        "[fetch_movie_subtitles] tmdbId={} contentType={} imdbId={} sources={} url={}",
        payload.tmdb_id, normalized_content_type, imdb_id, wyzie_sources, url
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

    set_cached_value(movie_subtitle_cache(), cache_key, subtitles.clone());

    log_resolver_debug(&format!(
        "[fetch_movie_subtitles] subtitle_count={} source=wyzie sources={} tmdbId={} imdbId={}",
        subtitles.len(), wyzie_sources, payload.tmdb_id, imdb_id
    ));

    Ok(subtitles)
}

#[tauri::command]
async fn fetch_movie_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(20))
        .gzip(true)
        .brotli(true)
        .build()
        .map_err(|e| e.to_string())?;
    let empty_headers = HashMap::new();
    let (body, final_url) = fetch_subtitle_text_resource(&client, &url, &empty_headers).await?;
    if !is_hls_subtitle_playlist(&body) {
        return Ok(body);
    }

    let segment_urls = extract_hls_playlist_media_urls(&body, &final_url);
    if segment_urls.is_empty() {
        return Ok(body);
    }

    let mut merged_text = String::new();
    for segment_url in segment_urls {
        let (segment_text, _) =
            fetch_subtitle_text_resource(&client, &segment_url, &empty_headers).await?;
        if segment_text.trim().is_empty() {
            continue;
        }
        merge_subtitle_segment_text(&mut merged_text, &segment_text);
    }

    if merged_text.trim().is_empty() {
        Ok(body)
    } else {
        Ok(merged_text)
    }
}

fn stop_process_on_port(port: u16) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .output();

        let Ok(output) = output else {
            return;
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let suffix = format!(":{port}");
        let current_pid = std::process::id();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if !trimmed.contains("LISTENING") || !trimmed.contains(&suffix) {
                continue;
            }

            let pid = trimmed
                .split_whitespace()
                .last()
                .and_then(|value| value.parse::<u32>().ok());

            let Some(pid) = pid else {
                continue;
            };

            if pid == current_pid {
                continue;
            }

            let _ = kill_process_tree(pid);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("sh")
            .args(["-lc", &format!("lsof -ti tcp:{port}")])
            .stdin(Stdio::null())
            .output();

        let Ok(output) = output else {
            return;
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let current_pid = std::process::id();

        for pid in stdout.lines().filter_map(|line| line.trim().parse::<u32>().ok()) {
            if pid == current_pid {
                continue;
            }

            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

#[tauri::command]
async fn fetch_movie_resolver_streams(
    payload: MovieResolverRequest,
) -> Result<Vec<ResolvedMovieStream>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(NUVIO_STREAM_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let normalized_content_type = match payload.content_type.as_str() {
        "series" => "series".to_string(),
        "animation" => "animation".to_string(),
        _ => "movie".to_string(),
    };
    let imdb_lookup_content_type = if normalized_content_type == "series" {
        "series"
    } else {
        "movie"
    };
    let force_refresh = payload.force_refresh.unwrap_or(false);
    let excluded_urls = payload.exclude_urls.clone().unwrap_or_default();
    let excluded_providers = payload.exclude_providers.clone().unwrap_or_default();
    let excluded_url_set = excluded_urls
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<std::collections::HashSet<_>>();
    let excluded_provider_set = excluded_providers
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<std::collections::HashSet<_>>();
    let use_cache = !force_refresh && excluded_url_set.is_empty() && excluded_provider_set.is_empty();

    let resolved_imdb_id = match payload.imdb_id.clone() {
        Some(imdb_id) if !imdb_id.trim().is_empty() => Ok(imdb_id),
        _ => {
            resolve_tmdb_external_imdb_id(&client, &payload.tmdb_id, imdb_lookup_content_type).await
        }
    };

    let cache_key = resolved_imdb_id.as_ref().ok().map(|imdb_id| {
        format!(
            "{}:{}:{}:{}:{}",
            MOVIE_STREAM_CACHE_VERSION,
            imdb_id,
            normalized_content_type,
            payload.season.unwrap_or(1),
            payload.episode.unwrap_or(1)
        )
    });

    if use_cache {
        if let Some(cache_key) = cache_key.as_ref() {
            if let Some(cached) = get_cached_value(
                movie_stream_cache(),
                cache_key,
                MOVIE_STREAM_CACHE_TTL_SECS,
            ) {
                log_resolver_debug(&format!(
                    "[fetch_movie_resolver_streams] cache_hit tmdbId={} imdbId={:?} stream_count={}",
                    payload.tmdb_id,
                    resolved_imdb_id,
                    cached.len()
                ));
                return Ok(cached);
            }
        }
    }

    ensure_nuvio_sidecar(&client)
        .await
        .map_err(|error| format!("Local Nuvio sidecar unavailable: {error}"))?;

    let nuvio_urls = resolved_imdb_id.as_ref().ok().map(|imdb_id| {
        build_nuvio_stream_urls(
            imdb_id,
            &normalized_content_type,
            payload.season,
            payload.episode,
        )
    });

    log_resolver_debug(&format!(
        "[fetch_movie_resolver_streams] tmdbId={} contentType={} imdbId={:?} forceRefresh={} excludedUrls={} excludedProviders={}",
        payload.tmdb_id,
        normalized_content_type,
        resolved_imdb_id,
        force_refresh,
        excluded_url_set.len(),
        excluded_provider_set.len()
    ));

    let mut validated_streams = Vec::new();
    let mut last_nuvio_error = None;
    let collect_all_stages = force_refresh || !excluded_url_set.is_empty() || !excluded_provider_set.is_empty();

    match nuvio_urls.as_ref() {
        Some(urls) => {
            for (url, strategy, timeout_secs) in urls.iter() {
                log_resolver_debug(&format!(
                    "[fetch_movie_resolver_streams] fetching Nuvio strategy={} tmdbId={} timeout={}s url={}",
                    strategy, payload.tmdb_id, timeout_secs, url
                ));

                match fetch_json_value_with_timeout(&client, url, *timeout_secs).await {
                    Ok(data) => {
                        let mut candidate_streams = normalize_nuvio_streams(&data, strategy)
                            .into_iter()
                            .filter(|stream| {
                                !excluded_url_set.contains(&stream.url.trim().to_ascii_lowercase())
                                    && !excluded_provider_set
                                        .contains(&stream.provider.trim().to_ascii_lowercase())
                            })
                            .collect::<Vec<_>>();
                        log_resolver_debug(&format!(
                            "[fetch_movie_resolver_streams] Nuvio strategy={} stream_count={} tmdbId={}",
                            strategy,
                            candidate_streams.len(),
                            payload.tmdb_id
                        ));

                        if candidate_streams.is_empty() {
                            continue;
                        }

                        candidate_streams.sort_by(|a, b| {
                            movie_stream_type_score(&b.stream_type)
                                .cmp(&movie_stream_type_score(&a.stream_type))
                                .then_with(|| {
                                    movie_audio_preference_score(b)
                                        .cmp(&movie_audio_preference_score(a))
                                })
                                .then_with(|| {
                                    movie_variant_preference_score(b, &normalized_content_type)
                                        .cmp(&movie_variant_preference_score(a, &normalized_content_type))
                                })
                                .then_with(|| {
                                    movie_host_preference_score(
                                        &b.provider,
                                        &b.url,
                                        &normalized_content_type,
                                    )
                                    .cmp(&movie_host_preference_score(
                                        &a.provider,
                                        &a.url,
                                        &normalized_content_type,
                                    ))
                                })
                                .then_with(|| {
                                    movie_provider_preference_score(&b.provider, &normalized_content_type)
                                        .cmp(&movie_provider_preference_score(&a.provider, &normalized_content_type))
                                })
                                .then_with(|| {
                                    movie_quality_score(&b.quality).cmp(&movie_quality_score(&a.quality))
                                })
                                .then_with(|| a.provider.cmp(&b.provider))
                                .then_with(|| a.url.cmp(&b.url))
                        });
                        candidate_streams.dedup_by(|left, right| left.url == right.url);

                        let mut stage_validated_streams = Vec::new();
                        for stream in candidate_streams {
                            let probe_result = probe_movie_stream_inner(
                                stream.url.clone(),
                                stream.headers.clone(),
                                Some(stream.stream_type.clone()),
                            )
                            .await;

                            if probe_result.ok {
                                let validated_stream = ResolvedMovieStream {
                                    url: probe_result.final_url.unwrap_or_else(|| stream.url.clone()),
                                    content_type: probe_result.content_type.clone(),
                                    ..stream
                                };
                                let discovered_subtitles =
                                    discover_provider_hls_subtitles(&client, &validated_stream).await;
                                let validated_stream = if !discovered_subtitles.is_empty() {
                                    ResolvedMovieStream {
                                        subtitles: discovered_subtitles,
                                        ..validated_stream
                                    }
                                } else {
                                    validated_stream
                                };
                                log_resolver_debug(&format!(
                                    "[fetch_movie_resolver_streams] accepted stream provider={} strategy={} source={} streamType={} quality={} subtitleCount={} url={}",
                                    validated_stream.provider,
                                    validated_stream.strategy,
                                    validated_stream.source,
                                    validated_stream.stream_type,
                                    validated_stream.quality,
                                    validated_stream.subtitles.len(),
                                    validated_stream.url
                                ));
                                stage_validated_streams.push(validated_stream);
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

                        if !stage_validated_streams.is_empty() {
                            let mut provider_summary = stage_validated_streams
                                .iter()
                                .map(|stream| stream.provider.clone())
                                .collect::<Vec<_>>();
                            provider_summary.sort();
                            provider_summary.dedup();
                            log_resolver_debug(&format!(
                                "[fetch_movie_resolver_streams] strategy={} validated_count={} tmdbId={} providers={:?}",
                                strategy,
                                stage_validated_streams.len(),
                                payload.tmdb_id,
                                provider_summary
                            ));
                            validated_streams.extend(stage_validated_streams);
                            if !collect_all_stages {
                                break;
                            }
                            continue;
                        }

                        log_resolver_debug(&format!(
                            "[fetch_movie_resolver_streams] strategy={} produced no validated streams tmdbId={}, continuing fallback",
                            strategy,
                            payload.tmdb_id
                        ));
                    }
                    Err(error) => {
                        log_resolver_debug(&format!(
                            "[fetch_movie_resolver_streams] Nuvio failed strategy={} tmdbId={} error={}",
                            strategy, payload.tmdb_id, error
                        ));
                        last_nuvio_error = Some(error);
                    }
                }
            }
        }
        None => {
            last_nuvio_error = Some(
                resolved_imdb_id
                    .as_ref()
                    .err()
                    .cloned()
                    .unwrap_or_else(|| "No IMDb ID available for Nuvio".to_string()),
            );
        }
    }

    validated_streams.sort_by(|a, b| {
        movie_stream_type_score(&b.stream_type)
            .cmp(&movie_stream_type_score(&a.stream_type))
            .then_with(|| movie_audio_preference_score(b).cmp(&movie_audio_preference_score(a)))
            .then_with(|| {
                movie_variant_preference_score(b, &normalized_content_type)
                    .cmp(&movie_variant_preference_score(a, &normalized_content_type))
            })
            .then_with(|| {
                movie_host_preference_score(&b.provider, &b.url, &normalized_content_type).cmp(
                    &movie_host_preference_score(&a.provider, &a.url, &normalized_content_type),
                )
            })
            .then_with(|| {
                movie_provider_preference_score(&b.provider, &normalized_content_type)
                    .cmp(&movie_provider_preference_score(&a.provider, &normalized_content_type))
            })
            .then_with(|| movie_quality_score(&b.quality).cmp(&movie_quality_score(&a.quality)))
            .then_with(|| a.provider.cmp(&b.provider))
            .then_with(|| a.url.cmp(&b.url))
    });
    validated_streams.dedup_by(|left, right| left.url == right.url);

    if validated_streams.is_empty() {
        if let Some(error) = last_nuvio_error {
            log_resolver_debug(&format!(
                "[fetch_movie_resolver_streams] final Nuvio error tmdbId={} error={}",
                payload.tmdb_id, error
            ));
        }
        return Err(format!(
            "No validated playable streams available for this {}",
            if normalized_content_type == "series" { "episode" } else { "movie" }
        ));
    }

    if validated_streams.is_empty() {
        return Err(format!(
            "No validated playable streams available for this {}",
            if normalized_content_type == "series" { "episode" } else { "movie" }
        ));
    }

    log_resolver_debug(&format!(
        "[fetch_movie_resolver_streams] validated_count={} tmdbId={} top_provider={}",
        validated_streams.len(),
        payload.tmdb_id,
        validated_streams
            .first()
            .map(|stream| stream.provider.as_str())
            .unwrap_or("unknown")
    ));

    if use_cache {
        if let Some(cache_key) = cache_key {
            set_cached_value(movie_stream_cache(), cache_key, validated_streams.clone());
        }
    }

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
    let tracks = url
        .query_pairs()
        .find(|(key, _)| key == "tracks")
        .map(|(_, value)| value.into_owned())
        .and_then(|value| serde_json::from_str::<Vec<Value>>(&value).ok())
        .unwrap_or_default();

    Some(CapturedNavigation {
        url: captured_url,
        page_url,
        kind: if kind == "frame" {
            CaptureKind::Frame
        } else {
            CaptureKind::Stream
        },
        tracks,
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
        subtitles: captured.tracks,
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
                    subtitles: Vec::new(),
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
                    subtitles: Vec::new(),
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

fn updater_runtime_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("AppData").join("Local")))
        .ok_or_else(|| "failed to resolve LocalAppData directory".to_string())?;

    let dir = base_dir.join("NOVA STREAM").join("updater");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create updater directory: {e}"))?;
    Ok(dir)
}

fn nuvio_sidecar_log_path() -> PathBuf {
    env::temp_dir().join("nova-stream-nuvio-sidecar.log")
}

fn open_nuvio_sidecar_log_file() -> Result<fs::File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(nuvio_sidecar_log_path())
        .map_err(|e| format!("failed to open Nuvio sidecar log file: {e}"))
}

fn configure_background_process(command: &mut Command) -> Result<(), String> {
    command.stdin(Stdio::null());

    let stdout = open_nuvio_sidecar_log_file()?;
    let stderr = stdout
        .try_clone()
        .map_err(|e| format!("failed to clone Nuvio sidecar log file handle: {e}"))?;
    command.stdout(Stdio::from(stdout));
    command.stderr(Stdio::from(stderr));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(())
}

fn configure_hidden_process(command: &mut Command) {
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn normalize_video_download_content_type(content_type: &str) -> String {
    match content_type.trim().to_ascii_lowercase().as_str() {
        "series" => "tv".to_string(),
        "tv" | "movie" | "anime" | "animation" => content_type.trim().to_ascii_lowercase(),
        _ => "movie".to_string(),
    }
}

fn runtime_status_label(status: RuntimeDownloadStatus) -> &'static str {
    match status {
        RuntimeDownloadStatus::Queued => "queued",
        RuntimeDownloadStatus::Downloading => "downloading",
        RuntimeDownloadStatus::Paused => "paused",
        RuntimeDownloadStatus::Cancelled => "cancelled",
        RuntimeDownloadStatus::Completed => "completed",
        RuntimeDownloadStatus::Failed => "failed",
    }
}

fn clamp_download_progress(progress: f64) -> u8 {
    progress.round().clamp(0.0, 100.0) as u8
}

fn emit_video_download_status(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream_type: Option<&str>,
    resume_supported: Option<bool>,
    status: RuntimeDownloadStatus,
    error_message: Option<String>,
) {
    let _ = app.emit(
        "video-download-status",
        VideoDownloadStatusEvent {
            id: request.id.clone(),
            content_id: request.content_id.clone(),
            content_type: normalize_video_download_content_type(&request.content_type),
            season: request.season,
            episode: request.episode,
            stream_type: stream_type.map(|value| value.to_string()),
            resume_supported,
            status: runtime_status_label(status).to_string(),
            error_message,
        },
    );
}

fn emit_video_download_progress(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream_type: &str,
    resolved_quality: Option<&str>,
    resume_supported: bool,
    progress: u8,
    bytes_downloaded: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_sec: u64,
) {
    let _ = app.emit(
        "video-download-progress",
        VideoDownloadProgressEvent {
            id: request.id.clone(),
            content_id: request.content_id.clone(),
            content_type: normalize_video_download_content_type(&request.content_type),
            season: request.season,
            episode: request.episode,
            stream_type: Some(stream_type.to_string()),
            resolved_quality: resolved_quality.map(|value| value.to_string()),
            resume_supported: Some(resume_supported),
            status: "downloading".to_string(),
            progress,
            bytes_downloaded,
            total_bytes,
            speed_bytes_per_sec,
        },
    );
}

fn emit_video_download_completed(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream_type: &str,
    resolved_quality: Option<&str>,
    resume_supported: bool,
    file_path: &StdPath,
    subtitle_file_path: Option<&StdPath>,
    bytes_downloaded: u64,
    total_bytes: u64,
) {
    let _ = app.emit(
        "video-download-completed",
        VideoDownloadCompletedEvent {
            id: request.id.clone(),
            content_id: request.content_id.clone(),
            content_type: normalize_video_download_content_type(&request.content_type),
            season: request.season,
            episode: request.episode,
            stream_type: Some(stream_type.to_string()),
            resolved_quality: resolved_quality.map(|value| value.to_string()),
            resume_supported: Some(resume_supported),
            bytes_downloaded,
            total_bytes,
            file_path: file_path.to_string_lossy().to_string(),
            subtitle_file_path: subtitle_file_path.map(|value| value.to_string_lossy().to_string()),
        },
    );
}

fn emit_video_download_failed(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream_type: Option<&str>,
    resume_supported: Option<bool>,
    error_message: String,
) {
    let _ = app.emit(
        "video-download-failed",
        VideoDownloadStatusEvent {
            id: request.id.clone(),
            content_id: request.content_id.clone(),
            content_type: normalize_video_download_content_type(&request.content_type),
            season: request.season,
            episode: request.episode,
            stream_type: stream_type.map(|value| value.to_string()),
            resume_supported,
            status: "failed".to_string(),
            error_message: Some(error_message),
        },
    );
}

fn sanitize_filename_segment(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else if character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();

    sanitized = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = sanitized.trim_matches(['.', ' ']).trim();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

fn downloads_root_dir() -> Result<PathBuf, String> {
    let dir = resolved_downloads_root_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create downloads directory: {e}"))?;
    Ok(dir)
}

fn nova_stream_local_data_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_local_dir().ok_or_else(|| "unable to resolve local data directory".to_string())?;
    let dir = base_dir.join("NOVA STREAM");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data directory: {e}"))?;
    Ok(dir)
}

fn default_downloads_root_dir() -> Result<PathBuf, String> {
    Ok(nova_stream_local_data_dir()?.join(DOWNLOADS_ROOT_DIR_NAME))
}

fn download_settings_path() -> Result<PathBuf, String> {
    Ok(nova_stream_local_data_dir()?.join(DOWNLOAD_SETTINGS_FILE_NAME))
}

fn load_download_settings() -> Result<DownloadSettings, String> {
    let path = download_settings_path()?;
    if !path.exists() {
        return Ok(DownloadSettings::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read download settings: {e}"))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse download settings: {e}"))
}

fn save_download_settings(settings: &DownloadSettings) -> Result<(), String> {
    let path = download_settings_path()?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed to serialize download settings: {e}"))?;
    fs::write(&path, contents).map_err(|e| format!("failed to save download settings: {e}"))
}

fn resolved_downloads_root_dir() -> Result<PathBuf, String> {
    let settings = load_download_settings()?;
    let root = settings
        .custom_root
        .as_ref()
        .map(|value| PathBuf::from(value.trim()))
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(default_downloads_root_dir()?);
    Ok(root)
}

fn build_download_location_info() -> Result<DownloadLocationInfo, String> {
    let default_path = default_downloads_root_dir()?;
    let current_path = resolved_downloads_root_dir()?;

    Ok(DownloadLocationInfo {
        current_path: current_path.display().to_string(),
        default_path: default_path.display().to_string(),
        is_custom: current_path != default_path,
    })
}

fn unique_destination_path(path: &StdPath) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| StdPath::new("."));
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1.. {
        let candidate_name = match extension {
            Some(ext) if !ext.is_empty() => format!("{stem} ({index}).{ext}"),
            _ => format!("{stem} ({index})"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path.to_path_buf()
}

fn move_or_copy_path(source: &StdPath, destination: &StdPath) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    if destination.exists() {
        if source.is_dir() && destination.is_dir() {
            for entry in fs::read_dir(source).map_err(|e| format!("failed to read directory: {e}"))? {
                let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
                let child_source = entry.path();
                let child_destination = destination.join(entry.file_name());
                move_or_copy_path(&child_source, &child_destination)?;
            }
            let _ = fs::remove_dir(source);
            return Ok(());
        }

        let next_destination = unique_destination_path(destination);
        return move_or_copy_path(source, &next_destination);
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create destination directory: {e}"))?;
    }

    match fs::rename(source, destination) {
        Ok(_) => Ok(()),
        Err(_) if source.is_file() => {
            fs::copy(source, destination).map_err(|e| format!("failed to copy file: {e}"))?;
            fs::remove_file(source).map_err(|e| format!("failed to remove source file: {e}"))?;
            Ok(())
        }
        Err(_) => {
            fs::create_dir_all(destination).map_err(|e| format!("failed to create destination directory: {e}"))?;
            for entry in fs::read_dir(source).map_err(|e| format!("failed to read directory: {e}"))? {
                let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
                let child_source = entry.path();
                let child_destination = destination.join(entry.file_name());
                move_or_copy_path(&child_source, &child_destination)?;
            }
            fs::remove_dir_all(source).map_err(|e| format!("failed to remove source directory: {e}"))?;
            Ok(())
        }
    }
}

fn replace_file_path(source: &StdPath, destination: &StdPath) -> Result<(), String> {
    if destination.exists() {
        if destination.is_dir() {
            fs::remove_dir_all(destination)
                .map_err(|e| format!("failed to remove destination directory: {e}"))?;
        } else {
            fs::remove_file(destination)
                .map_err(|e| format!("failed to remove destination file: {e}"))?;
        }
    }

    move_or_copy_path(source, destination)
}

fn move_download_root_contents(source_root: &StdPath, target_root: &StdPath) -> Result<(), String> {
    if source_root == target_root || !source_root.exists() {
        return Ok(());
    }

    fs::create_dir_all(target_root).map_err(|e| format!("failed to create target download directory: {e}"))?;
    for entry in fs::read_dir(source_root).map_err(|e| format!("failed to read source download directory: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read source entry: {e}"))?;
        let source_path = entry.path();
        let destination_path = target_root.join(entry.file_name());
        move_or_copy_path(&source_path, &destination_path)?;
    }
    let _ = fs::remove_dir(source_root);
    Ok(())
}

fn build_download_output_path(request: &VideoDownloadRequest) -> Result<PathBuf, String> {
    let root_dir = downloads_root_dir()?;
    let normalized_type = normalize_video_download_content_type(&request.content_type);
    let safe_title = sanitize_filename_segment(&request.title);

    let path = match normalized_type.as_str() {
        "tv" => {
            let series_dir = root_dir.join("series").join(format!("{}_{}", request.content_id, safe_title));
            fs::create_dir_all(&series_dir)
                .map_err(|e| format!("failed to create series download directory: {e}"))?;
            let season = request.season.unwrap_or(1);
            let episode = request.episode.unwrap_or(1);
            let episode_suffix = request
                .episode_title
                .as_ref()
                .map(|value| format!("_{}", sanitize_filename_segment(value)))
                .unwrap_or_default();
            series_dir.join(format!("S{season:02}E{episode:02}{episode_suffix}.mp4"))
        }
        "anime" => {
            let anime_dir = root_dir.join("anime").join(format!("{}_{}", request.content_id, safe_title));
            fs::create_dir_all(&anime_dir)
                .map_err(|e| format!("failed to create anime download directory: {e}"))?;
            let season = request.season.unwrap_or(1);
            let episode = request.episode.unwrap_or(1);
            anime_dir.join(format!("S{season:02}E{episode:02}.mp4"))
        }
        "animation" => {
            let animation_dir = root_dir.join("animation");
            fs::create_dir_all(&animation_dir)
                .map_err(|e| format!("failed to create animation download directory: {e}"))?;
            animation_dir.join(format!("{}_{}.mp4", request.content_id, safe_title))
        }
        _ => {
            let movie_dir = root_dir.join("movies");
            fs::create_dir_all(&movie_dir)
                .map_err(|e| format!("failed to create movie download directory: {e}"))?;
            movie_dir.join(format!("{}_{}.mp4", request.content_id, safe_title))
        }
    };

    Ok(path)
}

fn download_artifact_paths(request: &VideoDownloadRequest) -> Vec<PathBuf> {
    let Ok(final_path) = build_download_output_path(request) else {
        return Vec::new();
    };

    vec![
        final_path.clone(),
        final_path.with_extension("ts"),
        final_path.with_extension("mkv"),
        final_path.with_extension("mux.mp4"),
        final_path.with_extension("part"),
        final_path.with_extension("part.mp4"),
        build_hls_temp_dir(&final_path),
    ]
}

fn is_download_primary_media_path(path: &StdPath) -> bool {
    if path.is_dir() {
        return false;
    }

    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("mp4" | "mkv" | "m4v" | "mov" | "ts" | "m2ts" | "webm")
    )
}

fn subtitle_sidecar_paths_for_video(path: &StdPath) -> Vec<PathBuf> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let Some(base_name) = path.file_stem().and_then(|value| value.to_str()) else {
        return Vec::new();
    };

    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|candidate| candidate.is_file())
        .filter(|candidate| {
            matches!(
                candidate
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_ascii_lowercase())
                    .as_deref(),
                Some("srt" | "vtt" | "ass" | "ssa")
            )
        })
        .filter(|candidate| {
            candidate
                .file_stem()
                .and_then(|value| value.to_str())
                .map(|stem| stem == base_name || stem.starts_with(&format!("{base_name}.")))
                .unwrap_or(false)
        })
        .collect()
}

fn sibling_download_artifact_paths(path: &StdPath) -> Vec<PathBuf> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let Some(base_name) = path.file_stem().and_then(|value| value.to_str()) else {
        return Vec::new();
    };

    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|candidate| candidate != path)
        .filter(|candidate| {
            let candidate_name = candidate
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let base_name_lower = base_name.to_ascii_lowercase();

            if !candidate_name.starts_with(&base_name_lower) {
                return false;
            }

            if candidate.is_dir() {
                return true;
            }

            let extension = candidate
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase());
            let stem = candidate
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();

            if stem == base_name_lower || stem.starts_with(&format!("{base_name_lower}.")) {
                return true;
            }

            matches!(
                extension.as_deref(),
                Some(
                    "mp4" | "mkv" | "ts" | "m4s" | "srt" | "vtt" | "ass" | "ssa" | "copy" | "eng" | "ita"
                        | "jpn" | "spa" | "fre" | "ger" | "dan" | "fin" | "hun" | "kor" | "por" | "ukr"
                )
            )
        })
        .collect()
}

fn discover_downloaded_subtitle_path(video_path: &StdPath) -> Option<PathBuf> {
    let mut sidecars = subtitle_sidecar_paths_for_video(video_path)
        .into_iter()
        .filter(|path| {
            if path.is_dir() {
                return false;
            }

            matches!(
                path.extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_ascii_lowercase())
                    .as_deref(),
                Some("srt" | "vtt" | "ass" | "ssa" | "sub")
            )
        })
        .collect::<Vec<_>>();
    let has_explicit_language_variants = sidecars.iter().any(|path| {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        name.contains(".eng.")
            || name.contains(".en.")
            || name.contains(".ita.")
            || name.contains(".spa.")
            || name.contains(".fre.")
            || name.contains(".ger.")
            || name.contains(".jpn.")
            || name.contains(".kor.")
            || name.contains(".ara.")
            || name.contains(".hin.")
            || name.contains(".hun.")
            || name.contains(".dan.")
            || name.contains(".fin.")
            || name.contains(".nob.")
            || name.contains(".may.")
    });
    sidecars.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let right_name = right
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let score = |name: &str| -> i32 {
            if (name.contains(".eng.") || name.contains(".en.") || name.contains("english"))
                && name.ends_with(".srt")
            {
                7
            } else if (name.contains(".eng.") || name.contains(".en.") || name.contains("english"))
                && name.ends_with(".vtt")
            {
                6
            } else if name.contains(".eng.") || name.contains(".en.") || name.contains("english") {
                5
            } else if has_explicit_language_variants && (name.ends_with(".srt") || name.ends_with(".vtt")) {
                0
            } else if name.ends_with(".srt") {
                2
            } else {
                1
            }
        };

        score(&right_name)
            .cmp(&score(&left_name))
            .then_with(|| left_name.cmp(&right_name))
    });
    sidecars.into_iter().next()
}

fn is_text_subtitle_path(path: &StdPath) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("srt" | "vtt" | "ass" | "ssa" | "sub")
    )
}

fn build_downloaded_subtitle_path(
    video_path: &StdPath,
    subtitle_url: &str,
    preferred_format: Option<&str>,
) -> PathBuf {
    let extension = preferred_format
        .map(|value| value.trim().to_ascii_lowercase())
        .and_then(|value| match value.as_str() {
            "srt" => Some("srt"),
            "vtt" => Some("vtt"),
            "ass" => Some("ass"),
            "ssa" => Some("ssa"),
            "sub" => Some("sub"),
            _ => None,
        })
        .unwrap_or_else(|| guess_subtitle_format_from_url(subtitle_url));
    let parent = video_path.parent().unwrap_or_else(|| StdPath::new("."));
    let stem = video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");

    parent.join(format!("{stem}.eng.{extension}"))
}

fn build_download_subtitle_request(request: &VideoDownloadRequest) -> Option<MovieSubtitleRequest> {
    let tmdb_id = request.content_id.trim();
    if tmdb_id.is_empty() {
        return None;
    }

    let normalized_content_type = normalize_video_download_content_type(&request.content_type);
    if normalized_content_type == "anime" {
        return None;
    }

    let content_type = match normalized_content_type.as_str() {
        "tv" => "series".to_string(),
        "animation" => "animation".to_string(),
        _ => "movie".to_string(),
    };

    Some(MovieSubtitleRequest {
        tmdb_id: tmdb_id.to_string(),
        imdb_id: request.imdb_id.clone(),
        content_type,
        season: request.season,
        episode: request.episode,
    })
}

fn subtitle_is_english_or_unknown(subtitle: &ResolvedMovieSubtitle) -> bool {
    let language = subtitle.language.trim().to_ascii_lowercase();
    let label = subtitle.label.to_ascii_lowercase();

    matches!(language.as_str(), "" | "en" | "eng" | "unknown")
        || label.contains("english")
        || label.contains("[en]")
}

fn subtitle_matches_stream_provider(
    subtitle: &ResolvedMovieSubtitle,
    stream_provider: &str,
) -> bool {
    let normalized_provider = stream_provider.trim().to_ascii_lowercase();
    if normalized_provider.is_empty() {
        return false;
    }

    let normalized_source = subtitle.source.trim().to_ascii_lowercase();
    let normalized_label = subtitle.label.trim().to_ascii_lowercase();

    (!normalized_source.is_empty()
        && (normalized_source.contains(&normalized_provider)
            || normalized_provider.contains(&normalized_source)))
        || (!normalized_label.is_empty()
            && (normalized_label.contains(&normalized_provider)
                || normalized_provider.contains(&normalized_label)))
}

fn select_preferred_stream_download_subtitle(
    subtitles: &[ResolvedMovieSubtitle],
    stream_provider: &str,
) -> Option<ResolvedMovieSubtitle> {
    let mut candidates = subtitles.to_vec();
    if candidates.is_empty() {
        return None;
    }

    if candidates.iter().any(subtitle_is_english_or_unknown) {
        candidates.retain(subtitle_is_english_or_unknown);
    }

    candidates.sort_by(|a, b| {
        subtitle_matches_stream_provider(b, stream_provider)
            .cmp(&subtitle_matches_stream_provider(a, stream_provider))
            .then_with(|| subtitle_preference_score(b).cmp(&subtitle_preference_score(a)))
            .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.url.cmp(&b.url))
    });

    candidates.into_iter().next()
}

fn extract_hls_playlist_media_urls(manifest_text: &str, manifest_url: &Url) -> Vec<String> {
    manifest_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| manifest_url.join(line).ok().map(|url| url.to_string()))
        .collect()
}

fn is_hls_subtitle_playlist(body: &str) -> bool {
    let trimmed = body.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with("#EXTM3U") && trimmed.contains("#EXTINF")
}

fn extract_subtitle_text_from_zip(bytes: &[u8]) -> Result<String, String> {
    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| format!("Subtitle zip open failed: {e}"))?;
    let mut best_match: Option<(usize, String, String)> = None;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Subtitle zip entry failed: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        let name = entry.name().to_ascii_lowercase();
        let rank = if name.ends_with(".srt") {
            0
        } else if name.ends_with(".vtt") {
            1
        } else if name.ends_with(".ass") {
            2
        } else if name.ends_with(".ssa") {
            3
        } else if name.ends_with(".sub") {
            4
        } else {
            continue;
        };

        let mut buffer = Vec::new();
        entry.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&buffer).into_owned();

        match &best_match {
            Some((best_rank, best_name, _)) if rank > *best_rank => {}
            Some((best_rank, best_name, _)) if rank == *best_rank && name >= *best_name => {}
            _ => best_match = Some((rank, name, text)),
        }
    }

    best_match
        .map(|(_, _, text)| text)
        .ok_or_else(|| "No supported subtitle file found in archive".to_string())
}

fn merge_subtitle_segment_text(existing: &mut String, segment_text: &str) {
    let normalized = segment_text.trim_start_matches('\u{feff}');
    if existing.is_empty() {
        existing.push_str(normalized.trim());
        return;
    }

    let mut lines = normalized.lines();
    if let Some(first_line) = lines.next() {
        if !first_line.trim().eq_ignore_ascii_case("WEBVTT") && !first_line.trim().is_empty() {
            existing.push('\n');
            existing.push_str(first_line);
        }
    }

    for line in lines {
        if line.trim().is_empty() && existing.ends_with("\n\n") {
            continue;
        }
        existing.push('\n');
        existing.push_str(line);
    }
}

async fn fetch_subtitle_text_resource(
    client: &reqwest::Client,
    subtitle_url: &str,
    headers: &HashMap<String, String>,
) -> Result<(String, Url), String> {
    let resolved_url = if let Some(file_id) = parse_opensubtitles_file_id(subtitle_url) {
        resolve_opensubtitles_download_link(client, file_id).await?
    } else {
        subtitle_url.to_string()
    };

    let mut http_request = client.get(&resolved_url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    for (key, value) in headers {
        http_request = http_request.header(key, value);
    }

    let response = http_request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Movie subtitle text fetch failed: HTTP {}", status));
    }

    let is_zip = resolved_url.to_ascii_lowercase().ends_with(".zip")
        || content_type.contains("application/zip")
        || content_type.contains("application/octet-stream") && bytes.starts_with(b"PK");
    if is_zip {
        return Ok((extract_subtitle_text_from_zip(&bytes)?, final_url));
    }

    let is_gzip = content_type.contains("application/gzip")
        || content_type.contains("application/x-gzip")
        || bytes.starts_with(&[0x1f, 0x8b]);
    if is_gzip {
        let mut decoder = GzDecoder::new(bytes.as_ref());
        let mut decoded = String::new();
        decoder
            .read_to_string(&mut decoded)
            .map_err(|e| format!("Subtitle gzip decode failed: {e}"))?;
        return Ok((decoded, final_url));
    }

    Ok((String::from_utf8_lossy(&bytes).into_owned(), final_url))
}

async fn download_subtitle_sidecar_bytes(
    client: &reqwest::Client,
    subtitle_url: &str,
    headers: &HashMap<String, String>,
) -> Option<Vec<u8>> {
    let (body, final_url) = fetch_subtitle_text_resource(client, subtitle_url, headers).await.ok()?;
    if body.trim().is_empty() {
        return None;
    }

    if !is_hls_subtitle_playlist(&body) {
        return Some(body.into_bytes());
    }

    let segment_urls = extract_hls_playlist_media_urls(&body, &final_url);
    if segment_urls.is_empty() {
        return Some(body.into_bytes());
    }

    let mut merged_text = String::new();
    for segment_url in segment_urls {
        let (segment_text, _) = fetch_subtitle_text_resource(client, &segment_url, headers).await.ok()?;
        if segment_text.trim().is_empty() {
            continue;
        }

        merge_subtitle_segment_text(&mut merged_text, &segment_text);
    }

    if merged_text.trim().is_empty() {
        Some(body.into_bytes())
    } else {
        Some(merged_text.into_bytes())
    }
}

async fn maybe_download_subtitle_sidecar(
    request: &VideoDownloadRequest,
    stream: &ResolvedMovieStream,
    video_path: &StdPath,
) {
    let normalized_content_type = normalize_video_download_content_type(&request.content_type);
    let explicit_subtitle_url = request
        .subtitle_url
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let explicit_subtitle = explicit_subtitle_url.map(|url| ResolvedMovieSubtitle {
        format: guess_subtitle_format_from_url(&url).to_string(),
        hearing_impaired: false,
        label: "Download request".to_string(),
        language: "en".to_string(),
        origin: None,
        release: None,
        file_name: None,
        source: "download-request".to_string(),
        url,
    });
    let provider_subtitle = || {
        select_preferred_stream_download_subtitle(&stream.subtitles, &stream.provider).and_then(|subtitle| {
            if subtitle.url.trim().is_empty() {
                None
            } else {
                Some(subtitle)
            }
        })
    };
    let mut subtitle_candidates = Vec::new();

    if let Some(explicit_subtitle) = explicit_subtitle {
        subtitle_candidates.push(explicit_subtitle);
    }

    let provider_preferred_first =
        normalized_content_type != "anime" && stream.stream_type.eq_ignore_ascii_case("hls");
    let provider_candidate = provider_subtitle();

    if provider_preferred_first {
        if let Some(provider_subtitle) = provider_candidate.clone() {
            subtitle_candidates.push(provider_subtitle);
        }
    }

    if normalized_content_type != "anime" {
        if let Some(payload) = build_download_subtitle_request(request) {
            if let Ok(external_subtitles) = fetch_movie_subtitles(payload).await {
                let mut sorted_external = external_subtitles
                    .into_iter()
                    .filter(|subtitle| !subtitle.url.trim().is_empty())
                    .collect::<Vec<_>>();
                sorted_external.sort_by(|a, b| {
                    subtitle_preference_score(b)
                        .cmp(&subtitle_preference_score(a))
                        .then_with(|| a.hearing_impaired.cmp(&b.hearing_impaired))
                        .then_with(|| a.label.cmp(&b.label))
                        .then_with(|| a.url.cmp(&b.url))
                });
                subtitle_candidates.extend(sorted_external);
            }
        }
    }

    if !provider_preferred_first {
        if let Some(provider_subtitle) = provider_candidate {
            subtitle_candidates.push(provider_subtitle);
        }
    }

    subtitle_candidates.retain(|subtitle| !subtitle.url.trim().is_empty());
    subtitle_candidates.dedup_by(|left, right| left.url == right.url);

    if subtitle_candidates.is_empty() {
        return;
    }

    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };

    for selected_subtitle in subtitle_candidates {
        let subtitle_url = selected_subtitle.url.trim().to_string();
        if subtitle_url.is_empty() {
            continue;
        }

        let target_path = build_downloaded_subtitle_path(
            video_path,
            &subtitle_url,
            Some(&selected_subtitle.format),
        );

        let subtitle_headers = if selected_subtitle.source == "download-request"
            || selected_subtitle.source.eq_ignore_ascii_case(&stream.provider)
        {
            stream.headers.clone()
        } else {
            HashMap::new()
        };

        let bytes =
            match download_subtitle_sidecar_bytes(&client, &subtitle_url, &subtitle_headers).await {
                Some(bytes) if !bytes.is_empty() => bytes,
                _ => continue,
            };

        for existing_path in subtitle_sidecar_paths_for_video(video_path)
            .into_iter()
            .filter(|path| path != &target_path && is_text_subtitle_path(path))
        {
            let _ = tokio::fs::remove_file(existing_path).await;
        }

        let _ = tokio::fs::write(&target_path, &bytes).await;
        return;
    }
}

#[tauri::command]
fn find_local_subtitle_sidecar(file_path: String) -> Result<Option<String>, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(discover_downloaded_subtitle_path(StdPath::new(trimmed))
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn read_local_text_file(file_path: String) -> Result<String, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("file path is required".to_string());
    }

    let bytes = fs::read(trimmed).map_err(|e| format!("failed to read local text file: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn get_local_file_metadata(file_path: String) -> Result<serde_json::Value, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("file path is required".to_string());
    }

    let metadata = match fs::metadata(trimmed) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::json!({
                "exists": false,
                "isFile": false,
                "sizeBytes": 0u64,
            }));
        }
        Err(error) => {
            return Err(format!("failed to read local file metadata: {error}"));
        }
    };

    Ok(serde_json::json!({
        "exists": true,
        "isFile": metadata.is_file(),
        "sizeBytes": if metadata.is_file() { metadata.len() } else { 0u64 },
    }))
}

fn remove_download_artifacts(request: &VideoDownloadRequest, known_file_path: Option<&PathBuf>) {
    let mut paths = download_artifact_paths(request);
    if let Some(path) = known_file_path {
        paths.push(path.clone());
    }

    let subtitle_paths = paths
        .iter()
        .filter(|path| is_download_primary_media_path(path))
        .flat_map(|path| subtitle_sidecar_paths_for_video(path))
        .collect::<Vec<_>>();
    paths.extend(subtitle_paths);
    let sibling_paths = paths
        .iter()
        .filter(|path| is_download_primary_media_path(path))
        .flat_map(|path| sibling_download_artifact_paths(path))
        .collect::<Vec<_>>();
    paths.extend(sibling_paths);

    for path in paths {
        if path.exists() {
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
            remove_empty_parent_dirs(&path);
        }
    }
}

fn remove_download_artifacts_from_path(path: &PathBuf) {
    let mut candidates = vec![
        path.clone(),
        path.with_extension("part"),
        path.with_extension("part.mp4"),
        build_hls_temp_dir(path),
    ];

    if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
        if stem.ends_with(".part") {
            let restored = path.with_file_name(format!(
                "{}.mp4",
                stem.trim_end_matches(".part")
            ));
            candidates.push(restored);
        }
    }

    let subtitle_candidates = candidates
        .iter()
        .filter(|candidate| is_download_primary_media_path(candidate))
        .flat_map(|candidate| subtitle_sidecar_paths_for_video(candidate))
        .collect::<Vec<_>>();
    candidates.extend(subtitle_candidates);
    let sibling_candidates = candidates
        .iter()
        .filter(|candidate| is_download_primary_media_path(candidate))
        .flat_map(|candidate| sibling_download_artifact_paths(candidate))
        .collect::<Vec<_>>();
    candidates.extend(sibling_candidates);

    for candidate in candidates {
        if candidate.exists() {
            if candidate.is_dir() {
                let _ = fs::remove_dir_all(&candidate);
            } else {
                let _ = fs::remove_file(&candidate);
            }
            remove_empty_parent_dirs(&candidate);
        }
    }
}

fn remove_empty_parent_dirs(path: &StdPath) {
    let mut current = path.parent();
    let Some(root) = downloads_root_dir().ok() else {
        return;
    };

    while let Some(directory) = current {
        if directory == root {
            break;
        }
        match fs::remove_dir(directory) {
            Ok(_) => current = directory.parent(),
            Err(_) => break,
        }
    }
}

fn recursive_dir_size(path: &StdPath) -> u64 {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return 0,
    };

    if metadata.is_file() {
        return metadata.len();
    }

    let mut total = 0;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        total += recursive_dir_size(&entry.path());
    }

    total
}

fn compute_downloads_storage_info() -> Result<DownloadsStorageInfo, String> {
    let root = downloads_root_dir()?;
    let mut breakdown = HashMap::new();
    let movies = recursive_dir_size(&root.join("movies"));
    let series = recursive_dir_size(&root.join("series"));
    let anime = recursive_dir_size(&root.join("anime"));
    let animation = recursive_dir_size(&root.join("animation"));
    breakdown.insert("movies".to_string(), movies);
    breakdown.insert("series".to_string(), series);
    breakdown.insert("anime".to_string(), anime);
    breakdown.insert("animation".to_string(), animation);

    Ok(DownloadsStorageInfo {
        used_bytes: movies + series + anime + animation,
        total_bytes: fs2::total_space(&root).map_err(|e| format!("failed to read disk size: {e}"))?,
        free_bytes: fs2::available_space(&root).map_err(|e| format!("failed to read disk free space: {e}"))?,
        breakdown,
    })
}

fn discover_hls_output_candidate(
    save_dir: &StdPath,
    temp_dir: &StdPath,
    save_name: &str,
) -> Option<PathBuf> {
    fn normalized_name(value: &str) -> String {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .flat_map(|character| character.to_lowercase())
            .collect()
    }

    fn collect_files(root: &StdPath, output: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(root) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_files(&path, output);
            } else if path.is_file() {
                output.push(path);
            }
        }
    }

    let mut candidates = Vec::new();
    let mut fallback_candidates = Vec::new();
    let expected = normalized_name(save_name);

    for root in [save_dir, temp_dir] {
        let mut files = Vec::new();
        collect_files(root, &mut files);
        for path in files {
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let normalized_file_name = normalized_name(&file_name);
            let normalized_stem = normalized_name(&stem);

            let matches_name = normalized_stem == expected
                || normalized_file_name == expected
                || normalized_file_name.starts_with(&expected);
            let supported_extension = extension.is_empty()
                || matches!(extension.as_str(), "mp4" | "mkv" | "m4v" | "mov" | "ts");

            if matches_name && supported_extension {
                candidates.push(path);
            } else if supported_extension {
                let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
                if size >= 5 * 1024 * 1024 {
                    fallback_candidates.push(path);
                }
            }
        }
    }

    candidates.sort_by(|left, right| {
        let left_ext = left.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let right_ext = right.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let left_score = if left_ext == "mp4" { 2 } else { 1 };
        let right_score = if right_ext == "mp4" { 2 } else { 1 };
        let left_size = fs::metadata(left).map(|meta| meta.len()).unwrap_or(0);
        let right_size = fs::metadata(right).map(|meta| meta.len()).unwrap_or(0);

        right_score
            .cmp(&left_score)
            .then_with(|| right_size.cmp(&left_size))
    });

    fallback_candidates.sort_by(|left, right| {
        let left_ext = left.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let right_ext = right.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let left_score = if left_ext == "mp4" { 3 } else if left_ext == "mkv" { 2 } else { 1 };
        let right_score = if right_ext == "mp4" { 3 } else if right_ext == "mkv" { 2 } else { 1 };
        let left_size = fs::metadata(left).map(|meta| meta.len()).unwrap_or(0);
        let right_size = fs::metadata(right).map(|meta| meta.len()).unwrap_or(0);

        right_score
            .cmp(&left_score)
            .then_with(|| right_size.cmp(&left_size))
    });

    candidates
        .into_iter()
        .chain(fallback_candidates)
        .find(|candidate| validate_video_candidate(candidate))
}

fn emit_downloads_storage_info(app: &tauri::AppHandle) {
    if let Ok(info) = compute_downloads_storage_info() {
        let _ = app.emit("downloads-storage-info", info);
    }
}

fn build_ffmpeg_header_blob(headers: &HashMap<String, String>) -> Option<String> {
    if headers.is_empty() {
        return None;
    }

    let mut parts = Vec::new();
    for (key, value) in headers {
        if key.trim().is_empty() || value.trim().is_empty() {
            continue;
        }
        parts.push(format!("{}: {}\r\n", key.trim(), value.trim()));
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(""))
    }
}

fn find_binary_in_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;

    for directory in env::split_paths(&path_var) {
        let candidate = directory.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn resolve_ffmpeg_binary() -> Option<PathBuf> {
    let local_name = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent()?;
    let mut candidates = Vec::new();

    if !cfg!(debug_assertions) {
        if let Ok(runtime_root) = extract_embedded_nuvio_runtime() {
            candidates.push(runtime_root.join("vendor").join("tools").join(local_name));
        }
    }

    candidates.push(repo_root.join("vendor").join("tools").join(local_name));
    candidates.push(repo_root.join("release").join("win-unpacked").join(local_name));
    candidates.push(manifest_dir.join(local_name));

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    find_binary_in_path(local_name)
}

fn validate_completed_video_file(path: &StdPath) -> Result<(), String> {
    let Some(ffmpeg_binary) = resolve_ffmpeg_binary() else {
        return Ok(());
    };

    let mut command = Command::new(ffmpeg_binary);
    configure_hidden_process(&mut command);
    let output = command
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(path)
        .arg("-map")
        .arg("0:v:0")
        .arg("-frames:v")
        .arg("1")
        .arg("-f")
        .arg("null")
        .arg("-")
        .output()
        .map_err(|error| format!("FFmpeg validation failed to start: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("FFmpeg validation failed for the completed video file".to_string())
    } else {
        Err(format!("FFmpeg validation failed: {stderr}"))
    }
}

fn validate_video_candidate(path: &StdPath) -> bool {
    validate_completed_video_file(path).is_ok()
}

fn parse_ffmpeg_progress_time_to_seconds(line: &str) -> Option<f64> {
    let time_index = line.rfind("time=")?;
    let raw = line[time_index + 5..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim();
    let mut parts = raw.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn probe_ffmpeg_stream_duration_seconds(input: &StdPath, stream_map: &str) -> Option<f64> {
    let ffmpeg_binary = resolve_ffmpeg_binary()?;
    let mut command = Command::new(ffmpeg_binary);
    configure_hidden_process(&mut command);
    let output = command
        .arg("-hide_banner")
        .arg("-i")
        .arg(input)
        .arg("-map")
        .arg(stream_map)
        .arg("-c")
        .arg("copy")
        .arg("-f")
        .arg("null")
        .arg("-")
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr
        .lines()
        .rev()
        .find_map(parse_ffmpeg_progress_time_to_seconds)
}

fn has_significant_av_duration_mismatch(path: &StdPath) -> bool {
    let Some(video_duration) = probe_ffmpeg_stream_duration_seconds(path, "0:v:0") else {
        return false;
    };
    let Some(audio_duration) = probe_ffmpeg_stream_duration_seconds(path, "0:a:0") else {
        return false;
    };

    (audio_duration - video_duration).abs() > 2.5
}

#[derive(Clone, Debug)]
struct FfmpegAudioStreamProbe {
    audio_index: usize,
    normalized_language: String,
    description: String,
}

fn preferred_audio_language_hints(preferred_audio_selector: Option<&str>) -> Vec<String> {
    let selector = preferred_audio_selector.unwrap_or("").trim();
    let mut hints = Vec::new();

    if let Some(start) = selector.find("lang=\"") {
        let value_start = start + 6;
        if let Some(value_end) = selector[value_start..].find('"') {
            let raw = &selector[value_start..value_start + value_end];
            for part in raw.split('|') {
                let normalized = part
                    .trim()
                    .trim_start_matches('^')
                    .trim_end_matches('$')
                    .trim()
                    .to_ascii_lowercase();
                if !normalized.is_empty() && !hints.contains(&normalized) {
                    hints.push(normalized);
                }
            }
        }
    }

    if hints.is_empty() {
        hints.push("en".to_string());
        hints.push("eng".to_string());
    }

    hints
}

fn probe_ffmpeg_audio_streams(
    input: &str,
    headers: Option<&HashMap<String, String>>,
) -> Vec<FfmpegAudioStreamProbe> {
    let Some(ffmpeg_binary) = resolve_ffmpeg_binary() else {
        return Vec::new();
    };

    let mut command = Command::new(ffmpeg_binary);
    configure_hidden_process(&mut command);
    command.arg("-hide_banner");

    if let Some(header_blob) = headers.and_then(build_ffmpeg_header_blob) {
        command.arg("-headers").arg(header_blob);
    }

    let output = match command.arg("-i").arg(input).output() {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut probes = Vec::new();
    let mut audio_index = 0usize;

    for line in stderr.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("Stream #") || !trimmed.contains("Audio:") {
            continue;
        }

        let prefix = trimmed
            .split(": Audio:")
            .next()
            .unwrap_or_default()
            .trim();
        let language = prefix
            .rsplit_once('(')
            .and_then(|(_, tail)| tail.strip_suffix(')'))
            .unwrap_or("")
            .trim();

        probes.push(FfmpegAudioStreamProbe {
            audio_index,
            normalized_language: normalize_hls_audio_language(Some(language), trimmed)
                .to_ascii_lowercase(),
            description: trimmed.to_ascii_lowercase(),
        });
        audio_index += 1;
    }

    probes
}

fn ffmpeg_audio_probe_score(
    probe: &FfmpegAudioStreamProbe,
    preferred_audio_selector: Option<&str>,
) -> i32 {
    let hints = preferred_audio_language_hints(preferred_audio_selector);
    let language = probe.normalized_language.as_str();
    let description = probe.description.as_str();
    let mut score = 0;

    if hints.iter().any(|hint| hint == language) {
        score += 220;
    }

    if matches!(language, "en" | "eng") {
        score += 120;
    } else if !matches!(language, "" | "unknown") {
        score -= 45;
    }

    if description.contains("english") || description.contains("(eng)") || description.contains("(en)") {
        score += 50;
    }

    for marker in [
        "italian", "(ita)", " french", "(fre)", "(fra)", "german", "(ger)", "spanish", "(spa)",
        "japanese", "(jpn)", "korean", "(kor)", "hindi", "tamil", "telugu", "arabic", "(ara)",
    ] {
        if description.contains(marker) {
            score -= 60;
        }
    }

    score
}

fn preferred_ffmpeg_audio_map_for_input(
    input: &str,
    input_index: usize,
    headers: Option<&HashMap<String, String>>,
    preferred_audio_selector: Option<&str>,
) -> Option<String> {
    probe_ffmpeg_audio_streams(input, headers)
        .into_iter()
        .max_by_key(|probe| ffmpeg_audio_probe_score(probe, preferred_audio_selector))
        .map(|probe| format!("{input_index}:a:{}?", probe.audio_index))
}

fn completed_video_matches_preferred_audio(
    path: &StdPath,
    preferred_audio_selector: Option<&str>,
) -> bool {
    let input = path.to_string_lossy().to_string();
    let probes = probe_ffmpeg_audio_streams(&input, None);
    let Some(first_probe) = probes.first() else {
        return true;
    };

    ffmpeg_audio_probe_score(first_probe, preferred_audio_selector) >= 100
}

fn media_audio_candidate_score(path: &StdPath) -> i32 {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let english_markers = ["english", ".eng.", "_eng.", "-eng.", " eng ", "eng", "default", "main"];
    let non_english_markers = [
        "hindi",
        "tam",
        "tamil",
        "tel",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "urdu",
        "arabic",
        "korean",
        "japanese",
        "jpn",
        "french",
        "german",
        "italian",
        "ita",
        "russian",
        "spanish",
        "spa",
        "latino",
        "chinese",
        "mandarin",
        "jpn",
        "ger",
        "fre",
        "fra",
        "ukr",
    ];

    let mut score = 0;

    if matches!(extension.as_str(), "m4a" | "aac" | "ac3" | "eac3" | "mp3" | "dts") {
        score += 25;
    } else if matches!(extension.as_str(), "mp4" | "mkv" | "ts" | "m2ts" | "mov") {
        score -= 10;
    }

    if english_markers.iter().any(|marker| name.contains(marker)) {
        score += 50;
    }

    let non_english_hits = non_english_markers
        .iter()
        .filter(|marker| name.contains(**marker))
        .count() as i32;
    if non_english_hits > 0 {
        score -= non_english_hits * 30;
    }

    score
}

fn discover_hls_media_candidates(
    save_dir: &StdPath,
    temp_dir: &StdPath,
    target_path: &StdPath,
    save_name: &str,
) -> Vec<PathBuf> {
    fn collect_files(root: &StdPath, output: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(root) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_files(&path, output);
            } else if path.is_file() {
                output.push(path);
            }
        }
    }

    let mut candidates = Vec::new();
    for root in [save_dir, temp_dir] {
        let mut files = Vec::new();
        collect_files(root, &mut files);
        for path in files {
            if path == target_path {
                continue;
            }

            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let file_stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);

            if size < 5 * 1024 * 1024 {
                continue;
            }

            if !file_stem.starts_with(&save_name.to_ascii_lowercase()) {
                continue;
            }

            if matches!(extension.as_str(), "mp4" | "m4a" | "aac" | "mkv" | "ts" | "m2ts" | "mov") {
                candidates.push(path);
            }
        }
    }

    let newest_time = candidates
        .iter()
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .max();

    if let Some(newest_time) = newest_time {
        candidates.retain(|path| {
            fs::metadata(path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|modified| newest_time.duration_since(modified).ok())
                .map(|delta| delta <= Duration::from_secs(180))
                .unwrap_or(false)
        });
    }

    candidates.sort_by(|left, right| {
        let left_size = fs::metadata(left).map(|meta| meta.len()).unwrap_or(0);
        let right_size = fs::metadata(right).map(|meta| meta.len()).unwrap_or(0);
        right_size.cmp(&left_size)
    });
    candidates
}

fn hls_manifest_points_to_remote_media(manifest_path: &StdPath) -> bool {
    fs::read_to_string(manifest_path)
        .map(|contents| contents.contains("http://") || contents.contains("https://"))
        .unwrap_or(false)
}

fn hls_track_segment_sort_key(path: &StdPath) -> (u8, u64, String) {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if stem.starts_with("init") || stem.contains("init") {
        return (0, 0, stem);
    }

    let numeric_prefix = stem
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    if let Ok(index) = numeric_prefix.parse::<u64>() {
        return (1, index, stem);
    }

    (2, 0, stem)
}

fn collect_hls_track_segment_files(track_dir: &StdPath) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Ok(entries) = fs::read_dir(track_dir) else {
        return paths;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if matches!(extension.as_str(), "ts" | "m4s" | "m4a" | "aac" | "mp4") {
            paths.push(path);
        }
    }

    paths.sort_by_key(|path| hls_track_segment_sort_key(path));
    paths
}

fn collect_hls_track_directories(bundle_root: &StdPath) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut video_dirs = Vec::new();
    let mut audio_dirs = Vec::new();
    let Ok(entries) = fs::read_dir(bundle_root) else {
        return (video_dirs, audio_dirs);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if name.contains("subs___") {
            continue;
        }

        if collect_hls_track_segment_files(&path).is_empty() {
            continue;
        }

        if name.contains("audio___") {
            audio_dirs.push(path);
        } else {
            video_dirs.push(path);
        }
    }

    (video_dirs, audio_dirs)
}

fn hls_audio_track_dir_score(path: &StdPath, preferred_audio_selector: Option<&str>) -> i32 {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let hints = preferred_audio_language_hints(preferred_audio_selector);
    let mut score = 0;

    for hint in hints {
        if name.contains(&format!("___{hint}")) || name.ends_with(&hint) || name.contains(&hint) {
            score += 240;
        }
    }

    if name.contains("audio___eng") || name.contains("audio___en") {
        score += 140;
    } else if name.contains("audio___ita")
        || name.contains("audio___jpn")
        || name.contains("audio___kor")
        || name.contains("audio___spa")
        || name.contains("audio___fre")
        || name.contains("audio___ger")
    {
        score -= 80;
    }

    let directory_bytes = recursive_dir_size(path).min(i32::MAX as u64) as i32;
    score + (directory_bytes / (1024 * 1024))
}

fn write_ffmpeg_concat_list(paths: &[PathBuf], list_path: &StdPath) -> Result<(), String> {
    let mut lines = Vec::with_capacity(paths.len());
    for path in paths {
        let normalized = path
            .to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''");
        lines.push(format!("file '{normalized}'"));
    }

    fs::write(list_path, lines.join("\n"))
        .map_err(|error| format!("Failed to write concat list {}: {error}", list_path.display()))
}

fn attempt_local_hls_bundle_recover(
    temp_dir: &StdPath,
    target_path: &StdPath,
    save_name: &str,
    preferred_audio_selector: Option<&str>,
) -> Result<(), String> {
    let ffmpeg_binary = resolve_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg is not available for local HLS recovery".to_string())?;
    let bundle_root = temp_dir.join(save_name);
    if !bundle_root.is_dir() {
        return Err("No local HLS track bundle was found for recovery".to_string());
    }

    let (video_dirs, audio_dirs) = collect_hls_track_directories(&bundle_root);
    let video_dir = video_dirs
        .into_iter()
        .max_by_key(|path| recursive_dir_size(path))
        .ok_or_else(|| "No local HLS video track directory was found for recovery".to_string())?;
    let audio_dir = audio_dirs
        .into_iter()
        .max_by_key(|path| hls_audio_track_dir_score(path, preferred_audio_selector))
        .ok_or_else(|| "No local HLS audio track directory was found for recovery".to_string())?;

    let video_segments = collect_hls_track_segment_files(&video_dir);
    let audio_segments = collect_hls_track_segment_files(&audio_dir);
    if video_segments.is_empty() || audio_segments.is_empty() {
        return Err("Local HLS recovery is missing video or audio segments".to_string());
    }

    let video_list = temp_dir.join(format!("{save_name}.video.concat.txt"));
    let audio_list = temp_dir.join(format!("{save_name}.audio.concat.txt"));
    let recovered_output = target_path.with_extension("recover.mp4");

    write_ffmpeg_concat_list(&video_segments, &video_list)?;
    write_ffmpeg_concat_list(&audio_segments, &audio_list)?;
    let _ = fs::remove_file(&recovered_output);

    let mut command = Command::new(ffmpeg_binary);
    configure_hidden_process(&mut command);
    let output = command
        .arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-fflags")
        .arg("+genpts")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&video_list)
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&audio_list)
        .arg("-map")
        .arg("0:v:0")
        .arg("-map")
        .arg("1:a:0")
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("160k")
        .arg("-af")
        .arg("aresample=async=1:first_pts=0")
        .arg("-shortest")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&recovered_output)
        .output()
        .map_err(|error| format!("FFmpeg local bundle recovery failed to start: {error}"))?;

    let _ = fs::remove_file(&video_list);
    let _ = fs::remove_file(&audio_list);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "FFmpeg local bundle recovery failed".to_string()
        } else {
            format!("FFmpeg local bundle recovery failed: {stderr}")
        });
    }

    validate_completed_video_file(&recovered_output)?;
    if has_significant_av_duration_mismatch(&recovered_output) {
        let _ = fs::remove_file(&recovered_output);
        return Err("FFmpeg local bundle recovery produced mismatched audio/video durations".to_string());
    }
    if target_path.exists() {
        let _ = fs::remove_file(target_path);
    }
    replace_file_path(&recovered_output, target_path)?;
    Ok(())
}

fn attempt_ffmpeg_recover_hls_output(
    save_dir: &StdPath,
    temp_dir: &StdPath,
    target_path: &StdPath,
    save_name: &str,
    preferred_audio_selector: Option<&str>,
) -> Result<(), String> {
    let ffmpeg_binary = resolve_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg is not available for HLS recovery".to_string())?;

    if attempt_local_hls_bundle_recover(temp_dir, target_path, save_name, preferred_audio_selector).is_ok() {
        return Ok(());
    }

    let local_manifest = temp_dir.join("raw.m3u8");
    if local_manifest.exists() && !hls_manifest_points_to_remote_media(&local_manifest) {
        let recovered_from_manifest = target_path.with_extension("recover.mp4");
        let _ = fs::remove_file(&recovered_from_manifest);

        let mut manifest_command = Command::new(&ffmpeg_binary);
        configure_hidden_process(&mut manifest_command);
        let manifest_input = local_manifest.to_string_lossy().to_string();
        let audio_map = preferred_ffmpeg_audio_map_for_input(
            &manifest_input,
            0,
            None,
            preferred_audio_selector,
        )
        .unwrap_or_else(|| "0:a:0?".to_string());
        let manifest_output = manifest_command
            .arg("-y")
            .arg("-v")
            .arg("error")
            .arg("-allowed_extensions")
            .arg("ALL")
            .arg("-protocol_whitelist")
            .arg("file,crypto,data,http,https,tcp,tls")
            .arg("-i")
            .arg(&local_manifest)
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg(audio_map)
            .arg("-c")
            .arg("copy")
            .arg("-movflags")
            .arg("+faststart")
            .arg(&recovered_from_manifest)
            .output()
            .map_err(|error| format!("FFmpeg manifest recovery failed to start: {error}"))?;

        if manifest_output.status.success() && validate_completed_video_file(&recovered_from_manifest).is_ok() {
            if target_path.exists() {
                let _ = fs::remove_file(target_path);
            }
            replace_file_path(&recovered_from_manifest, target_path)?;
            return Ok(());
        }
    }

    let candidates = discover_hls_media_candidates(save_dir, temp_dir, target_path, save_name);
    if candidates.is_empty() {
        return Err("No media candidates were found for HLS recovery".to_string());
    }

    let recovered_output = target_path.with_extension("recover.mp4");
    let _ = fs::remove_file(&recovered_output);

    let video_candidate = candidates
        .iter()
        .find(|candidate| validate_video_candidate(candidate))
        .cloned()
        .ok_or_else(|| "No usable video candidate was found for HLS recovery".to_string())?;

    let audio_candidate = candidates
        .iter()
        .filter(|candidate| **candidate != video_candidate)
        .max_by_key(|candidate| media_audio_candidate_score(candidate))
        .cloned();

    let mut command = Command::new(ffmpeg_binary);
    configure_hidden_process(&mut command);
    command
        .arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(&video_candidate);

    if let Some(audio) = &audio_candidate {
        command.arg("-i").arg(audio);
    }

    command
        .arg("-map")
        .arg("0:v:0");

    if audio_candidate.is_some() {
        let audio_input = audio_candidate
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        let audio_map = preferred_ffmpeg_audio_map_for_input(
            &audio_input,
            1,
            None,
            preferred_audio_selector,
        )
        .unwrap_or_else(|| "1:a:0?".to_string());
        command
            .arg("-map")
            .arg(audio_map);
    } else {
        let video_input = video_candidate.to_string_lossy().to_string();
        let audio_map = preferred_ffmpeg_audio_map_for_input(
            &video_input,
            0,
            None,
            preferred_audio_selector,
        )
        .unwrap_or_else(|| "0:a:0?".to_string());
        command
            .arg("-map")
            .arg(audio_map);
    }

    let output = command
        .arg("-c")
        .arg("copy")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&recovered_output)
        .output()
        .map_err(|error| format!("FFmpeg recovery failed to start: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "FFmpeg recovery failed".to_string()
        } else {
            format!("FFmpeg recovery failed: {stderr}")
        });
    }

    validate_completed_video_file(&recovered_output)?;
    if target_path.exists() {
        let _ = fs::remove_file(target_path);
    }
    replace_file_path(&recovered_output, target_path)?;
    Ok(())
}

fn resolve_n_m3u8dl_binary() -> Option<PathBuf> {
    let local_name = if cfg!(target_os = "windows") {
        "N_m3u8DL-RE.exe"
    } else {
        "N_m3u8DL-RE"
    };
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent()?;
    let mut candidates = Vec::new();

    if !cfg!(debug_assertions) {
        if let Ok(runtime_root) = extract_embedded_nuvio_runtime() {
            candidates.push(runtime_root.join("vendor").join("tools").join(local_name));
        }
    }

    candidates.push(repo_root.join("vendor").join("tools").join(local_name));
    candidates.push(repo_root.join("release").join("win-unpacked").join(local_name));
    candidates.push(manifest_dir.join(local_name));

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    find_binary_in_path(local_name)
}

fn build_hls_temp_dir(target_path: &StdPath) -> PathBuf {
    let file_stem = target_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let temp_name = format!("{file_stem}.n_m3u8dl");
    target_path
        .parent()
        .unwrap_or_else(|| StdPath::new("."))
        .join(temp_name)
}

fn build_hls_log_path(temp_dir: &StdPath) -> PathBuf {
    temp_dir.join("n_m3u8dl.log")
}

fn summarize_hls_download_log(log_path: &StdPath) -> Option<String> {
    let contents = fs::read_to_string(log_path).ok()?;
    if contents.trim().is_empty() {
        return None;
    }

    let mut exhausted_retry_count = 0usize;
    let mut segment_count_failures = 0usize;
    let mut pending_url: Option<String> = None;
    let mut failed_urls = Vec::new();

    for line in contents.lines() {
        let trimmed = line.trim();
        if let Some(url) = trimmed.strip_prefix("Url        => ") {
            pending_url = Some(url.trim().to_string());
            continue;
        }

        if trimmed.contains("The retry attempts have been exhausted and the download of this segment has failed.") {
            exhausted_retry_count += 1;
            if let Some(url) = pending_url.take() {
                failed_urls.push(url);
            }
            continue;
        }

        if trimmed.contains("Segment count check not pass") {
            segment_count_failures += 1;
        }
    }

    if exhausted_retry_count == 0 && segment_count_failures == 0 {
        return None;
    }

    let mut parts = Vec::new();
    if segment_count_failures > 0 {
        parts.push(format!(
            "segment count check failed {} time{}",
            segment_count_failures,
            if segment_count_failures == 1 { "" } else { "s" }
        ));
    }
    if exhausted_retry_count > 0 {
        parts.push(format!(
            "{} segment download{} exhausted retr{}",
            exhausted_retry_count,
            if exhausted_retry_count == 1 { "" } else { "s" },
            if exhausted_retry_count == 1 { "y" } else { "ies" }
        ));
    }
    if let Some(example_url) = failed_urls.into_iter().next() {
        parts.push(format!("example failed segment: {example_url}"));
    }

    Some(parts.join("; "))
}

fn compute_hls_display_total_bytes(estimated_total: Option<u64>, current_bytes: u64) -> Option<u64> {
    let base = estimated_total.unwrap_or(0);
    if base == 0 {
        return None;
    }

    if current_bytes <= base.saturating_mul(9) / 10 {
        return Some(base);
    }

    let cushion = (current_bytes / 5).max(128 * 1024 * 1024);
    Some(base.max(current_bytes.saturating_add(cushion)))
}

fn cleanup_stale_hls_artifacts(
    save_dir: &StdPath,
    save_name: &str,
    target_path: &StdPath,
) {
    let Ok(entries) = fs::read_dir(save_dir) else {
        return;
    };

    let normalized_save_name = save_name.to_ascii_lowercase();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path == target_path {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !stem.starts_with(&normalized_save_name) {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if matches!(extension.as_str(), "ts" | "m4a" | "aac" | "mkv" | "mov" | "mp4") {
            let _ = fs::remove_file(&path);
        }
    }
}

fn cleanup_completed_hls_artifacts(
    save_dir: &StdPath,
    save_name: &str,
    target_path: &StdPath,
) {
    cleanup_stale_hls_artifacts(save_dir, save_name, target_path);

    let Ok(entries) = fs::read_dir(save_dir) else {
        return;
    };

    let normalized_save_name = save_name.to_ascii_lowercase();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == target_path {
            continue;
        }

        if path.is_dir() {
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if file_name.starts_with(&normalized_save_name) {
                let _ = fs::remove_dir_all(&path);
            }
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !stem.starts_with(&normalized_save_name) {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if matches!(
            extension.as_str(),
            "ts" | "m4s" | "m4a" | "aac" | "mkv" | "mov" | "copy"
        ) || file_name.ends_with(".mux.mp4")
        {
            let _ = fs::remove_file(&path);
        }
    }
}

fn existing_hls_recovery_candidates(target_path: &StdPath) -> Vec<PathBuf> {
    vec![
        target_path.with_extension("recover.mp4"),
    ]
}

fn promote_existing_hls_recovery_output(target_path: &StdPath) -> Result<Option<u64>, String> {
    let target_is_valid = target_path.exists() && validate_video_candidate(target_path);
    let target_size = fs::metadata(target_path).map(|metadata| metadata.len()).unwrap_or(0);

    let mut candidates = existing_hls_recovery_candidates(target_path)
        .into_iter()
        .filter(|candidate| candidate.exists() && validate_video_candidate(candidate))
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_size = fs::metadata(left).map(|metadata| metadata.len()).unwrap_or(0);
        let right_size = fs::metadata(right).map(|metadata| metadata.len()).unwrap_or(0);
        right_size.cmp(&left_size)
    });

    for candidate in candidates {
        let candidate_size = fs::metadata(&candidate)
            .map(|metadata| metadata.len())
            .unwrap_or(0);

        if target_is_valid && candidate_size <= target_size {
            continue;
        }

        replace_file_path(&candidate, target_path)?;
        return Ok(Some(candidate_size));
    }

    Ok(None)
}

fn select_download_stream(streams: &[ResolvedMovieStream], quality: Option<&str>) -> Option<ResolvedMovieStream> {
    let preferences: &[&str] = match quality.unwrap_or("high").trim().to_ascii_lowercase().as_str() {
        "standard" => &["720p", "auto", "1080p", "4k"],
        "highest" => &["4k", "1080p", "720p", "auto"],
        _ => &["1080p", "720p", "auto", "4k"],
    };

    for preferred in preferences {
        if let Some(stream) = streams
            .iter()
            .find(|stream| stream.quality.trim().eq_ignore_ascii_case(preferred))
        {
            return Some(stream.clone());
        }
    }

    streams.first().cloned()
}

fn infer_explicit_download_stream_type(
    explicit_stream_type: Option<&str>,
    stream_url: &str,
) -> String {
    let normalized = explicit_stream_type
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if matches!(normalized.as_str(), "hls" | "mp4" | "unknown") {
        return normalized;
    }

    let lower_url = stream_url.trim().to_ascii_lowercase();
    if lower_url.contains(".m3u8") {
        "hls".to_string()
    } else if lower_url.contains(".mp4") || lower_url.contains(".m4v") {
        "mp4".to_string()
    } else {
        "unknown".to_string()
    }
}

fn guess_subtitle_format_from_url(url: &str) -> &'static str {
    let lower_url = url.trim().to_ascii_lowercase();
    if lower_url.contains(".srt") {
        "srt"
    } else if lower_url.contains(".ass") {
        "ass"
    } else {
        "vtt"
    }
}

fn build_explicit_download_stream(
    request: &VideoDownloadRequest,
    normalized_type: &str,
) -> Option<ResolvedMovieStream> {
    let stream_url = request.stream_url.as_ref()?.trim();
    if stream_url.is_empty() {
        return None;
    }

    let stream_type = infer_explicit_download_stream_type(
        request.stream_type.as_deref(),
        stream_url,
    );

    let mut subtitles = Vec::new();
    if let Some(subtitle_url) = request
        .subtitle_url
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        subtitles.push(ResolvedMovieSubtitle {
            url: subtitle_url.to_string(),
            label: "English".to_string(),
            language: "en".to_string(),
            format: guess_subtitle_format_from_url(subtitle_url).to_string(),
            source: normalized_type.to_string(),
            hearing_impaired: false,
            release: None,
            origin: None,
            file_name: None,
        });
    }

    Some(ResolvedMovieStream {
        url: stream_url.to_string(),
        quality: request.quality.clone().unwrap_or_else(|| "auto".to_string()),
        provider: normalized_type.to_string(),
        headers: request.headers.clone().unwrap_or_default(),
        title: request.title.clone(),
        source: "download-request".to_string(),
        stream_type,
        content_type: None,
        strategy: "explicit".to_string(),
        subtitles,
    })
}

async fn resolve_movie_like_download_stream(
    request: &VideoDownloadRequest,
) -> Result<ResolvedMovieStream, String> {
    let normalized_type = normalize_video_download_content_type(&request.content_type);
    if let Some(explicit_stream) = build_explicit_download_stream(request, &normalized_type) {
        return Ok(explicit_stream);
    }
    if normalized_type == "anime" {
        return Err("Anime download is missing a resolved stream URL".to_string());
    }

    let resolver_request = MovieResolverRequest {
        tmdb_id: request.content_id.clone(),
        content_type: if normalized_type == "tv" {
            "series".to_string()
        } else {
            normalized_type.clone()
        },
        season: request.season,
        episode: request.episode,
        imdb_id: request.imdb_id.clone(),
        force_refresh: Some(false),
        exclude_urls: None,
        exclude_providers: None,
    };

    let streams = fetch_movie_resolver_streams(resolver_request).await?;
    select_download_stream(&streams, request.quality.as_deref())
        .ok_or_else(|| "No downloadable stream was resolved".to_string())
}

async fn run_direct_video_download(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream: &ResolvedMovieStream,
    control: &ActiveVideoDownloadControl,
    target_path: &StdPath,
) -> VideoDownloadTaskOutcome {
    let temp_path = target_path.with_extension("part");
    let mut existing_bytes = fs::metadata(&temp_path).map(|metadata| metadata.len()).unwrap_or(0);

    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => return VideoDownloadTaskOutcome::Failed(error.to_string()),
    };

    let mut http_request = client.get(&stream.url).header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    for (key, value) in &stream.headers {
        http_request = http_request.header(key, value);
    }
    if existing_bytes > 0 {
        http_request = http_request.header("Range", format!("bytes={existing_bytes}-"));
    }

    let response = match http_request.send().await {
        Ok(response) => response,
        Err(error) => return VideoDownloadTaskOutcome::Failed(error.to_string()),
    };

    if !(response.status().is_success() || response.status() == reqwest::StatusCode::PARTIAL_CONTENT) {
        return VideoDownloadTaskOutcome::Failed(format!("Download failed: HTTP {}", response.status()));
    }

    let should_append = existing_bytes > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if existing_bytes > 0 && !should_append {
        existing_bytes = 0;
        let _ = fs::remove_file(&temp_path);
    }

    let response_total = response.content_length();
    let target_total = if should_append {
        response_total
            .map(|remaining| existing_bytes.saturating_add(remaining))
            .or(request.total_bytes)
    } else {
        response_total.or(request.total_bytes)
    };
    let mut output = match OpenOptions::new()
        .create(true)
        .append(should_append)
        .write(true)
        .truncate(!should_append)
        .open(&temp_path)
    {
        Ok(file) => tokio::fs::File::from_std(file),
        Err(error) => return VideoDownloadTaskOutcome::Failed(error.to_string()),
    };

    let mut bytes_downloaded = existing_bytes;
    let mut last_progress_emit = std::time::Instant::now();
    let mut last_progress_bytes = existing_bytes;
    let mut last_nonzero_speed = 0u64;
    let mut stream_body = response.bytes_stream();

    if existing_bytes > 0 {
        let progress = target_total
            .map(|total| clamp_download_progress((bytes_downloaded as f64 / total.max(1) as f64) * 100.0))
            .unwrap_or(0);
        emit_video_download_progress(
            app,
            request,
            &stream.stream_type,
            Some(stream.quality.as_str()),
            true,
            progress,
            bytes_downloaded,
            target_total,
            0,
        );
    }

    while let Some(chunk) = stream_body.next().await {
        if control.cancel_flag.load(Ordering::SeqCst) {
            let stop_action = control
                .stop_action
                .lock()
                .map(|guard| *guard)
                .unwrap_or(ActiveVideoDownloadStopAction::Cancel);
            let _ = output.flush().await;
            drop(output);
            if stop_action != ActiveVideoDownloadStopAction::Pause {
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
            return VideoDownloadTaskOutcome::Stopped;
        }

        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return VideoDownloadTaskOutcome::Failed(error.to_string());
            }
        };

        if let Err(error) = output.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return VideoDownloadTaskOutcome::Failed(error.to_string());
        }

        bytes_downloaded += chunk.len() as u64;

        if last_progress_emit.elapsed() >= Duration::from_millis(350) {
            let progress = target_total
                .map(|total| clamp_download_progress((bytes_downloaded as f64 / total.max(1) as f64) * 100.0))
                .unwrap_or(0);
            let elapsed = last_progress_emit.elapsed().as_secs_f64().max(0.001);
            let delta_bytes = bytes_downloaded.saturating_sub(last_progress_bytes);
            let speed = if delta_bytes > 0 {
                let calculated = (delta_bytes as f64 / elapsed).round() as u64;
                last_nonzero_speed = calculated;
                calculated
            } else {
                last_nonzero_speed
            };
            emit_video_download_progress(
                app,
                request,
                &stream.stream_type,
                Some(stream.quality.as_str()),
                true,
                progress,
                bytes_downloaded,
                target_total,
                speed,
            );
            last_progress_bytes = bytes_downloaded;
            last_progress_emit = std::time::Instant::now();
        }
    }

    if let Err(error) = output.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return VideoDownloadTaskOutcome::Failed(error.to_string());
    }
    drop(output);

    if let Err(error) = tokio::fs::rename(&temp_path, target_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return VideoDownloadTaskOutcome::Failed(error.to_string());
    }

    let total_bytes = fs::metadata(target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(bytes_downloaded);

    emit_video_download_progress(
        app,
        request,
        &stream.stream_type,
        Some(stream.quality.as_str()),
        true,
        100,
        total_bytes,
        Some(total_bytes),
        0,
    );

    maybe_download_subtitle_sidecar(request, stream, target_path).await;

    VideoDownloadTaskOutcome::Completed {
        file_path: target_path.to_path_buf(),
        bytes_downloaded: total_bytes,
        total_bytes,
    }
}

async fn run_hls_video_download(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    stream: &ResolvedMovieStream,
    control: &ActiveVideoDownloadControl,
    target_path: &StdPath,
) -> VideoDownloadTaskOutcome {
    let Some(n_m3u8dl_binary) = resolve_n_m3u8dl_binary() else {
        return VideoDownloadTaskOutcome::Failed(
            "N_m3u8DL-RE is not available yet for HLS downloads on this machine".to_string(),
        );
    };
    let Some(ffmpeg_binary) = resolve_ffmpeg_binary() else {
        return VideoDownloadTaskOutcome::Failed(
            "FFmpeg is not available yet for HLS muxing on this machine".to_string(),
        );
    };

    let temp_dir = build_hls_temp_dir(target_path);
    if let Err(error) = fs::create_dir_all(&temp_dir) {
        return VideoDownloadTaskOutcome::Failed(format!("Failed to create HLS temp directory: {error}"));
    }
    let n_m3u8dl_log_path = build_hls_log_path(&temp_dir);
    let _ = fs::remove_file(&n_m3u8dl_log_path);

    let save_dir = target_path
        .parent()
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let save_name = target_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();
    let preferred_audio_selector = discover_preferred_hls_audio_selector(stream).await;
    let preferred_video_selection =
        discover_preferred_hls_video_selector(stream, request.quality.as_deref()).await;

    cleanup_stale_hls_artifacts(&save_dir, &save_name, target_path);

    let mut command = Command::new(n_m3u8dl_binary);
    configure_hidden_process(&mut command);
    command
        .arg(&stream.url)
        .arg("--tmp-dir")
        .arg(&temp_dir)
        .arg("--save-dir")
        .arg(&save_dir)
        .arg("--save-name")
        .arg(&save_name)
        .arg("--save-pattern")
        .arg("<SaveName>")
        .arg("--thread-count")
        .arg("8")
        .arg("--download-retry-count")
        .arg("6")
        .arg("--http-request-timeout")
        .arg("30")
        // Vixsrc rendition URLs already carry their own tokens; appending master params breaks them.
        .arg("--live-perform-as-vod")
        .arg("--ffmpeg-binary-path")
        .arg(&ffmpeg_binary)
        .arg("--log-file-path")
        .arg(&n_m3u8dl_log_path)
        .arg("--log-level")
        .arg("WARN")
        .arg("--disable-update-check")
        .arg("--del-after-done")
        .arg("false")
        .arg("-M")
        .arg("format=mp4:muxer=ffmpeg:skip_sub=true:keep=true");

    if let Some(selector) = preferred_audio_selector.as_deref() {
        command.arg("-sa").arg(selector);
    } else {
        command.arg("-sa").arg("lang=\"en|eng\":for=best");
    }

    if let Some(selection) = preferred_video_selection.as_ref() {
        command.arg("-sv").arg(&selection.selector);
    } else {
        match request.quality.as_deref().unwrap_or("high").trim().to_ascii_lowercase().as_str() {
            "standard" => {
                command.arg("-sv").arg("worst");
            }
            _ => {
                command.arg("-sv").arg("best");
            }
        }
    }

    command.arg("-H").arg("User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    for (key, value) in &stream.headers {
        if key.trim().is_empty() || value.trim().is_empty() {
            continue;
        }
        command.arg("-H").arg(format!("{}: {}", key.trim(), value.trim()));
    }

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return VideoDownloadTaskOutcome::Failed(format!("N_m3u8DL-RE start failed: {error}")),
    };

    {
        if let Ok(mut guard) = control.child.lock() {
            *guard = Some(child);
        }
    }

    let estimated_total = request.total_bytes;
    let mut last_bytes = recursive_dir_size(&temp_dir);
    let mut last_tick = std::time::Instant::now();
    let mut last_nonzero_speed = 0u64;
    let mut peak_observed_bytes = last_bytes;

    loop {
        if control.cancel_flag.load(Ordering::SeqCst) {
            if let Ok(mut guard) = control.child.lock() {
                if let Some(child) = guard.as_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                *guard = None;
            }
            let stop_action = control
                .stop_action
                .lock()
                .map(|guard| *guard)
                .unwrap_or(ActiveVideoDownloadStopAction::Cancel);
            if stop_action != ActiveVideoDownloadStopAction::Pause {
                let _ = fs::remove_dir_all(&temp_dir);
            }
            return VideoDownloadTaskOutcome::Stopped;
        }

        let mut finished = None;
        if let Ok(mut guard) = control.child.lock() {
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        finished = Some(status);
                        *guard = None;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        *guard = None;
                        return VideoDownloadTaskOutcome::Failed(format!("N_m3u8DL-RE wait failed: {error}"));
                    }
                }
            } else {
                return VideoDownloadTaskOutcome::Failed(format!(
                    "N_m3u8DL-RE process disappeared before completion; preserved temp dir: {}",
                    temp_dir.display()
                ));
            }
        }

        let current_bytes = recursive_dir_size(&temp_dir)
            .saturating_add(fs::metadata(target_path).map(|metadata| metadata.len()).unwrap_or(0));
        peak_observed_bytes = peak_observed_bytes.max(current_bytes);
        let display_total = compute_hls_display_total_bytes(estimated_total, current_bytes);
        let progress = display_total
            .map(|total| {
                let raw = (current_bytes as f64 / total.max(1) as f64) * 100.0;
                let clamped = clamp_download_progress(raw);
                if finished.is_some() {
                    clamped.max(99)
                } else {
                    clamped.min(99)
                }
            })
            .unwrap_or(0);
        let elapsed = last_tick.elapsed().as_secs_f64().max(0.001);
        let delta_bytes = current_bytes.saturating_sub(last_bytes);
        let speed = if finished.is_some() {
            0
        } else if delta_bytes > 0 {
            let calculated = (delta_bytes as f64 / elapsed).round() as u64;
            last_nonzero_speed = calculated;
            calculated
        } else {
            last_nonzero_speed
        };
        emit_video_download_progress(
            app,
            request,
            &stream.stream_type,
            preferred_video_selection
                .as_ref()
                .map(|selection| selection.quality_label.as_str())
                .or(Some(stream.quality.as_str())),
            false,
            progress,
            current_bytes,
            display_total,
            speed,
        );
        last_bytes = current_bytes;
        last_tick = std::time::Instant::now();

        if let Some(status) = finished {
            if !status.success() {
                if !target_path.exists() {
                    if let Some(candidate) = discover_hls_output_candidate(&save_dir, &temp_dir, &save_name) {
                        if candidate != target_path {
                            let _ = move_or_copy_path(&candidate, target_path);
                        }
                    }
                }

                if target_path.exists() && validate_completed_video_file(target_path).is_ok() {
                    break;
                }

                if attempt_ffmpeg_recover_hls_output(
                    &save_dir,
                    &temp_dir,
                    target_path,
                    &save_name,
                    preferred_audio_selector.as_deref(),
                )
                .is_ok()
                    && validate_completed_video_file(target_path).is_ok()
                {
                    break;
                }

                if promote_existing_hls_recovery_output(target_path)
                    .ok()
                    .flatten()
                    .is_some()
                    && validate_completed_video_file(target_path).is_ok()
                {
                    break;
                }

                let exit_label = status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "terminated by signal".to_string());
                return VideoDownloadTaskOutcome::Failed(format!(
                    "N_m3u8DL-RE exited with code {exit_label} before producing a valid file; preserved temp dir: {}",
                    temp_dir.display()
                ));
            }
            break;
        }

        tokio::time::sleep(Duration::from_millis(750)).await;
    }

    if let Some(log_issue) = summarize_hls_download_log(&n_m3u8dl_log_path) {
        let _ = fs::remove_file(target_path);
        return VideoDownloadTaskOutcome::Failed(format!(
            "HLS selected tracks did not download cleanly: {log_issue}; preserved temp dir: {}",
            temp_dir.display()
        ));
    }

    if !target_path.exists() {
        if let Some(candidate) = discover_hls_output_candidate(&save_dir, &temp_dir, &save_name) {
            if candidate != target_path {
                if let Err(error) = move_or_copy_path(&candidate, target_path) {
                    return VideoDownloadTaskOutcome::Failed(format!(
                        "HLS download finished but the final file could not be moved into place: {error}"
                    ));
                }
            }
        }
    }

    if !target_path.exists() {
        let mut nearby_outputs = Vec::new();
        for root in [save_dir.as_path(), temp_dir.as_path()] {
            if let Ok(entries) = fs::read_dir(root) {
                for entry in entries.flatten().take(12) {
                    nearby_outputs.push(
                        entry
                            .path()
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
            }
        }

        let details = if nearby_outputs.is_empty() {
            format!("no candidate outputs were found; preserved temp dir: {}", temp_dir.display())
        } else {
            format!(
                "candidate outputs: {}; preserved temp dir: {}",
                nearby_outputs.join(", "),
                temp_dir.display()
            )
        };
        return VideoDownloadTaskOutcome::Failed(format!(
            "HLS download finished without a final output file ({details})"
        ));
    }

    let mut total_bytes = fs::metadata(target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if peak_observed_bytes >= 100 * 1024 * 1024 && total_bytes < peak_observed_bytes / 4 {
        match attempt_ffmpeg_recover_hls_output(
            &save_dir,
            &temp_dir,
            target_path,
            &save_name,
            preferred_audio_selector.as_deref(),
        ) {
            Ok(()) => {}
            Err(recovery_error) => {
                if promote_existing_hls_recovery_output(target_path)
                    .ok()
                    .flatten()
                    .is_some()
                    && validate_completed_video_file(target_path).is_ok()
                {
                    let recovered_bytes = fs::metadata(target_path)
                        .map(|metadata| metadata.len())
                        .unwrap_or(total_bytes);
                    let _ = fs::remove_dir_all(&temp_dir);
                    emit_video_download_progress(
                        app,
                        request,
                        &stream.stream_type,
                        preferred_video_selection
                            .as_ref()
                            .map(|selection| selection.quality_label.as_str())
                            .or(Some(stream.quality.as_str())),
                        false,
                        100,
                        recovered_bytes,
                        Some(recovered_bytes),
                        0,
                    );
                    maybe_download_subtitle_sidecar(request, stream, target_path).await;
                    cleanup_completed_hls_artifacts(&save_dir, &save_name, target_path);
                    return VideoDownloadTaskOutcome::Completed {
                        file_path: target_path.to_path_buf(),
                        bytes_downloaded: recovered_bytes,
                        total_bytes: recovered_bytes,
                    };
                }
                let _ = fs::remove_file(target_path);
                return VideoDownloadTaskOutcome::Failed(format!(
                    "HLS final output looks truncated ({} bytes saved after {} bytes were observed during download); local recovery failed: {}; preserved temp dir: {}",
                    total_bytes,
                    peak_observed_bytes,
                    recovery_error,
                    temp_dir.display()
                ));
            }
        }
    }

    if !completed_video_matches_preferred_audio(target_path, preferred_audio_selector.as_deref()) {
        match attempt_ffmpeg_recover_hls_output(
            &save_dir,
            &temp_dir,
            target_path,
            &save_name,
            preferred_audio_selector.as_deref(),
        ) {
            Ok(()) => {
                total_bytes = fs::metadata(target_path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(total_bytes);
            }
            Err(recovery_error) => {
                return VideoDownloadTaskOutcome::Failed(format!(
                    "HLS output was saved with the wrong audio language; local recovery failed: {recovery_error}; preserved temp dir: {}",
                    temp_dir.display()
                ));
            }
        }
    }

    if has_significant_av_duration_mismatch(target_path) {
        match attempt_ffmpeg_recover_hls_output(
            &save_dir,
            &temp_dir,
            target_path,
            &save_name,
            preferred_audio_selector.as_deref(),
        ) {
            Ok(()) => {
                total_bytes = fs::metadata(target_path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(total_bytes);
                if has_significant_av_duration_mismatch(target_path) {
                    let _ = fs::remove_file(target_path);
                    return VideoDownloadTaskOutcome::Failed(format!(
                        "HLS output audio/video timelines are still mismatched after local recovery; preserved temp dir: {}",
                        temp_dir.display()
                    ));
                }
            }
            Err(recovery_error) => {
                let _ = fs::remove_file(target_path);
                return VideoDownloadTaskOutcome::Failed(format!(
                    "HLS output audio/video timelines are mismatched; local recovery failed: {recovery_error}; preserved temp dir: {}",
                    temp_dir.display()
                ));
            }
        }
    }

    if let Err(error) = validate_completed_video_file(target_path) {
        match attempt_ffmpeg_recover_hls_output(
            &save_dir,
            &temp_dir,
            target_path,
            &save_name,
            preferred_audio_selector.as_deref(),
        ) {
            Ok(()) => {}
            Err(recovery_error) => {
                if promote_existing_hls_recovery_output(target_path)
                    .ok()
                    .flatten()
                    .is_some()
                    && validate_completed_video_file(target_path).is_ok()
                {
                    let _ = fs::remove_dir_all(&temp_dir);
                    let total_bytes = fs::metadata(target_path)
                        .map(|metadata| metadata.len())
                        .unwrap_or(0);
                    emit_video_download_progress(
                        app,
                        request,
                        &stream.stream_type,
                        preferred_video_selection
                            .as_ref()
                            .map(|selection| selection.quality_label.as_str())
                            .or(Some(stream.quality.as_str())),
                        false,
                        100,
                        total_bytes,
                        Some(total_bytes),
                        0,
                    );
                    maybe_download_subtitle_sidecar(request, stream, target_path).await;
                    cleanup_completed_hls_artifacts(&save_dir, &save_name, target_path);
                    return VideoDownloadTaskOutcome::Completed {
                        file_path: target_path.to_path_buf(),
                        bytes_downloaded: total_bytes,
                        total_bytes,
                    };
                }
                let _ = fs::remove_file(target_path);
                return VideoDownloadTaskOutcome::Failed(format!(
                    "{error}; local recovery failed: {recovery_error}; preserved temp dir: {}",
                    temp_dir.display()
                ));
            }
        }
    }

    total_bytes = fs::metadata(target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(total_bytes);

    let _ = fs::remove_dir_all(&temp_dir);

    emit_video_download_progress(
        app,
        request,
        &stream.stream_type,
        preferred_video_selection
            .as_ref()
            .map(|selection| selection.quality_label.as_str())
            .or(Some(stream.quality.as_str())),
        false,
        100,
        total_bytes,
        Some(total_bytes),
        0,
    );

    maybe_download_subtitle_sidecar(request, stream, target_path).await;
    cleanup_completed_hls_artifacts(&save_dir, &save_name, target_path);

    VideoDownloadTaskOutcome::Completed {
        file_path: target_path.to_path_buf(),
        bytes_downloaded: total_bytes,
        total_bytes,
    }
}

async fn run_video_download_task(
    app: tauri::AppHandle,
    request: VideoDownloadRequest,
    control: ActiveVideoDownloadControl,
) -> VideoDownloadTaskOutcome {
    let stream = match resolve_movie_like_download_stream(&request).await {
        Ok(stream) => stream,
        Err(error) => return VideoDownloadTaskOutcome::Failed(error),
    };
    let resume_supported = matches!(stream.stream_type.as_str(), "mp4" | "unknown" | "hls");

    if let Ok(mut state) = video_download_manager().lock() {
        if let Some(entry) = state.entries.get_mut(&request.id) {
            entry.stream_type = Some(stream.stream_type.clone());
            entry.resume_supported = Some(resume_supported);
        }
    }

    emit_video_download_status(
        &app,
        &request,
        Some(&stream.stream_type),
        Some(resume_supported),
        RuntimeDownloadStatus::Downloading,
        None,
    );

    let target_path = match build_download_output_path(&request) {
        Ok(path) => path,
        Err(error) => return VideoDownloadTaskOutcome::Failed(error),
    };

    if stream.stream_type == "hls" {
        match promote_existing_hls_recovery_output(&target_path) {
            Ok(Some(total_bytes)) if validate_completed_video_file(&target_path).is_ok() => {
                maybe_download_subtitle_sidecar(&request, &stream, &target_path).await;
                let save_dir = target_path
                    .parent()
                    .map(|value| value.to_path_buf())
                    .unwrap_or_else(|| PathBuf::from("."));
                let save_name = target_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("download")
                    .to_string();
                cleanup_completed_hls_artifacts(&save_dir, &save_name, &target_path);
                return VideoDownloadTaskOutcome::Completed {
                    file_path: target_path,
                    bytes_downloaded: total_bytes,
                    total_bytes,
                };
            }
            Ok(_) => {}
            Err(error) => {
                return VideoDownloadTaskOutcome::Failed(format!(
                    "Failed to promote existing HLS recovery output: {error}"
                ));
            }
        }
    }

    if target_path.exists() {
        match stream.stream_type.as_str() {
            "mp4" | "unknown" => {
                if validate_completed_video_file(&target_path).is_ok() {
                    if let Ok(metadata) = fs::metadata(&target_path) {
                        let total_bytes = metadata.len();
                        return VideoDownloadTaskOutcome::Completed {
                            file_path: target_path,
                            bytes_downloaded: total_bytes,
                            total_bytes,
                        };
                    }
                } else {
                    let _ = fs::remove_file(&target_path);
                }
            }
            "hls" => {
                // HLS resumes can leave behind partial/truncated mp4s. Never trust an existing
                // target file here; let the HLS pipeline validate/recover it explicitly.
            }
            _ => {}
        }
    }

    match stream.stream_type.as_str() {
        "mp4" | "unknown" => run_direct_video_download(&app, &request, &stream, &control, &target_path).await,
        "hls" => run_hls_video_download(&app, &request, &stream, &control, &target_path).await,
        _ => VideoDownloadTaskOutcome::Failed("Unsupported stream type for offline download".to_string()),
    }
}

fn schedule_video_downloads(app: tauri::AppHandle) {
    let manager = video_download_manager();
    let mut jobs = Vec::new();

    {
        let mut state = match manager.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        reconcile_active_download_state(&mut state);
        let mut active_anime_count = active_anime_download_count(&state);

        loop {
            if let Some(limit) = state.max_concurrent {
                if state.active_count >= limit {
                    break;
                }
            }

            let Some(next_id) = pop_next_schedulable_download_id(&mut state, active_anime_count) else {
                break;
            };

            let control = ActiveVideoDownloadControl {
                cancel_flag: Arc::new(AtomicBool::new(false)),
                child: Arc::new(Mutex::new(None)),
                stop_action: Arc::new(Mutex::new(ActiveVideoDownloadStopAction::None)),
            };
            let request = {
                let Some(entry) = state.entries.get_mut(&next_id) else {
                    continue;
                };
                if entry.status != RuntimeDownloadStatus::Queued {
                    continue;
                }

                entry.status = RuntimeDownloadStatus::Downloading;
                entry.active = Some(control.clone());
                entry.request.clone()
            };
            if is_anime_video_download(&request) {
                active_anime_count += 1;
            }
            state.active_count += 1;
            jobs.push((request, control));
        }
    }

    for (request, control) in jobs {
        emit_video_download_status(&app, &request, None, None, RuntimeDownloadStatus::Downloading, None);
        let app_handle = app.clone();
        tokio::spawn(async move {
            let outcome = run_video_download_task(app_handle.clone(), request.clone(), control).await;
            finalize_video_download(app_handle, request, outcome);
        });
    }
}

fn finalize_video_download(
    app: tauri::AppHandle,
    request: VideoDownloadRequest,
    outcome: VideoDownloadTaskOutcome,
) {
    let manager = video_download_manager();

    {
        let mut state = match manager.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        let requested_status = state
            .entries
            .get(&request.id)
            .map(|entry| entry.status)
            .unwrap_or(RuntimeDownloadStatus::Cancelled);
        let stream_type = state
            .entries
            .get(&request.id)
            .and_then(|entry| entry.stream_type.clone());
        let resume_supported = state
            .entries
            .get(&request.id)
            .and_then(|entry| entry.resume_supported);

        reconcile_active_download_state(&mut state);
        if state.active_count > 0 {
            state.active_count -= 1;
        }

        match outcome {
            VideoDownloadTaskOutcome::Completed {
                file_path,
                bytes_downloaded,
                total_bytes,
            } => {
                let subtitle_file_path = discover_downloaded_subtitle_path(&file_path);
                if let Some(entry) = state.entries.get_mut(&request.id) {
                    entry.status = RuntimeDownloadStatus::Completed;
                    entry.active = None;
                    entry.file_path = Some(file_path.clone());
                }
                emit_video_download_completed(
                    &app,
                    &request,
                    stream_type.as_deref().unwrap_or("unknown"),
                    None,
                    resume_supported.unwrap_or(false),
                    &file_path,
                    subtitle_file_path.as_deref(),
                    bytes_downloaded,
                    total_bytes,
                );
                emit_downloads_storage_info(&app);
            }
            VideoDownloadTaskOutcome::Stopped => match requested_status {
                RuntimeDownloadStatus::Paused => {
                    if let Some(entry) = state.entries.get_mut(&request.id) {
                        entry.active = None;
                    }
                    emit_video_download_status(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        RuntimeDownloadStatus::Paused,
                        None,
                    );
                }
                RuntimeDownloadStatus::Cancelled => {
                    state.entries.remove(&request.id);
                    emit_video_download_status(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        RuntimeDownloadStatus::Cancelled,
                        None,
                    );
                }
                _ => {
                    if let Some(entry) = state.entries.get_mut(&request.id) {
                        entry.active = None;
                        entry.status = RuntimeDownloadStatus::Failed;
                    }
                    emit_video_download_failed(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        "Download stopped unexpectedly".to_string(),
                    );
                }
            },
            VideoDownloadTaskOutcome::Failed(error_message) => match requested_status {
                RuntimeDownloadStatus::Paused => {
                    if let Some(entry) = state.entries.get_mut(&request.id) {
                        entry.active = None;
                    }
                    emit_video_download_status(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        RuntimeDownloadStatus::Paused,
                        None,
                    );
                }
                RuntimeDownloadStatus::Cancelled => {
                    state.entries.remove(&request.id);
                    emit_video_download_status(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        RuntimeDownloadStatus::Cancelled,
                        None,
                    );
                }
                _ => {
                    if let Some(entry) = state.entries.get_mut(&request.id) {
                        entry.active = None;
                        entry.status = RuntimeDownloadStatus::Failed;
                    }
                    emit_video_download_failed(
                        &app,
                        &request,
                        stream_type.as_deref(),
                        resume_supported,
                        error_message,
                    );
                }
            },
        }
    }

    schedule_video_downloads(app);
}

fn stop_all_video_downloads() {
    let manager = video_download_manager();
    let active_controls = {
        let mut state = match manager.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        let controls = state
            .entries
            .values_mut()
            .filter_map(|entry| {
                if matches!(entry.status, RuntimeDownloadStatus::Downloading) {
                    entry.status = RuntimeDownloadStatus::Paused;
                }
                entry.active.take()
            })
            .collect::<Vec<_>>();

        state.active_count = 0;
        state.queue.clear();
        controls
    };

    for control in active_controls {
        if let Ok(mut stop_action) = control.stop_action.lock() {
            *stop_action = ActiveVideoDownloadStopAction::Pause;
        }
        control.cancel_flag.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = control.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

#[tauri::command]
fn get_anime_debug_log_path() -> String {
    env::temp_dir()
        .join(ANIME_DEBUG_LOG_FILE)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn start_video_download(
    app: tauri::AppHandle,
    payload: VideoDownloadRequest,
) -> Result<(), String> {
    let normalized_id = payload.id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("download id is required".to_string());
    }

    let mut normalized_payload = payload.clone();
    normalized_payload.id = normalized_id.clone();
    normalized_payload.content_type = normalize_video_download_content_type(&payload.content_type);
    normalized_payload.content_id = payload.content_id.trim().to_string();
    normalized_payload.title = payload.title.trim().to_string();

    if normalized_payload.content_id.is_empty() || normalized_payload.title.is_empty() {
        return Err("download payload is missing required content metadata".to_string());
    }

    {
        let manager = video_download_manager();
        let mut state = manager
            .lock()
            .map_err(|_| "failed to lock video download manager".to_string())?;

        reconcile_active_download_state(&mut state);

        let existing_status = state
            .entries
            .get(&normalized_id)
            .map(|entry| entry.status);

        if matches!(existing_status, Some(RuntimeDownloadStatus::Downloading | RuntimeDownloadStatus::Queued)) {
            return Ok(());
        }

        let next_entry = ManagedVideoDownload {
            request: normalized_payload.clone(),
            status: RuntimeDownloadStatus::Queued,
            active: None,
            file_path: state
                .entries
                .get(&normalized_id)
                .and_then(|entry| entry.file_path.clone()),
            stream_type: state
                .entries
                .get(&normalized_id)
                .and_then(|entry| entry.stream_type.clone()),
            resume_supported: state
                .entries
                .get(&normalized_id)
                .and_then(|entry| entry.resume_supported),
        };

        state.entries.insert(normalized_id.clone(), next_entry);
        state.queue.retain(|queued_id| queued_id != &normalized_id);
        state.queue.push_back(normalized_id.clone());
    }

    emit_video_download_status(
        &app,
        &normalized_payload,
        None,
        None,
        RuntimeDownloadStatus::Queued,
        None,
    );
    schedule_video_downloads(app);
    Ok(())
}

#[tauri::command]
async fn pause_video_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let normalized_id = id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("download id is required".to_string());
    }

    let (request_to_emit, active_control) = {
        let manager = video_download_manager();
        let mut state = manager
            .lock()
            .map_err(|_| "failed to lock video download manager".to_string())?;

        let current_status = state.entries.get(&normalized_id).map(|entry| entry.status);
        let request_to_emit = state
            .entries
            .get(&normalized_id)
            .map(|entry| entry.request.clone());
        let mut active_control = None;

        match current_status {
            Some(RuntimeDownloadStatus::Queued) => {
                if let Some(entry) = state.entries.get_mut(&normalized_id) {
                    entry.status = RuntimeDownloadStatus::Paused;
                }
                state.queue.retain(|queued_id| queued_id != &normalized_id);
            }
            Some(RuntimeDownloadStatus::Downloading) => {
                if let Some(entry) = state.entries.get_mut(&normalized_id) {
                    entry.status = RuntimeDownloadStatus::Paused;
                    active_control = entry.active.clone();
                }
            }
            _ => {}
        }
        (request_to_emit, active_control)
    };

    let Some(request) = request_to_emit else {
        return Ok(());
    };

    if let Some(control) = active_control {
        if let Ok(mut stop_action) = control.stop_action.lock() {
            *stop_action = ActiveVideoDownloadStopAction::Pause;
        }
        control.cancel_flag.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = control.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    } else {
        emit_video_download_status(
            &app,
            &request,
            None,
            None,
            RuntimeDownloadStatus::Paused,
            None,
        );
        schedule_video_downloads(app.clone());
    }

    Ok(())
}

#[tauri::command]
async fn cancel_video_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let normalized_id = id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("download id is required".to_string());
    }

    let mut request_to_emit = None;
    let mut active_control = None;

    {
        let manager = video_download_manager();
        let mut state = manager
            .lock()
            .map_err(|_| "failed to lock video download manager".to_string())?;

        let current_status = state.entries.get(&normalized_id).map(|entry| entry.status);
        match current_status {
            Some(RuntimeDownloadStatus::Downloading) => {
                if let Some(entry) = state.entries.get_mut(&normalized_id) {
                    request_to_emit = Some(entry.request.clone());
                    entry.status = RuntimeDownloadStatus::Cancelled;
                    active_control = entry.active.clone();
                }
            }
            Some(_) => {
                if let Some(entry) = state.entries.remove(&normalized_id) {
                    request_to_emit = Some(entry.request);
                }
                state.queue.retain(|queued_id| queued_id != &normalized_id);
            }
            None => {}
        }
    }

    let Some(request) = request_to_emit else {
        return Ok(());
    };

    if let Some(control) = active_control {
        if let Ok(mut stop_action) = control.stop_action.lock() {
            *stop_action = ActiveVideoDownloadStopAction::Cancel;
        }
        control.cancel_flag.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = control.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
        remove_download_artifacts(&request, None);
    } else {
        remove_download_artifacts(&request, None);
        emit_video_download_status(
            &app,
            &request,
            None,
            None,
            RuntimeDownloadStatus::Cancelled,
            None,
        );
        emit_downloads_storage_info(&app);
        schedule_video_downloads(app.clone());
    }

    Ok(())
}

#[tauri::command]
async fn delete_video_download(
    app: tauri::AppHandle,
    payload: DeleteVideoDownloadRequest,
) -> Result<(), String> {
    let normalized_id = payload.id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("download id is required".to_string());
    }

    let mut file_path = payload.file_path.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let mut stored_request: Option<VideoDownloadRequest> = None;

    {
        let manager = video_download_manager();
        if let Ok(state) = manager.lock() {
            if let Some(entry) = state.entries.get(&normalized_id) {
                if file_path.is_none() {
                    file_path = entry.file_path.clone();
                }
                stored_request = Some(entry.request.clone());
            }
        };
    }

    cancel_video_download(app.clone(), normalized_id.clone()).await?;

    {
        let manager = video_download_manager();
        if let Ok(mut state) = manager.lock() {
            if let Some(entry) = state.entries.remove(&normalized_id) {
                if file_path.is_none() {
                    file_path = entry.file_path.clone();
                }
                if stored_request.is_none() {
                    stored_request = Some(entry.request);
                }
            }
        };
    }

    if let Some(request) = stored_request.as_ref() {
        remove_download_artifacts(request, file_path.as_ref());
    }

    if let Some(path) = file_path {
        remove_download_artifacts_from_path(&path);
    }

    emit_downloads_storage_info(&app);
    Ok(())
}

#[tauri::command]
fn get_downloads_storage_info() -> Result<DownloadsStorageInfo, String> {
    compute_downloads_storage_info()
}

#[tauri::command]
fn get_download_location() -> Result<DownloadLocationInfo, String> {
    build_download_location_info()
}

#[tauri::command]
fn set_download_location(path: String) -> Result<DownloadLocationInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("download location is required".to_string());
    }

    let previous_root = downloads_root_dir()?;
    let next_root = PathBuf::from(trimmed);
    fs::create_dir_all(&next_root).map_err(|e| format!("failed to create download directory: {e}"))?;

    move_download_root_contents(&previous_root, &next_root)?;

    save_download_settings(&DownloadSettings {
        custom_root: Some(next_root.display().to_string()),
    })?;

    build_download_location_info()
}

#[tauri::command]
fn reset_download_location() -> Result<DownloadLocationInfo, String> {
    let previous_root = downloads_root_dir()?;
    let default_root = default_downloads_root_dir()?;
    fs::create_dir_all(&default_root).map_err(|e| format!("failed to create default download directory: {e}"))?;

    move_download_root_contents(&previous_root, &default_root)?;

    save_download_settings(&DownloadSettings { custom_root: None })?;

    build_download_location_info()
}

#[tauri::command]
fn set_video_download_max_concurrent(
    payload: SetVideoDownloadMaxConcurrentRequest,
) -> Result<(), String> {
    let manager = video_download_manager();
    let mut state = manager
        .lock()
        .map_err(|_| "failed to lock video download manager".to_string())?;

    state.max_concurrent = match payload.max_concurrent {
        Some(value) if value > 0 => Some(value),
        _ => None,
    };

    Ok(())
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let update_dir = updater_runtime_dir()?;
    let update_path = update_dir.join("nova-stream.exe");
    let temp_update_path = update_dir.join("nova-stream.exe.part");

    append_updater_log(&format!(
        "download start url={} current_exe={} target={}",
        url,
        current_exe.display(),
        update_path.display()
    ));

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

    let mut file = tokio::fs::File::create(&temp_update_path)
        .await
        .map_err(|e| {
            append_updater_log(&format!(
                "download create file failed path={} error={e}",
                temp_update_path.display()
            ));
            e.to_string()
        })?;

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

        file.write_all(&chunk).await.map_err(|e| {
            append_updater_log(&format!(
                "download write chunk failed path={} error={e}",
                temp_update_path.display()
            ));
            e.to_string()
        })?;

        if total > 0 {
            let percent = (downloaded * 100 / total) as u8;
            let _ = app.emit("download-progress", percent);
        }
    }

    file.flush().await.map_err(|e| {
        append_updater_log(&format!(
            "download flush failed path={} error={e}",
            temp_update_path.display()
        ));
        e.to_string()
    })?;
    drop(file);

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
    let update_dir = updater_runtime_dir()?;
    let update_exe = update_dir.join("nova-stream.exe");
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

    let batch_path = update_dir.join("apply-update.bat");

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
        update_dir.to_string_lossy(),
        updater_log_path.to_string_lossy(),
        current_path,
        updater_log_path.to_string_lossy(),
    );

    fs::write(&batch_path, &script).map_err(|e| {
        append_updater_log(&format!("apply failed writing batch file error={e}"));
        e.to_string()
    })?;

    let batch_path_string = batch_path.to_string_lossy().to_string();

    let mut command = Command::new("cmd");
    command.args(["/C", &batch_path_string]);
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().map_err(|e| {
        append_updater_log(&format!("apply failed launching batch file error={e}"));
        e.to_string()
    })?;

    append_updater_log(&format!(
        "apply launched batch file={}",
        batch_path.display()
    ));

    std::process::exit(0)
}

#[tauri::command]
async fn fetch_ann_feed() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let text = client
        .get("https://www.animenewsnetwork.com/news/rss.xml")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    Ok(text)
}

#[tauri::command]
async fn fetch_og_image(url: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // Extract og:image URL — try property-before-content and content-before-property order
    let patterns = [
        r#"property=["']og:image["'][^>]*content=["']([^"']+)["']"#,
        r#"content=["']([^"']+)["'][^>]*property=["']og:image["']"#,
    ];
    let mut img_url = String::new();
    for pat in &patterns {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(cap) = re.captures(&html) {
                img_url = cap[1].to_string().replace("&amp;", "&");
                break;
            }
        }
    }
    if img_url.is_empty() {
        return Ok(String::new());
    }

    // Resolve relative URLs
    let img_url = if img_url.starts_with("//") {
        format!("https:{}", img_url)
    } else if img_url.starts_with('/') {
        // Extract scheme+host from article URL: everything before the 3rd '/'
        let origin = if let Some(idx) = url.find("//") {
            let after = &url[idx + 2..];
            let host_end = after.find('/').unwrap_or(after.len());
            format!("{}//{}", &url[..idx], &after[..host_end])
        } else {
            url.clone()
        };
        format!("{}{}", origin, img_url)
    } else {
        img_url
    };

    // Fetch image bytes through Rust so hotlink/referer restrictions don't apply in the webview
    let resp = client
        .get(&img_url)
        .header("Referer", &url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(String::new());
    }

    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            emit_downloads_storage_info(&app.handle());
            tauri::async_runtime::spawn(async move {
                let client = match reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::limited(5))
                    .timeout(Duration::from_secs(5))
                    .build()
                {
                    Ok(client) => client,
                    Err(error) => {
                        log_resolver_debug(&format!(
                            "[nuvio_sidecar] failed to build warmup client: {}",
                            error
                        ));
                        return;
                    }
                };

                if let Err(error) = ensure_nuvio_sidecar(&client).await {
                    log_resolver_debug(&format!(
                        "[nuvio_sidecar] warmup failed: {}",
                        error
                    ));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize,
            set_player_fullscreen,
            set_topmost_state,
            close_window,
            open_iframe_player_window,
            search_hianime,
            get_hianime_episodes,
            get_hianime_stream,
            fetch_anime_text,
            get_anime_debug_log_path,
            browser_fetch_bridge_ready,
            complete_browser_fetch,
            complete_resolver_eval,
            resolver_session_eval,
            fetch_hls_segment,
            fetch_hls_manifest,
            register_media_proxy_stream,
            register_media_proxy_file,
            find_local_subtitle_sidecar,
            read_local_text_file,
            get_local_file_metadata,
            fetch_anime_text_with_session,
            fetch_movie_segment,
            fetch_movie_manifest,
            fetch_movie_subtitles,
            fetch_movie_text,
            fetch_movie_resolver_streams,
            fetch_anime_json,
            probe_movie_stream,
            capture_stream,
            resolve_embed_stream,
            start_video_download,
            pause_video_download,
            cancel_video_download,
            delete_video_download,
            get_downloads_storage_info,
            get_download_location,
            set_download_location,
            reset_download_location,
            set_video_download_max_concurrent,
            download_update,
            apply_update,
            fetch_ann_feed,
            fetch_og_image
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    if let Some(player_window) = app_handle.get_webview_window(IFRAME_PLAYER_WINDOW_LABEL) {
                        let _ = player_window.close();
                        let _ = player_window.destroy();
                    }

                    if let Some(bridge_window) = app_handle.get_webview_window(BROWSER_FETCH_BRIDGE_WINDOW_LABEL) {
                        let _ = bridge_window.close();
                        let _ = bridge_window.destroy();
                    }

                    stop_all_video_downloads();
                    stop_nuvio_sidecar();
                    app_handle.exit(0);
                }
            }
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                stop_all_video_downloads();
                stop_nuvio_sidecar();
            }
            _ => {}
        }
    });
}

