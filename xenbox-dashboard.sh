#!/bin/bash
# Open xenbox dashboard in local Chrome via SSH tunnel through the Pi
# Usage: ./xenbox-dashboard.sh
#
# NOTE: Bluetooth (Muse EEG) won't connect from your Mac — it's paired to
# the Pi's Chromium. All other UI, encoder values, and API calls work fine.

PI=xenbox@xenbox.local
PORTS="-L 3000:localhost:3000 -L 3001:localhost:3001 -L 8765:localhost:8765"

# Kill any existing tunnel on these ports
pkill -f "3000:localhost:3000" 2>/dev/null
sleep 0.5

echo "Opening SSH tunnel to xenbox dashboard via Pi..."
ssh -fNT $PORTS $PI

echo "Opening xenbox dashboard in Chrome..."
open -a "Google Chrome" "http://localhost:3000"
