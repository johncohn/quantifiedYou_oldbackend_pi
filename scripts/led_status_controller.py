#!/usr/bin/env python3
"""
LED Status Controller + Rotary Encoder Service for YouQuantified Kiosk Mode

Controls a 3-LED WS2812B NeoPixel strip on GPIO10 (SPI) to indicate system status.
Reads 3 rotary encoders from Adafruit I2C Quad Rotary Encoder Breakout (Product ID 5752).
Uses Pi5Neo library for Raspberry Pi 5 compatibility.
Communicates bidirectionally with the browser via WebSocket.

LED Layout:
- LED 0: RED always (system running)
- LED 1: GREEN when Muse connected/streaming
- LED 2: BLUE proportional to alpha score (when streaming + worn)

Encoder Layout (Adafruit Quad Encoder Breakout, I2C addr 0x49):
- Encoder 0: Chorus gain (CC5, 0-127, default 100)
- Encoder 1: Chorus depth (CC2, 0-127, default 64)
- Encoder 2: EEG threshold/sensitivity (0-127, default 64)
- Any button press: Save all values to /home/xenbox/encoder_settings.json

Requirements:
    pip3 install pi5neo websockets adafruit-circuitpython-seesaw

Run with sudo (required for SPI access):
    sudo python3 led_status_controller.py
"""

import asyncio
import json
import os
import signal
import sys
import math
import time
import threading
import subprocess
from enum import Enum

# Configure GPIO 10 for SPI mode before importing pi5neo
try:
    subprocess.run(['pinctrl', 'set', '10', 'a0'], check=True, capture_output=True)
    print("[LED] Configured GPIO10 for SPI mode")
except Exception as e:
    print(f"[LED] Warning: Could not configure GPIO10: {e}")

try:
    from pi5neo import Pi5Neo
    HAS_LED = True
    print("[LED] Pi5Neo library loaded")
except ImportError as e:
    print(f"[LED] Pi5Neo not available - running in simulation mode: {e}")
    HAS_LED = False

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip3 install websockets")
    sys.exit(1)

# Try to import encoder libraries
try:
    import board
    from adafruit_seesaw.seesaw import Seesaw
    from adafruit_seesaw.rotaryio import IncrementalEncoder
    from adafruit_seesaw.digitalio import DigitalIO
    HAS_ENCODER = True
    print("[ENC] Adafruit seesaw library loaded")
except ImportError as e:
    print(f"[ENC] Seesaw not available - running without encoders: {e}")
    HAS_ENCODER = False


# LED strip configuration
LED_COUNT = 3           # Number of LED pixels (3-LED strip)
SPI_DEVICE = '/dev/spidev0.0'
SPI_SPEED = 800         # kHz
BRIGHTNESS = 64         # 25% brightness (64/255)

# Encoder configuration
ENCODER_I2C_ADDR = 0x49  # Default address for Adafruit Quad Encoder Breakout
ENCODER_COUNT = 3         # Using 3 of 4 available encoders (indices 1, 2, 3; skipping 0)
ENCODER_INDICES = [1, 2, 3]  # Which encoder slots on the quad breakout to use
SETTINGS_FILE = '/home/xenbox/encoder_settings.json'

# Default encoder values (0-127 MIDI range)
DEFAULT_ENCODER_VALUES = {
    'gain': 100,       # Encoder 0: Chorus gain (CC5)
    'depth': 64,       # Encoder 1: Chorus depth (CC2)
    'threshold': 64    # Encoder 2: EEG sensitivity
}


class ConnectionState(Enum):
    IDLE = 'idle'
    SEARCHING = 'searching'
    CONNECTING = 'connecting'
    CONNECTED = 'connected'
    STREAMING = 'streaming'
    RECONNECTING = 'reconnecting'
    ERROR = 'error'
    STARTUP = 'startup'


class LEDController:
    def __init__(self):
        self.neo = None
        self.running = True
        self.animation_thread = None
        self.lock = threading.Lock()

        # Status tracking
        self.bela_connected = False      # LED 0: Bela/MIDI connection
        self.muse_state = ConnectionState.STARTUP  # LED 1: Muse connection
        self.wet_value = 0.0             # Effect mix value (0-1), same signal as audio
        self.is_worn = False             # Whether headband is on head

        # Blink state for connecting animation
        self.blink_state = False
        self.blink_counter = 0

        # Save flash animation state
        self.flash_save = False
        self.flash_counter = 0

        # Encoder state
        self.encoder_values = dict(DEFAULT_ENCODER_VALUES)
        self.seesaw = None
        self.encoders = []
        self.buttons = []
        self.last_positions = [0, 0, 0]
        self.stable_positions = [0, 0, 0]  # Debounced positions
        self.stable_count = [0, 0, 0]      # How many reads at same position
        self.button_was_pressed = [True, True, True]  # Start True to debounce startup

        # Connected WebSocket clients (for sending encoder values)
        self.ws_clients = set()

        # Load saved encoder values
        self._load_encoder_settings()

        if HAS_LED:
            try:
                self.neo = Pi5Neo(SPI_DEVICE, LED_COUNT, SPI_SPEED)
                print(f"[LED] Initialized {LED_COUNT} NeoPixels via SPI on GPIO10")
            except Exception as e:
                print(f"[LED] Failed to initialize: {e}")
                self.neo = None

        # Initialize encoders
        if HAS_ENCODER:
            self._init_encoders()

        # Start animation thread
        self.animation_thread = threading.Thread(target=self._animation_loop, daemon=True)
        self.animation_thread.start()

    def _init_encoders(self):
        """Initialize I2C encoders via Adafruit seesaw"""
        try:
            i2c = board.I2C()
            self.seesaw = Seesaw(i2c, addr=ENCODER_I2C_ADDR)
            product_id = (self.seesaw.get_version() >> 16) & 0xFFFF
            print(f"[ENC] Seesaw product ID: {product_id}")

            for i, enc_idx in enumerate(ENCODER_INDICES):
                enc = IncrementalEncoder(self.seesaw, encoder=enc_idx)
                btn = DigitalIO(self.seesaw, pin=12 + enc_idx)  # Button pins: 12, 13, 14, 15
                btn.switch_to_input(pull=True)  # Input with pull-up
                self.encoders.append(enc)
                self.buttons.append(btn)
                self.last_positions[i] = enc.position

            # Set initial encoder positions to match loaded values
            keys = ['gain', 'depth', 'threshold']
            for i, key in enumerate(keys):
                # Convert 0-127 value to encoder position
                self.last_positions[i] = self.encoders[i].position
            print(f"[ENC] Initialized {ENCODER_COUNT} encoders at I2C 0x{ENCODER_I2C_ADDR:02X}")
            print(f"[ENC] Loaded values: {self.encoder_values}")
        except Exception as e:
            print(f"[ENC] Failed to initialize encoders: {e}")
            self.seesaw = None
            self.encoders = []
            self.buttons = []

    def _load_encoder_settings(self):
        """Load saved encoder values from JSON file"""
        try:
            with open(SETTINGS_FILE, 'r') as f:
                saved = json.load(f)
                for key in DEFAULT_ENCODER_VALUES:
                    if key in saved:
                        self.encoder_values[key] = max(0, min(127, int(saved[key])))
                print(f"[ENC] Loaded settings from {SETTINGS_FILE}: {self.encoder_values}")
        except FileNotFoundError:
            print(f"[ENC] No saved settings, using defaults: {self.encoder_values}")
        except Exception as e:
            print(f"[ENC] Error loading settings: {e}, using defaults")

    def _save_encoder_settings(self):
        """Save current encoder values to JSON file"""
        try:
            with open(SETTINGS_FILE, 'w') as f:
                json.dump(self.encoder_values, f, indent=2)
            print(f"[ENC] Saved settings to {SETTINGS_FILE}: {self.encoder_values}")
            # Trigger LED flash to confirm save
            with self.lock:
                self.flash_save = True
                self.flash_counter = 0
        except Exception as e:
            print(f"[ENC] Error saving settings: {e}")

    def set_bela_connected(self, connected: bool):
        with self.lock:
            if self.bela_connected != connected:
                print(f"[LED] Bela connected: {self.bela_connected} -> {connected}")
                self.bela_connected = connected

    def set_muse_state(self, state: ConnectionState):
        with self.lock:
            if self.muse_state != state:
                print(f"[LED] Muse state: {self.muse_state.value} -> {state.value}")
                self.muse_state = state
                if state == ConnectionState.STREAMING:
                    self.is_worn = True

    def set_wet_value(self, wet: float):
        """Set effect mix value (0-1) for blue LED — same value driving the audio."""
        self.wet_value = max(0.0, min(1.0, wet))

    def set_worn(self, is_worn: bool):
        with self.lock:
            if self.is_worn != is_worn:
                print(f"[LED] Worn: {self.is_worn} -> {is_worn}")
                self.is_worn = is_worn

    def _poll_encoders(self):
        """Poll encoder positions and buttons, return True if values changed.
        Uses debouncing: position must be stable for 3 consecutive reads."""
        if not self.encoders:
            return False

        changed = False
        keys = ['gain', 'depth', 'threshold']
        DEBOUNCE_READS = 2  # Must hold same position for 2 polls

        if not hasattr(self, '_enc0_log_count'):
            self._enc0_log_count = 0

        try:
            for i in range(ENCODER_COUNT):
                # Read encoder position
                try:
                    pos = self.encoders[i].position
                except Exception as read_err:
                    if i == 0:
                        self._enc0_log_count += 1
                        if self._enc0_log_count >= 300:
                            print(f"[ENC] enc0 READ ERROR: {read_err}")
                            self._enc0_log_count = 0
                    continue

                # Debug logging for encoder 0 (gain) — log every ~5 seconds
                if i == 0:
                    self._enc0_log_count += 1
                    if self._enc0_log_count >= 300:
                        print(f"[ENC] enc0 raw={pos} last={self.last_positions[0]}")
                        self._enc0_log_count = 0

                # Ignore I2C corruption: any absolute value > 1000 is noise
                if abs(pos) > 1000:
                    continue

                # Ignore wild jumps from last known-good position
                # (don't update last_positions — that was causing ping-pong with noise)
                if abs(pos - self.last_positions[i]) > 50:
                    continue

                # Debounce: track how many reads at this position
                if pos == self.stable_positions[i]:
                    self.stable_count[i] += 1
                else:
                    self.stable_positions[i] = pos
                    self.stable_count[i] = 1

                # Only apply change after stable for DEBOUNCE_READS polls
                if self.stable_count[i] == DEBOUNCE_READS:
                    delta = pos - self.last_positions[i]
                    if delta != 0:
                        self.last_positions[i] = pos
                        old_val = self.encoder_values[keys[i]]
                        new_val = max(0, min(127, old_val + delta))
                        if new_val != old_val:
                            self.encoder_values[keys[i]] = new_val
                            print(f"[ENC] {keys[i]}: {old_val} -> {new_val}")
                            changed = True

                # Read button (active low) — also debounce
                pressed = not self.buttons[i].value
                if pressed and not self.button_was_pressed[i]:
                    print(f"[ENC] Button {i} pressed - saving settings")
                    self._save_encoder_settings()
                self.button_was_pressed[i] = pressed

        except Exception as e:
            print(f"[ENC] Poll error: {e}")

        return changed

    def _broadcast_encoder_values(self):
        """Send current encoder values to all connected WebSocket clients"""
        if not self.ws_clients:
            return
        message = json.dumps({
            'type': 'encoder_values',
            'gain': self.encoder_values['gain'],
            'depth': self.encoder_values['depth'],
            'threshold': self.encoder_values['threshold']
        })
        # Schedule sends on the event loop
        disconnected = set()
        for ws in self.ws_clients:
            try:
                asyncio.run_coroutine_threadsafe(ws.send(message), self._loop)
            except Exception as e:
                print(f"[ENC] Broadcast error: {e}")
                disconnected.add(ws)
        self.ws_clients -= disconnected

    def _animation_loop(self):
        """Background thread for LED updates and encoder polling"""
        while self.running:
            with self.lock:
                muse_state = self.muse_state
                is_worn = self.is_worn
                flash_save = self.flash_save
            # Read wet value outside lock — set from async WebSocket handler
            wet_value = self.wet_value

            # Update blink state
            self.blink_counter += 1
            if self.blink_counter >= 5:
                self.blink_counter = 0
                self.blink_state = not self.blink_state

            # Poll encoders
            encoder_changed = self._poll_encoders()
            if encoder_changed:
                self._broadcast_encoder_values()

            try:
                # Handle save flash animation (white flash for 500ms)
                if flash_save:
                    self.flash_counter += 1
                    if self.flash_counter <= 5:  # 500ms white flash
                        if self.neo:
                            for i in range(LED_COUNT):
                                self.neo.set_led_color(i, BRIGHTNESS, BRIGHTNESS, BRIGHTNESS)
                            self.neo.update_strip()
                        time.sleep(0.1)
                        continue
                    else:
                        with self.lock:
                            self.flash_save = False
                            self.flash_counter = 0

                # LED 0: Always RED when system is running
                led0_r, led0_g, led0_b = BRIGHTNESS, 0, 0

                # LED 1: GREEN when Muse connected
                # Smooth slow pulse when streaming AND worn (5-second cycle, dips near off)
                led1_r, led1_g, led1_b = 0, 0, 0
                if muse_state == ConnectionState.STREAMING and is_worn:
                    pulse = (math.sin(time.time() * 2 * math.pi / 5.0) + 1) / 2  # 0-1 over 5s
                    # Gamma correction (2.2) for perceptually smooth brightness
                    gamma_pulse = pulse ** 2.2
                    led1_g = int(1 + gamma_pulse * (BRIGHTNESS - 1))  # Pulse between near-off and bright
                elif muse_state in (ConnectionState.STREAMING, ConnectionState.CONNECTED):
                    led1_g = BRIGHTNESS

                # LED 2: BLUE — directly maps the effect wet value (0-1) to brightness
                led2_r, led2_g, led2_b = 0, 0, 0
                led2_b = int(wet_value * BRIGHTNESS)

                if self.neo:
                    self.neo.set_led_color(0, led0_r, led0_g, led0_b)
                    self.neo.set_led_color(1, led1_r, led1_g, led1_b)
                    self.neo.set_led_color(2, led2_r, led2_g, led2_b)
                    self.neo.update_strip()
                    if not hasattr(self, '_led2_log'):
                        self._led2_log = 0
                    self._led2_log += 1
                    if self._led2_log % 300 == 0:
                        print(f"[LED2] b={led2_b} wet={wet_value:.3f}")

            except Exception as e:
                print(f"[LED] Animation error: {e}")

            time.sleep(0.016)  # ~60 Hz update rate for smooth LED pulsing

    def cleanup(self):
        """Turn off all LEDs and cleanup"""
        self.running = False
        if self.animation_thread:
            self.animation_thread.join(timeout=1)
        if self.neo:
            self.neo.fill_strip(0, 0, 0)
            self.neo.update_strip()
            print("[LED] Cleanup complete")


# Global LED controller
led = LEDController()


async def handle_websocket(websocket, path=None):
    """Handle incoming WebSocket connections"""
    client_addr = websocket.remote_address
    print(f"[WS] Client connected: {client_addr}")

    # Track this client for encoder broadcasts
    led.ws_clients.add(websocket)

    # Send current encoder values to newly connected client
    try:
        await websocket.send(json.dumps({
            'type': 'encoder_values',
            'gain': led.encoder_values['gain'],
            'depth': led.encoder_values['depth'],
            'threshold': led.encoder_values['threshold']
        }))
        print(f"[WS] Sent initial encoder values to {client_addr}")
    except Exception as e:
        print(f"[WS] Error sending initial values: {e}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get('type')

                if msg_type == 'muse_status':
                    state_str = data.get('state', 'idle')
                    try:
                        state = ConnectionState(state_str)
                        led.set_muse_state(state)
                    except ValueError:
                        print(f"[WS] Unknown state: {state_str}")

                elif msg_type == 'worn_status':
                    is_worn = data.get('isWorn', False)
                    led.set_worn(is_worn)

                elif msg_type == 'bela_status':
                    connected = data.get('connected', False)
                    led.set_bela_connected(connected)

                elif msg_type == 'alpha_score':
                    if 'wet' in data:
                        # New format: direct wet value (0-1)
                        led.set_wet_value(data['wet'])
                    elif 'smoothed' in data:
                        # Old format: compute wet from smoothed alpha and threshold
                        s = data.get('smoothed', 0.0)
                        t = data.get('threshold', 64.0)
                        wet = max(0.0, min(1.0, (s - t) / (127 - t))) if s > t and t < 127 else 0.0
                        led.set_wet_value(wet)

                elif msg_type == 'midi_status':
                    midi_active = data.get('active', False)
                    led.set_bela_connected(midi_active)

                else:
                    print(f"[WS] Unknown message type: {msg_type}")

            except json.JSONDecodeError:
                print(f"[WS] Invalid JSON: {message[:100]}")

    except websockets.exceptions.ConnectionClosed:
        print(f"[WS] Client disconnected: {client_addr}")
    finally:
        led.ws_clients.discard(websocket)


async def main():
    """Main entry point"""
    print("[LED + Encoder Controller] Starting...")
    print(f"[LED] Configuration: {LED_COUNT} LEDs on GPIO10 (SPI)")
    print(f"[ENC] Encoders: {'available' if led.encoders else 'not available (simulation mode)'}")
    print(f"[ENC] Values: {led.encoder_values}")
    print(f"[WS] WebSocket server listening on ws://localhost:8765")

    # Store event loop reference for encoder broadcast thread
    led._loop = asyncio.get_event_loop()

    # Set initial state
    led.set_muse_state(ConnectionState.IDLE)

    # Start WebSocket server
    async with websockets.serve(handle_websocket, "localhost", 8765):
        await asyncio.Future()


def signal_handler(sig, frame):
    """Handle Ctrl+C"""
    print("\n[LED] Shutting down...")
    led.cleanup()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        led.cleanup()
