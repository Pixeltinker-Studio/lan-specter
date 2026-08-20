# Project Constraints

## Target Display

- The primary SPECTER display is a Waveshare 7-inch HDMI LCD.
- Its native and required UI test resolution is **1024 x 600 pixels in landscape orientation**.
- Validate all web UI layout changes at 1024 x 600 before considering them complete.
- Smaller viewport tests may be used as additional compatibility checks, but they must not replace the 1024 x 600 acceptance test.
- The primary interaction method is capacitive touch, so controls and scroll areas must remain touch-friendly.
