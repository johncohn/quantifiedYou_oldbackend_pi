# xenbox Login & Access Reference

## YouQuantified Dashboard

| | |
|---|---|
| **URL (kiosk view)** | `http://xenbox.local:3000/kiosk/cmk8yniz80002jibx3fh7j9ax` |
| **URL (home/login)** | `http://xenbox.local:3000` |
| **Email** | `jc7@com` |
| **Password** | `x-----` |

> Note: The Muse EEG will only connect from the Pi's own Chromium (Bluetooth is paired there). From a Mac browser you'll see a "Connect Muse" button but the visualization won't activate.

---

## SSH

```bash
ssh xenbox@xenbox.local
```

---

## VNC (live view of Pi screen)

```bash
# 1. Open tunnel
ssh -L 5900:localhost:5900 -N xenbox@xenbox.local

# 2. Connect VNC client to:
vnc://localhost:5900
```

Credentials: `xenbox` / (xenbox system password)

> Mac built-in: Finder → Go → Connect to Server → `vnc://localhost:5900`

---

## Mac Dev Scripts

| Script | What it does |
|--------|-------------|
| `./xenbox-dashboard.sh` | Tunnels ports 3000/3001/8765, opens Chrome at `localhost:3000` |
| `./bela-ide.sh` | Tunnels Bela IDE ports, opens Chrome at `localhost:8080?port=8080` |

> **⚠️ Port conflict:** Both scripts need port 3000. You cannot run them at the same time.
> Kill existing tunnels before switching:
> ```bash
> pkill -f "3000:localhost:3000" 2>/dev/null
> pkill -f "8080:192.168.7.2:80" 2>/dev/null
> pkill -f "3000:192.168.7.2:3000" 2>/dev/null
> ```
> Then run whichever script you want.

---

## Bela IDE

```bash
# 1. Kill any conflicting tunnels (on Mac)
pkill -f "3000:localhost:3000" 2>/dev/null
pkill -f "8080:192.168.7.2:80" 2>/dev/null
pkill -f "3000:192.168.7.2:3000" 2>/dev/null

# 2. Open Bela IDE
./bela-ide.sh
```

Opens Chrome at `http://localhost:8080?port=8080` — shows the PD patch console, MIDI traffic, CPU load, and all Bela projects.

> The `?port=8080` in the URL is required — without it the IDE tries to connect its main WebSocket on port 80 (which isn't tunneled) and fails.

---

## Chrome DevTools (debug kiosk Chromium remotely)

```bash
ssh -L 9222:localhost:9222 xenbox@xenbox.local
```

Then open Chrome on Mac → `chrome://inspect` → click **inspect** under the kiosk page.

> To see EEG console: click the context dropdown (top-left, shows `top`) and switch to the `blob:` frame.

---

## Pi Services

```bash
# Status
sudo systemctl status youquantified-backend
sudo systemctl status youquantified-frontend
sudo systemctl status yq-led-controller

# Restart
sudo systemctl restart youquantified-backend
sudo systemctl restart youquantified-frontend
```

---

## DB Backup / Restore

```bash
# Backup
ssh xenbox@xenbox.local "cp /home/xenbox/quantifiedYou_oldbackend_pi/keystone/keystone.db /home/xenbox/keystone.db.bak"

# Restore
ssh xenbox@xenbox.local "cp /home/xenbox/keystone.db.bak /home/xenbox/quantifiedYou_oldbackend_pi/keystone/keystone.db"
```
