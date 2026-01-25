/**
 * KioskMuseManager - Enhanced Muse connection for headless kiosk operation
 *
 * Features:
 * - Persistent Bluetooth pairing (survives power cycles)
 * - Auto-reconnect on disconnect with exponential backoff
 * - WebSocket status reporting to LED controller
 * - Event-based status updates
 * - PPG-based "headset worn" detection via heart rate
 */

import { MuseClient } from "muse-js";
import store from "../store/store";
import { fft } from "mathjs";
import { PolynomialRegression } from "ml-regression-polynomial";

// Connection states
export const ConnectionState = {
  IDLE: 'idle',
  SEARCHING: 'searching',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  STREAMING: 'streaming',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
};

class KioskMuseManager {
  constructor() {
    this.device = null;  // BluetoothDevice reference for reconnection
    this.muse = null;
    this.state = ConnectionState.IDLE;
    this.listeners = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseReconnectDelay = 1000; // 1 second
    this.maxReconnectDelay = 30000; // 30 seconds
    this.reconnectTimer = null;

    // WebSocket for LED status reporting
    this.statusSocket = null;
    this.wsReconnectTimer = null;

    // EEG processing
    this.sfreq = 256;
    this.WINDOW_SIZE = 2;
    this.BAND_POWERS_SFREQ = 10;
    this.numberOfChannels = 4;
    this.buffer = this._createBuffer();
    this.dataArray = [];
    this.eegMetricStream = null;
    this.deviceId = null;

    this.channelNames = { 0: "TP9", 1: "AF7", 2: "AF8", 3: "TP10" };

    // PPG processing for heart rate / worn detection
    this.PPG_WINDOW_SIZE = 10;  // seconds
    this.ppg_sfreq = 64;
    this.HR_SFREQ = 1;  // Calculate HR once per second
    this.ppgBuffer = new Array(this.PPG_WINDOW_SIZE * this.ppg_sfreq).fill(0);
    this.ppgMetricStream = null;

    // Headset worn state (based on valid heart rate)
    this.heartRate = 0;
    this.isWorn = false;
    this.wornListeners = new Set();

    // Connect to LED status WebSocket
    this._connectStatusSocket();
  }

  _createBuffer() {
    const arrayLength = this.WINDOW_SIZE * this.sfreq;
    const buffer = new Array(this.numberOfChannels);
    for (let i = 0; i < this.numberOfChannels; i++) {
      buffer[i] = new Array(arrayLength).fill(0);
    }
    return buffer;
  }

  _connectStatusSocket() {
    try {
      // Connect to local LED controller WebSocket
      this.statusSocket = new WebSocket('ws://localhost:8765');

      this.statusSocket.onopen = () => {
        this.log('LED status WebSocket connected');
        this._sendStatus();
      };

      this.statusSocket.onclose = () => {
        this.log('LED status WebSocket disconnected, reconnecting...');
        clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => this._connectStatusSocket(), 5000);
      };

      this.statusSocket.onerror = (err) => {
        // Silent fail - LED controller may not be running
      };
    } catch (e) {
      // WebSocket not available
    }
  }

  _sendStatus() {
    if (this.statusSocket?.readyState === WebSocket.OPEN) {
      this.statusSocket.send(JSON.stringify({
        type: 'muse_status',
        state: this.state,
        deviceName: this.device?.name || null,
        reconnectAttempts: this.reconnectAttempts,
        timestamp: new Date().toISOString()
      }));
    }
  }

  log(msg) {
    const ts = new Date().toISOString();
    console.log(`[MUSE ${ts}] ${msg}`);
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.log(`State: ${oldState} -> ${newState}`);
    this._sendStatus();
    this._notifyListeners();
  }

  onStateChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyListeners() {
    this.listeners.forEach(cb => cb(this.state, this.device?.name));
  }

  // Worn state listeners
  onWornStateChange(callback) {
    this.wornListeners.add(callback);
    return () => this.wornListeners.delete(callback);
  }

  _notifyWornListeners() {
    this.wornListeners.forEach(cb => cb(this.isWorn, this.heartRate));
  }

  getIsWorn() {
    return this.isWorn;
  }

  getHeartRate() {
    return this.heartRate;
  }

  /**
   * Try to reconnect to a previously paired device (no user gesture needed!)
   * Uses the Web Bluetooth getDevices() API
   * Retries several times since Bluetooth may not be ready right after boot
   */
  async tryAutoConnect(maxAttempts = 5) {
    this.log('Attempting auto-connect to previously paired device...');
    this.setState(ConnectionState.SEARCHING);

    try {
      // Check if getDevices() is available (requires Chrome flag)
      if (!navigator.bluetooth?.getDevices) {
        this.log('getDevices() not available - need manual pairing');
        this.setState(ConnectionState.IDLE);
        return false;
      }

      // Get previously paired devices
      const devices = await navigator.bluetooth.getDevices();
      this.log(`Found ${devices.length} previously paired device(s)`);

      // Look for a Muse device
      const museDevice = devices.find(d =>
        d.name?.toLowerCase().includes('muse') ||
        d.name?.toLowerCase().includes('muse-')
      );

      if (!museDevice) {
        this.log('No previously paired Muse found');
        this.setState(ConnectionState.IDLE);
        return false;
      }

      this.log(`Found paired Muse: ${museDevice.name}`);
      this.device = museDevice;

      // Set up disconnect handler
      this.device.addEventListener('gattserverdisconnected', () => {
        this.log('GATT server disconnected');
        this._handleDisconnect();
      });

      // CRITICAL: Watch for advertisements before connecting
      // Web Bluetooth requires receiving an advertisement packet before auto-connect works
      this.log('Watching for Muse advertisements...');

      try {
        // Start watching for advertisements from this device
        const abortController = new AbortController();

        const advertisementReceived = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            abortController.abort();
            reject(new Error('No advertisement received within timeout'));
          }, 30000); // 30 second timeout

          this.device.addEventListener('advertisementreceived', (event) => {
            clearTimeout(timeout);
            this.log(`Advertisement received from ${event.device.name}, RSSI: ${event.rssi}`);
            resolve(event);
          }, { once: true });
        });

        await this.device.watchAdvertisements({ signal: abortController.signal });
        this.log('Watching for advertisements...');

        // Wait for advertisement
        await advertisementReceived;
        this.log('Advertisement received, now connecting...');

        // Stop watching
        abortController.abort();

      } catch (err) {
        this.log(`Advertisement watch failed: ${err.message}, trying direct connect...`);
      }

      // Try to connect with retries (Bluetooth may not be ready right after boot)
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.log(`Auto-connect attempt ${attempt}/${maxAttempts}...`);

        try {
          const success = await this._connectToDevice();
          if (success) {
            return true;
          }
        } catch (err) {
          this.log(`Attempt ${attempt} failed: ${err.message}`);
        }

        if (attempt < maxAttempts) {
          // Wait before retry (increasing delay)
          const delay = attempt * 2000;
          this.log(`Waiting ${delay}ms before retry...`);
          this.setState(ConnectionState.RECONNECTING);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      this.log('Auto-connect failed after all attempts');
      this.setState(ConnectionState.IDLE);
      return false;

    } catch (err) {
      this.log(`Auto-connect failed: ${err.message}`);
      this.setState(ConnectionState.IDLE);
      return false;
    }
  }

  /**
   * Manual connect - requires user gesture (button click)
   * Used for initial pairing or if auto-connect fails
   */
  async connect() {
    this.log('Manual connect requested (user gesture)');
    this.setState(ConnectionState.SEARCHING);

    try {
      // Request device - this shows the browser's device picker
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Muse' }],
        optionalServices: [
          0xfe8d, // Muse service
          'battery_service'
        ]
      });

      this.log(`Device selected: ${this.device.name}`);

      // Set up disconnect handler
      this.device.addEventListener('gattserverdisconnected', () => {
        this.log('GATT server disconnected');
        this._handleDisconnect();
      });

      return await this._connectToDevice();

    } catch (err) {
      if (err.name === 'NotFoundError') {
        this.log('User cancelled device selection');
        this.setState(ConnectionState.IDLE);
      } else {
        this.log(`Connection failed: ${err.message}`);
        this.setState(ConnectionState.ERROR);
      }
      return false;
    }
  }

  async _connectToDevice() {
    this.setState(ConnectionState.CONNECTING);

    try {
      // Connect to GATT server
      this.log('Connecting to GATT server...');
      const server = await this.device.gatt.connect();

      // Create Muse client and connect
      this.muse = new MuseClient();
      this.muse.enablePpg = true; // Enable PPG for heart rate / worn detection

      // Connect muse-js to the GATT server
      await this.muse.connect(server);

      this.deviceId = this.device.name;
      this.log(`Connected to ${this.deviceId}`);

      // Register device in Redux store
      store.dispatch({
        type: "devices/create",
        payload: {
          id: this.deviceId,
          metadata: {
            device: "Muse",
            connected: true,
            id: this.deviceId,
            sampling_rate: {
              EEG: this.sfreq,
              PPG: this.ppg_sfreq,
              "Band Powers": this.BAND_POWERS_SFREQ,
              HR: this.HR_SFREQ,
            },
            type: "kiosk",
          },
        },
      });

      // Subscribe to connection status
      this.muse.connectionStatus.subscribe((status) => {
        this.log(`Muse connection status: ${status}`);
        store.dispatch({
          type: "devices/updateMetadata",
          payload: {
            id: this.deviceId,
            field: "connected",
            data: status,
          },
        });

        if (!status) {
          this._handleDisconnect();
        }
      });

      // Start streaming
      await this._startStreaming();

      this.reconnectAttempts = 0;
      this.setState(ConnectionState.STREAMING);
      return true;

    } catch (err) {
      this.log(`Connection to device failed: ${err.message}`);
      this.setState(ConnectionState.ERROR);
      return false;
    }
  }

  async _startStreaming() {
    this.log('Starting EEG stream...');
    await this.muse.start();

    // Subscribe to EEG readings
    this.muse.eegReadings.subscribe((reading) => {
      this.dataArray.push(reading);

      if (this.dataArray.length === 4) {
        // Fill buffer
        this.dataArray.forEach((obj) => {
          this.buffer[obj.electrode].splice(0, obj.samples.length);
          this.buffer[obj.electrode].push(...obj.samples);
        });

        // Dispatch raw EEG samples
        for (let i = 0; i < this.dataArray[0].samples.length; i++) {
          const dispatchData = this.dataArray.reduce((acc, data) => {
            const key = this.channelNames[data.electrode];
            acc[key] = data.samples[i];
            return acc;
          }, {});

          store.dispatch({
            type: "devices/streamUpdate",
            payload: {
              id: this.deviceId,
              data: dispatchData,
              modality: "EEG",
            },
          });
        }

        this.dataArray = [];
      }
    });

    // Subscribe to PPG readings for heart rate / worn detection
    this.muse.ppgReadings.subscribe((ppgReading) => {
      // PPG channel 2 is the infrared channel (best for heart rate)
      if (ppgReading.ppgChannel === 2) {
        this.ppgBuffer.splice(0, ppgReading.samples.length);
        this.ppgBuffer.push(...ppgReading.samples);
      }
    });

    // Start band power and heart rate calculations
    this._startMetricStream();
    this.log('EEG and PPG streaming started');
  }

  _startMetricStream() {
    if (this.eegMetricStream) {
      clearInterval(this.eegMetricStream);
    }
    if (this.ppgMetricStream) {
      clearInterval(this.ppgMetricStream);
    }

    // EEG band power calculation (10 Hz)
    this.eegMetricStream = setInterval(() => {
      if (this.state === ConnectionState.STREAMING) {
        this._calculateBandPowers();
      }
    }, (1 / this.BAND_POWERS_SFREQ) * 1000);

    // PPG heart rate calculation (1 Hz)
    this.ppgMetricStream = setInterval(() => {
      if (this.state === ConnectionState.STREAMING) {
        this._calculateHeartRate();
      }
    }, (1 / this.HR_SFREQ) * 1000);
  }

  _calculateBandPowers() {
    const fs = this.sfreq;
    const bandpowers = {
      Theta: [4, 8],
      Alpha: [8, 12],
      "Low beta": [12, 16],
      "High beta": [16, 25],
      Gamma: [25, 45],
    };

    const avrg_bandpowers = {};

    for (let channel = 0; channel < this.numberOfChannels; channel++) {
      const data = this.buffer[channel];
      const data_mean = data.reduce((a, b) => a + b, 0) / data.length;
      const centered_data = data.map((val) => val - data_mean);
      const sample = this._applyHammingWindow(centered_data);
      const N = sample.length;

      const raw_fft = fft(sample);
      let psd = raw_fft.map((elem) =>
        Math.sqrt(elem.re * elem.re + elem.im * elem.im)
      );
      psd = psd.slice(0, Math.floor(N / 2));
      psd = psd.map((mag) => (2 * mag) / N);

      for (let [key, freq_range] of Object.entries(bandpowers)) {
        const idx_start = Math.floor((freq_range[0] * N) / fs);
        const idx_end = Math.floor((freq_range[1] * N) / fs);
        avrg_bandpowers[key] = avrg_bandpowers[key] ?? {};
        avrg_bandpowers[key][channel] = this._average(psd.slice(idx_start, idx_end));
      }
    }

    const avrg = {};
    for (let col in avrg_bandpowers) {
      const bandpowers_arr = Object.values(avrg_bandpowers[col]).map(parseFloat);
      avrg[col] = this._average(bandpowers_arr);
    }

    store.dispatch({
      type: "devices/streamUpdate",
      payload: {
        id: this.deviceId,
        data: avrg,
        modality: "Band Powers",
      },
    });
  }

  _applyHammingWindow(signal) {
    const N = signal.length;
    return signal.map((val, i) =>
      val * (0.54 - 0.46 * Math.cos((Math.PI * 2 * i) / (N - 1)))
    );
  }

  _average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b), 0) / arr.length;
  }

  _calculateHeartRate() {
    try {
      // FIR lowpass filter coefficients
      const coeffs = [
        -0.00588043, -0.00620177, -0.00106799, 0.02467073, 0.07864882, 0.15035629,
        0.21289894, 0.23779528, 0.21289894, 0.15035629, 0.07864882, 0.02467073,
        -0.00106799, -0.00620177, -0.00588043,
      ];

      const ppg_fs = this.ppg_sfreq;
      const ppg_time = [];
      const length = this.ppgBuffer.length;

      for (let i = 0; i < length; i++) {
        ppg_time.push(i / ppg_fs);
      }

      // Filter the PPG signal
      const filtered_signal = this._filtfilt(coeffs, [1.0], this.ppgBuffer);
      const normalized_signal = this._normalizeArray(filtered_signal, ppg_time);

      // Find peaks using adaptive threshold
      const { peak_locs } = this._adaptiveThreshold(normalized_signal, ppg_fs);

      // Calculate heart rate from peaks
      const hr = this._getHeartRateFromPeaks(peak_locs, ppg_fs);

      // Update worn state based on valid heart rate
      const previousWorn = this.isWorn;
      this.heartRate = hr;
      this.isWorn = hr >= 40 && hr <= 200;  // Valid HR range

      // Log state changes
      if (previousWorn !== this.isWorn) {
        this.log(`Worn state changed: ${this.isWorn ? 'WORN' : 'NOT WORN'} (HR: ${hr})`);
        this._notifyWornListeners();
      }

      // Dispatch to Redux store
      store.dispatch({
        type: "devices/streamUpdate",
        payload: {
          id: this.deviceId,
          data: {
            HR: hr,
            isWorn: this.isWorn
          },
          modality: "HR",
        },
      });

    } catch (err) {
      // PPG calculation can fail with insufficient data
      this.heartRate = 0;
      this.isWorn = false;
    }
  }

  _filtfilt(b, a, x) {
    // Normalize filter coefficients
    if (a[0] !== 1) {
      b = b.map((coef) => coef / a[0]);
      a = a.map((coef) => coef / a[0]);
    }

    const padlen = 3 * Math.max(a.length, b.length);
    if (padlen >= x.length - 1) {
      return x; // Not enough data
    }

    // Odd padding
    const edge_left = x[0];
    const edge_right = x[x.length - 1];
    const pad_left = x.slice(1, padlen + 1).reverse().map((v) => 2 * edge_left - v);
    const pad_right = x.slice(x.length - padlen - 1, x.length - 1).reverse().map((v) => 2 * edge_right - v);
    let x_padded = pad_left.concat(x).concat(pad_right);

    // Forward-backward filter
    const lfilter = (b, a, x) => {
      const y = new Array(x.length);
      const b_coeffs = b.slice(1);
      const a_coeffs = a.slice(1);

      for (let i = 0; i < x.length; i++) {
        y[i] = b[0] * x[i];
        for (let j = 0; j < b_coeffs.length; j++) {
          if (i - j - 1 >= 0) y[i] += b_coeffs[j] * x[i - j - 1];
        }
        for (let j = 0; j < a_coeffs.length; j++) {
          if (i - j - 1 >= 0) y[i] -= a_coeffs[j] * y[i - j - 1];
        }
      }
      return y;
    };

    let y = lfilter(b, a, x_padded);
    y = y.reverse();
    y = lfilter(b, a, y);
    y = y.reverse();

    return y.slice(padlen, y.length - padlen);
  }

  _normalizeArray(arr, time) {
    try {
      const regression = new PolynomialRegression(time, arr, 6);
      const trend = time.map((t) => regression.predict(t));
      const normArr = arr.map((val, idx) => val - trend[idx]);
      const min = Math.min(...normArr);
      const max = Math.max(...normArr);
      if (max === min) return arr.map(() => 0.5);
      return normArr.map((val) => (val - min) / (max - min));
    } catch (e) {
      return arr;
    }
  }

  _adaptiveThreshold(arr, sfreq) {
    let x = new Array(arr.length).fill(0);
    x[0] = Math.max(...arr) * 0.2;
    const std = this._stdDev(arr);
    let peak_amps = [0];
    let peak_locs = [0];

    for (let i = 1; i < arr.length; i++) {
      x[i] = x[i - 1] - 0.6 * Math.abs((peak_amps[peak_amps.length - 1] + std) / sfreq);
      if (arr[i] > x[i]) {
        if (peak_locs.length > 1) {
          const peak_diff = peak_locs[peak_amps.length - 2] - peak_locs[peak_amps.length - 1];
          if (peak_diff / sfreq < 0.6) {
            x[i] = arr[i];
          }
        } else {
          x[i] = arr[i];
        }
      } else {
        if (x[i - 1] === arr[i - 1]) {
          peak_amps.push(x[i - 1]);
          peak_locs.push(i - 1);
        }
      }
    }
    return { x, peak_amps, peak_locs };
  }

  _stdDev(arr) {
    const n = arr.length;
    const mean = arr.reduce((acc, val) => acc + val, 0) / n;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    return Math.sqrt(variance);
  }

  _getHeartRateFromPeaks(peakLocs, ppgFs) {
    if (peakLocs.length < 3) return 0;

    let heartRates = [];
    for (let i = 1; i < peakLocs.length - 1; i++) {
      let hr = 60 / ((peakLocs[i + 1] - peakLocs[i]) / ppgFs);
      if (hr >= 30 && hr <= 220) {
        heartRates.push(hr);
      }
    }

    if (heartRates.length === 0) return 0;
    return Math.floor(this._average(heartRates));
  }

  _handleDisconnect() {
    if (this.state === ConnectionState.RECONNECTING) {
      return; // Already handling
    }

    this.log('Handling disconnect...');
    this.setState(ConnectionState.RECONNECTING);

    // Stop metric streams
    if (this.eegMetricStream) {
      clearInterval(this.eegMetricStream);
      this.eegMetricStream = null;
    }
    if (this.ppgMetricStream) {
      clearInterval(this.ppgMetricStream);
      this.ppgMetricStream = null;
    }

    // Reset worn state
    this.isWorn = false;
    this.heartRate = 0;
    this._notifyWornListeners();

    // Update Redux store
    if (this.deviceId) {
      store.dispatch({
        type: "devices/updateMetadata",
        payload: {
          id: this.deviceId,
          field: "connected",
          data: false,
        },
      });
    }

    // Start reconnection attempts
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      this.setState(ConnectionState.ERROR);
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(delay)}ms`);

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._attemptReconnect(), delay);
  }

  async _attemptReconnect() {
    if (!this.device) {
      this.log('No device reference for reconnect');
      this.setState(ConnectionState.ERROR);
      return;
    }

    this.log('Attempting reconnect...');

    try {
      // Reconnect using stored device reference - NO user gesture needed!
      const success = await this._connectToDevice();

      if (success) {
        this.log('Reconnected successfully!');
        this.reconnectAttempts = 0;

        // Emit custom event so KioskAutoMapper can reset its state
        window.dispatchEvent(new CustomEvent('muse-reconnected', {
          detail: { deviceId: this.deviceId }
        }));
        this.log('Dispatched muse-reconnected event');
      } else {
        this._scheduleReconnect();
      }
    } catch (err) {
      this.log(`Reconnect failed: ${err.message}`);
      this._scheduleReconnect();
    }
  }

  async disconnect() {
    this.log('Manual disconnect requested');

    clearTimeout(this.reconnectTimer);
    clearInterval(this.eegMetricStream);
    clearInterval(this.ppgMetricStream);

    // Reset worn state
    this.isWorn = false;
    this.heartRate = 0;

    if (this.muse) {
      try {
        await this.muse.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }

    if (this.device?.gatt?.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {
        // Ignore
      }
    }

    this.setState(ConnectionState.IDLE);
    this.reconnectAttempts = 0;
  }

  getState() {
    return this.state;
  }

  getDeviceName() {
    return this.device?.name || null;
  }
}

// Singleton instance
export const kioskMuse = new KioskMuseManager();
export default kioskMuse;
