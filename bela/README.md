# Bela GEM Effects Projects

This directory contains Pure Data patches for the Bela GEM audio processing platform.

## Projects

### midi-chorus

A MIDI-controlled stereo chorus effect for guitar/instrument processing.

**Features:**
- 2-voice stereo chorus with staggered delays (25ms/30ms base)
- Slightly detuned LFOs between voices for richness
- Stereo width control for mono-to-wide spread
- Proper dry/wet mix control
- MIDI CC control over all parameters
- Auto-sweep mode for testing without MIDI
- Built-in test tone generator (440Hz)
- Scope output for waveform visualization

**MIDI CC Mappings:**
- CC 1 (Mod Wheel) - Rate: 0.1-3 Hz (LFO speed)
- CC 2 - Depth: 0-15 ms (pitch modulation amount)
- CC 4 - Dry/Wet Mix: 0-100%

**Parameter Guide:**
- **Rate**: Controls LFO speed. Slow (0.1-0.5 Hz) gives gentle shimmer, faster (1-3 Hz) creates vibrato/warble
- **Depth**: How much the pitch wavers. Subtle (1-3ms) for thickening, higher (8-15ms) for wobbly pitch
- **Mix**: Blend dry and wet. 50% is classic chorus, 100% is fully effected

**Stereo Design:**
The stereo width is built-in via two voices with phase-offset LFOs (180 degrees apart) and different base delays (15ms/20ms). This creates natural stereo movement without needing a separate width control.

**Files:**
- `_main.pd` - Main patch with test tone and auto-sweep
- `chorus-stereo~.pd` - Stereo chorus abstraction
- `settings.json` - Bela project settings

**Deployment:**

To deploy to Bela GEM:
```bash
rsync -avz midi-chorus/ root@bela.local:/root/Bela/projects/midi-chorus/
```

Then build and run:
```bash
ssh root@bela.local "cd Bela && make PROJECT=midi-chorus && make PROJECT=midi-chorus run"
```

Or use the Bela Web IDE at http://bela.local

**Integration with xenbox_eeg.js:**

This chorus receives MIDI from xenbox_eeg.js running on Raspberry Pi 5. The integration mirrors the Tone.js chorus behavior for EEG-controlled biofeedback.

**MIDI CC Mapping (matches xenbox_eeg.js):**
| CC | Parameter | Range | Source |
|----|-----------|-------|--------|
| CC1 | Rate | 0.1-8 Hz | Fixed (1.5 Hz = Tone.js default) |
| CC2 | Depth | 0-1 | Fixed (0.5 = Tone.js default) |
| CC3 | Feedback | 0-0.8 | Fixed (0 = Tone.js has none) |
| CC4 | Mix | 0-1 | **Dynamic: Alpha EEG → sigmoid → wet** |
| CC5 | Gain | 0-1 | Fixed (~0.8 default) |

**How It Works:**
1. xenbox_eeg.js receives EEG data from Muse headset
2. Alpha relative power is calculated (alpha / sum_of_all_bands)
3. Adaptive threshold learns your personal alpha baseline
4. Sigmoid function converts alpha to 0-1 effect intensity
5. CC4 (mix) is sent to Bela over USB-MIDI
6. Bela applies chorus wet/dry mix in real-time

**Biofeedback Loop:**
- More alpha waves (relaxation/flow state) → more chorus effect
- Less alpha waves → dry signal
- Creates musical reward for achieving flow state

**Setup:**
1. Connect Bela to Pi 5 via USB
2. Run xenbox_eeg.js in YouQuantified
3. Enable "Chorus" checkbox
4. Connect Muse headset
5. Play instrument through Bela audio inputs

### midi-flanger (legacy)

The original flanger effect - kept for reference. See `midi-chorus` for the current active project.

## Development

All Pure Data patches are compatible with Bela's libpd implementation. Test mode allows development without hardware by using the built-in test tone and auto-parameter sweep.

**Testing the chorus:**
1. Deploy to Bela and run
2. Listen to the auto-sweep cycle through parameter combinations
3. Open Bela Scope to see stereo waveform differences
4. Use MIDI CC 1-4 to manually control and find sweet spots
