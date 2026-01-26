# YouQuantified on Raspberry Pi 5 - Current Status

**Date:** 2026-01-10
**Migration:** From Raspberry Pi 4 working installation
**Status:** ✅ **FULLY OPERATIONAL**

---

## Current Status Summary

### ✅ FULLY WORKING
- **Fresh Code:** Cloned from Pi 4 working version (commit 559ecf8)
- **Backend Service:** Running on port 3001 (SQLite dev mode)
- **Frontend Service:** Running on port 3000
- **TP-Link UB500 Bluetooth:** Fully functional (hci1 ONLY adapter)
- **Built-in Bluetooth:** Completely disabled (blacklisted kernel module)
- **ERTM:** Permanently disabled via boot parameters
- **Muse Connection:** ✅ Stable - Connects and stays connected with full EEG data
- **xenbox_eeg.js:** Ready to use with 5 EEG parameters configured
- **Web Bluetooth API:** Working with experimental bluetoothd
- **Auto-start Services:** All services enabled and working

### Critical Success
**🎉 Pi 5 with TP-Link UB500 + Muse is FULLY OPERATIONAL** - The Muse connects reliably via Web Bluetooth and maintains a stable connection even when worn on the head with electrodes making skin contact. The TP-Link adapter successfully handles the full Muse data bandwidth that caused the Pi 5's built-in Bluetooth to fail.

---

## Hardware Configuration

- **Device:** Raspberry Pi 5
- **Hostname:** `xenbox.local` (via mDNS/Avahi over WiFi)
- **Built-in Bluetooth:** BCM (disabled via rfkill)
- **External Bluetooth:** TP-Link UB500 Adapter (hci1) - USB Bus
- **EEG Headset:** Muse 2 (to be tested)

---

## Software Configuration

### Bluetooth Adapter Configuration

**CRITICAL:** Pi 5's built-in Bluetooth cannot handle Muse's full data bandwidth. The TP-Link UB500 adapter is required and must be the ONLY Bluetooth adapter present in the system.

**Active Adapter:** hci1 (TP-Link UB500 - ONLY adapter)
```bash
hci1:   Type: Primary  Bus: USB
        BD Address: CC:BA:BD:6A:A2:20
        Status: UP RUNNING
        Manufacturer: Realtek Semiconductor Corporation (93)
```

**Built-in Bluetooth:** Completely disabled via kernel module blacklist
```bash
# Built-in Bluetooth module is blacklisted and not loaded
# File: /etc/modprobe.d/blacklist-pi5-bluetooth.conf
blacklist hci_uart
```

### Persistent Bluetooth Configuration

All settings automatically applied on boot:

**1. ERTM Disabled (Boot Parameter)**
```bash
# File: /boot/firmware/cmdline.txt
# Added: bluetooth.disable_ertm=1
# Required for Muse compatibility
```

**2. bluetoothd with Experimental Features**
```bash
# File: /etc/systemd/system/bluetooth.service.d/override.conf
[Service]
ExecStart=
ExecStart=/usr/libexec/bluetooth/bluetoothd --experimental

# REQUIRED for Web Bluetooth API to work in Chrome
```

**3. Bluetooth Connection Parameters**
```bash
# File: /etc/bluetooth/main.conf
[General]
ControllerMode = dual

[LE]
MinConnectionInterval = 24
MaxConnectionInterval = 40
ConnectionLatency = 4
ConnectionSupervisionTimeout = 720
Autoconnect = true

# Tolerant of RF interference when wearing Muse headset
```

**4. Bluetooth Adapter Initialization**
```bash
# Service: /etc/systemd/system/bluetooth-config.service
# Ensures TP-Link adapter is unblocked and active on boot
sudo systemctl status bluetooth-config.service
```

### System Services

#### Backend Service
**Location:** `/etc/systemd/system/youquantified-backend.service`

```bash
# Control commands
sudo systemctl status youquantified-backend
sudo systemctl restart youquantified-backend
sudo systemctl stop youquantified-backend
sudo systemctl start youquantified-backend

# View logs
sudo journalctl -u youquantified-backend -f
tail -f ~/yq-backend.log
```

#### Frontend Service
**Location:** `/etc/systemd/system/youquantified-frontend.service`

```bash
# Control commands
sudo systemctl status youquantified-frontend
sudo systemctl restart youquantified-frontend
sudo systemctl stop youquantified-frontend
sudo systemctl start youquantified-frontend

# View logs
sudo journalctl -u youquantified-frontend -f
tail -f ~/yq-frontend.log
```

### Environment Configuration

#### Frontend Environment (`~/quantifiedYou_oldbackend_pi/frontend/.env`)
```bash
REACT_APP_UPLOAD_URI_ENDPOINT_DEV="http://localhost:3001/api/graphql"
REACT_APP_UPLOAD_URI_ENDPOINT="http://xenbox.local:3001/api/graphql"
REACT_APP_COLLAB_ENDPOINT_DEV="ws://localhost:3001/collab"
REACT_APP_COLLAB_ENDPOINT="ws://xenbox.local:3001/collab"
GENERATE_SOURCEMAP=false
```

**Note:** Uses `xenbox.local` (mDNS hostname) so the address stays constant regardless of network/IP changes.

#### Backend Environment (`~/quantifiedYou_oldbackend_pi/keystone/.env`)
```bash
DATABASE_URL=file:./keystone.db
SESSION_SECRET=youquantified_pi5_session_secret
FRONTEND_URL_DEV=http://localhost:3000
FRONTEND_URL=http://xenbox.local:3000
NODE_ENV=development
ASSET_BASE_URL_DEV=http://localhost:3001
ASSET_BASE_URL=http://xenbox.local:3001
PORT=3001
```

**Important:** Uses SQLite (`keystone.db`) in development mode for memory efficiency.

---

## Web Bluetooth Setup

### Chrome Flag Configuration (REQUIRED)

**Status:** ✅ Configured and working

1. Open Chrome/Chromium on the Pi
2. Navigate to: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
3. Add: `http://xenbox.local:3000`
4. Change dropdown to **"Enabled"**
5. Click "Relaunch"
6. **May require 2-3 relaunches** before Muse button becomes active

### Accessing the Application

**Always use:** `http://xenbox.local:3000` (not localhost:3000)

This ensures:
- Web Bluetooth API works with the Chrome flag
- CORS headers match expected origin
- Frontend can reach backend API

### Muse Connection Procedure

1. Power on Muse headset (LED should blink)
2. Navigate to `http://xenbox.local:3000` in Chrome
3. Login to your account
4. Go to Data tab
5. Click "Muse" button
6. Browser pairing dialog will appear
7. Select "Muse-01E1" (or your Muse device name)
8. Click "Pair"
9. Connection establishes immediately
10. Put headset on - connection remains stable even with electrodes touching skin

**Note:** Unlike Pi 5's built-in Bluetooth, the TP-Link adapter maintains connection when electrodes make skin contact and full EEG data starts streaming.

---

## Key Differences from Pi 4

### Bluetooth Configuration
- **Pi 4:** Uses built-in Bluetooth (BCM43455 on UART) - works perfectly with Muse
- **Pi 5:** Uses external TP-Link UB500 adapter (USB) - **REQUIRED**
  - Built-in Bluetooth **completely disabled** (kernel module blacklisted)
  - Pi 5's built-in Bluetooth cannot handle Muse's full data bandwidth
  - Disconnects when electrodes touch skin and full EEG data starts streaming
  - TP-Link UB500 successfully handles high-bandwidth BLE data
  - `bluetoothd --experimental` required for Web Bluetooth API
  - Only one Bluetooth adapter can be present (confusion with multiple adapters)

### Bluetooth Technical Details
- **Pi 4 Built-in:** BCM43455, Bluetooth 5.0, handles Muse bandwidth natively
- **Pi 5 Built-in:** BCM, insufficient bandwidth for Muse full data stream
- **TP-Link UB500:** Realtek chip, Bluetooth 5.1, high-bandwidth capable
- **Critical:** Built-in adapter must be blacklisted, not just disabled

### IP Address
- **Pi 4:** 192.168.2.3 (old Ethernet setup)
- **Pi 5:** `xenbox.local` (mDNS over WiFi)

### Code Version
- Both now running identical code (commit 559ecf8)
- Includes xenbox_eeg.js with CONFIG object and comprehensive documentation
- Same frontend, backend, and visual code

### Power Requirements
- **Pi 5:** Requires robust 5V/5A power supply
- USB peripherals like TP-Link adapter can cause low voltage warnings
- Insufficient power can cause Bluetooth instability

---

## Backup

Original Pi 5 installation backed up to:
```
~/pi5_backup_20260110_143923.tar.gz (775MB)
```

---

## Setup Complete

All configuration is persistent across reboots:
- ✅ TP-Link UB500 adapter configured as only Bluetooth device
- ✅ Built-in Bluetooth blacklisted
- ✅ ERTM disabled in boot parameters
- ✅ bluetoothd --experimental enabled
- ✅ Bluetooth connection parameters optimized
- ✅ Frontend and backend services auto-start
- ✅ Web Bluetooth API functional
- ✅ Muse connection stable with full EEG data streaming
- ✅ xenbox_eeg.js ready with 5 EEG parameters configured

---

## Troubleshooting

### If Muse won't connect:

**1. Verify only TP-Link adapter is present:**
```bash
hciconfig
# Should show ONLY hci1 (TP-Link), no hci0

lsusb | grep TP-Link
# Should show: 2357:0604 TP-Link UB500 Adapter
```

**2. Check critical settings:**
```bash
# ERTM must be disabled
cat /sys/module/bluetooth/parameters/disable_ertm
# Must output: Y

# bluetoothd must have --experimental flag
ps aux | grep bluetoothd
# Must show: /usr/libexec/bluetooth/bluetoothd --experimental

# Built-in Bluetooth must be blacklisted
cat /etc/modprobe.d/blacklist-pi5-bluetooth.conf
# Must show: blacklist hci_uart
```

**3. Verify TP-Link is powered and working:**
```bash
sudo hciconfig hci1 up
bluetoothctl list
# Should show only one controller (CC:BA:BD:6A:A2:20)

# Test scanning
timeout 8 bash -c '(echo "scan on"; sleep 7; echo "devices") | bluetoothctl' | grep Muse
# Should find Muse-01E1
```

**4. If Chrome says "turn on bluetooth":**
```bash
# Close Chrome completely
# Verify bluetoothd experimental is running
sudo systemctl restart bluetooth
sleep 3
sudo hciconfig hci1 up
# Reopen Chrome
```

**5. If built-in Bluetooth reappears after reboot:**
```bash
# Verify blacklist is in place
cat /etc/modprobe.d/blacklist-pi5-bluetooth.conf

# Remove module if loaded
sudo rmmod hci_uart btbcm

# Rebuild initramfs
sudo update-initramfs -u

# Reboot
sudo reboot
```

### If Muse connects but disconnects when wearing it:

**This indicates the built-in Bluetooth is being used instead of TP-Link.**

The built-in adapter cannot handle Muse's full data bandwidth and disconnects when electrodes touch skin. Verify:
```bash
# Only hci1 should exist
hciconfig
# If hci0 appears, built-in is not properly disabled

# Double-check blacklist
cat /etc/modprobe.d/blacklist-pi5-bluetooth.conf

# Remove module and reboot
sudo rmmod hci_uart btbcm
sudo reboot
```

### If Web Bluetooth pairing dialog shows no devices:

```bash
# Ensure bluetoothd has experimental flag
sudo systemctl cat bluetooth.service | grep experimental
# Must show: ExecStart=/usr/libexec/bluetooth/bluetoothd --experimental

# If missing, reinstall override:
sudo mkdir -p /etc/systemd/system/bluetooth.service.d
sudo bash -c 'cat > /etc/systemd/system/bluetooth.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/libexec/bluetooth/bluetoothd --experimental
EOF'
sudo systemctl daemon-reload
sudo systemctl restart bluetooth
```

### If services fail to start:
```bash
# Check backend logs
sudo journalctl -u youquantified-backend -n 50

# Check frontend logs
sudo journalctl -u youquantified-frontend -n 50

# Rebuild if needed
cd ~/quantifiedYou_oldbackend_pi/frontend
npm run build
```

### Complete Reset Procedure:

If nothing works, reset Bluetooth configuration:
```bash
# 1. Stop services
sudo systemctl stop bluetooth

# 2. Remove both adapters
sudo hciconfig hci0 down 2>/dev/null
sudo hciconfig hci1 down 2>/dev/null
sudo rmmod hci_uart btbcm 2>/dev/null

# 3. Verify TP-Link is plugged in
lsusb | grep TP-Link

# 4. Restart Bluetooth
sudo systemctl restart bluetooth
sleep 3

# 5. Bring up TP-Link only
sudo hciconfig hci1 up

# 6. Test
bluetoothctl list
# Should show only one controller

# 7. If hci0 appears, blacklist is broken
cat /etc/modprobe.d/blacklist-pi5-bluetooth.conf
# Recreate if needed and reboot
```
