# lan-specter

`lan-specter` is the software base for SPECTER, a Raspberry Pi based portable Ethernet/LAN diagnostic tool.

This first milestone intentionally contains no display, GPIO, touch, PoE, or hardware-specific TFT assumptions. The code builds a small CLI-driven diagnostic core that can later feed a TFT UI.

## MVP Scope

- Detect a Linux network interface
- Read link state, speed, and duplex with `ethtool`
- Read basic IP configuration with `ip`
- Ping gateway, a remote SPECTER entity, and optionally an internet target
- Run an `iperf3` client test against a remote RE-01
- Return structured diagnostic results before formatting them for the CLI

## Raspberry Pi Setup

Install the expected system tools on both Raspberry Pis:

```bash
sudo apt update
sudo apt install iperf3 ethtool lldpd python3-pip python3-venv git avahi-daemon libnss-mdns
```

Set the hostnames:

```bash
sudo hostnamectl set-hostname specter-es01
sudo hostnamectl set-hostname specter-re01
```

Use `specter-es01` on the main unit and `specter-re01` on the remote unit. With Avahi/mDNS enabled, the remote should be reachable as:

```bash
specter-re01.local
```

On the remote unit, enable the iperf3 server:

```bash
sudo systemctl enable --now iperf3
```

## Development

Install locally:

```bash
python -m pip install -e .
```

Run a scan:

```bash
specter scan
```

Show a continuously updating HDMI/console dashboard:

```bash
specter watch
```

Print machine-readable scan results:

```bash
specter scan --json
```

Run the local web UI:

```bash
specter-ui
```

Run the UI with simulated data:

```bash
specter-ui --demo
```

## HDMI Console Display

An HDMI display does not need a special display driver for the MVP. Connect it to `specter-es01` and run the terminal dashboard:

```bash
cd ~/lan-specter
source .venv/bin/activate
specter watch
```

Optional autostart on `specter-es01`:

```bash
sudo cp systemd/specter-es01-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now specter-es01-dashboard.service
```

## HDMI Web UI Prototype

The web UI prototype is designed for the Waveshare 7inch HDMI LCD at 1024x600 landscape. It uses the same diagnostic core as the CLI.

Start it manually on `specter-es01`:

```bash
cd ~/lan-specter
source .venv/bin/activate
specter-ui
```

For UI development without live network tests:

```bash
specter-ui --demo
```

Optional server autostart:

```bash
sudo cp systemd/specter-es01-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now specter-es01-web.service
```

### Raspberry Pi OS Lite Kiosk

Install a minimal X/Chromium kiosk stack on `specter-es01`:

```bash
sudo apt update
sudo apt install --no-install-recommends xserver-xorg xinit x11-xserver-utils matchbox-window-manager chromium-browser curl
```

If `chromium-browser` is not available on your image:

```bash
sudo apt install --no-install-recommends chromium
```

Enable the SPECTER web server and HDMI kiosk:

```bash
cd ~/lan-specter
sudo cp systemd/specter-es01-web.service /etc/systemd/system/
sudo cp systemd/specter-es01-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl disable --now specter-es01-dashboard.service
sudo systemctl enable --now specter-es01-web.service
sudo systemctl enable --now specter-es01-kiosk.service
```

Check status:

```bash
systemctl status specter-es01-web.service
systemctl status specter-es01-kiosk.service
```

Disable the kiosk again:

```bash
sudo systemctl disable --now specter-es01-kiosk.service
sudo systemctl enable --now getty@tty1.service
```

Run tests:

```bash
python -m unittest discover -s tests
```

Without installing the package first:

```bash
PYTHONPATH=src python -m unittest discover -s tests
```

## Notes

The paranormal SPECTER terminology belongs in presentation layers. Network modules return technical facts and do not pretend to detect physical wiremap faults that two Raspberry Pis cannot prove.
