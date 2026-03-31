#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_APP=""

while IFS= read -r -d '' candidate; do
  SRC_APP="$candidate"
  break
done < <(find "$SCRIPT_DIR" -maxdepth 1 -mindepth 1 -type d -name "*.app" -print0)

if [ -z "$SRC_APP" ]; then
  osascript -e 'display dialog "No app bundle was found next to Install First.command." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

APP_NAME="$(basename "$SRC_APP")"
DST_APP="/Applications/$APP_NAME"

if ! osascript "$SRC_APP" "$DST_APP" <<'APPLESCRIPT'
on run argv
  set srcPath to item 1 of argv
  set dstPath to item 2 of argv
  do shell script "rm -rf " & quoted form of dstPath & " && ditto " & quoted form of srcPath & " " & quoted form of dstPath & " && xattr -cr " & quoted form of dstPath with administrator privileges
end run
APPLESCRIPT
then
  osascript -e 'display dialog "Install was canceled or failed before NOVA STREAM could be prepared." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

open "$DST_APP"
