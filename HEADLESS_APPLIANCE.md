# YouQuantified Headless Appliance Architecture

**Date:** 2026-01-25
**Status:** Fully Operational

This document describes the complete architecture for running YouQuantified as a headless EEG-controlled audio effects appliance.

---

## Overview

The system creates a real-time biofeedback loop:
1. **Muse EEG Headset** captures brainwave data (Alpha, Beta, Theta, Gamma)
2. **Raspberry Pi 5** processes EEG and runs the visualization dashboard
3. **Bela GEM** receives MIDI CC messages and applies audio effects

Key innovations:
- **Automatic Muse connection** without user interaction after initial pairing
- **Headset worn detection** via PPG heart rate - MIDI is suppressed when headset not worn

---

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HEADLESS APPLIANCE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    Bluetooth    ┌────────────────────────────────────────┐ │
│  │   Muse 2    │ ──────────────► │           Raspberry Pi 5               │ │
│  │  EEG Headset│   (TP-Link      │                                        │ │
│  │             │    UB500)       │  ┌─────────────────────────────────┐   │ │
│  └─────────────┘                 │  │  Chromium (Kiosk Mode)          │   │ │
│                                  │  │                                  │   │ │
│                                  │  │  ┌────────────────────────────┐ │   │ │
│                                  │  │  │ KioskView.js               │ │   │ │
│                                  │  │  │  └─ MuseConnectButton.js   │ │   │ │
│                                  │  │  │  └─ KioskAutoMapper.js     │ │   │ │
│                                  │  │  │  └─ kiosk-muse.js          │ │   │ │
│                                  │  │  └────────────────────────────┘ │   │ │
│                                  │  │                                  │   │ │
│                                  │  │  ┌────────────────────────────┐ │   │ │
│                                  │  │  │ xenbox_eeg.js (p5.js)      │ │   │ │
│                                  │  │  │  - EEG visualization       │ │   │ │
│                                  │  │  │  - MIDI CC output          │ │   │ │
│                                  │  │  │  - Tone.js audio           │ │   │ │
│                                  │  │  └────────────────────────────┘ │   │ │
│                                  │  └─────────────────────────────────┘   │ │
│                                  └────────────────────────────────────────┘ │
│                                           │                                  │
│                                           │ USB-MIDI                         │
│                                           ▼                                  │
│                                  ┌────────────────────────────────────────┐ │
│                                  │           Bela GEM                     │ │
│                                  │                                        │ │
│                                  │  ┌─────────────────────────────────┐   │ │
│                                  │  │ midi-chorus/_main.pd            │   │ │
│                                  │  │  - Stereo chorus effect         │   │ │
│                                  │  │  - MIDI CC control              │   │ │
│                                  │  │  - CC4 = Mix (from Alpha EEG)   │   │ │
│                                  │  └─────────────────────────────────┘   │ │
│                                  │                                        │ │
│                                  │  Audio In ◄── Guitar/Instrument       │ │
│                                  │  Audio Out ──► Amp/Speakers           │ │
│                                  └────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### EEG to Audio Pipeline

```
Muse Headset
    │
    │ Bluetooth LE (5 EEG bands @ 10Hz)
    ▼
kiosk-muse.js (KioskMuseManager)
    │
    │ Calculate band powers via FFT (EEG)
    │ Calculate heart rate via PPG peaks
    │ Determine isWorn state (HR 40-200 BPM = worn)
    │ Dispatch to Redux store
    ▼
KioskAutoMapper.js
    │
    │ Normalize EEG values (0-1)
    │ Pass HR and isWorn directly
    │ Map to visualization parameters
    ▼
xenbox_eeg.js (p5.js visualization)
    │
    │ 1. Display EEG bands on histogram
    │ 2. Display HR and worn status on dashboard
    │ 3. Calculate relative power (alpha_rel = alpha / sum)
    │ 4. Track running mean for adaptive threshold
    │ 5. Apply sigmoid: chorus_wet = 1 / (1 + exp(-smoothness * deviation * sensitivity))
    │ 6. IF WORN: Send MIDI CC4 = chorus_wet * 127
    │    IF NOT WORN: Send MIDI CC4 = 0 (suppress)
    ▼
Bela GEM (Pure Data)
    │
    │ Receive CC4 on MIDI channel 0
    │ Apply to chorus wet/dry mix
    ▼
Audio Output (Guitar with EEG-controlled chorus)
```

### Biofeedback Loop

| Brain State | Alpha Level | Chorus Effect |
|-------------|-------------|---------------|
| Relaxed/Flow | High (above personal mean) | More chorus (wet) |
| Stressed/Active | Low (below personal mean) | Less chorus (dry) |

The sigmoid function with adaptive threshold creates smooth transitions centered on your personal baseline, rewarding flow states with richer audio.

---

## File Reference

### Frontend (React/Redux)

| File | Purpose |
|------|---------|
| `frontend/src/components/kiosk/KioskView.js` | Main kiosk view - no auth required, full-screen visualization |
| `frontend/src/components/kiosk/MuseConnectButton.js` | Connection UI - large button when disconnected, status indicator when connected |
| `frontend/src/components/kiosk/KioskAutoMapper.js` | Auto-maps Muse band powers to visualization parameters |
| `frontend/src/utility/kiosk-muse.js` | **Core Muse manager** - handles Web Bluetooth, auto-reconnect, advertisement watching |

### Visualization (p5.js)

| File | Purpose |
|------|---------|
| `xenbox_eeg.js` | Main visualization - EEG display, MIDI output, Tone.js audio effects |
| Location in Keystone: `keystone/public/code/blob-jCTLjHalgu97` | Deployed visualization code |

### Bela (Pure Data)

| File | Purpose |
|------|---------|
| `bela/midi-chorus/_main.pd` | Main patch - MIDI input, test tone, scope output |
| `bela/midi-chorus/chorus-stereo~.pd` | Stereo chorus abstraction |
| `bela/README.md` | Bela project documentation |

### Scripts

| File | Purpose |
|------|---------|
| `scripts/start-kiosk.sh` | Chromium kiosk launcher with auto-restart |
| `scripts/yq-kiosk.desktop` | Desktop autostart entry |
| `scripts/yq-kiosk.service` | systemd service for kiosk |
| `scripts/muse_headless.py` | Alternative Python Muse service (experimental) |

---

## Key Technical Achievements

### 1. Auto-Connect Without User Gesture

Web Bluetooth normally requires a user click for `requestDevice()`. The solution:

```javascript
// kiosk-muse.js - tryAutoConnect()

// 1. Get previously paired devices (no gesture needed!)
const devices = await navigator.bluetooth.getDevices();

// 2. Find the Muse device
const museDevice = devices.find(d => d.name?.toLowerCase().includes('muse'));

// 3. CRITICAL: Watch for advertisements before connecting
await museDevice.watchAdvertisements({ signal: abortController.signal });

// 4. Wait for advertisement (Muse must be powered on)
await advertisementReceived;

// 5. Connect using stored device reference (no gesture needed!)
await this.device.gatt.connect();
```

**Requirements:**
- Chrome flag: `--enable-features=WebBluetooth,WebBluetoothNewPermissionsBackend`
- Initial manual pairing (one-time setup)
- Muse must be powered on for advertisement

### 2. Adaptive Sigmoid Threshold

The chorus effect responds to **deviation from your personal baseline**, not absolute values:

```javascript
// xenbox_eeg.js

// Track running mean (your personal baseline)
alphaMean += (alpha_rel - alphaMean) / alphaN;

// Calculate deviation from baseline
const alphaDeviation = alpha_rel - alphaMean;

// Sigmoid centered at 0 (deviation)
// Positive deviation = above baseline = high output
// Negative deviation = below baseline = low output
const chorus_wetVal = 1 / (1 + Math.exp(-smoothness * alphaDeviation * sensitivity));
```

Parameters:
- `sensitivity = 8.0` - Amplifies small deviations
- `smoothness = 6.0` - Sigmoid steepness (lower = smoother transitions)

### 3. MIDI CC Mapping

| CC | Parameter | Range | Control |
|----|-----------|-------|---------|
| CC1 | Rate | 0.1-8 Hz | Fixed (1.5 Hz) |
| CC2 | Depth | 0-1 | Fixed (0.5) |
| CC3 | Feedback | 0-0.8 | Fixed (0) |
| CC4 | Mix | 0-1 | **Dynamic: Alpha EEG** |
| CC5 | Gain | 0-1 | Fixed (0.8) |
| CC6 | Sweep | On/Off | Fixed (Off) |

### 4. PPG-Based Headset Worn Detection

The Muse 2 has a PPG (photoplethysmography) sensor that detects blood flow. This only works when the headset is worn on someone's head with skin contact.

**How it works:**

```javascript
// kiosk-muse.js - _calculateHeartRate()

// 1. Collect PPG samples from infrared channel
this.muse.ppgReadings.subscribe((ppgReading) => {
  if (ppgReading.ppgChannel === 2) {  // Infrared
    this.ppgBuffer.push(...ppgReading.samples);
  }
});

// 2. Filter and normalize the signal
const filtered = this._filtfilt(coeffs, [1.0], this.ppgBuffer);
const normalized = this._normalizeArray(filtered, time);

// 3. Find peaks using adaptive threshold
const { peak_locs } = this._adaptiveThreshold(normalized, ppg_fs);

// 4. Calculate heart rate from peak intervals
const hr = this._getHeartRateFromPeaks(peak_locs, ppg_fs);

// 5. Determine worn state
this.isWorn = hr >= 40 && hr <= 200;  // Valid HR range
```

**MIDI Suppression:**

When `isWorn = false`:
- Dashboard shows "NOT WORN (MIDI suppressed)" in red
- MIDI CC4 (mix) is forced to 0
- Prevents random audio modulation from electrical noise

When `isWorn = true`:
- Dashboard shows "HR: XX BPM - HEADSET WORN" in green
- MIDI CC4 responds to Alpha EEG as normal

**Dashboard Display:**

```
┌─────────────────────────────────────────────────────────────┐
│  FPS: 60 | Samples: 100    HR: 72 BPM - HEADSET WORN       │
│  MIDI: Connected to Bela                                    │
├─────────────────────────────────────────────────────────────┤
```

---

## Configuration

### Raspberry Pi 5

**IP Address:** 192.168.2.2

**Bluetooth:** TP-Link UB500 adapter (built-in disabled)

**Services:**
```bash
# Backend (Keystone)
sudo systemctl status youquantified-backend

# Frontend (React)
sudo systemctl status youquantified-frontend

# Kiosk (Chromium)
sudo systemctl status yq-kiosk  # or autostart
```

**Chrome Flags (in start-kiosk.sh):**
```bash
--enable-features=WebBluetooth,WebBluetoothNewPermissionsBackend
--enable-experimental-web-platform-features
--password-store=basic  # Prevents keyring prompt
```

### Bela GEM

**Deploy:**
```bash
rsync -avz bela/midi-chorus/ root@bela.local:/root/Bela/projects/midi-chorus/
```

**Run:**
```bash
ssh root@bela.local "cd Bela && make PROJECT=midi-chorus run"
```

**Auto-start:** Enable "Run project on boot" in Bela IDE settings.

---

## User Experience

### First-Time Setup

1. Connect Muse to Pi via Web Bluetooth (one-time)
2. Enable "Run project on boot" on Bela
3. Reboot system

### Normal Operation

1. Power on Pi and Bela
2. Put Muse in pairing mode (LED blinking)
3. Wait for auto-connect (green status indicator)
4. Play instrument - chorus responds to Alpha waves

### VNC Debugging

Connect via VNC to see:
- Visualization dashboard (full-screen)
- Browser DevTools (F12) for console logs
- EEG bands histogram
- MIDI output values

---

## Visualization Dashboard

The xenbox dashboard shows:

```
┌──────────────────────────────────────────────────────────────────────┐
│  FPS: 60 | Samples: 100                                              │
│  MIDI: Connected to Bela                                             │
├────────────────────────────────────────────────────────────────────--┤
│                                                                      │
│  EEG Bands (Relative)        │  EEG Signal Monitor (Relative Power)  │
│  ┌────────────────────────┐  │  ┌──────────────────────────────────┐ │
│  │ Alpha    ████████  35% │  │  │                                  │ │
│  │ Theta    ██████    25% │  │  │      ~~~~~Alpha~~~~~             │ │
│  │ Low Beta ████      18% │  │  │   ~~~~Beta~~~~                   │ │
│  │ High Beta███       12% │  │  │  ~~Theta~~                       │ │
│  │ Gamma    ██        10% │  │  │ ~Gamma~                          │ │
│  └────────────────────────┘  │  │                                  │ │
│                              │  └──────────────────────────────────┘ │
│  MIDI to Bela                │                                       │
│  ┌────────────────────────┐  │                                       │
│  │ Mix      ████████   89 │  │                                       │
│  │ Rate     ██          24│  │                                       │
│  │ Depth    ████        64│  │                                       │
│  │ Gain     ███████    100│  │                                       │
│  └────────────────────────┘  │                                       │
│                              │                                       │
│  Mix History:                │                                       │
│  ┌────────────────────────┐  │                                       │
│  │ ~~~/\~~~~/\~~~         │  │                                       │
│  └────────────────────────┘  │                                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

The canvas auto-resizes to fill the browser window.

---

## Troubleshooting

### Muse Won't Auto-Connect

1. **Check Muse is powered on** - LED should be blinking
2. **Verify Chrome flags** - `--enable-features=WebBluetoothNewPermissionsBackend`
3. **Re-pair manually** - Click "Connect Muse" button once
4. **Check advertisement timeout** - 30 seconds max wait

### No MIDI Output

1. **Check Bela connected** - `lsusb | grep Bela`
2. **Verify MIDI status** - Dashboard shows "MIDI: Connected to Bela"
3. **Check CC4 values** - Mix bar should move with Alpha changes

### Chorus Not Responding

1. **Enable Chorus checkbox** - Must be checked in xenbox
2. **Check Alpha values** - Should be non-zero in histogram
3. **Verify MIDI flow** - CC4 values in dashboard should change
4. **Check Bela project running** - Via Bela IDE or SSH

### Dashboard Not Filling Screen

Refresh the page after resize. The `windowResized()` function handles dynamic canvas sizing.

---

## Related Documentation

- `PI5_STATUS.md` - Raspberry Pi 5 setup and Bluetooth configuration
- `bela/README.md` - Bela chorus effect documentation
- `scripts/` - Startup scripts and systemd services
