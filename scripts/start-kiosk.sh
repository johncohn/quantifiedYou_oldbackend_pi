#!/bin/bash
# YouQuantified Kiosk Mode Launcher

KIOSK_URL="http://xenbox.local:3000/kiosk/cmk8yniz80002jibx3fh7j9ax"
LOG_FILE="/home/xenbox/kiosk.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

export DISPLAY=:0
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

log "Starting YouQuantified Kiosk Mode..."

# Wait for labwc compositor to be ready
log "Waiting for labwc compositor..."
WAITED=0
while ! pgrep -x labwc > /dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge 60 ]; then
        log "WARNING: labwc not found after 60s"
        break
    fi
done
# Extra settle time for compositor to fully initialize
sleep 5
log "Compositor ready (waited ${WAITED}s + 5s settle)"

# Wait for backend blob
log "Waiting for backend..."
WAITED=0
while ! curl -sf "http://xenbox.local:3001/code/blob-jCTLjHalgu97" > /dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge 90 ]; then
        log "WARNING: Backend not ready after 90s"
        break
    fi
done
log "Backend ready (waited ${WAITED}s)"

# Wait for frontend
WAITED=0
while ! curl -sf "http://localhost:3000/" > /dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge 30 ]; then break; fi
done
log "Frontend ready (waited ${WAITED}s)"

# Kill any leftover Chromium and clear crash state
pkill -f chromium 2>/dev/null || true
sleep 2
rm -rf ~/.config/chromium/Singleton* 2>/dev/null || true

while true; do
    log "Launching Chromium..."
    chromium \
        --password-store=basic \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --disable-restore-session-state \
        --disable-session-crashed-bubble \
        --disable-component-update \
        --check-for-update-interval=31536000 \
        --enable-features=WebBluetooth,WebBluetoothNewPermissionsBackend \
        --enable-experimental-web-platform-features \
        --unsafely-treat-insecure-origin-as-secure="http://xenbox.local:3000" \
        --autoplay-policy=no-user-gesture-required \
        --disable-background-networking \
        --disable-sync \
        --disable-translate \
        --disable-features=TranslateUI \
        --no-first-run \
        --start-fullscreen \
        --window-size=1920,1080 \
        --window-position=0,0 \
        "$KIOSK_URL" \
        >> "$LOG_FILE" 2>&1

    log "Chromium exited, restarting in 5 seconds..."
    pkill -f chromium 2>/dev/null || true
    sleep 5
done
