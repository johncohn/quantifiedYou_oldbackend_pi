# EEG Threshold & Effect Control — Math Reference

This document describes how raw EEG data from the Muse headband is processed into the audio effect wet/dry mix value.

---

## Signal Chain Overview

```
Muse EEG bands
    │
    ▼
1. Relative alpha      alpha_rel = alpha / (alpha + lowBeta + highBeta + theta + gamma)
    │
    ▼
2. Running mean        alphaMean  (Welford online mean, resets on reconnect)
    │
    ▼
3. Sigmoid → rawAlphaMidi   0–127, 0.5 at personal baseline
    │
    ▼
4. EMA smoothing       smoothedAlpha  (~2s time constant)
    │
    ▼
5. Threshold gate      chorus_wetVal  0–1, drives audio mix and LED 2
```

---

## Step 1 — Relative Alpha

Alpha power is normalised against total band power so the value is
person-independent and session-independent:

```
alpha_rel = alpha / (alpha + lowBeta + highBeta + theta + gamma)
```

Range: 0–1 (e.g. 0.4 means alpha is 40% of total signal).

---

## Step 2 — Running Personal Baseline (Welford mean)

A running mean of `alpha_rel` is maintained using Welford's online
algorithm (no history buffer needed):

```
alphaN    += 1
alphaMean += (alpha_rel - alphaMean) / alphaN
```

This is the user's **personal alpha baseline** for the current session.
It adapts continuously — the longer the session, the more stable it
becomes. Resets to 0 on Muse disconnect.

---

## Step 3 — Sigmoid → rawAlphaMidi

The deviation from personal baseline is mapped to 0–127 via a sigmoid
centred at 0 deviation:

```
alphaDeviation = alpha_rel - alphaMean
rawAlphaMix    = 1 / (1 + exp(-10 × alphaDeviation))   → 0–1
rawAlphaMidi   = rawAlphaMix × 127                      → 0–127
```

- At **personal baseline**: `alphaDeviation = 0` → `rawAlphaMidi ≈ 63.5`
- **Above** baseline: value rises toward 127
- **Below** baseline: value falls toward 0

This is the value displayed in the **histogram bar** in the UI.

---

## Step 4 — EMA Smoothing

An exponential moving average is applied to prevent rapid on/off
switching from momentary alpha spikes:

```
smoothK       = 0.008          # per-frame coefficient at ~60 fps
smoothedAlpha += smoothK × (rawAlphaMidi − smoothedAlpha)
```

Time constant ≈ `1 / smoothK` frames ≈ 125 frames ÷ 60 fps ≈ **~2 seconds**.

---

## Step 5 — Threshold Gate (Knob 3)

The **threshold encoder (knob 3)** sets `encoderThreshold` (0–127, default 64).

The effect wet value is computed as a **linear ramp above the threshold**:

```
thresholdMidi = encoderThreshold          # 0–127

if smoothedAlpha > thresholdMidi:
    chorus_wetVal = min(1, (smoothedAlpha − thresholdMidi) / (127 − thresholdMidi))
else:
    chorus_wetVal = 0
```

### Threshold behaviour

| Knob 3 value | Effect activates when… |
|---|---|
| **0** | Always somewhat active (smoothedAlpha always > 0) |
| **64** (default) | Personal baseline must be clearly exceeded |
| **127** | Needs maximum alpha activity to activate |

### Ramp shape

Once above threshold the effect scales **linearly** from 0 to 1 as
`smoothedAlpha` travels from `thresholdMidi` to 127:

```
wet = 0     at smoothedAlpha = thresholdMidi
wet = 0.5   at smoothedAlpha = (thresholdMidi + 127) / 2
wet = 1.0   at smoothedAlpha = 127
```

---

## Master Gate

Even if `chorus_wetVal > 0`, the effect and LED 2 are zeroed unless:

```
effectActive = hasEEGData AND isWorn
```

- `hasEEGData` — Muse is streaming fresh band power data
- `isWorn` — PPG infrared channel confirms headset is on head

---

## Knob Summary

| Knob | Parameter | Effect |
|---|---|---|
| 1 | Master Gain (CC5) | Overall output level |
| 2 | Depth/Drive (CC2 or CC8) | Modulation depth (Chorus) or drive amount (Harmonics) |
| 3 | Threshold (0–127) | Alpha level required to activate effect |
