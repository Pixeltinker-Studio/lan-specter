# Project Constraints

## Required Design References

- Read `docs/design/specter-visual-design.md` before changing layout, styling, interaction patterns, navigation, or visual assets.
- Read `docs/design/specter-language-design.md` before adding or changing any user-facing copy.
- Treat both documents as product constraints, not optional inspiration.

## Target Display

- The primary SPECTER display is a Waveshare 7-inch HDMI LCD.
- Its native and required UI test resolution is **1024 x 600 pixels in landscape orientation**.
- Validate all web UI layout changes at 1024 x 600 before considering them complete.
- Smaller viewport tests may be used as additional compatibility checks, but they must not replace the 1024 x 600 acceptance test.
- The primary interaction method is capacitive touch, so controls and scroll areas must remain touch-friendly.

## SPECTER UI

- The UI represents a serious portable field instrument from a slightly alternative 1987. It must not resemble a SaaS dashboard, gaming HUD, smartphone app, or overt comedy prop.
- Preserve the restrained instrument palette, hard panel geometry, technical typography, and minimum 56 px touch targets defined in the visual design document.
- Keep navigation destinations and return behavior explicit. Avoid duplicate menu controls and ambiguous labels such as `RETURN` without a clear destination.
- Keep frequently changing hardware work asynchronous. Scans, radio operations, and analysis requests must not block touch input or make the interface appear frozen.
- Render stable lists with stable identity and ordering. Live measurements may update without making rows jump or resetting unrelated animations and scroll positions.
- Validate every completed UI change at the native 1024 x 600 viewport, including overflow, scrolling, touch target size, transitions, and error states.

## SPECTER Presentation Language

- User-facing UI copy is concise, technical, serious, and slightly ominous. The device never explains the joke.
- Do not use emojis, playful ghost language, punchlines, exclamation marks, or self-aware comedy.
- Use SPECTER terminology only in the presentation layer. Internals, APIs, data models, logs, protocol handling, tests, and code identifiers must retain correct technical terminology.
- Never let pseudoscientific terminology obscure the underlying measurement. Pair the SPECTER label with the real numeric value, unit, protocol, or technical explanation.
- Preserve actionable technical errors. A SPECTER status may introduce an error, but it must not replace the information needed to diagnose it.
- Follow the canonical vocabulary and copy patterns in `docs/design/specter-language-design.md`. Do not invent synonyms when an established term already exists.
