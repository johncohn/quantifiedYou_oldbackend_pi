#!/bin/bash
# YouQuantified Kiosk Mode Setup Script
#
# Run this script on the Raspberry Pi to configure kiosk mode.
# Usage: sudo ./setup-kiosk-mode.sh
#
# This script:
# 1. Installs LED controller dependencies
# 2. Copies startup scripts to correct locations
# 3. Enables systemd services
# 4. Configures autostart

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="/home/xenbox"

echo "=========================================="
echo "YouQuantified Kiosk Mode Setup"
echo "=========================================="

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run with sudo"
    exit 1
fi

# Step 1: Install Python dependencies for LED controller
echo ""
echo "[1/5] Installing LED controller dependencies..."
pip3 install rpi_ws281x websockets || {
    echo "WARNING: Failed to install some packages"
}

# Step 2: Copy kiosk launcher script
echo ""
echo "[2/5] Installing kiosk launcher script..."
cp "$SCRIPT_DIR/start-kiosk.sh" "$USER_HOME/start-kiosk.sh"
chmod +x "$USER_HOME/start-kiosk.sh"
chown xenbox:xenbox "$USER_HOME/start-kiosk.sh"
echo "  Installed: $USER_HOME/start-kiosk.sh"

# Step 3: Install systemd services
echo ""
echo "[3/5] Installing systemd services..."

# LED Controller service
cp "$SCRIPT_DIR/yq-led-controller.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable yq-led-controller.service
echo "  Enabled: yq-led-controller.service"

# Step 4: Setup autostart for kiosk (using desktop entry method)
echo ""
echo "[4/5] Setting up kiosk autostart..."
mkdir -p "$USER_HOME/.config/autostart"
cp "$SCRIPT_DIR/yq-kiosk.desktop" "$USER_HOME/.config/autostart/"
chown -R xenbox:xenbox "$USER_HOME/.config/autostart"
echo "  Installed: $USER_HOME/.config/autostart/yq-kiosk.desktop"

# Step 5: Configure Chromium for persistent Bluetooth
echo ""
echo "[5/5] Configuring Chromium for persistent Bluetooth..."
CHROMIUM_PREFS_DIR="$USER_HOME/.config/chromium/Default"
mkdir -p "$CHROMIUM_PREFS_DIR"

# Note: Chromium preferences will be set via command line flags in start-kiosk.sh

# Summary
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Services installed:"
echo "  - yq-led-controller.service (LED status indicator)"
echo "  - yq-kiosk.desktop (autostart on login)"
echo ""
echo "To start services now (without reboot):"
echo "  sudo systemctl start yq-led-controller"
echo ""
echo "To test kiosk mode manually:"
echo "  $USER_HOME/start-kiosk.sh"
echo ""
echo "LED wiring:"
echo "  - WS2812B Data → GPIO18 (Pin 12)"
echo "  - WS2812B VCC  → 5V (Pin 2 or 4)"
echo "  - WS2812B GND  → GND (Pin 6)"
echo ""
echo "First-time Muse pairing:"
echo "  1. Connect via VNC or attach display"
echo "  2. Click 'Connect Muse' button"
echo "  3. Select your Muse from the picker"
echo "  4. After pairing, future connections are automatic"
echo ""
echo "Reboot to start in kiosk mode:"
echo "  sudo reboot"
echo ""
