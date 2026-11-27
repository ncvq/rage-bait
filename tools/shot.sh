#!/bin/sh
# Screenshot the game in headless Chrome via tools/preview.html (query options are listed at its top).
#   tools/shot.sh out.png "level=13"                 960x540 (the game at 2x)
#   tools/shot.sh out.png "cut=area2&t=6&mode=multi"
#   SIZE=844,390 DPR=3 tools/shot.sh phone.png "level=1&touch=1"
# Console output (errors, FLOW lines) goes to out.png.log. BUDGET = ms of virtual time to run first.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHROME=${CHROME:-google-chrome-stable}
"$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --allow-file-access-from-files --enable-logging=stderr --v=0 \
  --window-size="${SIZE:-960,540}" --force-device-scale-factor="${DPR:-1}" \
  --virtual-time-budget="${BUDGET:-2500}" --screenshot="$1" "file://$ROOT/tools/preview.html?$2" 2>&1 |
  grep -E "CONSOLE|PAGE ERROR" > "$1.log"
true
