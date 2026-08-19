#!/bin/sh
set -eu

URL="${SPECTER_KIOSK_URL:-http://127.0.0.1:8765}"

wait_for_ui() {
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS "$URL" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
}

find_chromium() {
  if command -v chromium-browser >/dev/null 2>&1; then
    command -v chromium-browser
    return 0
  fi
  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return 0
  fi
  echo "chromium-browser or chromium not found" >&2
  return 1
}

wait_for_ui

xset s off >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true

if command -v matchbox-window-manager >/dev/null 2>&1; then
  matchbox-window-manager -use_titlebar no >/dev/null 2>&1 &
fi

CHROMIUM="$(find_chromium)"
exec "$CHROMIUM" \
  --kiosk "$URL" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --touch-events=enabled \
  --overscroll-history-navigation=0 \
  --force-device-scale-factor=1 \
  --check-for-update-interval=31536000 \
  --disable-features=TranslateUI \
  --window-size=1024,600 \
  --window-position=0,0
