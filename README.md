# NOVA STREAM

Premium desktop streaming application built with **Tauri 2 + Vite + React**.

Nova Stream provides a fast, lightweight desktop experience for browsing and watching movies, series, animation, and anime with a modern UI and native performance.

---

# Features

- Native **desktop application**
- Ultra lightweight (**Tauri runtime**)
- Anime streaming with **AniList identity mapping**
- Multi-provider fallback system
- Built-in **native player window**
- Transparent immersive playback UI
- Fast search across multiple content types
- Auto-update system for Windows builds

---

# Supported Platforms

| Platform | Build Type |
|--------|--------|
| Windows | Portable `.exe` |
| macOS | `.app` bundle (zipped) |

Linux support may come later.

---

# Installation

## Windows

1. Go to the **Releases** page.
2. Download:

NOVA-STREAM-x.x.x-portable.exe

3. Run the file directly.
No installation required.

## macOS

1. Download:

NOVA-STREAM-x.x.x-macos.app.zip

2. Extract the zip.

You will get:

NOVA STREAM.app

3. Move the app to **Applications**.
4. First launch (important):

Right-click the app → **Open** → **Open**

This is required because the app is currently **unsigned**.

After the first launch, macOS will remember the permission.

# How the Native Player Works

Nova Stream opens video playback inside a **separate transparent native window** for a more immersive viewing experience.

The player window:

- matches the main window size
- removes window decorations
- stays on top
- uses transparency for UI blending

On Windows the player window is attached to the main window using OS-level window ownership.

On macOS the same effect is achieved using parent window handling.

# Tech Stack

- **Tauri 2**
- **Rust**
- **React**
- **Vite**
- **TailwindCSS**
- **AniList API**
- Custom anime provider backend

---

# Development

Clone the repo:
bash
git clone https://github.com/uchennaexecutive-sudo/novastream-test
cd novastream-test

Install dependencies:
bash
npm install

Run development build:
bash
npm run tauri dev

Build production app:

npm run tauri build

# Releases

Releases are automated using **GitHub Actions**.

Each release produces:

| File       | Purpose                  |
| ---------- | ------------------------ |
| .exe     | Windows portable version |
| .app.zip | macOS application bundle |

# Current Status

Project is under active development.

Focus areas currently include:

* improving anime provider reliability
* improving fallback stream logic
* stabilizing playback across different hosts
* expanding cross-platform support

# License

Private project – all rights reserved

# After adding it

Commit normally:

git add README.md
git commit -m "add project README"
git push

