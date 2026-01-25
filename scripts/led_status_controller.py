#!/usr/bin/env python3
"""
LED Status Controller for YouQuantified Kiosk Mode

Controls a WS2812B LED on GPIO18 to indicate system status.
Receives status updates via WebSocket from the browser.

Status LED Colors:
- White fade-in: System starting
- Yellow slow pulse: Waiting for Muse connection
- Blue fast blink: Connecting
- Green solid: Connected & streaming
- Green gentle pulse: Data flowing + MIDI active
- Blue slow pulse: Reconnecting
- Red solid: Error

Requirements:
    pip3 install rpi_ws281x websockets

Run with sudo (required for GPIO/PWM access):
    sudo python3 led_status_controller.py
"""

import asyncio
import json
import signal
import sys
import time
import threading
from enum import Enum

try:
    from rpi_ws281x import PixelStrip, Color
    HAS_LED = True
except ImportError:
    print("[LED] rpi_ws281x not available - running in simulation mode")
    HAS_LED = False

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip3 install websockets")
    sys.exit(1)


# LED strip configuration
LED_COUNT = 1           # Number of LED pixels
LED_PIN = 18            # GPIO pin (18 uses PWM)
LED_FREQ_HZ = 800000    # LED signal frequency in Hz
LED_DMA = 10            # DMA channel to use
LED_BRIGHTNESS = 128    # 0-255, start at 50%
LED_INVERT = False      # True to invert signal
LED_CHANNEL = 0         # PWM channel


class ConnectionState(Enum):
    IDLE = 'idle'
    SEARCHING = 'searching'
    CONNECTING = 'connecting'
    CONNECTED = 'connected'
    STREAMING = 'streaming'
    RECONNECTING = 'reconnecting'
    ERROR = 'error'
    STARTUP = 'startup'


# Color definitions (GRB order for WS2812B)
COLORS = {
    'off': (0, 0, 0),
    'white': (255, 255, 255),
    'red': (0, 255, 0),       # GRB: G=0, R=255, B=0
    'green': (255, 0, 0),     # GRB: G=255, R=0, B=0
    'blue': (0, 0, 255),      # GRB: G=0, R=0, B=255
    'yellow': (255, 255, 0),  # GRB: G=255, R=255, B=0
    'orange': (165, 255, 0),  # GRB: G=165, R=255, B=0
    'purple': (0, 128, 128),  # GRB: G=0, R=128, B=128
}


class LEDController:
    def __init__(self):
        self.strip = None
        self.current_state = ConnectionState.STARTUP
        self.running = True
        self.animation_thread = None
        self.lock = threading.Lock()

        if HAS_LED:
            try:
                self.strip = PixelStrip(
                    LED_COUNT, LED_PIN, LED_FREQ_HZ,
                    LED_DMA, LED_INVERT, LED_BRIGHTNESS, LED_CHANNEL
                )
                self.strip.begin()
                print(f"[LED] Initialized WS2812B on GPIO{LED_PIN}")
            except Exception as e:
                print(f"[LED] Failed to initialize: {e}")
                self.strip = None

        # Start animation thread
        self.animation_thread = threading.Thread(target=self._animation_loop, daemon=True)
        self.animation_thread.start()

    def set_color(self, r, g, b, brightness=1.0):
        """Set LED color (RGB order, will be converted to GRB)"""
        if self.strip:
            # Apply brightness
            r = int(r * brightness)
            g = int(g * brightness)
            b = int(b * brightness)
            # WS2812B uses GRB order
            self.strip.setPixelColor(0, Color(g, r, b))
            self.strip.show()
        else:
            # Simulation mode
            print(f"[LED SIM] R={r} G={g} B={b} bright={brightness:.2f}")

    def set_state(self, state: ConnectionState):
        with self.lock:
            if self.current_state != state:
                print(f"[LED] State: {self.current_state.value} -> {state.value}")
                self.current_state = state

    def _animation_loop(self):
        """Background thread for LED animations"""
        phase = 0
        last_state = None

        while self.running:
            with self.lock:
                state = self.current_state

            # Reset phase on state change
            if state != last_state:
                phase = 0
                last_state = state

            try:
                if state == ConnectionState.STARTUP:
                    # White fade in
                    brightness = min(1.0, phase / 50)
                    self.set_color(255, 255, 255, brightness)

                elif state == ConnectionState.IDLE:
                    # Yellow slow pulse
                    brightness = 0.3 + 0.7 * abs((phase % 100) - 50) / 50
                    self.set_color(255, 255, 0, brightness)

                elif state == ConnectionState.SEARCHING:
                    # Yellow fast blink
                    on = (phase % 20) < 10
                    self.set_color(255, 255, 0, 1.0 if on else 0.1)

                elif state == ConnectionState.CONNECTING:
                    # Blue fast blink
                    on = (phase % 10) < 5
                    self.set_color(0, 100, 255, 1.0 if on else 0.1)

                elif state == ConnectionState.CONNECTED:
                    # Green solid
                    self.set_color(0, 255, 0, 1.0)

                elif state == ConnectionState.STREAMING:
                    # Green gentle pulse (indicates data flowing)
                    brightness = 0.7 + 0.3 * abs((phase % 60) - 30) / 30
                    self.set_color(0, 255, 0, brightness)

                elif state == ConnectionState.RECONNECTING:
                    # Blue slow pulse
                    brightness = 0.3 + 0.7 * abs((phase % 40) - 20) / 20
                    self.set_color(0, 100, 255, brightness)

                elif state == ConnectionState.ERROR:
                    # Red solid
                    self.set_color(255, 0, 0, 1.0)

                else:
                    # Unknown state - purple
                    self.set_color(128, 0, 128, 1.0)

            except Exception as e:
                print(f"[LED] Animation error: {e}")

            phase += 1
            time.sleep(0.05)  # 20 FPS animation

    def cleanup(self):
        """Turn off LED and cleanup"""
        self.running = False
        if self.animation_thread:
            self.animation_thread.join(timeout=1)
        if self.strip:
            self.set_color(0, 0, 0)
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
                        led.set_state(state)
                    except ValueError:
                        print(f"[WS] Unknown state: {state_str}")

                elif msg_type == 'midi_status':
                    # Could use for additional feedback
                    midi_active = data.get('active', False)
                    print(f"[WS] MIDI active: {midi_active}")

                else:
                    print(f"[WS] Unknown message type: {msg_type}")

            except json.JSONDecodeError:
                print(f"[WS] Invalid JSON: {message[:100]}")

    except websockets.exceptions.ConnectionClosed:
        print(f"[WS] Client disconnected: {client_addr}")


async def main():
    """Main entry point"""
    print("[LED Status Controller] Starting...")
    print(f"[WS] WebSocket server listening on ws://localhost:8765")

    # Set initial state
    led.set_state(ConnectionState.IDLE)

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
