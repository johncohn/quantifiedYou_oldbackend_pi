/**
 * KioskMuseManager - Enhanced Muse connection for headless kiosk operation
 *
 * Features:
 * - Persistent Bluetooth pairing (survives power cycles)
 * - Auto-reconnect on disconnect with exponential backoff
 * - WebSocket status reporting to LED controller
 * - Event-based status updates
 */

import { MuseClient } from "muse-js";
import store from "../store/store";
import { fft } from "mathjs";

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
      this.muse.enablePpg = false; // Disable PPG for faster connection

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
              "Band Powers": this.BAND_POWERS_SFREQ,
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

    // Start band power calculations
    this._startMetricStream();
    this.log('EEG streaming started');
  }

  _startMetricStream() {
    if (this.eegMetricStream) {
      clearInterval(this.eegMetricStream);
    }

    this.eegMetricStream = setInterval(() => {
      if (this.state === ConnectionState.STREAMING) {
        this._calculateBandPowers();
      }
    }, (1 / this.BAND_POWERS_SFREQ) * 1000);
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

  _handleDisconnect() {
    if (this.state === ConnectionState.RECONNECTING) {
      return; // Already handling
    }

    this.log('Handling disconnect...');
    this.setState(ConnectionState.RECONNECTING);

    // Stop metric stream
    if (this.eegMetricStream) {
      clearInterval(this.eegMetricStream);
      this.eegMetricStream = null;
    }

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
