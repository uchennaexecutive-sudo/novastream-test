# release.ps1 - Nova Stream release helper
# Usage: .\release.ps1 1.5.5 "Short changelog note"
#
# Auto-update contract for a Windows release:
# 1. package.json              -> app/package version for the JS project
# 2. package-lock.json         -> lockfile root version for repo consistency
# 3. src-tauri/tauri.conf.json -> packaged app version shown by Tauri
# 4. src-tauri/Cargo.toml      -> Rust/Tauri binary version
# 5. src/main.jsx              -> frontend APP_VERSION used by update checks
# 6. updates/latest.json        -> seeded locally before push/tag so the repo version stays aligned
# 7. .github/workflows/release.yml rewrites updates/latest.json after the tag build
#
# The updater works only if the built binary version and APP_VERSION match the tag.

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location 'c:\Users\uchen\nova-stream-dev-test'

$TargetVersion = $Version
$ReleaseRepo = 'uchennaexecutive-sudo/novastream-test'

if ($TargetVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semver format X.Y.Z. Received: $TargetVersion"
}

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $Path), $Content, $utf8NoBom)
}

function Update-FileText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Replacement,
    [Parameter(Mandatory = $true)][string]$VerificationText,
    [switch]$Multiline
  )

  $content = Get-Content -Raw -Path $Path
  $options = if ($Multiline) { [System.Text.RegularExpressions.RegexOptions]::Multiline } else { [System.Text.RegularExpressions.RegexOptions]::None }
  $updated = [System.Text.RegularExpressions.Regex]::Replace($content, $Pattern, $Replacement, $options)

  if ($updated -eq $content) {
    if ($content -match [System.Text.RegularExpressions.Regex]::Escape($VerificationText)) {
      return
    }

    throw "Expected pattern not found in $Path"
  }

  Write-Utf8NoBomFile -Path $Path -Content $updated

  $verified = Get-Content -Raw -Path $Path
  if ($verified -notmatch [System.Text.RegularExpressions.Regex]::Escape($VerificationText)) {
    throw "Verification failed for $Path. Expected to find: $VerificationText"
  }
}

function Update-PackageLockVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Version
  )

  $content = Get-Content -Raw -Path $Path
  $topLevelPattern = '(?s)\A(\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*")([^"]+)(")'
  $rootPackagePattern = '(?s)("packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*")([^"]+)(")'

  $topLevelReplacement = '${1}' + $Version + '${3}'
  $rootPackageReplacement = '${1}' + $Version + '${3}'

  $updatedTop = [System.Text.RegularExpressions.Regex]::Replace($content, $topLevelPattern, $topLevelReplacement, 1)
  if ($updatedTop -eq $content) {
    if ($content -match ('(?s)\A\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '"')) {
      $updatedTop = $content
    } else {
      throw "Failed to update top-level version in $Path"
    }
  }

  $updatedRoot = [System.Text.RegularExpressions.Regex]::Replace($updatedTop, $rootPackagePattern, $rootPackageReplacement, 1)
  if ($updatedRoot -eq $updatedTop) {
    if ($updatedTop -match ('(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '"')) {
      $updatedRoot = $updatedTop
    } else {
      throw "Failed to update root package version in $Path"
    }
  }

  Write-Utf8NoBomFile -Path $Path -Content $updatedRoot

  $verified = Get-Content -Raw -Path $Path
  if ($verified -notmatch ('(?s)\A\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '"')) {
    throw "Verification failed for top-level version in $Path"
  }

  if ($verified -notmatch ('(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '"')) {
    throw "Verification failed for root package version in $Path"
  }
}

function Update-LatestJsonManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Notes,
    [Parameter(Mandatory = $true)][string]$Repository
  )

  $manifest = [ordered]@{
    version = $Version
    notes = "v$Version - $Notes"
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{
      'windows-x86_64' = [ordered]@{
        url = "https://github.com/$Repository/releases/download/v$Version/NOVA-STREAM-$Version-portable.exe"
      }
      'darwin-universal' = [ordered]@{
        url = "https://github.com/$Repository/releases/download/v$Version/NOVA-STREAM-$Version-macos.dmg"
      }
    }
  }

  $json = $manifest | ConvertTo-Json -Depth 10
  Write-Utf8NoBomFile -Path $Path -Content $json

  $verified = Get-Content -Raw -Path $Path
  if ($verified -notmatch ('"version"\s*:\s*"' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '"')) {
    throw "Verification failed for $Path. Expected version $Version"
  }

  if ($verified -notmatch ('NOVA-STREAM-' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '-portable\.exe')) {
    throw "Verification failed for $Path. Expected Windows release URL for v$Version"
  }

  if ($verified -notmatch ('NOVA-STREAM-' + [System.Text.RegularExpressions.Regex]::Escape($Version) + '-macos\.dmg')) {
    throw "Verification failed for $Path. Expected macOS release URL for v$Version"
  }
}

Write-Host "`nPreparing Nova Stream v$TargetVersion..." -ForegroundColor Cyan
Write-Host "Updating version-bearing files required for release + auto-update:" -ForegroundColor Yellow
Write-Host " - package.json"
Write-Host " - package-lock.json"
Write-Host " - src-tauri/tauri.conf.json"
Write-Host " - src-tauri/Cargo.toml"
Write-Host " - src/main.jsx"
Write-Host " - updates/latest.json"
Write-Host ""

Update-FileText -Path 'package.json' `
  -Pattern '"version":\s*".*?"' `
  -Replacement ('"version": "{0}"' -f $TargetVersion) `
  -VerificationText ('"version": "{0}"' -f $TargetVersion)

Update-PackageLockVersion -Path 'package-lock.json' -Version $TargetVersion

Update-FileText -Path 'src-tauri/tauri.conf.json' `
  -Pattern '"version":\s*".*?"' `
  -Replacement ('"version": "{0}"' -f $TargetVersion) `
  -VerificationText ('"version": "{0}"' -f $TargetVersion)

Update-FileText -Path 'src-tauri/Cargo.toml' `
  -Pattern '^version = ".*?"' `
  -Replacement ('version = "{0}"' -f $TargetVersion) `
  -VerificationText ('version = "{0}"' -f $TargetVersion) `
  -Multiline

Update-FileText -Path 'src/main.jsx' `
  -Pattern "const APP_VERSION = '.*?'" `
  -Replacement ("const APP_VERSION = '{0}'" -f $TargetVersion) `
  -VerificationText ("const APP_VERSION = '{0}'" -f $TargetVersion)

Update-LatestJsonManifest -Path 'updates/latest.json' -Version $TargetVersion -Notes $Notes -Repository $ReleaseRepo

Write-Host "Version files updated and verified for v$TargetVersion." -ForegroundColor Green
Write-Host ""
Write-Host "Reminder:" -ForegroundColor Yellow
Write-Host " - updates/latest.json is pre-seeded here with the expected Windows release URL."
Write-Host " - The GitHub Actions release workflow rewrites updates/latest.json after the tag build."
Write-Host " - That manifest is what installed builds fetch to detect v$TargetVersion."
Write-Host ""

$blockedReleasePaths = @(
  '.claude/settings.local.json'
)

# 1. Pull latest remote (CI bot may have committed latest.json)
Write-Host "Pulling latest remote..." -ForegroundColor Yellow
git pull --rebase --autostash origin main
if ($LASTEXITCODE -ne 0) { throw 'Pull/rebase failed' }

# 2. Commit staged changes
Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A

$stagedFiles = git diff --cached --name-only
if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect staged files' }

if (-not $stagedFiles) {
  Write-Host "Nothing staged for release." -ForegroundColor DarkYellow
} else {
  Write-Host "Staged files for release:" -ForegroundColor Yellow
  $stagedFiles | ForEach-Object { Write-Host " - $_" }
}

$blockedMatches = @($stagedFiles | Where-Object { $blockedReleasePaths -contains $_ })
if ($blockedMatches.Count -gt 0) {
  Write-Host ""
  Write-Host "Blocked local-only files were staged and will be excluded automatically:" -ForegroundColor Yellow
  $blockedMatches | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
  Write-Host ""
  foreach ($path in $blockedMatches) {
    git restore --staged -- "$path"
    if ($LASTEXITCODE -ne 0) { throw "Failed to unstage blocked file: $path" }

    git restore -- "$path"
    if ($LASTEXITCODE -ne 0) { throw "Failed to restore blocked file: $path" }
  }

  $stagedFiles = git diff --cached --name-only
  if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect staged files after excluding blocked files' }

  Write-Host "Final staged files for release after exclusions:" -ForegroundColor Yellow
  if (-not $stagedFiles) {
    Write-Host " - none" -ForegroundColor DarkYellow
  } else {
    $stagedFiles | ForEach-Object { Write-Host " - $_" }
  }
}

git commit -m "v${TargetVersion}: $Notes"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nothing new to commit (already clean)" -ForegroundColor DarkYellow
}

# 3. Push main
Write-Host "`nPushing main..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "Push failed, trying rebase again..." -ForegroundColor DarkYellow
  git pull --rebase --autostash origin main
  git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Push failed' }
}

# 4. Delete old local tag if exists, create fresh, force-push
Write-Host "`nTagging v$TargetVersion..." -ForegroundColor Yellow
if ((git tag --list "v$TargetVersion")) {
  git tag -d "v$TargetVersion" | Out-Null
}
git tag "v$TargetVersion"
git push origin "v$TargetVersion" --force
if ($LASTEXITCODE -ne 0) { throw 'Tag push failed' }

Write-Host "`nv$TargetVersion pushed." -ForegroundColor Green
Write-Host "GitHub Actions will now:" -ForegroundColor Green
Write-Host " - build the Windows portable exe"
Write-Host " - publish the GitHub Release asset"
Write-Host " - rewrite updates/latest.json to point at the new asset"
Write-Host " - commit latest.json back to main"
Write-Host ""
Write-Host "Installed v1.5.0 builds will detect v$TargetVersion from updates/latest.json and download it automatically." -ForegroundColor Cyan
Write-Host "   https://github.com/uchennaexecutive-sudo/novastream-test/actions`n" -ForegroundColor DarkGray
