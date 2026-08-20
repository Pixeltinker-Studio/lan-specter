# SPECTER Visual Design Direction

User-facing terminology, tone, measurement labels, and error copy are defined in `docs/design/specter-language-design.md`. Visual and language direction must be applied together.

## Target Hardware

- Display: Waveshare 7-inch HDMI LCD
- Native resolution: **1024 x 600 pixels**
- Orientation: landscape
- Primary input: capacitive touch
- UI acceptance checks must use the native 1024 x 600 viewport. Smaller resolutions are optional compatibility checks, not the project baseline.

## Design Intent

SPECTER should look like a portable scientific field instrument from a slightly alternative 1987.

Reference feel:

- laboratory equipment
- field measurement hardware
- early digital instrumentation
- paranormal research presented with total seriousness

Avoid:

- SaaS dashboard language
- cyberpunk or matrix-terminal styling
- gaming HUD composition
- smartphone-app patterns
- obvious Ghostbusters references

The device is not joking. The humor comes from rigorous presentation of absurd pseudoscientific terminology.

## Core Identity

Primary mark:

```text
SPECTER
```

Device line:

```text
ES-01
PORTABLE ETHERNETIC SPECTROMETER
```

Long form, used only for boot screens, labels, and typeplates:

```text
SPECTRAL PACKET &
ETHERNETIC COMMUNICATION
TEST AND EVALUATION RIG
```

Remote unit:

```text
RE-01 — REMOTE ENTITY
```

## Visual Language

Use a restrained instrument palette:

- near-black greenish background
- desaturated phosphor green for stable states
- amber for warnings and transitional states
- muted cyan for technical secondary readouts
- oxidized red for critical conditions
- warm off-white for primary numeric values

Avoid dominant purple, blue gradients, neon cyberpunk, or decorative glitch effects.

## Typography

Preferred character:

- monospaced or technical grotesk
- squared, utilitarian, legible
- no stylized horror typography
- no exaggerated sci-fi display font as the main UI font

Hierarchy:

- primary measurement: very large
- measurement label: compact uppercase
- technical explanation: small secondary text
- decorative typeplate text: small and sparse

## Logo Direction

The SPECTER wordmark should feel printed or engraved on equipment, not like an app logo.

Possible treatments:

- heavy monospace wordmark
- inline separator: `SPECTER // ES-01`
- typeplate lockup with model, calibration reference, and unit class
- simple geometric field-marker icon, not a ghost icon

Potential symbol language:

- aperture/sensor bracket
- Ethernet jack abstraction
- oscilloscope trace
- measurement reticle
- divided spectral field mark

Avoid literal ghosts, slime, proton streams, skulls, or haunted-house symbolism.

## Status Symbols

Use simple instrument signs, not playful icons:

- `●` stable indicator
- `△` anomaly indicator
- `×` critical indicator
- bracketed channel marks such as `[CH-A]`
- reticle or scan-line marks for entity acquisition

Status vocabulary:

- `STABLE`
- `ANOMALY`
- `CRITICAL`
- `UNKNOWN PHENOMENON`

## Instrument Panels

Panel rules:

- 4 px or smaller radius
- hard borders
- clear internal alignment
- no nested decorative cards
- no glossy app widgets
- touch targets at least 56 px tall

Good panel labels:

```text
FIELD ANALYSIS SECTION
CH-A / ETH0
CAL REF 01
ANOMALY REGISTER
REMOTE ENTITY REGISTER
```

## Measurement Display Pattern

Keep pseudoscience and real measurements paired:

```text
FIELD CAPACITY
938 Mbps
TCP THROUGHPUT
```

```text
SPECTRAL DISSIPATION
0.00 %
PACKET LOSS
```

Never replace real values with vague ratings such as `EXCELLENT` where numeric data exists.

## Boot Screen Direction

Boot is the most theatrical state, but it must stay short.

Target duration:

- 2-4 seconds if diagnostics are ready
- no artificial long delay

Boot elements:

- wordmark
- model
- typeplate text
- sequential subsystem readiness list
- subtle calibration or scan-line motion

Example:

```text
SPECTER ES-01
PORTABLE ETHERNETIC SPECTROMETER

SYSTEM INITIALIZATION
ETHERNETIC INTERFACE ........ READY
DIAGNOSTIC CORE ............. READY
SPECTRAL PROCESSOR .......... READY
FIELD SENSOR ARRAY .......... READY
LOCAL ENTITY ................ ES-01
```

## Screen States

The UI should behave like a state machine:

```text
BOOT
IDLE
LINK_ACQUISITION
ENTITY_SCAN
READY
ANALYSIS
RESULT
NO_LINK
NO_DHCP
ENTITY_NOT_FOUND
ANOMALY
CRITICAL
SYSTEM_ERROR
```

## Housing Direction

Industrial design should feel like a small rugged lab instrument:

- compact slab body
- slightly raised screen bezel
- visible model/typeplate zone
- front-panel legends
- recessed Ethernet port area
- physical carry/bench feel rather than handheld phone feel
- color candidates: charcoal shell, muted olive/gray accents, off-white legends

Potential physical labels:

```text
SPECTER ES-01
PORTABLE ETHERNETIC SPECTROMETER
FIELD INTERFACE / ETH0
REMOTE ENTITY ACQUISITION
CAL REF 01
```

Avoid prop-comedy styling. It should look plausible enough that someone might believe it is real test equipment.
