# Esteban & Kaia

Quick notes on changes we made porting YouQuantified to Raspberry Pi. Some of this stuff might be worth merging back.

*Note: When we say "we" in this doc, we mean John working with Claude (AI assistant). Wanted to clarify since it might be confusing otherwise!*

## What We Changed

### 1. Extensions UI for External Libraries (edit.js, new.js)
**What:** Added UI controls so users can add external library CDN URLs (like Tone.js, Three.js) directly in the visual editor.

**Why:** The backend schema already supports an `extensions` field, but there was no way to edit it in the UI. Had to manually UPDATE the database which was a pain. (Note: Parameters could already be added via the UI - this change is specifically for the external libraries feature.)

**Merge?** Yes please - this is super useful. Pure UI addition, doesn't break anything.

---

### 2. Tone.js Library (p5iframe.js)
**What:** Added one line to include Tone.js CDN in the p5.js iframe.

**Why:** Wanted audio synthesis for EEG sonification (map brain waves to sound effects).

**Merge?** Maybe? Could also remove this and let people add it via the new extensions UI. Up to you - adds ~100KB to every iframe load. Worth discussing.

---

### 3. xenbox_eeg.js Visual
**What:** New 400+ line visualization that plots EEG signals in real-time and maps them to audio effects. Has a CONFIG object so you can tune thresholds without editing code.

**Why:** Wanted to see the actual signals coming in and understand how they map to effects. Added docs explaining the whole flow.

**Merge?** Definitely - good example visual with educational value. Kaia - this extends your original xenbox idea, curious what you think!

---

### 4. Signup Waitlist Toggle (signup.js)
**What:** Changed `if (true)` to `if (false)` to disable the waitlist.

**Why:** Self-hosted Pi doesn't need a waitlist like youquantified.com does.

**Merge?** Not as-is. Should make it an environment variable:
```javascript
const ENABLE_WAITLIST = process.env.REACT_APP_ENABLE_WAITLIST === 'true';
```
Then youquantified.com sets it to `true`, self-hosted sets to `false`.

---

### 5. CORS Config (keystone.ts)
**What:** Changed from specific origins to `origin: true` (accept all).

**Why:** Pi IP addresses kept changing, needed flexibility during development.

**Merge?** No - security issue. Should make it environment-aware:
```typescript
cors: {
  origin: process.env.NODE_ENV === 'development' ? true : [specific origins],
  credentials: true,
}
```

---

### 6. Pi Documentation
**What:** Added PI4_SETUP.md, PI4_STATUS.md, PI5_STATUS.md with complete setup instructions.

**Why:** Getting this running on Pi was... interesting. Especially the Bluetooth stuff.

**Key finding:** Pi 5's built-in Bluetooth can't handle Muse's data bandwidth - drops connection when electrodes touch skin. Need external USB Bluetooth adapter (TP-Link UB500).

**Merge?** Yes - enables people to run this on embedded hardware. Might open up cool use cases.

---

## How to Merge This

**Phase 1 - Easy wins:**
1. Extensions UI for external libraries - ready to go
2. xenbox_eeg.js visual - ready to go
3. Pi documentation - ready to go

**Phase 2 - Need refactoring first:**
1. Signup toggle - convert to environment variable
2. CORS config - convert to environment variable

**Phase 3 - Let's discuss:**
1. Tone.js - keep it? remove it? make it optional?

## Questions

**Esteban:**
- Extensions UI look okay or want changes?
- Tone.js - thoughts?
- Environment variable approach work for your deployment?

**Kaia:**
- What do you think of the enhancements to xenbox (signal plots, CONFIG object)?
- EEG-to-audio mappings make sense? (Alpha→Chorus, Gamma→Distortion, etc.)

## Repos

**Original YouQuantified repo:** https://github.com/mindhiveproject/You-Quantified/tree/old-backend
**Our Pi fork:** https://github.com/johncohn/quantifiedYou_oldbackend_pi

Let me know what you think. Happy to help with PRs or refactoring whatever needs work.

John
