# release.ps1 - Nova Stream release helper
# Usage: .\release.ps1 1.5.1 "Short changelog note"
#
# Auto-update contract for a Windows release:
# 1. package.json              -> app/package version for the JS project
# 2. package-lock.json         -> lockfile root version for repo consistency
# 3. src-tauri/tauri.conf.json -> packaged app version shown by Tauri
# 4. src-tauri/Cargo.toml      -> Rust/Tauri binary version
# 5. src/main.jsx              -> frontend APP_VERSION used by update checks
# 6. .github/workflows/release.yml writes updates/latest.json after the tag build
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

if ($TargetVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semver format X.Y.Z. Received: $TargetVersion"
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

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $Path), $updated, $utf8NoBom)

  $verified = Get-Content -Raw -Path $Path
  if ($verified -notmatch [System.Text.RegularExpressions.Regex]::Escape($VerificationText)) {
    throw "Verification failed for $Path. Expected to find: $VerificationText"
  }
}

Write-Host "`nPreparing Nova Stream v$TargetVersion..." -ForegroundColor Cyan
Write-Host "Updating version-bearing files required for release + auto-update:" -ForegroundColor Yellow
Write-Host " - package.json"
Write-Host " - package-lock.json"
Write-Host " - src-tauri/tauri.conf.json"
Write-Host " - src-tauri/Cargo.toml"
Write-Host " - src/main.jsx"
Write-Host ""

Update-FileText -Path 'package.json' `
  -Pattern '"version":\s*".*?"' `
  -Replacement ('"version": "{0}"' -f $TargetVersion) `
  -VerificationText ('"version": "{0}"' -f $TargetVersion)

Update-FileText -Path 'package-lock.json' `
  -Pattern '"version":\s*".*?"' `
  -Replacement ('"version": "{0}"' -f $TargetVersion) `
  -VerificationText ('"version": "{0}"' -f $TargetVersion)

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

Write-Host "Version files updated and verified for v$TargetVersion." -ForegroundColor Green
Write-Host ""
Write-Host "Reminder:" -ForegroundColor Yellow
Write-Host " - updates/latest.json is NOT edited here."
Write-Host " - The GitHub Actions release workflow rewrites updates/latest.json after the tag build."
Write-Host " - That manifest is what installed builds fetch to detect v$TargetVersion."
Write-Host ""

# 1. Pull latest remote (CI bot may have committed latest.json)
Write-Host "Pulling latest remote..." -ForegroundColor Yellow
git pull --rebase --autostash origin main
if ($LASTEXITCODE -ne 0) { throw 'Pull/rebase failed' }

# 2. Commit staged changes
Write-Host "`nCommitting..." -ForegroundColor Yellow
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src/main.jsx
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
