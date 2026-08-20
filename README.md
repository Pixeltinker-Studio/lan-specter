# lan-specter

`lan-specter` is the software base for SPECTER, a portable Ethernet/LAN diagnostic tool built for a **Raspberry Pi 5 running Raspberry Pi OS Lite 64-bit**.

The ES-01 uses the Raspberry Pi 5 as its fixed target platform. The HDMI UI is designed for the Waveshare 7-inch display at 1024x600 in landscape orientation and is operated by capacitive touch.

Reference captures of the main interface states are available in the [SPECTER UI screenshot gallery](docs/screenshots/README.md).

## Target Platform

- Raspberry Pi 5
- Raspberry Pi OS Lite 64-bit
- ARM64 / `aarch64`
- Waveshare 7-inch HDMI LCD
- 1024x600 landscape
- USB capacitive touch

The installation instructions in this document assume this platform. Older Raspberry Pi models, 32-bit Raspberry Pi OS, desktop images, and non-ARM64 systems are not deployment targets.

## Planning and Issues

Features, bugs, and technical tasks are tracked in the [LAN Specter project](https://github.com/orgs/Pixeltinker-Studio/projects/2). Please use the repository's issue forms when adding new work.

## MVP Scope

- Detect a Linux network interface
- Read link state, speed, and duplex with `ethtool`
- Read basic IP configuration with `ip`
- Ping gateway, a remote SPECTER entity, and optionally an internet target
- Run an `iperf3` client test against a remote RE-01
- Run an operator-initiated Internet speed test with `librespeed-cli`
- Return structured diagnostic results before formatting them for the CLI

## Raspberry Pi Setup

Install the expected system tools on both Raspberry Pis:

```bash
sudo apt update
sudo apt install bluez iperf3 ethtool lldpd network-manager python3-gpiozero python3-lgpio python3-pip python3-venv git curl ca-certificates avahi-daemon libnss-mdns
```

Install the ARM64 build of `librespeed-cli` on ES-01. The commands below are specifically for Raspberry Pi 5 with Raspberry Pi OS Lite 64-bit:

```bash
SPECTER_LIBRESPEED_VERSION=1.0.14
SPECTER_LIBRESPEED_TMP="$(mktemp -d)"
SPECTER_LIBRESPEED_ARCHIVE="librespeed-cli_${SPECTER_LIBRESPEED_VERSION}_linux_arm64.tar.gz"

curl -fL \
  "https://github.com/librespeed/speedtest-cli/releases/download/v${SPECTER_LIBRESPEED_VERSION}/${SPECTER_LIBRESPEED_ARCHIVE}" \
  -o "${SPECTER_LIBRESPEED_TMP}/${SPECTER_LIBRESPEED_ARCHIVE}"

curl -fL \
  "https://github.com/librespeed/speedtest-cli/releases/download/v${SPECTER_LIBRESPEED_VERSION}/checksums.txt" \
  -o "${SPECTER_LIBRESPEED_TMP}/checksums.txt"

(
  cd "${SPECTER_LIBRESPEED_TMP}"
  sha256sum --check --ignore-missing checksums.txt
  tar -xzf "${SPECTER_LIBRESPEED_ARCHIVE}"
)

sudo install -m 0755 \
  "${SPECTER_LIBRESPEED_TMP}/librespeed-cli" \
  /usr/local/bin/librespeed-cli

rm -rf "${SPECTER_LIBRESPEED_TMP}"

/usr/local/bin/librespeed-cli --version
```

Release `v1.0.14` and its checksums are published by the [official LibreSpeed project](https://github.com/librespeed/speedtest-cli/releases/tag/v1.0.14).

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

The Bluetooth entity finder listens for Bluetooth Low Energy advertisements through BlueZ. It reports measured RSSI values and a short-term warmer/colder trend. RSSI is not a reliable distance or direction measurement, and devices that are not advertising cannot be detected.

### Passive Piezo Beeper

The acoustic signal output is disabled until a BCM GPIO pin is explicitly configured. For a robust installation, drive the passive piezo through a small NPN transistor or logic-level MOSFET instead of treating a GPIO as a speaker output.

For the low-power Murata PKM22EPP-40 used in the prototype, a direct GPIO test connection can use a permanent 1 kOhm series resistor:

```text
GPIO18 --- 1 kOhm --- PIEZO +
GND ---------------- PIEZO -
```

To attenuate the output mechanically, add a 10 kOhm linear potentiometer as a rheostat in series after the permanent resistor. Connect the wiper to one of the used outer terminals so a poor wiper contact does not interrupt the circuit. Do not replace or bypass the fixed 1 kOhm GPIO protection resistor, and never connect the piezo between 5 V and a GPIO.

Recommended reference circuit for a low-voltage passive piezo:

```text
GPIO18 --- 1 kΩ --- NPN base
                     |
                  100 kΩ
                     |
GND -----------------+--- NPN emitter

3.3 V --- PIEZO +
          PIEZO - --- NPN collector
```

Confirm the voltage and current rating of the actual piezo before wiring it. Use a common ground. If the selected transducer module already contains a driver, follow its datasheet instead of this reference circuit.

After choosing the pin, enable it for the service:

```bash
sudo cp config/specter.env.example /etc/default/specter
sudoedit /etc/default/specter
sudo systemctl restart specter-es01-web.service
```

`SPECTER_BEEPER_PIN` uses BCM numbering. The example selects GPIO18. `GPIOZERO_PIN_FACTORY=lgpio` selects the Raspberry Pi 5-compatible GPIO backend. Set `SPECTER_BEEPER_MUTED=1` to boot silently. The UI reports the beeper as unavailable when no pin is configured or GPIO initialization fails; it does not simulate successful output in live mode. If the virtual environment cannot import the OS-provided `lgpio` module, recreate it with `python3 -m venv --system-site-packages .venv` before installing this project.

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

The web UI prototype is designed for the Waveshare 7-inch HDMI LCD at **1024x600 landscape**. This is the project's required target resolution and the acceptance-test viewport for UI changes. Smaller viewport checks are additional compatibility tests only. The UI uses the same diagnostic core as the CLI.

After startup, the UNIT PLATE is the HOME view. Its `MENU` control opens the subsystem routing matrix; the matrix uses `HOME` to return to the plate, while instrument views use `MENU` to return to the matrix.

The UI includes a moving standby screen to reduce static image retention. Touching the display exits standby and shows the SPECTER boot screen before returning to the UNIT PLATE.

The `EXTERNAL CAPACITY` menu entry runs a separate Internet measurement and never requires RE-01. It uses `librespeed-cli` JSON output for download, upload, ping, and jitter. The test starts only after the operator reviews the data-use and public-IP notice. It runs asynchronously, can be cancelled, and is limited by both the LibreSpeed HTTP timeout and a hard process timeout. No result-sharing or telemetry option is requested.

Configure the test in `/etc/default/specter` with the `SPECTER_LIBRESPEED_*` values from `config/specter.env.example`. By default, LibreSpeed's public server pool is used. For a self-hosted backend, copy `config/librespeed-servers.example.json`, replace its example server details, and set `SPECTER_LIBRESPEED_LOCAL_JSON` to the resulting absolute path. A remotely hosted server list can instead be selected with `SPECTER_LIBRESPEED_SERVER_JSON`. The configured test server necessarily sees the device's public IP address, and transfer volume varies with available connection capacity and test duration.

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
sudo cp config/polkit-1/rules.d/49-specter-networkmanager.rules /etc/polkit-1/rules.d/
sudo chown root:root /etc/polkit-1/rules.d/49-specter-networkmanager.rules
sudo chmod 0644 /etc/polkit-1/rules.d/49-specter-networkmanager.rules
sudo systemctl daemon-reload
sudo systemctl enable --now specter-es01-web.service
```

The Polkit rule grants the `specter` service user only the NetworkManager permissions needed to scan for Wi-Fi access points and switch the Wi-Fi radio. It does not grant general root command execution.

### Raspberry Pi OS Lite Kiosk

Install a minimal X/Chromium kiosk stack on `specter-es01`:

```bash
sudo apt update
sudo apt install --no-install-recommends xserver-xorg xinit x11-xserver-utils xserver-xorg-input-libinput matchbox-window-manager chromium-browser curl xinput libinput-tools evtest
```

If `chromium-browser` is not available on your image:

```bash
sudo apt install --no-install-recommends chromium
```

For Waveshare USB capacitive touch, connect both HDMI and USB. Check whether the touch controller is visible:

```bash
lsusb
cat /proc/bus/input/devices
sudo libinput list-devices
```

Inside the running kiosk X session, touch devices should also appear in:

```bash
DISPLAY=:0 xinput list
```

On Raspberry Pi 5, Xorg may choose the non-display DRM device first. Install the SPECTER Xorg override:

```bash
sudo mkdir -p /etc/X11/xorg.conf.d
sudo cp config/xorg.conf.d/99-specter-pi5-hdmi.conf /etc/X11/xorg.conf.d/
```

Enable the SPECTER web server and HDMI kiosk:

```bash
cd ~/lan-specter
sudo cp systemd/specter-es01-web.service /etc/systemd/system/
sudo cp systemd/specter-es01-kiosk.service /etc/systemd/system/
sudo cp config/polkit-1/rules.d/49-specter-networkmanager.rules /etc/polkit-1/rules.d/
sudo chown root:root /etc/polkit-1/rules.d/49-specter-networkmanager.rules
sudo chmod 0644 /etc/polkit-1/rules.d/49-specter-networkmanager.rules
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

## Design

The current visual direction is documented in:

```text
docs/design/specter-visual-design.md
```
