/**
 * xenbox - EEG-Controlled Audio Visualization
 *
 * REQUIRED PARAMETERS (configure in YouQuantified):
 * [
 *   {"name": "Alpha", "suggested": ["Alpha"]},
 *   {"name": "Low Beta", "suggested": ["Low beta"]},
 *   {"name": "High Beta", "suggested": ["High beta"]},
 *   {"name": "Theta", "suggested": ["Theta"]},
 *   {"name": "Gamma", "suggested": ["Gamma"]}
 * ]
 *
 * =============================================================================
 * HOW IT WORKS: EEG DATA FLOW TO AUDIO EFFECTS
 * =============================================================================
 *
 * STEP 1: RECEIVE RAW EEG DATA
 * - Muse sends 5 frequency bands at ~10-12 Hz
 * - Values arrive already multiplied by YouQuantified slider positions
 * - Example: If slider is 0.5 and Muse outputs 0.8, you receive 0.4
 *
 * STEP 2: CALCULATE WEIGHTED SUM
 * - weighted = alpha + lowBeta + highBeta + theta + gamma
 * - Shows total combined signal strength across all bands
 *
 * STEP 3: NORMALIZE TO RELATIVE VALUES
 * - alpha_rel = alpha / weighted
 * - Each band becomes a fraction of total (always sums to 1.0)
 * - Example: If alpha is 40% of total signal, alpha_rel = 0.4
 * - This removes absolute amplitude and focuses on proportional mix
 *
 * STEP 4: ADAPTIVE THRESHOLD LEARNING
 * - Calculates running average of Alpha and Gamma over the session
 * - If your typical Alpha is 0.25, that becomes your personal baseline
 * - Adapts to individual brain wave patterns
 *
 * STEP 5: SIGMOID THRESHOLDING
 * - Converts continuous EEG values into effect intensities (0 to 1)
 * - Sigmoid function: 1 / (1 + exp(-steepness * (value - threshold)))
 * - When value < threshold: Output approaches 0 (effect off)
 * - When value = threshold: Output = 0.5 (effect at half)
 * - When value > threshold: Output approaches 1 (effect fully on)
 * - High steepness (60) creates sharp, binary-like transitions
 *
 * STEP 6: APPLY TO AUDIO EFFECTS
 * - Each effect's "wet" value (0-1) controls dry/wet mix
 * - wet = 0: Pure dry signal (no effect)
 * - wet = 1: Full effect applied
 *
 * =============================================================================
 * EFFECT MAPPINGS AND THRESHOLDS
 * =============================================================================
 *
 * | EEG Band      | Effect     | Threshold Type | Threshold Value      | Notes                    |
 * |---------------|------------|----------------|----------------------|--------------------------|
 * | Alpha         | Chorus     | Adaptive       | alphaMean × 1.25     | Personalized baseline    |
 * | Low Beta      | Flanger    | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | High Beta     | Reverb     | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | Theta         | Delay      | Fixed          | 0.3 (30% of signal)  | Same for all users       |
 * | Gamma         | Distortion | Adaptive       | gammaMean × 1.25     | Inverted: low = high     |
 *
 * FIXED THRESHOLDS:
 * - Use default midpoint (0.3) for all users
 * - Effect activates when band is >30% of total signal
 *
 * ADAPTIVE THRESHOLDS:
 * - Learn your personal baseline over the session
 * - Threshold = personal_average × 1.25 (25% above baseline)
 * - Better for individual differences in Alpha/Gamma
 *
 * INVERTED (Gamma/Distortion):
 * - Output = 1 - sigmoid(gamma)
 * - Low gamma → high distortion
 * - High gamma → low distortion
 *
 * =============================================================================
 * EEG FREQUENCY BANDS (from Muse)
 * =============================================================================
 * - Alpha (8-12 Hz): Relaxed, calm, awake but eyes closed
 * - Low Beta (12-15 Hz): Relaxed focus, light concentration
 * - High Beta (15-30 Hz): Active thinking, problem solving
 * - Theta (4-8 Hz): Deep relaxation, meditation, drowsiness
 * - Gamma (30+ Hz): High-level cognition, peak focus
 */

// =============================================================================
// CONFIGURATION - EDIT THESE VALUES TO TUNE BEHAVIOR
// =============================================================================

const CONFIG = {
  // Sigmoid parameters for threshold activation
  sigmoid: {
    steepness: 4,       // Lower = smoother transition (was 10, now 4 for more responsiveness)
    fixedMidpoint: 0.3  // Fixed threshold for non-adaptive effects (try 0.2-0.4)
  },

  // Adaptive thresholding multiplier
  adaptive: {
    multiplier: 0.5     // Threshold = baseline × this (was 0.9, now 0.5 for easier activation)
  },

  // EEG band to audio effect mappings
  // Change these to remap which band controls which effect
  mappings: {
    "Alpha": {
      effect: "Chorus",
      adaptive: true,   // Use personalized threshold
      invert: false     // Normal behavior (high input = high output)
    },
    "Low Beta": {
      effect: "Flanger",
      adaptive: false,  // Use fixed threshold
      invert: false
    },
    "High Beta": {
      effect: "Reverb",
      adaptive: false,
      invert: false
    },
    "Theta": {
      effect: "Delay",
      adaptive: false,
      invert: false
    },
    "Gamma": {
      effect: "Distortion",
      adaptive: true,
      invert: true      // Low gamma = high distortion
    }
  }
};

// Legacy constants for backward compatibility (derived from CONFIG)
const STEEP = CONFIG.sigmoid.steepness;
const midpoint = CONFIG.sigmoid.fixedMidpoint;
const threshold = CONFIG.adaptive.multiplier;

// =============================================================================
// MIDI OUTPUT CONFIGURATION - Bela GEM Chorus Control
// =============================================================================
const MIDI_CONFIG = {
  enabled: true,           // Set to false to disable MIDI output
  outputName: "Bela",      // Partial match for MIDI output device name
  channel: 0,              // MIDI channel (0-15)

  // CC mappings matching Bela chorus patch
  cc: {
    rate: 1,               // CC1: LFO rate (0.1-8 Hz)
    depth: 2,              // CC2: Modulation depth (0-1)
    feedback: 3,           // CC3: Feedback (0-0.8)
    mix: 4,                // CC4: Chorus wet/dry mix (0-1) - controlled by Alpha
    gain: 5,               // CC5: Master gain (0-1)
    sweep: 6,              // CC6: Auto-sweep toggle (0=off, 127=on)
    satMix: 7,             // CC7: Saturation wet/dry mix (0-1) - controlled by Alpha
    satDrive: 8,           // CC8: Saturation drive amount (maps to 1-10 in PD)
    inputSelect: 9         // CC9: Input source (0=tone generator, 127=live audio input)
  },

  // Fixed values to match Tone.js chorus settings
  // Sent once on MIDI connection
  fixedValues: {
    rate: 24,              // 1.5 Hz: (1.5 / 8) * 127 ≈ 24
    depth: 64,             // 0.5: 0.5 * 127 ≈ 64
    feedback: 64,          // 0.4 after PD ×0.8 scaling — adds richness
    gain: 100,             // ~0.8 default gain
    sweep: 0,              // Turn OFF auto-sweep (xenbox controls params)
    satDrive: 28           // Drive ~3 (maps to (28/127)*9+1 ≈ 3 in PD)
  },

  // Rate limiting for CC messages (ms between sends)
  throttleMs: 50
};

// MIDI state
let midiOutput = null;
let midiEnabled = false;
let lastMidiSendTime = 0;
let _lastLoggedMix = -1;  // Track last logged mix value to reduce console spam
let hasEEGData = false;    // True when Muse is sending data
let midiStatusText = "MIDI: Not initialized";
let encoderThreshold = 64;     // Knob 3 raw value (0-127): threshold offset for effect activation
let activeEffect = 'Saturation';  // Default effect at power-up ('Chorus' or 'Saturation')
let liveInput = false;             // false = tone generator, true = live audio input
let rawAlphaMidi = 0;              // Raw alpha activity 0-127 (pre-threshold, for histogram display)
const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);  // Unique per page load
let smoothedAlpha = 64;            // EMA-smoothed raw alpha (0-127), ~4 second time constant

// WebSocket for LED status reporting
let ledSocket = null;
let lastBelaStatus = null;  // Track last sent status to avoid redundant sends

function connectLEDSocket() {
  try {
    console.log('[LED WS] Attempting to connect to ws://localhost:8765...');
    ledSocket = new WebSocket('ws://localhost:8765');
    ledSocket.onopen = () => {
      console.log('[LED WS] Connected to LED controller');
      // Send current Bela status on connect
      sendBelaStatus(midiEnabled);
    };
    ledSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'encoder_values') {
          // Knob 1: Gain (CC5) — always controls master gain
          const newGain = Math.max(0, Math.min(127, Math.round(msg.gain)));
          if (newGain !== MIDI_CONFIG.fixedValues.gain) {
            MIDI_CONFIG.fixedValues.gain = newGain;
            sendMIDICC(MIDI_CONFIG.cc.gain, newGain);
            console.log(`[ENC] Gain -> ${newGain}`);
          }

          // Knob 2: Depth/Drive — depends on active effect
          const newKnob2 = Math.max(0, Math.min(127, Math.round(msg.depth)));
          if (activeEffect === 'Chorus') {
            if (newKnob2 !== MIDI_CONFIG.fixedValues.depth) {
              MIDI_CONFIG.fixedValues.depth = newKnob2;
              sendMIDICC(MIDI_CONFIG.cc.depth, newKnob2);
              console.log(`[ENC] Depth -> ${newKnob2}`);
            }
          } else {
            if (newKnob2 !== MIDI_CONFIG.fixedValues.satDrive) {
              MIDI_CONFIG.fixedValues.satDrive = newKnob2;
              sendMIDICC(MIDI_CONFIG.cc.satDrive, newKnob2);
              console.log(`[ENC] Drive -> ${newKnob2}`);
            }
          }

          // Knob 3: Threshold — controls effect activation offset
          const newThreshold = Math.max(0, Math.min(127, Math.round(msg.threshold)));
          if (newThreshold !== encoderThreshold) {
            encoderThreshold = newThreshold;
            console.log(`[ENC] Threshold -> ${newThreshold}`);
          }
        }
      } catch (e) {
        // Ignore parse errors on incoming messages
      }
    };
    ledSocket.onclose = () => {
      console.log('[LED WS] Disconnected, reconnecting in 2s...');
      ledSocket = null;
      setTimeout(connectLEDSocket, 2000);
    };
    ledSocket.onerror = (err) => {
      console.log('[LED WS] Error, will retry on close');
      // Don't retry here - onclose will handle it
    };
  } catch (e) {
    console.log('[LED WS] Exception:', e);
    setTimeout(connectLEDSocket, 2000);
  }
}

function sendBelaStatus(connected) {
  if (ledSocket?.readyState === WebSocket.OPEN && lastBelaStatus !== connected) {
    ledSocket.send(JSON.stringify({
      type: 'bela_status',
      connected: connected
    }));
    lastBelaStatus = connected;
  }
}

function sendAlphaScore(wetVal) {
  // Send the exact effect mix value (0-1) to LED controller for blue LED
  try {
    if (ledSocket?.readyState === WebSocket.OPEN) {
      ledSocket.send(JSON.stringify({ type: 'alpha_score', wet: wetVal }));
    }
  } catch (e) {
    console.log('[LED] sendAlphaScore failed:', e);
  }
}

// MIDI parameter values for visualization (0-127 scale)
let midiValues = {
  mix: 0,
  rate: 0,
  depth: 0,
  feedback: 0,
  gain: 0,
  sweep: 0,
  satMix: 0,
  satDrive: 0
};

// History for animated bars (smooth transitions)
let midiValueHistory = {
  mix: []
};
const MIDI_HISTORY_LENGTH = 50;

// EEG values for histogram display (normalized 0-1)
let eegDisplayValues = {
  alpha: 0,
  theta: 0,
  lowBeta: 0,
  highBeta: 0,
  gamma: 0
};

// Heart rate and worn detection
let heartRate = 0;
let isWorn = false;
let ppgSampleCount = 0;
let lastPpgValue = 0;
let ppgWaveform = [];
let ppgVariance = 0;

// UI elements
let micSelect;
let userMic;
let checkboxes = {};

// Audio effects
let chorus, flanger, reverb, delay, distortion;

// Running statistics for adaptive thresholding
let alphaN = 0;
let alphaMean = 0;
let gammaN = 0;
let gammaMean = 0;

// Effect names mapped to EEG bands
const effectNames = ["Chorus", "Flanger", "Reverb", "Delay", "Distortion"];
const eegBands = ["Alpha", "Low Beta", "High Beta", "Theta", "Gamma"];

// Signal history for plotting
const HISTORY_LENGTH = 300; // number of samples to display (~10 seconds at 30Hz)
let signalHistory = {
  "Alpha": [],
  "Low Beta": [],
  "High Beta": [],
  "Theta": [],
  "Gamma": [],
  "Weighted": []
};

// Frame rate tracking
let lastUpdateTime = 0;
let updateCount = 0;
let displayFPS = 0;

// Helper functions
function divideIfNotZero(numerator, denominator) {
  if (denominator === 0 || isNaN(denominator)) {
    return 0;
  }
  return numerator / denominator;
}

function sigmoid(x, k = STEEP, m = midpoint) {
  return 1 / (1 + Math.exp(-k * (x - m)));
}

// =============================================================================
// MIDI OUTPUT FUNCTIONS - Send CC to Bela GEM
// =============================================================================

// Store MIDI access for reconnection
let midiAccess = null;

async function initMIDI() {
  console.log("[MIDI] Initializing MIDI output...");
  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log(`[MIDI] Found ${midiAccess.outputs.size} MIDI output(s)`);

    // Listen for MIDI device connect/disconnect events
    midiAccess.onstatechange = (event) => {
      console.log(`[MIDI] State change: ${event.port.name} - ${event.port.state}`);
      if (event.port.type === 'output') {
        if (event.port.state === 'disconnected') {
          // Check if it was our Bela output
          if (midiOutput && event.port.id === midiOutput.id) {
            console.log("[MIDI] Bela disconnected!");
            midiOutput = null;
            midiEnabled = false;
            midiStatusText = "MIDI: Bela disconnected";
            sendBelaStatus(false);  // Notify LED controller
          }
        } else if (event.port.state === 'connected') {
          // Try to reconnect to Bela
          if (event.port.name.toLowerCase().includes(MIDI_CONFIG.outputName.toLowerCase())) {
            console.log("[MIDI] Bela reconnected!");
            connectToMIDIOutput(event.port);
          }
        }
      }
    };

    // Find and connect to Bela output
    for (const output of midiAccess.outputs.values()) {
      console.log(`[MIDI] Output available: "${output.name}"`);
      if (output.name.toLowerCase().includes(MIDI_CONFIG.outputName.toLowerCase())) {
        connectToMIDIOutput(output);
        return;
      }
    }

    // If Bela not found, list available outputs
    const outputNames = Array.from(midiAccess.outputs.values()).map(o => o.name);
    if (outputNames.length > 0) {
      midiStatusText = `MIDI: Bela not found. Available: ${outputNames.join(", ")}`;
      console.log("Bela not found. Available MIDI outputs:", outputNames);
    } else {
      midiStatusText = "MIDI: No outputs available";
      console.log("No MIDI outputs available");
    }
  } catch (err) {
    midiStatusText = `MIDI: Error - ${err.message}`;
    console.error("MIDI initialization error:", err);
  }
}

function connectToMIDIOutput(output) {
  midiOutput = output;
  midiEnabled = true;
  midiStatusText = `MIDI: Connected to ${output.name}`;
  console.log(`[MIDI] Connected to: ${output.name}`);
  sendBelaStatus(true);  // Notify LED controller

  // Send fixed parameter values on connect
  setTimeout(() => {
    sendMIDICC(MIDI_CONFIG.cc.rate, MIDI_CONFIG.fixedValues.rate);
    sendMIDICC(MIDI_CONFIG.cc.depth, MIDI_CONFIG.fixedValues.depth);
    sendMIDICC(MIDI_CONFIG.cc.feedback, MIDI_CONFIG.fixedValues.feedback);
    sendMIDICC(MIDI_CONFIG.cc.gain, MIDI_CONFIG.fixedValues.gain);
    sendMIDICC(MIDI_CONFIG.cc.sweep, MIDI_CONFIG.fixedValues.sweep);
    sendMIDICC(MIDI_CONFIG.cc.satDrive, MIDI_CONFIG.fixedValues.satDrive);
    // Set initial mix based on default effect
    sendMIDICC(MIDI_CONFIG.cc.mix, activeEffect === 'Chorus' ? 0 : 0);
    sendMIDICC(MIDI_CONFIG.cc.satMix, 0);
    sendMIDICC(MIDI_CONFIG.cc.inputSelect, liveInput ? 127 : 0);
    console.log("[MIDI] Sent parameters to Bela (default effect: " + activeEffect + ")");
  }, 500);
}

function sendMIDICC(cc, value) {
  if (!midiOutput || !midiEnabled) return;

  // Clamp value to 0-127
  const midiValue = Math.max(0, Math.min(127, Math.round(value)));

  // Send CC message: [status, cc number, value]
  // Status = 0xB0 + channel for CC messages
  const status = 0xB0 + MIDI_CONFIG.channel;
  midiOutput.send([status, cc, midiValue]);

  // Track values for visualization
  if (cc === MIDI_CONFIG.cc.mix) {
    midiValues.mix = midiValue;
    if (activeEffect === 'Chorus') {
      midiValueHistory.mix.push(midiValue);
      if (midiValueHistory.mix.length > MIDI_HISTORY_LENGTH) midiValueHistory.mix.shift();
    }
  } else if (cc === MIDI_CONFIG.cc.rate) {
    midiValues.rate = midiValue;
  } else if (cc === MIDI_CONFIG.cc.depth) {
    midiValues.depth = midiValue;
  } else if (cc === MIDI_CONFIG.cc.feedback) {
    midiValues.feedback = midiValue;
  } else if (cc === MIDI_CONFIG.cc.gain) {
    midiValues.gain = midiValue;
  } else if (cc === MIDI_CONFIG.cc.sweep) {
    midiValues.sweep = midiValue;
  } else if (cc === MIDI_CONFIG.cc.satMix) {
    midiValues.satMix = midiValue;
    if (activeEffect === 'Saturation') {
      midiValueHistory.mix.push(midiValue);
      if (midiValueHistory.mix.length > MIDI_HISTORY_LENGTH) midiValueHistory.mix.shift();
    }
  } else if (cc === MIDI_CONFIG.cc.satDrive) {
    midiValues.satDrive = midiValue;
  }
}

function sendMIDICCThrottled(cc, value) {
  const now = performance.now();
  if (now - lastMidiSendTime < MIDI_CONFIG.throttleMs) return;
  lastMidiSendTime = now;
  sendMIDICC(cc, value);
}

function setup() {
  // Fill most of the window
  createCanvas(windowWidth - 20, windowHeight - 20);
  textAlign(CENTER, CENTER);
  textSize(14);

  // Initialize MIDI output to Bela
  if (MIDI_CONFIG.enabled) {
    initMIDI();
  }

  // Connect to LED status WebSocket
  connectLEDSocket();

  // Close WebSocket cleanly on page unload so stale connections don't linger
  window.addEventListener('beforeunload', () => {
    if (ledSocket) {
      ledSocket.onclose = null;  // Prevent reconnect attempt
      ledSocket.close();
      ledSocket = null;
    }
  });

  // Mic selector
  navigator.mediaDevices.enumerateDevices().then(devices => {
    const inputs = devices.filter(d => d.kind === 'audioinput');
    micSelect = createSelect();
    micSelect.position(20, 20);
    micSelect.option("Choose a mic", "");

    inputs.forEach(device => {
      micSelect.option(device.label || `Device ${device.deviceId}`, device.deviceId);
    });

    micSelect.changed(() => startWithDevice(micSelect.value()));
  });

  // Effect selection — radio-style (only one active at a time)
  // Saturation ("Harmonics") is the default at power-up
  let y = 60;
  const effectOptions = [
    { name: "Harmonics", key: "Saturation" },
    { name: "Chorus", key: "Chorus" }
  ];
  for (let opt of effectOptions) {
    const isDefault = (opt.key === activeEffect);
    const checkbox = createCheckbox(opt.name, isDefault);
    checkbox.position(20, y);
    checkbox.changed(() => {
      // Radio behavior: only one active at a time
      if (checkbox.checked()) {
        activeEffect = opt.key;
        // Uncheck the other
        for (let other of effectOptions) {
          if (other.key !== opt.key && checkboxes[other.key]) {
            checkboxes[other.key].checked(false);
          }
        }
      } else {
        // Don't allow unchecking the active one — recheck it
        checkbox.checked(true);
      }
    });
    checkboxes[opt.key] = checkbox;
    y += 25;
  }

  // Audio input toggle checkbox
  y += 10;  // Small gap after effect selection
  const inputCheckbox = createCheckbox("Live Input", false);
  inputCheckbox.position(20, y);
  inputCheckbox.changed(() => {
    liveInput = inputCheckbox.checked();
    sendMIDICC(MIDI_CONFIG.cc.inputSelect, liveInput ? 127 : 0);
    console.log(`[INPUT] Source: ${liveInput ? 'Live Audio' : 'Tone Generator'}`);
  });

  // Initialize audio effects
  chorus = new Tone.Chorus({
    frequency: 1.5,
    delayTime: 3.5,
    depth: .5,
    spread: 180,
    type: "sine"
  }).start();

  flanger = new Tone.FeedbackDelay(0.005, 0.5);
  reverb = new Tone.Reverb(10);
  delay = new Tone.FeedbackDelay(0.25, 0.4);
  distortion = new Tone.Distortion();
}

async function startWithDevice(deviceId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    });
    stream.getTracks().forEach(track => track.stop());

    await Tone.start();
    await Tone.context.resume();

    if (userMic) {
      userMic.disconnect();
      userMic.dispose();
    }

    userMic = new Tone.UserMedia();
    await userMic.open();
    updateWetValues();
  } catch (err) {
    console.error("Error accessing device:", err);
  }
}

function updateWetValues() {
  // Disconnect all effects first
  chorus.disconnect();
  flanger.disconnect();
  reverb.disconnect();
  delay.disconnect();
  distortion.disconnect();

  // Reconnect mic through chorus to destination (browser-side audio)
  if (userMic) userMic.disconnect();
  if (userMic) userMic.connect(chorus);
  chorus.connect(Tone.Destination);
}

function draw() {
  background(240);

  // Track update rate
  updateCount++;
  const currentTime = millis();
  if (currentTime - lastUpdateTime > 1000) {
    displayFPS = updateCount;
    updateCount = 0;
    lastUpdateTime = currentTime;
  }

  // Extract EEG values from data object (already scaled by sliders)
  const alpha = isFinite(Number(data?.["Alpha"])) ? Number(data["Alpha"]) : 0;
  const lowBeta = isFinite(Number(data?.["Low Beta"])) ? Number(data["Low Beta"]) : 0;
  const highBeta = isFinite(Number(data?.["High Beta"])) ? Number(data["High Beta"]) : 0;
  const theta = isFinite(Number(data?.["Theta"])) ? Number(data["Theta"]) : 0;
  const gamma = isFinite(Number(data?.["Gamma"])) ? Number(data["Gamma"]) : 0;

  // Extract heart rate and worn state (from PPG)
  heartRate = isFinite(Number(data?.["HR"])) ? Number(data["HR"]) : 0;
  isWorn = data?.["isWorn"] === true;
  ppgSampleCount = isFinite(Number(data?.["ppgSampleCount"])) ? Number(data["ppgSampleCount"]) : 0;
  lastPpgValue = isFinite(Number(data?.["lastPpgValue"])) ? Number(data["lastPpgValue"]) : 0;
  ppgVariance = isFinite(Number(data?.["ppgVariance"])) ? Number(data["ppgVariance"]) : 0;
  if (Array.isArray(data?.["ppgWaveform"])) {
    ppgWaveform = data["ppgWaveform"];
  }

  // Weighted aggregate = sum of all parameter values (slider-scaled data)
  const weighted = alpha + lowBeta + highBeta + theta + gamma;
  hasEEGData = weighted > 0;  // Track if Muse is actually sending data

  // Calculate sum for normalization (for relative values used in effects)
  const sum = weighted; // same as the sum of all components

  // Relative values (normalized to sum) - for effect control
  const alpha_rel = divideIfNotZero(alpha, sum);
  const lowBeta_rel = divideIfNotZero(lowBeta, sum);
  const highBeta_rel = divideIfNotZero(highBeta, sum);
  const theta_rel = divideIfNotZero(theta, sum);
  const gamma_rel = divideIfNotZero(gamma, sum);

  // Store EEG values for histogram display
  eegDisplayValues.alpha = alpha_rel;
  eegDisplayValues.theta = theta_rel;
  eegDisplayValues.lowBeta = lowBeta_rel;
  eegDisplayValues.highBeta = highBeta_rel;
  eegDisplayValues.gamma = gamma_rel;

  // Update running statistics for adaptive thresholding
  alphaN += 1;
  alphaMean += (alpha_rel - alphaMean) / alphaN;

  gammaN += 1;
  gammaMean += (gamma_rel - gammaMean) / gammaN;

  // Calculate effect wet value using threshold offset
  // Knob 3 (encoderThreshold, 0-127) controls how far above personal alpha mean
  // the alpha must be before the effect activates.
  // At threshold=64: effect is off at baseline, activates on elevated alpha
  // At threshold=0: effect is always somewhat active
  // At threshold=127: effect needs very high alpha to activate
  const alphaDeviation = alpha_rel - alphaMean;  // How far from personal baseline
  // Raw alpha mix: sigmoid maps deviation to 0-1 (no threshold applied)
  // This is what the histogram bar shows — pure alpha activity
  const rawAlphaMix = 1 / (1 + Math.exp(-10 * alphaDeviation));  // 0.5 at baseline, higher with more alpha
  rawAlphaMidi = rawAlphaMix * 127;  // 0-127 for histogram display

  // EMA smoothing on raw alpha: ~2 second time constant at ~60fps
  const smoothK = 0.008;
  smoothedAlpha += smoothK * (rawAlphaMidi - smoothedAlpha);

  // Threshold gate applied AFTER smoothing
  // Effect intensity proportional to how far smoothed alpha exceeds threshold
  const thresholdMidi = encoderThreshold;  // Knob 3 raw value 0-127
  const chorus_wetVal = smoothedAlpha > thresholdMidi
    ? Math.min(1, (smoothedAlpha - thresholdMidi) / (127 - thresholdMidi))
    : 0;

  // Send effect mix value to LED controller (~20Hz)
  if (frameCount % 3 === 0) {
    sendAlphaScore(chorus_wetVal);
  }

  // Other effects use sigmoid
  const flanger_wetVal = sigmoid(lowBeta_rel);
  const reverb_wetVal = sigmoid(highBeta_rel);
  const delay_feedback = sigmoid(theta_rel);
  const distortion_wetVal = 1 - sigmoid(gamma_rel, STEEP, gammaMean * threshold);

  // Update signal history (store raw slider-scaled values, not relative)
  signalHistory["Alpha"].push(alpha);
  signalHistory["Low Beta"].push(lowBeta);
  signalHistory["High Beta"].push(highBeta);
  signalHistory["Theta"].push(theta);
  signalHistory["Gamma"].push(gamma);
  signalHistory["Weighted"].push(weighted);

  // Trim history to max length
  for (let key in signalHistory) {
    if (signalHistory[key].length > HISTORY_LENGTH) {
      signalHistory[key].shift();
    }
  }

  // Console logging - log every 30 seconds (reduced to minimize noise)
  if (frameCount % 1800 === 0) {
    console.log(`[XENBOX] Alpha:${nf(alpha_rel,1,3)} Chorus:${nf(chorus_wetVal,1,2)} HR:${heartRate} Worn:${isWorn?'YES':'NO'} MIDI:${midiEnabled&&isWorn?'ON':'SUPPRESSED'}`);
  }

  // Draw signal plots (first, so overlays render on top)
  drawSignalPlots();

  // Draw MIDI parameter histogram
  drawMIDIHistogram();

  // Draw PPG waveform for debugging
  drawPPGWaveform();

  // Consolidated status panel (drawn AFTER plots so it renders on top)
  push();
  const panelX = 280;
  const panelY = 5;
  const panelW = 280;
  const panelH = 90;
  const rowH = 20;
  const dotR = 6;
  const textStartX = panelX + 25;

  // Dark semi-transparent background
  fill(30, 30, 30, 200);
  noStroke();
  rect(panelX, panelY, panelW, panelH, 8);

  // Row 1: MUSE status - green when PPG data flowing
  const museOk = ppgSampleCount > 0;
  fill(museOk ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  text(`MUSE: ${museOk ? 'Connected' : 'No Data'}`, textStartX, panelY + 15);

  // Row 2: HEADSET status - green when worn
  fill(isWorn ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15 + rowH, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  if (isWorn) {
    text(`HEADSET: On Head (${heartRate || '--'} BPM)`, textStartX, panelY + 15 + rowH);
  } else {
    text('HEADSET: Off Head', textStartX, panelY + 15 + rowH);
  }

  // Row 3: BELA status - green when MIDI active
  fill(midiEnabled ? color(0, 200, 0) : color(200, 0, 0));
  noStroke();
  ellipse(panelX + 14, panelY + 15 + rowH * 2, dotR * 2, dotR * 2);
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  text(`BELA: ${midiEnabled ? 'MIDI Active' : 'Not Connected'}`, textStartX, panelY + 15 + rowH * 2);

  // Row 4: FPS (small, dimmed)
  fill(150);
  textSize(12);
  text(`FPS: ${displayFPS}`, textStartX, panelY + 15 + rowH * 3);

  pop();

  // Encoder values - large separate display below status panel
  push();
  const encX = panelX;
  const encY = panelY + panelH + 10;
  const encW = 340;
  const encH = 80;

  // Background
  fill(30, 30, 30, 220);
  noStroke();
  rect(encX, encY, encW, encH, 8);

  // Effect name + encoder label
  const effectLabel = activeEffect === 'Chorus' ? 'CHORUS' : 'HARMONICS';
  const knob2Label = activeEffect === 'Chorus' ? 'DEPTH' : 'DRIVE';
  const knob2Value = activeEffect === 'Chorus' ? MIDI_CONFIG.fixedValues.depth : MIDI_CONFIG.fixedValues.satDrive;
  fill(255, 220, 0);
  textSize(20);
  textAlign(LEFT, TOP);
  text(`EFFECT: ${effectLabel}`, encX + 10, encY + 5);

  // Values
  textSize(18);
  fill(255);
  text(`GAIN:${MIDI_CONFIG.fixedValues.gain}  ${knob2Label}:${knob2Value}  THR:${encoderThreshold}`, encX + 10, encY + 35);

  // Show threshold status: effect active or inactive
  const thresholdActive = chorus_wetVal > 0.1;
  fill(thresholdActive ? color(0, 150, 255) : color(80));
  textSize(14);
  text(thresholdActive ? 'ACTIVE' : 'IDLE', encX + 10, encY + 60);

  pop();

  // Apply effect modulations based on active effect
  // MIDI is suppressed when: no EEG data (Muse not connected) or headset not worn
  // Use sendMIDICC (not throttled) for both to avoid single-timestamp throttle
  // blocking the zero-out of the inactive effect
  if (midiEnabled && hasEEGData) {
    const wetValue = isWorn ? chorus_wetVal * 127 : 0;

    if (activeEffect === 'Chorus') {
      sendMIDICCThrottled(MIDI_CONFIG.cc.mix, wetValue);
      sendMIDICC(MIDI_CONFIG.cc.satMix, 0);
    } else {
      sendMIDICCThrottled(MIDI_CONFIG.cc.satMix, wetValue);
      sendMIDICC(MIDI_CONFIG.cc.mix, 0);
    }
  }

  // Also apply to Tone.js chorus (browser-side, if mic is active)
  chorus.wet.value = (activeEffect === 'Chorus' && isWorn) ? chorus_wetVal : 0;
  flanger.wet.value = 0;
  reverb.wet.value = 0;
  delay.feedback.value = 0;
  distortion.wet.value = 0;
}

function drawSignalPlots() {
  // Dynamic sizing based on canvas
  const plotX = 280;
  const plotY = 50;
  const plotWidth = width - plotX - 20;
  const plotHeight = height - plotY - 80;
  const plotPadding = 10;

  // Background for plot area
  push();
  fill(255);
  stroke(100);
  strokeWeight(1);
  rect(plotX, plotY, plotWidth, plotHeight);
  pop();

  // Colors for each band
  const colors = {
    "Alpha": [255, 100, 100],      // Red
    "Low Beta": [100, 255, 100],   // Green
    "High Beta": [100, 100, 255],  // Blue
    "Theta": [255, 200, 100],      // Orange
    "Gamma": [200, 100, 255],      // Purple
    "Weighted": [50, 50, 50]       // Dark gray
  };

  // Calculate auto-scaling range based on all current data
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let bandName in signalHistory) {
    const history = signalHistory[bandName];
    for (let val of history) {
      if (isFinite(val)) {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
  }

  // Handle edge cases
  if (!isFinite(minVal) || !isFinite(maxVal)) {
    minVal = 0;
    maxVal = 1;
  }

  // Add 15% padding to range for better visualization
  const range = maxVal - minVal;
  const padding = range * 0.15;
  minVal = minVal - padding;
  maxVal = maxVal + padding;

  // Ensure minimum range for stability when signals are very flat
  if (maxVal - minVal < 0.01) {
    const center = (maxVal + minVal) / 2;
    minVal = center - 0.01;
    maxVal = center + 0.01;
  }

  // Allow negative values and values > 1 for full dynamic range
  // (don't clamp to 0-1 anymore)

  // Draw grid lines
  push();
  stroke(220);
  strokeWeight(1);
  for (let i = 0; i <= 4; i++) {
    const y = plotY + plotPadding + (plotHeight - 2 * plotPadding) * i / 4;
    line(plotX + plotPadding, y, plotX + plotWidth - plotPadding, y);
  }
  pop();

  // Draw each signal
  const drawableWidth = plotWidth - 2 * plotPadding;
  const drawableHeight = plotHeight - 2 * plotPadding;

  for (let bandName in signalHistory) {
    const history = signalHistory[bandName];
    if (history.length < 2) continue;

    const color = colors[bandName] || [0, 0, 0];
    const lineWidth = bandName === "Weighted" ? 3 : 1.5;

    push();
    stroke(color[0], color[1], color[2]);
    strokeWeight(lineWidth);
    noFill();

    beginShape();
    for (let i = 0; i < history.length; i++) {
      const x = plotX + plotPadding + (drawableWidth * i) / (HISTORY_LENGTH - 1);
      // Map value from [minVal, maxVal] to full plot height
      const normalizedVal = (history[i] - minVal) / (maxVal - minVal);
      const val = constrain(normalizedVal, 0, 1);
      const y = plotY + plotPadding + drawableHeight - (val * drawableHeight);
      vertex(x, y);
    }
    endShape();
    pop();
  }

  // Draw legend
  push();
  textSize(11);
  textAlign(LEFT, CENTER);
  let legendY = plotY + 15;
  for (let bandName of ["Alpha", "Low Beta", "High Beta", "Theta", "Gamma", "Weighted"]) {
    const color = colors[bandName];
    fill(color[0], color[1], color[2]);
    noStroke();
    rect(plotX + plotWidth - 90, legendY - 4, 15, 8);
    fill(0);
    text(bandName, plotX + plotWidth - 70, legendY);
    legendY += 15;
  }
  pop();

  // Y-axis labels (showing actual scaled range)
  push();
  fill(0);
  textSize(10);
  textAlign(RIGHT, CENTER);
  for (let i = 0; i <= 4; i++) {
    const y = plotY + plotPadding + (plotHeight - 2 * plotPadding) * i / 4;
    const val = maxVal - ((maxVal - minVal) * i / 4);
    text(nf(val, 1, 3), plotX + plotPadding - 5, y);
  }
  pop();

  // Title
  push();
  fill(0);
  textSize(14);
  textAlign(CENTER, TOP);
  text("EEG Signal Monitor (Relative Power)", plotX + plotWidth / 2, plotY - 25);
  pop();
}

function drawMIDIHistogram() {
  const histX = 20;
  const histY = 200;
  const histWidth = 240;
  const histHeight = height - histY - 20;
  const barPadding = 4;
  const barHeight = 18;

  // Background
  push();
  fill(240);
  stroke(100);
  strokeWeight(1);
  rect(histX, histY, histWidth, histHeight, 5);
  pop();

  // ========== EEG SECTION ==========
  push();
  fill(0);
  textSize(11);
  textAlign(CENTER, TOP);
  text("EEG Bands (Relative)", histX + histWidth / 2, histY + 5);
  pop();

  // EEG parameters (0-1 scale, shown as percentage)
  const eegParams = [
    { name: "Alpha", value: eegDisplayValues.alpha, color: [255, 100, 100] },
    { name: "Theta", value: eegDisplayValues.theta, color: [255, 200, 100] },
    { name: "Low Beta", value: eegDisplayValues.lowBeta, color: [100, 255, 100] },
    { name: "High Beta", value: eegDisplayValues.highBeta, color: [100, 100, 255] },
    { name: "Gamma", value: eegDisplayValues.gamma, color: [200, 100, 255] }
  ];

  const barMaxWidth = histWidth - 70;
  let y = histY + 22;

  for (let param of eegParams) {
    // Label
    push();
    fill(0);
    textSize(9);
    textAlign(LEFT, CENTER);
    text(param.name, histX + 5, y + barHeight / 2);
    pop();

    // Bar background
    push();
    fill(200);
    noStroke();
    rect(histX + 55, y, barMaxWidth, barHeight, 3);
    pop();

    // Value bar (0-1 maps to full width)
    const barWidth = Math.min(param.value, 1) * barMaxWidth;
    push();
    fill(param.color);
    noStroke();
    rect(histX + 55, y, barWidth, barHeight, 3);
    pop();

    // Value text (show as percentage)
    push();
    fill(0);
    textSize(9);
    textAlign(RIGHT, CENTER);
    text((param.value * 100).toFixed(0) + "%", histX + histWidth - 5, y + barHeight / 2);
    pop();

    y += barHeight + barPadding;
  }

  // ========== MIDI SECTION ==========
  y += 8;
  push();
  fill(0);
  textSize(11);
  textAlign(CENTER, TOP);
  text("MIDI to Bela", histX + histWidth / 2, y);
  pop();
  y += 16;

  // MIDI parameters (0-127 scale)
  // Mix bar shows RAW alpha activity (pre-threshold), not the gated value
  const knob2Name = activeEffect === 'Chorus' ? "Depth" : "Drive";
  const knob2Val = activeEffect === 'Chorus' ? midiValues.depth : midiValues.satDrive;
  const midiParams = [
    { name: "Mix", value: Math.round(smoothedAlpha), color: [76, 175, 80], dynamic: true },
    { name: knob2Name, value: knob2Val, color: [100, 100, 100], dynamic: false },
    { name: "Gain", value: midiValues.gain, color: [100, 100, 100], dynamic: false }
  ];

  for (let param of midiParams) {
    // Label
    push();
    fill(0);
    textSize(9);
    textAlign(LEFT, CENTER);
    text(param.name, histX + 5, y + barHeight / 2);
    pop();

    // Bar background
    push();
    fill(200);
    noStroke();
    rect(histX + 55, y, barMaxWidth, barHeight, 3);
    pop();

    // Value bar
    const barWidth = (param.value / 127) * barMaxWidth;
    push();
    fill(param.color);
    noStroke();
    rect(histX + 55, y, barWidth, barHeight, 3);
    pop();

    // Orange threshold marker on Mix bar
    if (param.dynamic) {
      const thrX = histX + 55 + (encoderThreshold / 127) * barMaxWidth;
      push();
      stroke(255, 100, 0);
      strokeWeight(2);
      line(thrX, y, thrX, y + barHeight);
      pop();
    }

    // Value text
    push();
    fill(0);
    textSize(9);
    textAlign(RIGHT, CENTER);
    text(param.value, histX + histWidth - 5, y + barHeight / 2);
    pop();

    y += barHeight + barPadding;
  }

}

function drawPPGWaveform() {
  // Draw PPG waveform at bottom of screen for debugging
  const ppgX = 280;
  const ppgY = height - 70;
  const ppgWidth = width - ppgX - 20;
  const ppgHeight = 60;

  // Background
  push();
  fill(255);
  stroke(100);
  strokeWeight(1);
  rect(ppgX, ppgY, ppgWidth, ppgHeight, 3);
  pop();

  // Title
  push();
  fill(0);
  textSize(10);
  textAlign(LEFT, TOP);
  const ppgStatus = ppgSampleCount > 0 ? `(${ppgSampleCount} samples)` : '(no data)';
  text(`PPG Waveform ${ppgStatus}`, ppgX + 5, ppgY + 2);
  pop();

  // Draw waveform if we have data
  if (ppgWaveform && ppgWaveform.length > 1) {
    // Find min/max for scaling
    let minVal = Infinity, maxVal = -Infinity;
    for (let v of ppgWaveform) {
      if (isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }

    // Ensure some range
    if (maxVal - minVal < 1) {
      const center = (maxVal + minVal) / 2;
      minVal = center - 0.5;
      maxVal = center + 0.5;
    }

    // Draw the waveform
    push();
    stroke(255, 0, 100);  // Pink/red for PPG (blood)
    strokeWeight(1.5);
    noFill();
    beginShape();
    for (let i = 0; i < ppgWaveform.length; i++) {
      const x = ppgX + 5 + (i / (ppgWaveform.length - 1)) * (ppgWidth - 10);
      const normalized = (ppgWaveform[i] - minVal) / (maxVal - minVal);
      const y = ppgY + 15 + (ppgHeight - 20) - normalized * (ppgHeight - 20);
      vertex(x, y);
    }
    endShape();
    pop();

    // Show value range
    push();
    fill(100);
    textSize(8);
    textAlign(RIGHT, TOP);
    text(`max: ${maxVal.toFixed(0)}`, ppgX + ppgWidth - 5, ppgY + 2);
    textAlign(RIGHT, BOTTOM);
    text(`min: ${minVal.toFixed(0)}`, ppgX + ppgWidth - 5, ppgY + ppgHeight - 2);
    pop();
  } else {
    // No data message
    push();
    fill(150);
    textSize(12);
    textAlign(CENTER, CENTER);
    text("No PPG data received", ppgX + ppgWidth / 2, ppgY + ppgHeight / 2);
    pop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth - 20, windowHeight - 20);
}
