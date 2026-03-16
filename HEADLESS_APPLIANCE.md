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

> **Pixel order:** LEDs use RGB byte order. Pi5Neo only supports an `RGB` pixel type but internally outputs GRB, so r and g are swapped at every `set_led_color()` call to compensate.

| LED | Color | Meaning |
|-----|-------|---------|
| 0 | **GREEN** (solid) | System ready, running normally |
| 0 | **RED** (solid) | Bypass mode (GPIO17 grounded) |
| 1 | **PURPLE** (pulse) | Muse streaming + worn (5s sine pulse, gamma-corrected) |
| 1 | **PURPLE** (solid) | Muse connected but not worn |
| 2 | **AQUA** (variable) | Effect mix level — directly mirrors audio wet value (0 when not worn) |

### Bypass Switch (GPIO17)

A physical bypass switch connects **GPIO17** to **GND**. The LED controller configures GPIO17 as input with pull-up resistor. When grounded, LED 0 switches from GREEN to RED to indicate bypass mode.

### Rotary Encoders (Adafruit Quad Breakout, I2C 0x49)

| Slot | Function | MIDI CC | Default |
|------|----------|---------|---------|
| 1 | Master Gain | CC5 | 100 |
| 2 | Depth/Drive | CC2/CC8 | 64 |
| 3 | EEG Threshold | (local) | 64 |

Button press on any encoder saves current values to `/home/xenbox/encoder_settings.json`.

> **Implementation note:** Encoder buttons must be initialized with `btn.switch_to_input(pull=digitalio.Pull.UP)` — using `pull=True` (a boolean) silently falls through to plain `INPUT` mode, which sends `GPIO_PULLENCLR` to the seesaw chip and breaks encoder counting on the lowest-numbered slot. Encoders are polled at 30Hz (every 2nd frame of the 60Hz LED loop).

---

## Threshold and Smoothing

The effect activation uses a **gated linear ramp** above threshold:

1. **Raw alpha** computed via sigmoid of alpha deviation from running mean
2. **Smoothed** with EMA filter: `smoothedAlpha += 0.008 * (raw - smoothedAlpha)` (~2s time constant)
3. **Threshold gate**: effect is OFF when smoothed value is below threshold (encoder knob 3)
4. **Linear ramp**: when above threshold, effect intensity is proportional to overshoot

This decouples threshold (where the effect turns on) from amplitude (how strong it gets).

See **[THRESHOLD_MATH.md](THRESHOLD_MATH.md)** for the full signal chain with equations.

---

## Muse Bluetooth Recovery

The Muse uses Chrome's Web Bluetooth `getDevices()` API to reconnect without a user gesture (no button click needed). After disconnect, the browser retries with exponential backoff (1s → 30s max, 10 attempts).

**If reconnection exhausts all attempts** (e.g. device left on for days, Muse put in pairing mode too late), the page automatically reloads after 10 seconds to clear stale Bluetooth state. This is the most reliable recovery mechanism — the page reload re-initializes the Bluetooth stack cleanly.

**PPG-based worn detection** (infrared channel mean threshold) controls `isWorn`. LED 1 pulses only when `isWorn=true`. The effect and LED 2 are both zeroed when `isWorn=false`, so the system is silent and dark when the headset is sitting on a table even if Muse is connected and streaming.

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

### Documentation

| File | Purpose |
|------|---------|
| `HEADLESS_APPLIANCE.md` | This file — architecture, hardware, deployment |
| `THRESHOLD_MATH.md` | EEG-to-audio signal chain equations and knob reference |

---

## WiFi Provisioning (comitup)

The Pi uses [comitup](https://github.com/davesteele/comitup) for phone-based WiFi setup. When no known WiFi network is available, the Pi automatically creates a hotspot.

### How It Works

1. On boot, comitup checks if any known WiFi network is in range
2. If yes → connects automatically (CONNECTED state)
3. If no → creates hotspot `xenbox-setup-NNNN` on wlan1 (HOTSPOT state)
4. User connects phone/laptop to the hotspot
5. Captive portal appears with list of available WiFi networks
6. User selects network, enters password → Pi connects, hotspot disappears

### Configuration

| File | Setting |
|------|---------|
| `/etc/comitup.conf` | `ap_name: xenbox-setup` |
| | `primary_wifi_device: wlan1` |
| | `enable_appliance_mode: false` (critical — only one usable WiFi adapter) |

### Important Notes

- **wlan0 is disabled/unmanaged** — do not use it, it causes problems
- **wlan1** is the only active WiFi adapter
- `enable_appliance_mode: false` prevents comitup from trying to use wlan0 as upstream
- The captive portal page may take a few seconds to fully load (white screen initially is normal)
- Comitup manages WiFi connections via NetworkManager — do not manually create NM WiFi connections

### Checking Status

```bash
# Via SSH (ethernet at 192.168.2.2 when hotspot is active)
sudo comitup-cli           # Interactive status
sudo journalctl -u comitup -n 30   # Logs
nmcli connection show --active      # Active connections
```

---

## Debugging Consoles

### Kiosk (Chromium) — Remote DevTools from Mac

Chromium runs with `--remote-debugging-port=9222`. Forward the port over SSH then open Chrome on your Mac:

```bash
ssh -L 9222:localhost:9222 xenbox@192.168.68.126
```

Then visit `chrome://inspect` in Chrome on your Mac → click **inspect** under the kiosk page.

> **To see the Muse/EEG console:** The EEG code runs inside a srcdoc iframe. In the DevTools console, click the **context selector dropdown** (top-left, shows `top`) and switch to the `blob:` frame.

### Bela — Web IDE Console from Mac

The Bela IDE makes three WebSocket connections (ports 80, 3000, 40100). All must be tunneled, **and** the URL needs `?port=8080` so the main WebSocket uses the tunneled port instead of the default port 80:

```bash
ssh -L 8080:192.168.7.2:80 -L 3000:192.168.7.2:3000 -L 40100:192.168.7.2:40100 xenbox@192.168.68.126
```

Then visit **`http://localhost:8080?port=8080`** in your Mac browser. The IDE shows the PD patch console, MIDI traffic, CPU load, and all projects in real time.

---

## Kiosk Escape Shortcuts

The kiosk runs Chromium in fullscreen on labwc (Wayland compositor) with auto-restart. These keyboard shortcuts are configured in `~/.config/labwc/rc.xml`:

| Shortcut | Action | Script |
|----------|--------|--------|
| `Ctrl+Alt+T` | Open terminal (lxterminal) | built-in |
| `Ctrl+Alt+Q` | Kill kiosk + open terminal | `/home/xenbox/kill-kiosk.sh` |
| `Ctrl+Alt+K` | Restart kiosk | `/home/xenbox/restart-kiosk.sh` |

After modifying `rc.xml`, reload with: `pkill -SIGHUP labwc`

---

## Deployment

### Deploy visualization blob
```bash
PI=192.168.68.126

# 1. Copy JS to blob location (this is what the kiosk actually loads)
scp xenbox_eeg.js xenbox@$PI:/home/xenbox/quantifiedYou_oldbackend_pi/keystone/public/code/blob-jCTLjHalgu97

# 2. Also copy to repo location (for reference)
scp xenbox_eeg.js xenbox@$PI:/home/xenbox/quantifiedYou_oldbackend_pi/xenbox_eeg.js

# 3. Update filesize in DB (use actual byte count)
SIZE=$(wc -c < xenbox_eeg.js)
ssh xenbox@$PI "sqlite3 /home/xenbox/quantifiedYou_oldbackend_pi/keystone/keystone.db \"UPDATE Visual SET code_filesize = $SIZE WHERE code_filename = 'blob-jCTLjHalgu97';\""

# 4. Hard reload kiosk page (cache bypass via Chrome DevTools)
ssh xenbox@$PI 'python3 -c "
import json, asyncio, websockets
async def main():
    targets = json.loads(__import__(\"urllib.request\").request.urlopen(\"http://localhost:9222/json\").read())
    ws_url = next(t[\"webSocketDebuggerUrl\"] for t in targets if t.get(\"type\")==\"page\")
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({\"id\":1,\"method\":\"Page.reload\",\"params\":{\"ignoreCache\":True}}))
        print(await asyncio.wait_for(ws.recv(), timeout=5))
asyncio.run(main())
"'
```

**Gotchas:**
- The root-level `keystone.db` is EMPTY — the real DB is at `keystone/keystone.db`
- Copying to `xenbox_eeg.js` in the repo does NOT update the kiosk — must update the blob file
- Always update DB filesize when blob size changes

### Deploy LED controller
```bash
PI=192.168.68.126

# 1. Copy file
scp scripts/led_status_controller.py xenbox@$PI:/home/xenbox/quantifiedYou_oldbackend_pi/scripts/

# 2. Force kill + restart (systemctl restart hangs over SSH)
PID=$(ssh xenbox@$PI 'echo xenbox | sudo -S systemctl status yq-led-controller.service 2>&1 | grep "Main PID" | awk "{print \$3}"')
ssh xenbox@$PI "echo xenbox | sudo -S kill -9 $PID 2>&1; sleep 1; echo xenbox | sudo -S systemctl reset-failed yq-led-controller.service 2>&1; echo xenbox | sudo -S systemctl start yq-led-controller.service 2>&1"
```

### Deploy frontend (React build)
```bash
PI=192.168.68.126
cd frontend && npm run build
rsync -a frontend/build/ xenbox@$PI:/home/xenbox/quantifiedYou_oldbackend_pi/frontend/build/
# Then reload kiosk page (same Chrome DevTools method as blob deploy step 4)
```

### Deploy Bela PD patch
```bash
PI=192.168.68.126

# 1. Stage files on Pi (can't scp directly to Bela from laptop)
scp bela/midi-chorus/_main.pd bela/midi-chorus/saturator~.pd xenbox@$PI:/tmp/

# 2. Copy from Pi to Bela
ssh xenbox@$PI 'scp -o StrictHostKeyChecking=no /tmp/_main.pd /tmp/saturator~.pd root@192.168.7.2:/root/Bela/projects/midi-chorus/'

# 3. Restart Bela project
ssh xenbox@$PI 'ssh -o StrictHostKeyChecking=no root@192.168.7.2 "make -C /root/Bela stop 2>&1; make -C /root/Bela run PROJECT=midi-chorus 2>&1 &"'
```
