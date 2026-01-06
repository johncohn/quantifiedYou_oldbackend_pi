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
 * Description:
 * This visualization uses EEG brain wave data from a Muse headset to control
 * audio effects in real-time. Each frequency band (Alpha, Beta, Theta, Gamma)
 * modulates different audio parameters, creating an auditory neurofeedback experience.
 *
 * EEG Bands:
 * - Alpha (8-12 Hz): Relaxed, calm state - controls Chorus
 * - Low Beta (12-15 Hz): Relaxed focus - controls Flanger
 * - High Beta (15-30 Hz): Active thinking - controls Reverb
 * - Theta (4-8 Hz): Deep relaxation, meditation - controls Delay
 * - Gamma (30+ Hz): High-level cognition - controls Distortion
 */

// Configuration constants
const STEEP = 60; // larger values for steeper sigmoid transition
const midpoint = 0.3; // threshold for effect activation (adjust based on your baseline EEG)
const threshold = 1.25; // multiplier for adaptive thresholding

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
const HISTORY_LENGTH = 100; // number of samples to display (reduced for faster scrolling)
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

function setup() {
  createCanvas(800, 600);
  textAlign(CENTER, CENTER);
  textSize(14);

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

  // Checkboxes for effects
  let y = 60;
  for (let name of effectNames) {
    const checkbox = createCheckbox(name, false);
    checkbox.position(20, y);
    checkbox.changed(() => updateWetValues());
    checkboxes[name] = checkbox;
    y += 25;
  }

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

  // Reconnect mic and chain effects
  if (userMic) userMic.disconnect();
  if (userMic) userMic.connect(chorus);

  let lastNode = chorus;

  if (checkboxes["Chorus"].checked()) {
    lastNode = chorus;
  }

  if (checkboxes["Flanger"].checked()) {
    lastNode.connect(flanger);
    lastNode = flanger;
  }

  if (checkboxes["Reverb"].checked()) {
    lastNode.connect(reverb);
    lastNode = reverb;
  }

  if (checkboxes["Delay"].checked()) {
    lastNode.connect(delay);
    lastNode = delay;
  }

  if (checkboxes["Distortion"].checked()) {
    lastNode.connect(distortion);
    lastNode = distortion;
  }

  lastNode.connect(Tone.Destination);
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

  // Weighted aggregate = sum of all parameter values (slider-scaled data)
  const weighted = alpha + lowBeta + highBeta + theta + gamma;

  // Calculate sum for normalization (for relative values used in effects)
  const sum = weighted; // same as the sum of all components

  // Relative values (normalized to sum) - for effect control
  const alpha_rel = divideIfNotZero(alpha, sum);
  const lowBeta_rel = divideIfNotZero(lowBeta, sum);
  const highBeta_rel = divideIfNotZero(highBeta, sum);
  const theta_rel = divideIfNotZero(theta, sum);
  const gamma_rel = divideIfNotZero(gamma, sum);

  // Update running statistics for adaptive thresholding
  alphaN += 1;
  alphaMean += (alpha_rel - alphaMean) / alphaN;

  gammaN += 1;
  gammaMean += (gamma_rel - gammaMean) / gammaN;

  // Calculate effect wet values using sigmoid on relative values
  const chorus_wetVal = sigmoid(alpha_rel, STEEP, alphaMean * threshold);
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

  // Display statistics
  push();
  fill(0);
  textSize(14);
  textAlign(LEFT, TOP);
  text(`Alpha Mean: ${nf(alphaMean, 1, 3)} | Chorus: ${nf(chorus_wetVal, 1, 2)}`, 20, 200);
  text(`Gamma Mean: ${nf(gammaMean, 1, 3)} | Distortion: ${nf(distortion_wetVal, 1, 2)}`, 20, 220);
  text(`Frame Rate: ${displayFPS} fps | Data Points: ${signalHistory["Alpha"].length}`, 20, 240);
  pop();

  // Draw signal plots
  drawSignalPlots();

  // Apply effect modulations
  if (checkboxes["Chorus"].checked()) {
    chorus.wet.value = chorus_wetVal;
  } else {
    chorus.wet.value = 0;
  }

  if (checkboxes["Flanger"].checked()) {
    flanger.wet.value = flanger_wetVal;
  } else {
    flanger.wet.value = 0;
  }

  if (checkboxes["Reverb"].checked()) {
    reverb.wet.value = reverb_wetVal;
  } else {
    reverb.wet.value = 0;
  }

  if (checkboxes["Delay"].checked()) {
    delay.feedback.value = map(delay_feedback, 0, 1, 0, 0.3);
  } else {
    delay.feedback.value = 0;
  }

  if (checkboxes["Distortion"].checked()) {
    distortion.wet.value = distortion_wetVal;
  } else {
    distortion.wet.value = 0;
  }
}

function drawSignalPlots() {
  const plotX = 250;
  const plotY = 250;
  const plotWidth = 530;
  const plotHeight = 320;
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
