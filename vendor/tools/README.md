# Vendored Media Tools

These binaries are intentionally vendored for release packaging.

Windows binaries keep their existing names:

- `ffmpeg.exe`
- `N_m3u8DL-RE.exe`

macOS binaries are architecture-specific and intentionally use explicit names so later runtime resolution can branch safely without changing the current Windows flow:

- `ffmpeg-macos-x64`
- `ffmpeg-macos-arm64`
- `N_m3u8DL-RE-macos-x64`
- `N_m3u8DL-RE-macos-arm64`

`src-tauri/build.rs` already archives the full `vendor/tools` directory into the embedded runtime, so adding these files makes them available to packaged builds without changing the Windows packaging path.

## Source provenance

### FFmpeg

- macOS x64 source:
  - `https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip`
- macOS arm64 source:
  - `https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip`

Version at download time:

- FFmpeg `8.1` release build

SHA-256:

- `ffmpeg-macos-x64`
  - `3980559C6560960C99BD9B051C1BB3537624F2B382547D4E8F2880003F3A40A6`
- `ffmpeg-macos-arm64`
  - `1DDA5D1BDDE134222DD02A00BE649A8E7D0190922E4104B017D995C60F261926`

### N_m3u8DL-RE

- macOS x64 source:
  - `https://github.com/nilaoda/N_m3u8DL-RE/releases/download/v0.5.1-beta/N_m3u8DL-RE_v0.5.1-beta_osx-x64_20251029.tar.gz`
- macOS arm64 source:
  - `https://github.com/nilaoda/N_m3u8DL-RE/releases/download/v0.5.1-beta/N_m3u8DL-RE_v0.5.1-beta_osx-arm64_20251029.tar.gz`

Version at download time:

- `v0.5.1-beta`

SHA-256:

- `N_m3u8DL-RE-macos-x64`
  - `5C8C8B7F0794F9D4350CDCF2EB662993D8EC23A967C5E8B230A431144ECA87E3`
- `N_m3u8DL-RE-macos-arm64`
  - `90F5B7A86182C1C985EA842936CCB1E6313CD771231B9C7ADADE255AF74DEAD7`
