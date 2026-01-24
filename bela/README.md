# Bela GEM Effects Projects

This directory contains Pure Data patches for the Bela GEM audio processing platform.

## Projects

### midi-flanger

A MIDI-controlled stereo flanger effect for guitar/instrument processing.

**Features:**
- Stereo flanger effect with variable delay
- MIDI CC control over all parameters
- Auto-sweep mode for testing without MIDI
- Built-in test tone generator
- Scope output for waveform visualization

**MIDI CC Mappings:**
- CC 1 (Mod Wheel) - Flanger Rate: 0.1-10 Hz
- CC 2 - Flanger Depth: 0-10 ms
- CC 3 - Flanger Feedback: 0-0.9
- CC 4 - Dry/Wet Mix: 0-100%

**Files:**
- `_main.pd` - Main patch with test tone and auto-sweep
- `flanger-stereo~.pd` - Stereo flanger abstraction
- `settings.json` - Bela project settings

**Deployment:**

To deploy to Bela GEM:
```bash
rsync -avz midi-flanger/ root@bela.local:/root/Bela/projects/midi-flanger/
```

Then build and run:
```bash
ssh root@bela.local "cd Bela && make PROJECT=midi-flanger && make PROJECT=midi-flanger run"
```

Or use the Bela Web IDE at http://bela.local

**Integration with XenboX:**

This flanger is designed to work with the XenboX MIDI controller running on Raspberry Pi 5. Add the CC mappings above to your XenboX configuration to control the effect in real-time.

## Development

All Pure Data patches are compatible with Bela's libpd implementation. Test mode allows development without hardware by using the built-in test tone and auto-parameter sweep.
