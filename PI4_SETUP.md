# Porting YouQuantified to Raspberry Pi 4

## Overview
This guide covers moving the YouQuantified application from Pi 5 to Pi 4 to test Bluetooth compatibility with Muse headsets.

**Note:** Pi 4 uses the same BCM43455 Bluetooth chipset as Pi 5, so Bluetooth issues may persist. A USB Bluetooth dongle is still recommended for reliable Muse connectivity.

---

## Prerequisites on Pi 4

1. **Raspberry Pi OS** (Bookworm recommended - stable, not testing/trixie)
2. **Network connectivity** (Ethernet or Wi-Fi)
3. **At least 4GB RAM** (8GB recommended)

---

## Step 1: Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+ (required for frontend)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL (backend database)
sudo apt install -y postgresql postgresql-contrib

# Install Bluetooth tools
sudo apt install -y bluetooth bluez bluez-tools

# Install build tools
sudo apt install -y git cmake build-essential
```

---

## Step 2: Copy Application Code

### Option A: Clone from GitHub (Recommended)
```bash
cd ~
git clone https://github.com/johncohn/quantifiedYou_oldbackend_pi.git
cd quantifiedYou_oldbackend_pi
```

### Option B: Copy directly from your Mac
On your Mac, run:
```bash
# Copy from this directory to Pi 4
scp -r /Users/jcohn/quantifiedYou_oldbackend_pi pi4-user@pi4-ip-address:~/
```

### Option C: Use rsync for efficient transfer
```bash
rsync -avz --exclude 'node_modules' \
  /Users/jcohn/quantifiedYou_oldbackend_pi/ \
  pi4-user@pi4-ip-address:~/quantifiedYou_oldbackend_pi/
```

---

## Step 3: Configure Environment Variables

Create `.env` file in `frontend/` directory:

```bash
cd ~/quantifiedYou_oldbackend_pi/frontend
cat > .env << 'EOF'
REACT_APP_UPLOAD_URI_ENDPOINT_DEV="http://localhost:3001/api/graphql"
REACT_APP_UPLOAD_URI_ENDPOINT="http://localhost:3001/api/graphql"
REACT_APP_COLLAB_ENDPOINT_DEV="ws://localhost:3001/collab"
REACT_APP_COLLAB_ENDPOINT="ws://localhost:3001/collab"
REACT_APP_GEN_AI_ENDPOINT_DEV="http://localhost:2024"
REACT_APP_GEN_AI_ENDPOINT="http://localhost:2024"
REACT_APP_CORTEX_CLIENT_ID=""
REACT_APP_CORTEX_CLIENT_SECRET=""
REACT_APP_CORTEX_LICENSE=""
EOF
```

---

## Step 4: Setup PostgreSQL Database

```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE youquantified;
CREATE USER youquantified WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE youquantified TO youquantified;
ALTER DATABASE youquantified OWNER TO youquantified;
\q
EOF
```

Create `keystone/.env`:
```bash
cd ~/quantifiedYou_oldbackend_pi/keystone
cat > .env << 'EOF'
DATABASE_URL="postgresql://youquantified:your_secure_password@localhost:5432/youquantified"
SESSION_SECRET="change_this_to_a_random_string_min_32_chars"
EOF
```

---

## Step 5: Install Application Dependencies

```bash
cd ~/quantifiedYou_oldbackend_pi

# Install backend dependencies
cd keystone
npm install
npm run build

# Install frontend dependencies
cd ../frontend
npm install

# Install genAI dependencies
cd ../genAI
npm install
```

---

## Step 6: Initialize Database

```bash
cd ~/quantifiedYou_oldbackend_pi/keystone
npm run dev
# Wait for migration to complete, then Ctrl+C
```

---

## Step 7: Bluetooth Configuration (Minimal)

**Only apply ERTM disable** (this is the only config that helped):

```bash
# Disable ERTM
echo "options bluetooth disable_ertm=1" | sudo tee /etc/modprobe.d/bluetooth-tweaks.conf

# Reboot to apply
sudo reboot
```

**Do NOT apply:**
- BLE connection parameters (didn't help)
- Power management changes (caused issues)
- Wi-Fi disabling (not the root cause)

---

## Step 8: Start Services

Create a script to run all three services:

```bash
cat > ~/quantifiedYou_oldbackend_pi/start.sh << 'EOF'
#!/bin/bash

# Start backend
cd ~/quantifiedYou_oldbackend_pi/keystone
npm run dev > ~/yq-backend.log 2>&1 &
echo "Backend started (PID: $!)"

# Wait for backend
sleep 10

# Start frontend
cd ~/quantifiedYou_oldbackend_pi/frontend
npm start > ~/yq-frontend.log 2>&1 &
echo "Frontend started (PID: $!)"

# Start genAI
cd ~/quantifiedYou_oldbackend_pi/genAI
npm run dev > ~/yq-genai.log 2>&1 &
echo "GenAI started (PID: $!)"

echo "All services started. Check logs:"
echo "  Backend: ~/yq-backend.log"
echo "  Frontend: ~/yq-frontend.log"
echo "  GenAI: ~/yq-genai.log"
EOF

chmod +x ~/quantifiedYou_oldbackend_pi/start.sh
```

Run it:
```bash
~/quantifiedYou_oldbackend_pi/start.sh
```

---

## Step 9: Test the Application

1. **Access the app**: Open Chromium on Pi 4 and go to `http://localhost:3000`
2. **Create account**: Use email-based account (e.g., `test@example.com` / `Test1234!`)
3. **Test xenbox visual**: Should work with Tone.js library now included

---

## Step 10: Test Muse Connection

1. Power on your Muse headset
2. In YouQuantified, go to Data tab
3. Click "Muse" button
4. Select your Muse device in the pairing dialog
5. **Monitor connection**:
   - Does it connect?
   - Does it stay connected?
   - Compare to Pi 5 behavior

---

## Bluetooth Testing Commands

Monitor Bluetooth while testing:

```bash
# Watch Bluetooth logs in real-time
sudo journalctl -u bluetooth -f

# Check Bluetooth adapter status
hciconfig hci0

# Check for active connections
bluetoothctl devices
bluetoothctl info <MAC_ADDRESS>

# Check power management
cat /sys/class/bluetooth/hci0/power/control
```

---

## Expected Outcomes

### If Pi 4 works better:
- Connection is more stable
- Fewer timeouts
- No Wi-Fi interference issues
- → Document what's different and stick with Pi 4

### If Pi 4 has same issues:
- Same GATT timeouts
- Same occasional connection + quick disconnect pattern
- → Confirms it's a BCM43455 chipset limitation
- → **USB Bluetooth dongle is the solution**

---

## USB Bluetooth Dongle Setup (Recommended)

If Pi 4 has same issues, add a USB Bluetooth dongle:

1. **Plug in dongle** (TP-Link UB500, ASUS USB-BT500, or Plugable USB-BT4LE)
2. **Verify detection**:
   ```bash
   lsusb | grep -i bluetooth
   hciconfig -a
   # Should show hci0 (built-in) and hci1 (dongle)
   ```

3. **Disable built-in Bluetooth**:
   ```bash
   sudo systemctl stop bluetooth
   echo "dtoverlay=disable-bt" | sudo tee -a /boot/firmware/config.txt
   sudo reboot
   ```

4. **Verify only dongle is active**:
   ```bash
   hciconfig -a
   # Should only show hci0 (which is now the dongle)
   ```

5. **Test Muse connection** - should work reliably now!

---

## Troubleshooting

### Services won't start
- Check logs: `tail -f ~/yq-*.log`
- Check ports: `sudo netstat -tlnp | grep -E '3000|3001|2024'`
- Kill existing processes: `pkill -f "node.*keystone"`

### Database connection fails
- Check PostgreSQL: `sudo systemctl status postgresql`
- Verify credentials in `keystone/.env`
- Check database exists: `sudo -u postgres psql -l`

### Muse won't connect
- Check Bluetooth is running: `systemctl status bluetooth`
- Check Muse battery level
- Try: `sudo systemctl restart bluetooth`
- Check Web Bluetooth support: `chrome://bluetooth-internals`

### Chrome says "Web Bluetooth not supported"
- Make sure using Chromium (not Firefox)
- Enable experimental features: `chrome://flags/#enable-experimental-web-platform-features`

---

## Key Differences from Pi 5 Setup

| Aspect | Pi 5 | Pi 4 (Recommended) |
|--------|------|-------------------|
| OS | Debian trixie (testing) | Debian Bookworm (stable) |
| Kernel | 6.12.x (bleeding edge) | 6.1.x (LTS) |
| Bluetooth config | Multiple tweaks tried | Only ERTM disable |
| Wi-Fi | Had instability issues | Should be stable |
| Power management | Modified | Leave default |

---

## Next Steps

1. Get Pi 4 running with YouQuantified
2. Test Muse connection
3. Compare stability to Pi 5
4. If issues persist, order USB Bluetooth dongle
5. Document what works for production deployment

---

## Notes

- **xenbox.js** and **xenbox_original.js** are in the root directory if you need them
- Tone.js is now hardcoded in p5iframe.js (committed to git)
- All environment variables are documented above
- ERTM disable is the only Bluetooth tweak worth keeping

Good luck! Let me know how the Pi 4 testing goes.
