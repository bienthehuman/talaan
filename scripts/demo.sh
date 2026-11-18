#!/usr/bin/env bash
# Record the scripted demo walkthrough (e2e/demo/demo.spec.ts) and turn it into GIFs for the README.
#
#   bash scripts/demo.sh
#
# Needs the compose stack running with FAULT_INJECTION=1 and the demo logins seeded:
#   FAULT_INJECTION=1 docker compose up -d --build --wait && docker compose exec -T server python manage.py seed_demo
# Output: docs/media/*.gif (and .webm next to them, not committed). Converting uses ffmpeg from Docker (jrottenberg/ffmpeg).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p docs/media
(
  cd e2e
  npm ci --silent
  npx playwright install chromium >/dev/null
  rm -rf demo-output
  DEMO_VIDEO=1 npx playwright test -c playwright.demo.config.ts
)

copy() { # test-folder-pattern name
  local video
  video="$(find e2e/demo-output -path "*$1*" -name 'video.webm' | head -1)"
  [ -n "$video" ] || { echo "no video for $1" >&2; exit 1; }
  cp "$video" "docs/media/$2.webm"
}
copy "offline-work-survives" offline-and-lost-response
copy "two-phones-change" two-device-conflict

for name in offline-and-lost-response two-device-conflict; do
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/docs/media:/media" jrottenberg/ffmpeg:7-alpine -y -loglevel error \
    -i "/media/$name.webm" \
    -vf "fps=8,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 "/media/$name.gif"
  ls -la "docs/media/$name.gif"
done
