#!/bin/bash
# Open Bela IDE in Chrome via SSH tunnel through the Pi
# Usage: ./bela-ide.sh

PI=xenbox@192.168.68.126
PORTS="-L 8080:192.168.7.2:80 -L 3000:192.168.7.2:3000 -L 40100:192.168.7.2:40100"

# Kill any existing tunnel on these ports
pkill -f "8080:192.168.7.2:80" 2>/dev/null
sleep 0.5

echo "Opening SSH tunnel to Bela via Pi..."
ssh -fNT $PORTS $PI

echo "Opening Bela IDE in Chrome..."
open -a "Google Chrome" "http://localhost:8080?port=8080"
