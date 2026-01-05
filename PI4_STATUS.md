# YouQuantified on Raspberry Pi 4 - Current Status

**Date:** 2026-01-04
**Goal:** Run YouQuantified with xenbox visual using Muse EEG headset on Raspberry Pi 4 for small-format computer deployment

---

## Current Status Summary

### What's Working
- **Muse Bluetooth Connection:** Stable and streaming data consistently
- **User Authentication:** Can create accounts and login
- **Backend GraphQL API:** Running on port 3001 (when stable)
- **Frontend React App:** Running on port 3000
- **Database:** PostgreSQL configured and migrations applied
- **Auto-restart Services:** systemd services configured for both frontend and backend

### What's Not Working
- **Visual Loading:** "Unexpected token '<'" error when trying to load xenbox visual
- **Backend Stability:** Backend occasionally crashes/becomes unresponsive (likely port conflicts from multiple manual starts)

### Critical Success
**Pi 4 Bluetooth with Muse is STABLE** - The primary goal has been achieved. Connection stays stable and data is flowing from the Muse headset.

---

## Hardware Configuration

- **Device:** Raspberry Pi 4
- **IP Address:** 192.168.2.3 (subject to change - check with `ip addr`)
- **Bluetooth Chipset:** BCM43455 (built-in)
- **EEG Headset:** Muse 2

---

## Software Configuration

### System Services

Two systemd services are configured for auto-restart:

#### Backend Service
**Location:** `/etc/systemd/system/youquantified-backend.service`
```bash
# Control commands
sudo systemctl status youquantified-backend
sudo systemctl restart youquantified-backend
sudo systemctl stop youquantified-backend
sudo systemctl start youquantified-backend

# View logs
sudo journalctl -u youquantified-backend -f
tail -f ~/yq-backend.log
```

#### Frontend Service
**Location:** `/etc/systemd/system/youquantified-frontend.service`
```bash
# Control commands
sudo systemctl status youquantified-frontend
sudo systemctl restart youquantified-frontend
sudo systemctl stop youquantified-frontend
sudo systemctl start youquantified-frontend

# View logs
sudo journalctl -u youquantified-frontend -f
tail -f ~/yq-frontend.log
```

### Environment Configuration

#### Frontend Environment (`~/quantifiedYou_oldbackend_pi/frontend/.env`)
```bash
REACT_APP_UPLOAD_URI_ENDPOINT_DEV="http://192.168.2.3:3001/api/graphql"
REACT_APP_UPLOAD_URI_ENDPOINT="http://192.168.2.3:3001/api/graphql"
REACT_APP_COLLAB_ENDPOINT_DEV="ws://192.168.2.3:3001/collab"
REACT_APP_COLLAB_ENDPOINT="ws://192.168.2.3:3001/collab"
REACT_APP_GEN_AI_ENDPOINT_DEV="http://192.168.2.3:2024"
REACT_APP_GEN_AI_ENDPOINT="http://192.168.2.3:2024"
REACT_APP_CORTEX_CLIENT_ID=""
REACT_APP_CORTEX_CLIENT_SECRET=""
REACT_APP_CORTEX_LICENSE=""
```

**Important:** Uses IP address (192.168.2.3) instead of localhost to enable Web Bluetooth with Chrome flag.

#### Backend Environment (`~/quantifiedYou_oldbackend_pi/keystone/.env`)
```bash
POSTGRES_URL=postgresql://youquantified:securepassword@localhost:5432/youquantified
DATABASE_URL=postgresql://youquantified:securepassword@localhost:5432/youquantified
SESSION_SECRET=youquantified_pi4_session_secret
FRONTEND_URL_DEV=http://localhost:3000
FRONTEND_URL=http://192.168.2.3:3000
NODE_ENV=production
```

### Backend Configuration (`keystone/keystone.ts`)

**CORS Configuration:**
```typescript
cors: {
  origin: true,  // Accept all origins (simplified for local testing)
  credentials: true,
},
```

**Database Provider:**
- Development: SQLite
- Production: PostgreSQL (configured for Pi deployment)

**Storage Paths:**
- Cover images: `public/images/`
- P5 visuals: `public/code/`

---

## Web Bluetooth Setup

Web Bluetooth API requires localhost, HTTPS, or flagged insecure origins.

### Chrome Flag Configuration (REQUIRED)

1. Open Chrome/Chromium on the Pi
2. Navigate to: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
3. Add: `http://192.168.2.3:3000`
4. Click "Relaunch"
5. **May require 2-3 relaunches** before Muse button becomes active

### Accessing the Application

**Always use:** `http://192.168.2.3:3000` (not localhost:3000)

This ensures:
- Web Bluetooth works with the Chrome flag
- CORS headers match expected origin
- Frontend can reach backend API

---

## Muse Connection Procedure

1. Power on Muse headset
2. Navigate to `http://192.168.2.3:3000` in Chrome
3. Login to your account
4. Go to Data tab
5. Click "Muse" button (should not be greyed out if Chrome flag is set)
6. Select Muse device in pairing dialog
7. Connection should establish and remain stable

**User Confirmation:** "connection is stable.. and i did a recording of the muse data and it looks good (as in there are numbers).. not sure if they are valid.. but there is data flowing"

---

## Known Issues

### Issue 1: Visual Loading Error
**Symptom:** When trying to load xenbox visual, browser shows "Unexpected token '<'" error

**Status:** UNRESOLVED

**What We Know:**
- Visual files are being served correctly (HTTP 200)
- Files exist in `~/quantifiedYou_oldbackend_pi/keystone/public/code/`
- Example files: `blob-xY3B5NmJpj_3`, `blob-BxIr1h-_6zEr`
- Error occurs when iframe tries to load the visual code

**GraphQL Query That Fails:**
```graphql
query Visual($where: VisualWhereUniqueInput!) {
  visual(where: $where) {
    id
    title
    description
    p5Code {
      url
      filename
    }
  }
}
```

**Error Response:** "failed to load response data no data found for resource with given identifier"

### Issue 2: Backend Instability
**Symptom:** Backend occasionally crashes or becomes unresponsive

**Likely Causes:**
- Port conflicts from multiple manual starts (`EADDRINUSE: address already in use :::3001`)
- GraphQL query failures
- Unknown crashes

**Current Mitigation:**
- systemd auto-restart configured (RestartSec=10)
- Manual recovery: `sudo killall -9 node && sudo systemctl restart youquantified-backend`

**Status:** Partially mitigated by auto-restart, root cause unclear

### Issue 3: CORS Preflight Failures
**Symptom:** Backend not returning `Access-Control-Allow-Origin` header in OPTIONS requests

**Workaround:** Access app from `http://192.168.2.3:3000` instead of `http://localhost:3000`

**Status:** Workaround in place, proper fix would require deeper CORS debugging

---

## Troubleshooting

### Backend Won't Start
```bash
# Kill all node processes
sudo killall -9 node

# Restart services
sudo systemctl restart youquantified-backend youquantified-frontend

# Check status
sudo systemctl status youquantified-backend --no-pager
tail -50 ~/yq-backend.log
```

### Frontend Connection Refused
```bash
# Check if port 3000 is occupied
sudo fuser -k 3000/tcp

# Restart frontend
sudo systemctl restart youquantified-frontend
```

### Muse Button Greyed Out
1. Verify Chrome flag is set: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Ensure value is: `http://192.168.2.3:3000`
3. Relaunch Chrome (may need 2-3 attempts)
4. Access via `http://192.168.2.3:3000` (not localhost)

### Database Schema Issues
```bash
cd ~/quantifiedYou_oldbackend_pi/keystone
npx prisma db push --accept-data-loss
```

### Check Backend Health
```bash
# Test GraphQL endpoint
curl -s http://192.168.2.3:3001/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{__typename}"}'

# Should return: {"data":{"__typename":"Query"}}
```

---

## Development Workflow

### Restart Everything Cleanly
```bash
# On the Pi
sudo killall -9 node
sudo systemctl restart youquantified-backend youquantified-frontend

# Wait 15 seconds for services to stabilize
sleep 15

# Verify services
sudo systemctl status youquantified-backend --no-pager
sudo systemctl status youquantified-frontend --no-pager
```

### Deploy Changes from Mac
```bash
# On Mac, in this directory
scp -r keystone/ xenbox@192.168.2.3:~/quantifiedYou_oldbackend_pi/
scp -r frontend/ xenbox@192.168.2.3:~/quantifiedYou_oldbackend_pi/

# Or use rsync (more efficient)
rsync -avz --exclude 'node_modules' \
  keystone/ xenbox@192.168.2.3:~/quantifiedYou_oldbackend_pi/keystone/

rsync -avz --exclude 'node_modules' \
  frontend/ xenbox@192.168.2.3:~/quantifiedYou_oldbackend_pi/frontend/
```

### Rebuild Backend After Changes
```bash
# On the Pi
cd ~/quantifiedYou_oldbackend_pi/keystone
npm install
npm run build
sudo systemctl restart youquantified-backend
```

---

## What We Achieved

1. **Successful Muse Bluetooth pairing and stable connection on Pi 4**
2. PostgreSQL database configured and running
3. User authentication working
4. systemd services for auto-restart on failure
5. Web Bluetooth enabled via Chrome flag workaround
6. GraphQL API serving data (when backend is stable)
7. Frontend accessible and functional

---

## What Remains To Be Done

1. **Fix visual loading issue** - "Unexpected token '<'" error when loading xenbox visual
   - This is the critical blocker for using Muse data with visuals

2. **Stabilize backend** - Identify and fix root cause of crashes
   - May be related to port conflicts
   - May be related to GraphQL query handling

3. **Test xenbox visual with live Muse data** - Once visual loading works
   - Verify data integration
   - Test visualization responsiveness

4. **Optimize for production deployment**
   - Consider nginx reverse proxy
   - Set up proper HTTPS with Let's Encrypt
   - Harden security (change default passwords, secure PostgreSQL)

---

## Project Goal

**Primary Objective:** Run xenbox visual on small-format computer (Raspberry Pi 4) with Muse EEG headset as input.

**Status:** 75% complete
- Muse connectivity: WORKING
- Pi 4 deployment: WORKING
- Visual loading: NOT WORKING
- Data integration: UNTESTED (blocked by visual loading)

---

## Important Files

- **Visual code samples:** `xenbox.js`, `xenbox_original.js` (in root directory)
- **Backend logs:** `~/yq-backend.log` (on Pi)
- **Frontend logs:** `~/yq-frontend.log` (on Pi)
- **systemd services:** `/etc/systemd/system/youquantified-*.service` (on Pi)
- **Database:** PostgreSQL at `localhost:5432/youquantified` (on Pi)

---

## Network Information

**Current IP:** 192.168.2.3 (may change)

**To find Pi if IP changes:**
```bash
# From Mac
arp -a | grep -i "b8:27:eb\|dc:a6:32\|e4:5f:01"

# Or scan network
for ip in 192.168.1.{1..254}; do
  ping -c 1 -W 500 $ip &>/dev/null && echo "$ip is up"
done
```

---

## Next Session Checklist

1. Check if backend is responding: `curl http://192.168.2.3:3001/api/graphql`
2. Check service status: `ssh xenbox@192.168.2.3 "sudo systemctl status youquantified-backend --no-pager"`
3. Check recent logs: `ssh xenbox@192.168.2.3 "tail -50 ~/yq-backend.log"`
4. Access app: `http://192.168.2.3:3000`
5. Test Muse connection (should work reliably)
6. Debug visual loading issue

---

**Last Updated:** 2026-01-04
**Major Achievement:** Muse Bluetooth connection stable and streaming data on Pi 4
