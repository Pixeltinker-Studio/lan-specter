# SPECTER UI Screenshots

Reference captures of the web UI in demo mode at the native Waveshare display resolution: **1024 × 600 pixels, landscape**.

| Boot sequence | Unit plate / default view |
| --- | --- |
| [![Boot sequence](01-boot.jpg)](01-boot.jpg) | [![Unit plate](02-unit-plate.jpg)](02-unit-plate.jpg) |
| **Subsystem menu** | **Ethernetic field status** |
| [![Subsystem menu](03-main-menu.jpg)](03-main-menu.jpg) | [![Ethernetic field status](04-ethernetic-field-status.jpg)](04-ethernetic-field-status.jpg) |
| **Entity scan** | **Full analysis in progress** |
| [![Entity scan](05-entity-scan.jpg)](05-entity-scan.jpg) | [![Full analysis](06-full-analysis.jpg)](06-full-analysis.jpg) |
| **Analysis result** | **Remote entity interlock** |
| [![Analysis result](07-analysis-complete.jpg)](07-analysis-complete.jpg) | [![Remote entity interlock](08-remote-entity-interlock.jpg)](08-remote-entity-interlock.jpg) |
| **Field collapse** | **WLAN spectrum** |
| [![Field collapse](09-field-collapse.jpg)](09-field-collapse.jpg) | [![WLAN spectrum](10-wlan-spectrum.jpg)](10-wlan-spectrum.jpg) |
| **BLE entity finder** | **External capacity notice** |
| [![BLE entity finder](11-ble-entity-finder.jpg)](11-ble-entity-finder.jpg) | [![External capacity](12-external-capacity.jpg)](12-external-capacity.jpg) |
| **External analysis in progress** | **External analysis result** |
| [![External analysis](13-external-analysis.jpg)](13-external-analysis.jpg) | [![External analysis result](14-external-analysis-complete.jpg)](14-external-analysis-complete.jpg) |
| **Technical diagnostics** | **Acoustic signals** |
| [![Technical diagnostics](15-diagnostics.jpg)](15-diagnostics.jpg) | [![Acoustic signals](16-acoustic-signals.jpg)](16-acoustic-signals.jpg) |
| **Standby containment array** | |
| [![Standby containment array](17-standby-containment.jpg)](17-standby-containment.jpg) | |

These images are presentation references, not substitutes for live Raspberry Pi hardware validation. Radio readings, device identities, addresses, throughput, and timing values shown here are simulated demo data.

## Refreshing the captures

The repository contains a deterministic capture utility at `scripts/capture_ui_screenshots.py`. It starts the SPECTER demo server on an available local port, opens Chromium at exactly **1024 × 600**, prepares each documented UI state, writes JPEG files at 90% quality, and verifies their pixel dimensions.

Install the optional tooling once:

```console
python -m pip install -e ".[screenshots]"
python -m playwright install chromium
```

Refresh the complete gallery:

```console
python scripts/capture_ui_screenshots.py
```

Refresh only the screens affected by a change:

```console
python scripts/capture_ui_screenshots.py --screens menu,bluetooth,standby
```

Show all accepted screen names without starting a server or browser:

```console
python scripts/capture_ui_screenshots.py --list
```

An existing demo server or an installed system Chromium may be used explicitly:

```console
python scripts/capture_ui_screenshots.py --base-url http://127.0.0.1:8765
python scripts/capture_ui_screenshots.py --browser-executable /usr/bin/chromium
```

The utility checks `/api/scan` before performing any setup and refuses to continue unless the server reports demo mode. It therefore cannot trigger WLAN, Bluetooth, or analysis operations against a live instrument by mistake. Captures are written directly to this directory; review the changed images before committing them.
