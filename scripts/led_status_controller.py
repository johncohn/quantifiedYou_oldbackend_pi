#!/usr/bin/env python3
"""
LED Status Controller for YouQuantified Kiosk Mode

Controls a 4-LED WS2812B NeoPixel strip on GPIO10 (SPI) to indicate system status.
Uses Pi5Neo library for Raspberry Pi 5 compatibility.
Receives status updates via WebSocket from the browser.

LED Layout:
- LED 0: RED when Bela connected (MIDI active), dark otherwise
- LED 1: YELLOW when Muse connected (blinks while connecting), dark when disconnected
- LED 2: GREEN when alpha state reached (score > threshold), dark otherwise
- LED 3: Unused (dark)

Requirements:
    pip3 install pi5neo websockets

Run with sudo (required for SPI access):
    sudo python3 led_status_controller.py
"""

import asyncio
import json
import signal
import sys
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


# LED strip configuration
LED_COUNT = 3           # Number of LED pixels (3-LED strip)
SPI_DEVICE = '/dev/spidev0.0'
SPI_SPEED = 800         # kHz
BRIGHTNESS = 64         # 25% brightness (64/255)


# Alpha threshold for "alpha state" (tune this value)
# chorus_wetVal ranges from 0-1 (sigmoid output)
ALPHA_THRESHOLD = 0.5


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
        self.alpha_score = 0.0           # LED 2: Alpha state score (0-1)
        self.is_worn = False             # Whether headband is on head

        # Blink state for connecting animation
        self.blink_state = False
        self.blink_counter = 0

        if HAS_LED:
            try:
                self.neo = Pi5Neo(SPI_DEVICE, LED_COUNT, SPI_SPEED)
                print(f"[LED] Initialized {LED_COUNT} NeoPixels via SPI on GPIO10")
            except Exception as e:
                print(f"[LED] Failed to initialize: {e}")
                self.neo = None

        # Start animation thread
        self.animation_thread = threading.Thread(target=self._animation_loop, daemon=True)
        self.animation_thread.start()

    def set_pixel(self, index, r, g, b):
        """Set individual LED color (RGB order)"""
        if index >= LED_COUNT:
            return
        if self.neo:
            self.neo.set_led_color(index, r, g, b)
        else:
            # Simulation mode
            if r > 0 or g > 0 or b > 0:
                print(f"[LED SIM] LED{index}: R={r} G={g} B={b}")

    def show(self):
        """Update the LED strip"""
        if self.neo:
            self.neo.update_strip()

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
                # Default to worn=true when streaming starts (will be updated by worn_status)
                if state == ConnectionState.STREAMING:
                    self.is_worn = True

    def set_alpha_score(self, score: float):
        with self.lock:
            self.alpha_score = score

    def set_worn(self, is_worn: bool):
        with self.lock:
            if self.is_worn != is_worn:
                print(f"[LED] Worn: {self.is_worn} -> {is_worn}")
                self.is_worn = is_worn

    def _animation_loop(self):
        """Background thread for LED updates"""
        while self.running:
            with self.lock:
                bela_connected = self.bela_connected
                muse_state = self.muse_state
                alpha_score = self.alpha_score
                is_worn = self.is_worn

            # Update blink state for connecting animation
            self.blink_counter += 1
            if self.blink_counter >= 5:  # Toggle every 500ms (5 * 100ms)
                self.blink_counter = 0
                self.blink_state = not self.blink_state

            try:
                # Calculate all LED values
                # LED 0: Always RED when system is running
                led0_r, led0_g, led0_b = BRIGHTNESS, 0, 0

                # LED 1: GREEN when Muse connected/streaming
                led1_r, led1_g, led1_b = 0, 0, 0
                if muse_state in (ConnectionState.STREAMING, ConnectionState.CONNECTED):
                    led1_g = BRIGHTNESS

                # LED 2: BLUE proportional to alpha/mix (0-127) - only when streaming AND worn
                led2_r, led2_g, led2_b = 0, 0, 0
                if muse_state == ConnectionState.STREAMING and is_worn:
                    led2_b = int(alpha_score * 127)

                # Set all LEDs
                if self.neo:
                    self.neo.set_led_color(0, led0_r, led0_g, led0_b)
                    self.neo.set_led_color(1, led1_r, led1_g, led1_b)
                    self.neo.set_led_color(2, led2_r, led2_g, led2_b)
                    self.neo.update_strip()

            except Exception as e:
                print(f"[LED] Animation error: {e}")

            time.sleep(0.1)  # 10 Hz update rate

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
                    # Update worn status for LED 2 control
                    is_worn = data.get('isWorn', False)
                    led.set_worn(is_worn)

                elif msg_type == 'bela_status':
                    # Bela/MIDI connection status
                    connected = data.get('connected', False)
                    led.set_bela_connected(connected)

                elif msg_type == 'alpha_score':
                    # Alpha state score (0-1 range)
                    score = data.get('score', 0.0)
                    led.set_alpha_score(score)

                elif msg_type == 'midi_status':
                    # Legacy support - treat as bela_status
                    midi_active = data.get('active', False)
                    led.set_bela_connected(midi_active)

                else:
                    print(f"[WS] Unknown message type: {msg_type}")

            except json.JSONDecodeError:
                print(f"[WS] Invalid JSON: {message[:100]}")

    except websockets.exceptions.ConnectionClosed:
        print(f"[WS] Client disconnected: {client_addr}")


async def main():
    """Main entry point"""
    print("[LED Status Controller] Starting...")
    print(f"[LED] Configuration: {LED_COUNT} LEDs on GPIO10 (SPI)")
    print(f"[LED] Alpha threshold: {ALPHA_THRESHOLD}")
    print(f"[WS] WebSocket server listening on ws://localhost:8765")

    # Set initial state
    led.set_muse_state(ConnectionState.IDLE)

    # Start WebSocket server
    async with websockets.serve(handle_websocket, "localhost", 8765):
        # Run forever
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
