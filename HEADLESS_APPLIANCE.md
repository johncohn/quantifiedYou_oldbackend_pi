# YouQuantified Headless Appliance Architecture

**Date:** 2026-02-14
**Status:** Fully Operational

This document describes the complete architecture for running YouQuantified as a headless EEG-controlled audio effects appliance.

---

## High-Level Architecture

```
┌──────────────┐
│  Muse 2 EEG  │
│   Headset    │
└──────┬───────┘
       │ Bluetooth LE
       ▼
┌─────────────────────────────────────────────────────────────┐
│                      RASPBERRY PI 5                          │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Chromium (Kiosk Mode, port :3000)            │  │
│  │                                                        │  │
│  │  ┌───────────────────┐   ┌──────────────────────────┐ │  │
│  │  │   kiosk-muse.js   │   │      xenbox_eeg.js       │ │  │
│  │  │   (parent page)   │   │      (srcdoc iframe)     │ │  │
│  │  │                   │   │                          │ │  │
│  │  │ - Bluetooth→Muse  │   │ - EEG visualization     │ │  │
│  │  │ - Band power calc │   │ - Alpha smoothing (EMA)  │ │  │
│  │  │ - PPG worn detect │   │ - Threshold gating       │ │  │
│  │  │ - Redux dispatch  │   │ - Effect switching UI    │ │  │
│  │  │                   │   │ - Histogram display      │ │  │
│  │  │   WS :8765 ───────┼───┼──► muse_status, worn    │ │  │
│  │  │                   │   │                          │ │  │
│  │  └───────────────────┘   │   USB-MIDI ──────────────┼─┼──┼──► Bela
│  │                          │   CC1-9 to PD patch      │ │  │
│  │                          │                          │ │  │
│  │                          │   WS :8765 ──────────────┼─┼──┼──► LED ctrl
│  │                          │   wet (0-1) out          │ │  │
│  │                          │   encoder values in      │ │  │
│  │                          └──────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────┐              │
│  │  led_status_controller.py (systemd svc)   │              │
│  │  WebSocket server ws://localhost:8765      │              │
│  │                                           │              │
│  │  Receives from browser:                   │              │
│  │    muse_status, worn_status, wet value    │              │
│  │  Sends to browser:                        │              │
│  │    encoder_values (gain, depth, threshold)│              │
│  └──────────────┬────────────────────────────┘              │
│                 │                                            │
│                 │  GPIO10 (SPI)         ┌──────────────────────────────────────┐
│                 ├──────────────────────►│  WS2812B NEOPIXELS (x3)             │
│                 │                       │                                      │
│                 │                       │  LED 0 ── GREEN: ready, RED: bypass  │
│                 │                       │  LED 1 ── PURPLE: Muse status        │
│                 │                       │           (pulses when streaming+worn)│
│                 │                       │  LED 2 ── AQUA: effect mix level     │
│                 │                       └──────────────────────────────────────┘
│                 │
│                 │  I2C (addr 0x49)      ┌──────────────────────────────────────┐
│                 ├──────────────────────►│  ROTARY ENCODERS (x3, seesaw)       │
│                 │                       │                                      │
│                 │                       │  Knob 1 ── Master Gain (CC5)         │
│                 │                       │  Knob 2 ── Depth/Drive (CC2/CC8)     │
│                 │                       │  Knob 3 ── EEG Threshold (local)     │
│                 │                       │  Button ── Save settings to disk     │
│                 │                       └──────────────────────────────────────┘
│                 │
│                 │  GPIO17 (input, pull-up)
│                 └──────────────────────┐
│                                        │
│  ┌────────────┐  ┌────────────────┐   ┌──────────────────────────────────────┐
│  │serve -s    │  │ Keystone       │   │  BYPASS SWITCH                       │
│  │build :3000 │  │ :3001 blob/API │   │                                      │
│  │React app   │  │                │   │  GPIO17 ─── switch ─── GND           │
│  └────────────┘  └────────────────┘   │  Open = normal (GREEN LED 0)         │
│                                        │  Closed = bypass (RED LED 0)         │
└────────────────────────────────────────└──────────────────────────────────────┘
       │ USB-MIDI
       ▼
┌──────────────────────────────────────┐
│            BELA GEM                   │
│                                       │
│  _main.pd (Pure Data)                │
│  ┌─────────────────────────────────┐ │
│  │ MIDI IN:                        │ │
│  │   CC1-6  Chorus params          │ │
│  │   CC7-8  Saturation params      │ │
│  │   CC9    Input source toggle    │ │
│  │                                 │ │
│  │ Audio:                          │ │
│  │   tone gen ─┐                   │ │
│  │   adc~ ─────┼──► chorus-stereo~ │ │
│  │       crossfade  ──► saturator~ │ │
│  │         (CC9)       ──► dac~    │ │
│  └─────────────────────────────────┘ │
│                                       │
│  Audio In  ◄── Guitar/Instrument     │
│  Audio Out ──► Amp/Speakers          │
└──────────────────────────────────────┘
```

---

## Data Flow: EEG to Audio + LED

```
Muse Headset
    │
    │ Bluetooth LE (5 EEG bands @ 10Hz, PPG @ 64Hz)
    ▼
kiosk-muse.js ──────────────────────────────────────────────┐
    │                                                        │
    │ Band powers, PPG worn detection                        │ WebSocket :8765
    │ Redux dispatch to store                                │ muse_status
    ▼                                                        │ worn_status
xenbox_eeg.js (p5.js iframe)                                 │
    │                                                        ▼
    ├─── Raw alpha ──► Sigmoid ──► rawAlphaMidi (0-127)     LED Controller
    │                                                        │
    ├─── EMA smooth (K=0.008, ~2s) ──► smoothedAlpha        │
    │                                                        │
    ├─── Threshold gate:                                     │
    │    if smoothedAlpha > threshold:                        │
    │      wet = (smoothedAlpha - threshold)                  │
    │            / (127 - threshold)                          │
    │    else: wet = 0                                        │
    │                                                        │
    ├─── SAFETY GATE: effectActive = hasEEGData && isWorn     │
    │    All output is ZERO unless Muse streaming + on head   │
    │                                                        │
    ├─── Active effect gets wet value as MIDI CC ──► Bela    │
    │    Chorus:     CC4 = wet * 127                          │
    │    Saturation: CC7 = wet * 127                          │
    │    (sends 0 when !effectActive)                         │
    │                                                        │
    └─── wet value (0-1) ──► WebSocket :8765 ──────────────► │
         (sends 0 when !effectActive)                         │
                                                              │
                                                         LED 2 (AQUA)
                                                         brightness = wet * 64
                                                         (off unless streaming+worn)
                                                              │
                                                         LED 0 (GREEN/RED)
                                                         GREEN = ready
                                                         RED = bypass
                                                         (GPIO17 to GND)
```

---

## WebSocket Protocol (ws://localhost:8765)

Single WebSocket server in `led_status_controller.py`. Two clients connect:

| Client | Sends | Receives |
|--------|-------|----------|
| kiosk-muse.js (parent) | `muse_status`, `worn_status` | `encoder_values` |
| xenbox_eeg.js (iframe) | `alpha_score {wet}`, `bela_status` | `encoder_values` |

### Messages

**Browser -> LED Controller:**
```json
{"type": "muse_status", "state": "streaming"}
{"type": "worn_status", "isWorn": true}
{"type": "alpha_score", "wet": 0.42}
{"type": "bela_status", "connected": true}
```

**LED Controller -> Browser:**
```json
{"type": "encoder_values", "gain": 100, "depth": 64, "threshold": 50}
```

---

## MIDI CC Mapping

| CC | Parameter | Range | Source |
|----|-----------|-------|--------|
| CC1 | Chorus Rate | 0.1-8 Hz | Fixed |
| CC2 | Chorus Depth | 0-1 | Encoder knob 2 (chorus mode) |
| CC3 | Chorus Feedback | 0-0.8 | Fixed |
| CC4 | Chorus Mix | 0-1 | Alpha EEG (when chorus active) |
| CC5 | Master Gain | 0-1 | Encoder knob 1 |
| CC6 | Sweep Enable | On/Off | Fixed (off) |
| CC7 | Saturation Mix | 0-1 | Alpha EEG (when saturation active) |
| CC8 | Saturation Drive | 1-10 | Encoder knob 2 (saturation mode) |
| CC9 | Input Source | Tone/Live | "Live Input" checkbox |

---

## Effect Switching

Two effects available, one active at a time (radio buttons on dashboard):

| Effect | Mix CC | Param CC | Description |
|--------|--------|----------|-------------|
| **Chorus** | CC4 | CC2 (depth) | Stereo chorus with LFO modulation |
| **Harmonics** (default) | CC7 | CC8 (drive) | Soft saturation (cubic waveshaping, adds overtones) |

When switching effects:
- Active effect gets `wet * 127` on its mix CC
- Inactive effect gets `0` on its mix CC
- Encoder knob 2 remaps to the active effect's parameter

### Safety Gating

All audio output and LED activity require `effectActive = hasEEGData && isWorn`:

| Condition | MIDI to Bela | LED 2 | Dashboard Histogram |
|-----------|-------------|-------|---------------------|
| Muse streaming + worn | wet * 127 | AQUA (proportional) | Active (colored) |
| Muse streaming, not worn | 0 | OFF | Greyed out |
| Muse disconnected | 0 | OFF | Greyed out |

This is enforced in two places:
- **Browser** (`xenbox_eeg.js`): `effectActive` gates MIDI CC sends and LED WebSocket messages
- **LED controller** (`led_status_controller.py`): LED 2 only renders when `muse_state == STREAMING and is_worn`

---

## Hardware: LEDs and Encoders

### NeoPixel LEDs (WS2812B x3, SPI GPIO10)

| LED | Color | Meaning |
|-----|-------|---------|
| 0 | **GREEN** (solid) | System ready, running normally |
| 0 | **RED** (solid) | Bypass mode (GPIO17 grounded) |
| 1 | **PURPLE** (pulse) | Muse connected + worn (5s sine pulse, gamma-corrected) |
| 1 | **PURPLE** (solid) | Muse connected, not worn |
| 2 | **AQUA** (variable) | Effect mix level (only when streaming + worn, off otherwise) |

### Bypass Switch (GPIO17)

A physical bypass switch connects **GPIO17** to **GND**. The LED controller configures GPIO17 as input with pull-up resistor. When grounded, LED 0 switches from GREEN to RED to indicate bypass mode.

### Rotary Encoders (Adafruit Quad Breakout, I2C 0x49)

| Slot | Function | MIDI CC | Default |
|------|----------|---------|---------|
| 1 | Master Gain | CC5 | 100 |
| 2 | Depth/Drive | CC2/CC8 | 64 |
| 3 | EEG Threshold | (local) | 64 |

Button press on any encoder saves current values to `/home/xenbox/encoder_settings.json`.

---

## Threshold and Smoothing

The effect activation uses a **gated linear ramp** above threshold:

1. **Raw alpha** computed via sigmoid of alpha deviation from running mean
2. **Smoothed** with EMA filter: `smoothedAlpha += 0.008 * (raw - smoothedAlpha)` (~2s time constant)
3. **Threshold gate**: effect is OFF when smoothed value is below threshold (encoder knob 3)
4. **Linear ramp**: when above threshold, effect intensity is proportional to overshoot

This decouples threshold (where the effect turns on) from amplitude (how strong it gets).

---

## File Reference

### Frontend (React/Redux, served on :3000)

| File | Purpose |
|------|---------|
| `frontend/src/components/kiosk/KioskView.js` | Main kiosk view |
| `frontend/src/components/kiosk/MuseConnectButton.js` | Connection UI |
| `frontend/src/components/kiosk/KioskAutoMapper.js` | Auto-maps Muse data to viz params |
| `frontend/src/utility/kiosk-muse.js` | Muse BLE manager, PPG worn detection, sends muse_status/worn_status via WS |

### Visualization (p5.js, served as blob from Keystone :3001)

| File | Purpose |
|------|---------|
| `xenbox_eeg.js` | EEG display, MIDI CC output, effect switching, alpha smoothing, sends wet value via WS |
| Deployed as: `keystone/public/code/blob-jCTLjHalgu97` | |

### Bela (Pure Data)

| File | Purpose |
|------|---------|
| `bela/midi-chorus/_main.pd` | Main patch: MIDI input, audio routing, input source toggle |
| `bela/midi-chorus/chorus-stereo~.pd` | Stereo chorus abstraction |
| `bela/midi-chorus/saturator~.pd` | Stereo soft saturator (cubic waveshaping) |

### Pi Services

| File | Purpose |
|------|---------|
| `scripts/led_status_controller.py` | LED + encoder controller, WebSocket server on :8765 |
| `scripts/start-kiosk.sh` | Chromium kiosk launcher |
| systemd: `yq-led-controller.service` | LED/encoder service (runs as root for SPI) |

---

## Deployment

### Deploy visualization blob
```bash
scp xenbox_eeg.js xenbox@<PI_IP>:/home/xenbox/quantifiedYou_oldbackend_pi/keystone/public/code/blob-jCTLjHalgu97
# Update filesize in DB:
sqlite3 keystone.db "UPDATE Visual SET code_filesize=<SIZE> WHERE code_filename='blob-jCTLjHalgu97';"
```

### Deploy LED controller
```bash
scp scripts/led_status_controller.py xenbox@<PI_IP>:/home/xenbox/quantifiedYou_oldbackend_pi/scripts/
ssh xenbox@<PI_IP> "sudo systemctl restart yq-led-controller"
```

### Deploy frontend (React build)
```bash
cd frontend && npm run build
rsync -a frontend/build/ xenbox@<PI_IP>:/home/xenbox/quantifiedYou_oldbackend_pi/frontend/build/
# Clear browser cache and reload via Chrome DevTools WebSocket on port 9222
```

### Deploy Bela PD patch
```bash
scp -r bela/midi-chorus/ root@192.168.7.2:/root/Bela/projects/midi-chorus/
ssh root@192.168.7.2 "make -C /root/Bela stop; make -C /root/Bela run PROJECT=midi-chorus"
```
