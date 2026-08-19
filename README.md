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

Install the expected system tools:

```bash
sudo apt update
sudo apt install iperf3 ethtool lldpd python3-pip git
```

On the remote unit, start an iperf3 server:

```bash
iperf3 -s
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
