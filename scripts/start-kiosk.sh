#!/bin/bash
# YouQuantified Kiosk Mode Launcher
#
# This script launches Chromium in kiosk mode pointing to the
# YouQuantified visualization. Designed for headless Raspberry Pi operation.
#
# Install location: /home/xenbox/start-kiosk.sh

set -e

# Configuration
KIOSK_URL="http://192.168.2.2:3000/kiosk/cmk8yniz80002jibx3fh7j9ax"
LOG_FILE="/home/xenbox/kiosk.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting YouQuantified Kiosk Mode..."

# Wait for display
log "Waiting for display..."
while [ -z "$DISPLAY" ]; do
    export DISPLAY=:0
    sleep 1
done
log "Display available: $DISPLAY"

# Wait for network (backend needs to be reachable)
log "Waiting for backend service..."
MAX_WAIT=60
WAITED=0
while ! curl -s "http://192.168.2.2:3001/api/graphql" > /dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $WAITED -ge $MAX_WAIT ]; then
        log "WARNING: Backend not responding after ${MAX_WAIT}s, launching anyway..."
        break
    fi
done
log "Backend service ready (waited ${WAITED}s)"

# Kill any existing Chromium instances
pkill -f chromium || true
sleep 2

log "Launching Chromium in kiosk mode..."
log "URL: $KIOSK_URL"

# Launch Chromium with kiosk flags
# --password-store=basic prevents keyring password prompt
# --enable-features=WebBluetoothNewPermissionsBackend enables persistent Bluetooth pairing
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
    >> "$LOG_FILE" 2>&1 &

CHROMIUM_PID=$!
log "Chromium launched with PID: $CHROMIUM_PID"

# Monitor Chromium and restart if it crashes
while true; do
    if ! kill -0 $CHROMIUM_PID 2>/dev/null; then
        log "Chromium exited, restarting in 5 seconds..."
        sleep 5
        exec "$0"  # Restart this script
    fi
    sleep 10
done
