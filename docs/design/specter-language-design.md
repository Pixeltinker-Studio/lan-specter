# SPECTER Language Design Direction

Layout, typography, color, motion, and hardware display constraints are defined in `docs/design/specter-visual-design.md`. Language and visual direction must be applied together.

## Purpose

This document defines the voice and terminology of the SPECTER presentation layer.

SPECTER speaks like a serious portable scientific instrument from a slightly alternative 1987. Its terminology is technically adjacent, pseudoscientific, and faintly ominous. The device never acknowledges that any of this is unusual.

The humor comes from rigorous presentation of absurd terminology, not from jokes, mascots, or commentary.

## Voice

SPECTER copy is:

- concise
- technical
- declarative
- restrained
- slightly ominous
- completely sincere

Prefer short noun phrases and instrument readouts:

```text
REMOTE ENTITY DETECTED
```

```text
UNIDENTIFIED ETHERNETIC ACTIVITY
```

```text
FIELD LOCK ACQUIRED
```

Avoid conversational or playful copy:

```text
Spooky network detected! 👻
```

```text
Uh-oh, we lost the ghost device!
```

Do not explain the joke. Do not call attention to the fictional terminology. Do not use emojis, puns, exclamation marks, horror clichés, or obvious paranormal references.

## Layer Boundary

SPECTER terminology belongs exclusively to the presentation layer.

Use correct technical terminology in:

- Python and JavaScript identifiers
- API routes and payload fields
- data models
- hardware and network services
- logs and diagnostics
- tests
- configuration and environment variables
- developer documentation and installation instructions

For example, an API field remains `packet_loss_percent`, not `spectral_dissipation`. A Python service remains a Bluetooth scanner, not an entity aura detector.

The UI may present that same value as:

```text
SPECTRAL DISSIPATION
0.00 %
PACKET LOSS
```

This separation keeps the implementation maintainable and the measurements trustworthy.

## Canonical Terminology

Use established terms consistently. Do not create a new synonym when one already exists here.

| Technical term | SPECTER UI |
| --- | --- |
| Ethernet | Ethernetic Field |
| Ethernet interface | Field Interface |
| Ethernet link | Ethernetic Coupling |
| Link established | Field Lock |
| Link speed | Link Resonance |
| Device / host | Entity |
| Local Raspberry Pi | Local Entity / ES-01 |
| Remote Raspberry Pi | Remote Entity / RE-01 |
| Discovery | Entity Scan |
| Device found | Entity Detected / Entity Acquired |
| Device not found | Entity Not Acquired |
| Ping | Echo Probe |
| Ping RTT | Echo Response |
| Packet loss | Spectral Dissipation |
| Throughput | Field Capacity |
| iperf3 | Resonance Test |
| Jitter | Field Instability |
| RSSI | Field Intensity |
| Wi-Fi scan | WLAN Spectrum Sweep |
| BLE scan | BLE Field Sweep |
| BLE device finder | Entity Finder |
| Bluetooth advertisement | BLE Advertisement / Entity Emission |
| Network interface down | Field Interface Offline |
| Connection disconnected | Field Collapse |
| Error | Anomaly |
| Warning | Anomaly Detected |
| Fatal error | Critical Anomaly |
| Test | Analysis |
| Start test | Initiate Analysis |
| Test running | Analysis in Progress |
| Test complete | Analysis Complete |
| Buzzer | Acoustic Transducer |
| Sound / beep | Acoustic Signal / Finder Pulse |
| Muted | Acoustic Output Muted |

Protocol names, interface names, addresses, SSIDs, device names, units, and tool names remain technically accurate wherever they help the operator understand or diagnose a result.

## Measurement Integrity

Pseudoscientific language must never make real measurements less precise.

Use a three-level measurement pattern when space permits:

```text
SPECTER LABEL
REAL VALUE AND UNIT
TECHNICAL MEASUREMENT
```

Good:

```text
LINK RESONANCE
1000BASE-T / FULL DUPLEX
ETHERNET LINK
```

Good:

```text
SPECTRAL DISSIPATION
0.00 %
PACKET LOSS
```

Good:

```text
FIELD CAPACITY
934 Mbps
TCP THROUGHPUT / IPERF3
```

Good:

```text
FIELD INTENSITY
-63 dBm
BLE RSSI
```

Bad:

```text
FIELD STRENGTH
EXCELLENT
```

when the measured result is actually `934 Mbps` or `-63 dBm`.

Qualitative states such as `FAINT`, `STRONG`, `STABLE`, or `CRITICAL` may supplement a measurement. They must not replace a numeric value when one exists.

## Copy Structure

### Headings

Use compact uppercase instrument labels:

```text
ENTITY FINDER
ANOMALY REGISTER
ETHERNETIC ANALYSIS
WLAN SPECTRUM
```

### Actions

Use direct operational verbs:

```text
INITIATE ANALYSIS
START FIELD SWEEP
STOP FIELD SWEEP
ACQUIRE ENTITY
MUTE OUTPUT
```

Avoid chatty actions:

```text
Let's scan!
Try again
Go back
```

Navigation actions must still be unambiguous. Atmosphere does not justify unclear destinations. Prefer `HOME`, `MENU`, or a named destination over an unexplained `RETURN`.

### Status

Use terse state declarations:

```text
FIELD LOCKED
ENTITY ACQUIRED
ANALYSIS IN PROGRESS
ANOMALY DETECTED
FIELD COLLAPSE
```

Do not add punctuation unless it improves a technical value. Status declarations normally have no period and never need an exclamation mark.

### Unknown States

Use `UNKNOWN`, `UNIDENTIFIED`, or `NOT ACQUIRED` only when the underlying state is genuinely unknown.

Good:

```text
UNIDENTIFIED BLE ENTITY
C0:DE:00:00:00:01
-78 dBm
```

Better, when a real advertised name exists:

```text
FIELD TAG
C0:DE:00:00:00:01
-78 dBm
```

Never discard known device names or identifiers merely to sound mysterious.

## Errors and Diagnostics

Atmospheric status and actionable detail should be paired.

Good:

```text
ANOMALY DETECTED
REMOTE ENTITY NOT ACQUIRED
ping: destination host unreachable
```

Good:

```text
FIELD INTERFACE OFFLINE
eth0: no carrier
```

Bad:

```text
THE SPECTRAL VEIL IS CLOSED
```

The bad example hides the actual failure and gives the operator no recovery path.

Raw command failures may be shown in a secondary diagnostic area, but primary UI copy should summarize them without changing their meaning.

## Radio and Proximity Language

Wi-Fi and BLE RSSI are signal measurements, not reliable distance measurements.

- Describe them as field intensity or signal state.
- Always retain the measured dBm value when available.
- Do not claim exact range, direction, or physical distance.
- Avoid explanatory proximity disclaimers in the primary immersive UI; place necessary technical limitations in documentation or diagnostics.
- Finder cadence and animation may suggest warmer/colder behavior, but must remain tied to measured RSSI.

Good:

```text
FIELD INTENSE
-48 dBm
```

Bad:

```text
ENTITY 2.4 METERS AWAY
```

## Capitalization and Formatting

- Primary UI labels and statuses use uppercase.
- Preserve official casing for technical names where appropriate: `iperf3`, `eth0`, `hci0`, `dBm`, `Mbps`.
- Keep values and units together: `934 Mbps`, `-63 dBm`, `0.00 %`.
- Avoid excessive punctuation, ellipses, decorative brackets, and gratuitous abbreviations.
- Prefer one strong SPECTER term over repeated use of `SPECTER`, `SPECTRAL`, or `FIELD` in every label.

## Review Checklist

Before accepting new UI copy, verify:

1. Is the copy short, technical, sincere, and slightly ominous?
2. Does it avoid jokes, emojis, horror clichés, and self-aware language?
3. Does it use the canonical term rather than an invented synonym?
4. Is the SPECTER terminology confined to the presentation layer?
5. Is the real measurement, unit, identifier, or protocol still visible?
6. Is an error still technically accurate and actionable?
7. Does an unknown label reflect genuinely unknown data?
8. Is navigation still immediately understandable?
