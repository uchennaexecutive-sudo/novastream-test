# release.ps1 - Nova Stream release helper
# Usage: .\release.ps1 1.0.8 "Short changelog note"

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes
)

Set-Location c:\Users\uchen\nova-stream-dev-test

$TargetVersion = if ($args.Count -gt 0 -and $args[0]) { $args[0] } else { $Version }

Write-Host "`nBumping version files to v$TargetVersion..." -ForegroundColor Yellow
(Get-Content package.json) -replace '"version": ".*"', ('"version": "{0}"' -f $TargetVersion) | Set-Content package.json
(Get-Content src-tauri/tauri.conf.json) -replace '"version": ".*"', ('"version": "{0}"' -f $TargetVersion) | Set-Content src-tauri/tauri.conf.json
(Get-Content src-tauri/Cargo.toml) -replace '^version = ".*"', ('version = "{0}"' -f $TargetVersion) | Set-Content src-tauri/Cargo.toml
(Get-Content src/main.jsx) -replace "const APP_VERSION = '.*'", ("const APP_VERSION = '{0}'" -f $TargetVersion) | Set-Content src/main.jsx

Write-Host "`nReleasing Nova Stream v$TargetVersion..." -ForegroundColor Cyan

# 1. Pull latest remote (CI bot may have committed latest.json)
Write-Host "`nPulling latest remote..." -ForegroundColor Yellow
git pull --rebase --autostash origin main
if ($LASTEXITCODE -ne 0) { Write-Host "Pull/rebase failed" -ForegroundColor Red; exit 1 }

# 2. Commit staged changes
Write-Host "`nCommitting..." -ForegroundColor Yellow
git add -A
git commit -m "v${TargetVersion}: $Notes"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing new to commit (already clean)" -ForegroundColor DarkYellow }

# 3. Push main
Write-Host "`nPushing main..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "Push failed, trying rebase again..." -ForegroundColor DarkYellow
  git pull --rebase --autostash origin main
  git push origin main
  if ($LASTEXITCODE -ne 0) { Write-Host "Push failed" -ForegroundColor Red; exit 1 }
}

# 4. Delete old local tag if exists, create fresh, force-push
Write-Host "`nTagging v$TargetVersion..." -ForegroundColor Yellow
git tag -d "v$TargetVersion" 2>$null
git tag "v$TargetVersion"
git push origin "v$TargetVersion" --force
if ($LASTEXITCODE -ne 0) { Write-Host "Tag push failed" -ForegroundColor Red; exit 1 }

Write-Host "`nv$TargetVersion pushed! CI is now building." -ForegroundColor Green
Write-Host "   https://github.com/uchennaexecutive-sudo/novastream-test/actions`n" -ForegroundColor DarkGray
