#!/usr/bin/env python3
"""
Headless Muse Service - Auto-connects to Muse without user interaction

This service:
1. Scans for Muse devices via native Bluetooth (no user gesture needed!)
2. Connects and streams EEG data
3. Calculates band powers (Alpha, Beta, Theta, Gamma)
4. Sends data to frontend via WebSocket

Requires: pip install bleak numpy websockets
"""

import asyncio
import json
import logging
import signal
import struct
import sys
from datetime import datetime
from collections import deque

import numpy as np
from bleak import BleakScanner, BleakClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[MUSE %(asctime)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# Muse BLE UUIDs
MUSE_SERVICE = "0000fe8d-0000-1000-8000-00805f9b34fb"
CONTROL_CHAR = "273e0001-4c4d-454d-96be-f03bac821358"
EEG_CHARS = [
    "273e0003-4c4d-454d-96be-f03bac821358",  # TP9
    "273e0004-4c4d-454d-96be-f03bac821358",  # AF7
    "273e0005-4c4d-454d-96be-f03bac821358",  # AF8
    "273e0006-4c4d-454d-96be-f03bac821358",  # TP10
]

# Muse EEG parameters
SFREQ = 256  # Muse sampling rate
WINDOW_SIZE = 2  # seconds for FFT
BAND_POWERS_RATE = 10  # Hz - how often to calculate band powers
NUM_CHANNELS = 4
CHANNEL_NAMES = ['TP9', 'AF7', 'AF8', 'TP10']

# Frequency bands
BANDS = {
    'Theta': (4, 8),
    'Alpha': (8, 12),
    'Low beta': (12, 16),
    'High beta': (16, 25),
    'Gamma': (25, 45),
}

# WebSocket server config
WS_HOST = '0.0.0.0'  # Allow connections from any interface
WS_PORT = 8766  # Different from LED controller (8765)


def decode_eeg_packet(packet):
    """Decode Muse EEG packet (12-bit samples)"""
    # First 2 bytes are timestamp, rest are 12-bit EEG samples
    samples = []
    # Muse sends 12 samples per packet, each 12 bits
    # Packed as: [timestamp(2)] [sample pairs as 3 bytes each]
    for i in range(12):
        # Calculate byte position for 12-bit sample
        byte_offset = 2 + (i * 3) // 2
        if byte_offset + 1 >= len(packet):
            break

        if i % 2 == 0:
            # First sample of pair: first byte + upper 4 bits of second
            val = (packet[byte_offset] << 4) | (packet[byte_offset + 1] >> 4)
        else:
            # Second sample of pair: lower 4 bits of first + second byte
            val = ((packet[byte_offset] & 0x0F) << 8) | packet[byte_offset + 1]

        # Convert from unsigned 12-bit to microvolts
        # Muse uses 12-bit ADC with 1.64V reference
        val = (val - 2048) * 1.64 / 2048 * 1000000 / 256
        samples.append(val)

    return samples


class MuseHeadlessService:
    def __init__(self):
        self.running = False
        self.connected = False
        self.device_name = None
        self.device_address = None
        self.client = None
        self.clients = set()  # WebSocket clients

        # EEG data buffers (one per channel)
        buffer_size = WINDOW_SIZE * SFREQ
        self.buffers = [deque(maxlen=buffer_size) for _ in range(NUM_CHANNELS)]

        # Initialize buffers with zeros
        for buf in self.buffers:
            buf.extend([0.0] * buffer_size)

        self.reconnect_delay = 5
        self.max_reconnect_delay = 30
        self.sample_count = 0
        self.last_log_time = 0

    async def scan_for_muse(self, timeout=15):
        """Scan for Muse devices"""
        log.info(f"Scanning for Muse devices ({timeout}s)...")

        try:
            devices = await BleakScanner.discover(timeout=timeout)

            for device in devices:
                name = device.name or ""
                if 'muse' in name.lower():
                    log.info(f"Found: {device.name} ({device.address})")
                    return device

            log.warning("No Muse device found")
            return None

        except Exception as e:
            log.error(f"Scan error: {e}")
            return None

    def _eeg_callback(self, channel_idx):
        """Create callback for EEG characteristic notifications"""
        def callback(sender, data):
            try:
                samples = decode_eeg_packet(bytes(data))
                for sample in samples:
                    self.buffers[channel_idx].append(sample)
                self.sample_count += len(samples)
            except Exception as e:
                log.debug(f"Decode error ch{channel_idx}: {e}")
        return callback

    def _disconnect_callback(self, client):
        """Called when Muse disconnects"""
        log.warning("Muse disconnected!")
        self.connected = False
        asyncio.create_task(self.broadcast_status())

    async def connect_muse(self, device):
        """Connect to Muse and start streaming"""
        log.info(f"Connecting to {device.name}...")

        try:
            self.client = BleakClient(
                device.address,
                disconnected_callback=self._disconnect_callback
            )

            await self.client.connect(timeout=20)

            if not self.client.is_connected:
                log.error("Connection failed")
                return False

            self.connected = True
            self.device_name = device.name
            self.device_address = device.address
            log.info(f"Connected to {device.name}")

            # Subscribe to EEG characteristics
            for idx, char_uuid in enumerate(EEG_CHARS):
                try:
                    await self.client.start_notify(char_uuid, self._eeg_callback(idx))
                    log.info(f"Subscribed to EEG channel {idx} ({CHANNEL_NAMES[idx]})")
                except Exception as e:
                    log.error(f"Failed to subscribe to channel {idx}: {e}")

            # Muse protocol: send commands to start streaming
            # Order matters: preset first, then resume
            try:
                # Request version (helps initialize some Muse models)
                await self.client.write_gatt_char(CONTROL_CHAR, b'v1\n')
                log.info("Sent version request")
                await asyncio.sleep(0.5)

                # Set preset (p20 = default, p21 = EEG-focused)
                await self.client.write_gatt_char(CONTROL_CHAR, b'p20\n')
                log.info("Sent preset p20")
                await asyncio.sleep(0.5)

                # Resume streaming
                await self.client.write_gatt_char(CONTROL_CHAR, b's\n')
                log.info("Sent resume command")
                await asyncio.sleep(0.5)

                # Start data
                await self.client.write_gatt_char(CONTROL_CHAR, b'd\n')
                log.info("Sent start command")
            except Exception as e:
                log.warning(f"Command failed: {e}")

            # Reset reconnect delay on successful connection
            self.reconnect_delay = 5

            await self.broadcast_status()
            return True

        except Exception as e:
            log.error(f"Connection error: {e}")
            self.connected = False
            if self.client:
                try:
                    await self.client.disconnect()
                except:
                    pass
            return False

    def calculate_band_powers(self):
        """Calculate band powers using FFT"""
        band_powers = {}

        for band_name, (low_freq, high_freq) in BANDS.items():
            channel_powers = []

            for ch in range(NUM_CHANNELS):
                # Get buffer data
                data = np.array(self.buffers[ch])

                # Skip if mostly zeros (no data yet)
                if np.abs(data).max() < 0.1:
                    continue

                # Remove mean (center the data)
                data = data - np.mean(data)

                # Apply Hamming window
                window = np.hamming(len(data))
                data = data * window

                # FFT
                fft_vals = np.fft.fft(data)
                n = len(data)
                psd = np.abs(fft_vals[:n//2])
                psd = (2 * psd) / n

                # Get frequency bins
                freqs = np.fft.fftfreq(n, 1/SFREQ)[:n//2]

                # Find indices for this band
                idx = np.where((freqs >= low_freq) & (freqs < high_freq))[0]

                if len(idx) > 0:
                    band_power = float(np.mean(psd[idx]))
                    channel_powers.append(band_power)

            # Average across channels
            if channel_powers:
                band_powers[band_name] = float(np.mean(channel_powers))

        return band_powers

    async def broadcast_status(self):
        """Send connection status to all WebSocket clients"""
        status = {
            'type': 'muse_status',
            'connected': self.connected,
            'device_name': self.device_name,
            'timestamp': datetime.now().isoformat()
        }
        await self.broadcast(status)

    async def broadcast_data(self, band_powers):
        """Send band power data to all WebSocket clients"""
        if not band_powers:
            return

        message = {
            'type': 'band_powers',
            'data': band_powers,
            'timestamp': datetime.now().isoformat()
        }
        await self.broadcast(message)

    async def broadcast(self, message):
        """Send message to all connected WebSocket clients"""
        if not self.clients:
            return

        msg_str = json.dumps(message)
        disconnected = set()

        for client in self.clients:
            try:
                await client.send(msg_str)
            except Exception:
                disconnected.add(client)

        self.clients -= disconnected

    async def handle_client(self, websocket, path=None):
        """Handle a WebSocket client connection"""
        addr = websocket.remote_address if hasattr(websocket, 'remote_address') else 'unknown'
        log.info(f"WebSocket client connected: {addr}")
        self.clients.add(websocket)

        # Send current status immediately
        await self.broadcast_status()

        try:
            async for message in websocket:
                try:
                    cmd = json.loads(message)
                    if cmd.get('type') == 'ping':
                        await websocket.send(json.dumps({'type': 'pong'}))
                    elif cmd.get('type') == 'status':
                        await self.broadcast_status()
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            log.debug(f"Client error: {e}")
        finally:
            self.clients.discard(websocket)
            log.info(f"WebSocket client disconnected: {addr}")

    async def band_power_loop(self):
        """Periodically calculate and broadcast band powers"""
        import time
        interval = 1.0 / BAND_POWERS_RATE

        while self.running:
            if self.connected:
                try:
                    band_powers = self.calculate_band_powers()

                    # Log status every 5 seconds regardless of data
                    now = time.time()
                    if now - self.last_log_time > 5:
                        self.last_log_time = now
                        if band_powers:
                            alpha = band_powers.get('Alpha', 0)
                            log.info(f"Data: samples={self.sample_count} Alpha={alpha:.4f} clients={len(self.clients)}")
                        else:
                            log.info(f"No band data yet: samples={self.sample_count} clients={len(self.clients)}")

                    if band_powers:
                        await self.broadcast_data(band_powers)
                except Exception as e:
                    log.error(f"Band power error: {e}")

            await asyncio.sleep(interval)

    async def connection_loop(self):
        """Main connection management loop"""
        while self.running:
            if not self.connected:
                device = await self.scan_for_muse(timeout=10)

                if device:
                    success = await self.connect_muse(device)
                    if not success:
                        log.info(f"Retrying in {self.reconnect_delay}s...")
                        await asyncio.sleep(self.reconnect_delay)
                        # Exponential backoff
                        self.reconnect_delay = min(self.reconnect_delay * 1.5, self.max_reconnect_delay)
                else:
                    log.info(f"No device found, retrying in {self.reconnect_delay}s...")
                    await asyncio.sleep(self.reconnect_delay)
            else:
                # Check connection health
                if self.client and not self.client.is_connected:
                    log.warning("Connection lost")
                    self.connected = False
                    await self.broadcast_status()

                await asyncio.sleep(2)

    async def run(self):
        """Main run loop"""
        import websockets

        self.running = True

        log.info("=" * 50)
        log.info("Muse Headless Service Starting")
        log.info(f"WebSocket server: ws://{WS_HOST}:{WS_PORT}")
        log.info("=" * 50)

        # Start WebSocket server
        server = await websockets.serve(
            self.handle_client,
            WS_HOST,
            WS_PORT
        )
        log.info("WebSocket server ready")

        # Run background tasks
        try:
            await asyncio.gather(
                self.connection_loop(),
                self.band_power_loop(),
            )
        except asyncio.CancelledError:
            log.info("Shutting down...")
        finally:
            server.close()
            await server.wait_closed()
            if self.client and self.client.is_connected:
                await self.client.disconnect()
            self.running = False

    def stop(self):
        """Stop the service"""
        log.info("Stop requested")
        self.running = False


async def main():
    service = MuseHeadlessService()

    loop = asyncio.get_event_loop()

    def signal_handler():
        log.info("Received shutdown signal")
        service.stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    await service.run()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Interrupted")
