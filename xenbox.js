const STEEP = 60; // larger values for steeper transition
const midpoint = 0.3; // if you want to define manually, this should hover around wherever your resting alpha value is (you can check the bar graph)
const threshold = 1.25; // Decide how far above your average alpha value you want the effect to kick in

let micSelect;
let userMic;
let checkboxes = {};
let sum;

let chorus, flanger, reverb, delay, distortion;

let chorusN = 0; // how many samples we've seen
let chorusMean = 0; // the current running average

let distortionN = 0; // how many samples we've seen
let distortionMean = 0; // the current running average

const effectNames = ["Chorus", "Flanger", "Reverb", "Delay", "Distortion"];

function divideIfNotZero(numerator, denominator) {
if (denominator === 0 || isNaN(denominator)) {
return 0;
}
else {
return numerator / denominator;
}
}

function sigmoid(x, k = STEEP, m = midpoint) {
return 1 / (1 + Math.exp(-k * (x - m)));
}


function setup() {
createCanvas(600, 300);
textAlign(CENTER, CENTER);
textSize(14);

// Mic selector
navigator.mediaDevices.enumerateDevices().then(devices => {
const inputs = devices.filter(d => d.kind === 'audioinput');
micSelect = createSelect();
micSelect.position(100, 60);
micSelect.option("Choose a mic", "");

inputs.forEach(device => {
micSelect.option(device.label || `Device ${device.deviceId}`, device.deviceId);
});

micSelect.changed(() => startWithDevice(micSelect.value()));
});

// Checkboxes
let y = 100;
for (let name of effectNames) {
const checkbox = createCheckbox(name, false);
checkbox.position(100, y);
checkbox.changed(() => updateWetValues());
checkboxes[name] = checkbox;
y += 25;
}

// Effects
chorus = new Tone.Chorus({
frequency: 1.5,
delayTime: 3.5,
depth: .5,
spread: 180,
type: "sine"
});

flanger = new Tone.FeedbackDelay(0.005, 0.5);
//filter = new Tone.Filter(2000, "lowpass");
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
chorus.start();
updateWetValues();
} catch (err) {
console.error("Error accessing device:", err);
}
}

function updateWetValues() {
// Disconnect all effects first
chorus.disconnect();
flanger.disconnect();
//filter.disconnect();
reverb.disconnect();
delay.disconnect();
distortion.disconnect();

// Disconnect mic and start chain
if (userMic) userMic.disconnect();
if (userMic) userMic.connect(chorus);

let lastNode = chorus;

if (checkboxes["Chorus"].checked()) {
//chorus.wet.value = 1;
lastNode = chorus;
//} else {
//chorus.wet.value = 0;
}

if (checkboxes["Flanger"].checked()) {
lastNode.connect(flanger);
//flanger.wet.value = 1;
lastNode = flanger;
//} else {
// flanger.wet.value = 0;
}

// if (checkboxes["Filter"].checked()) {
// lastNode.connect(filter);
// lastNode = filter;
//}

if (checkboxes["Reverb"].checked()) {
lastNode.connect(reverb);
//reverb.wet.value =1;
lastNode = reverb;
//} else {
//reverb.wet.value = 0;
}

if (checkboxes["Delay"].checked()) {
lastNode.connect(delay);
//delay.wet.value = 1;
lastNode = delay;
//} else {
//delay.wet.value = 0;
}

if (checkboxes["Distortion"].checked()) {
lastNode.connect(distortion);
//delay.wet.value = 1;
lastNode = distortion;
//} else {
//delay.wet.value = 0;
}

lastNode.connect(Tone.Destination);
}

const effectKeys = ["Chorus", "Flanger", "Reverb", "Delay","Distortion"];

function draw() {
background(240);

const sum = effectKeys.reduce(
(acc, k) => acc + (isFinite(Number(data?.[k])) ? Number(data?.[k]) : 0),
0
);

// let values = Object.values(data).slice(0,5);

// const sum = values.reduce(
// (acc, k) => acc + (isFinite(Number(data?.[k])) ? Number(data[k]) : 0),
// 0
// );

//let sum = values.reduce((acc, currentValue) => Math.abs(acc) + Math.abs(currentValue), 0);
//let sum = data?.["Chorus"] + data?.["Flanger"] + data?.["Filter"] + data?.["Reverb"] + data?.["Delay"]

let chorus_rel = divideIfNotZero(data?.["Chorus"],sum)
let chorus_wetVal = sigmoid(chorus_rel,k=STEEP, m = chorusMean*threshold)

let flanger_rel = divideIfNotZero(data?.["Flanger"],sum)
let flanger_wetVal = sigmoid(flanger_rel)

//let filter_rel = divideIfNotZero(data?.["Filter"],sum)

let reverb_rel = divideIfNotZero(data?.["Reverb"],sum)
let reverb_wetVal = sigmoid(reverb_rel)

let delay_rel = divideIfNotZero(data?.["Delay"],sum)
let delay_feedback = sigmoid(delay_rel)

let distortion_rel = divideIfNotZero(data?.["Distortion"],sum)
let distortion_wetVal = 1 - sigmoid(distortion_rel,k=STEEP, m = distortionMean*threshold)

const x = chorus_rel; 

chorusN += 1;
chorusMean += (x - chorusMean) / chorusN;

distortionN += 1;
distortionMean += (x - distortionMean) / distortionN;

push(); // keep your existing styles intact
fill(0); // black text
textSize(16); // readable size
textAlign(LEFT, TOP); // anchor at upper-left corner
text('Alpha Mean: ' + nf(chorusMean, 1, 2), 20, 20); // x=20 px, y=20 px
pop();

push(); // keep your existing styles intact
fill(0); // black text
textSize(16); // readable size
textAlign(RIGHT, TOP); // anchor at upper-left corner
text('Chorus wet value: ' + nf(chorus_wetVal, 1, 2), 500, 20); // x=20 px, y=20 px
pop();

//push(); // keep your existing styles intact
//fill(0); // black text
//textSize(16); // readable size
//textAlign(RIGHT, BOTTOM); // anchor at upper-left corner
//text('Distortion wet value: ' + nf(distortion_wetVal, 1, 2), 500, 20); // x=20 px, y=20 px
//pop();


//if (data?.["Chorus"] !== undefined) {
//chorus.wet.value = data?.["Chorus"] > 1.5 ? 1 : 0;
//chorus.wet.value = map(chorus_wetVal, 0, 1, 0, 1)
//}

if (checkboxes["Chorus"].checked()) {
chorus.wet.value = chorus_wetVal;
} else {
chorus.wet.value = 0;
}

//if (data?.["Flanger"] !== undefined) {
//flanger.wet.value = divideIfNotZero(data?.["Flanger"],sum);
//}

if (checkboxes["Flanger"].checked()) {
flanger.wet.value = flanger_wetVal;
} else {
flanger.wet.value = 0;
}

//if (data?.["Filter"] !== undefined) {
//filter.frequency.value = map(divideIfNotZero(data?.["Filter"],sum), 0, 1, 50, 4000);
//}

// if (checkboxes["Filter"].checked()) {
// filter.frequency.value = map(filter_rel, 0, 1, 50, 4000);
// }


//if (data?.["Reverb"] !== undefined) {
//reverb.wet.value = divideIfNotZero(data?.["Reverb"],sum);
//}

if (checkboxes["Reverb"].checked()) {
reverb.wet.value = reverb_wetVal;
} else {
reverb.wet.value = 0;
}

//if (data?.["Delay"] !== undefined) {
//delay.feedback.value = map(divideIfNotZero(data?.["Delay"],sum), 0, 1, 0.1, 0.3);
//}

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

