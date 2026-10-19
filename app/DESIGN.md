# onusmu design reference

How the app looks and why, so new screens match the existing ones. Every value here lives in code; when the two disagree, the code wins and this file should be updated.

## The look in one paragraph

Dark glass. A near-black backdrop with two faint cool-grey glows, and translucent white panels with a thin light edge sitting on top of it. No colour except red for the microphone and red, green and amber for status. The launch and sign-in screens are the exception: the emblem's very dark green, with the chrome emblem small and unframed. System font, Feather line icons, fully rounded pills for anything you tap or type in. The interface is in Greek.

## Rules

1. **Dark only.** `useTheme()` always returns the dark theme, whatever the phone is set to. The light theme still exists in the theme file but is unused.
2. **Colour is for meaning.** Red means the microphone is live or something is destructive. Green and amber are sync and status. Everything else is white, grey or glass. The brand green (`brand` in the theme) is only for the launch and sign-in screens.
3. **Panels are glass.** Use `theme.glass` for any card, group, input or bubble. Do not hand-pick a background colour.
4. **Never hard-code spacing, radius or colour.** Take them from `src/theme/index.ts`.
5. **Greek copy, informal singular** ("Πάτα", "Δοκίμασε ξανά"). No dashes or bullet characters as decoration.
6. **Times and counters use tabular numbers** so digits do not jump as they change.

## Where things live

| What | File |
| --- | --- |
| Colours, spacing, radius, type, tab bar size | `src/theme/index.ts` |
| Backdrop (glass or brand green), safe areas, side margins, tab bar clearance | `src/components/Screen.tsx` |
| Floating animated tab bar | `src/components/GlassTabBar.tsx` |
| Icons, round icon button, chrome emblem (`Logo`) | `src/components/Icon.tsx` |
| Launch screen (emblem fade, then dissolve) | `src/components/LaunchScreen.tsx` |
| What a recording was understood as, with undo | `src/components/InsightList.tsx` |
| Large screen title with optional buttons | `src/components/Header.tsx` |
| Grouped rows (settings style) | `src/components/List.tsx` |
| Buttons | `src/components/Button.tsx` |
| Glass card | `src/components/Card.tsx` |
| Empty and error states | `src/components/EmptyState.tsx` |
| Source time tags under chat answers | `src/components/CitationChips.tsx` |
| Waiting dots in chat | `src/components/TypingDots.tsx` |
| Pulsing red dot | `src/components/RecordingDot.tsx` |
| Chunk status (pending, processing, failed) | `src/components/ChunkStatusBadge.tsx` |
| Dates, durations, greeting (Greek) | `src/lib/time.ts` |

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#07080A` | Base colour behind the backdrop |
| `surface` | white at 7% | Glass panel fill |
| `surfaceMuted` | white at 14% | Pressed rows, chat question bubble, tab bar pill, switch track |
| `border` | white at 14% | Glass edge, dividers, outlined buttons |
| `text` | `#F5F6FA` | Main text and icons |
| `textMuted` | cool white at 68% | Secondary text |
| `textFaint` | cool white at 42% | Placeholders, timestamps, inactive tab icons |
| `primary` / `onPrimary` | `#FFFFFF` / `#0A0B12` | Main button, send button, mic button when idle |
| `recording` | `#FF5A52` | Microphone live: mic button, stop button, pulsing dot |
| `danger` / `dangerSurface` | `#FF7B72` / red at 16% | Destructive actions and errors |
| `success` | `#3DD68C` | Synced, switch on |
| `warning` | `#F2B544` | Uploading, processing |

`theme.glass` is the `surface` fill plus a 1pt `border` edge.

Brand green, for the launch and sign-in screens only:

| Token | Value | Use |
| --- | --- | --- |
| `brand.green` | `#011A1A` | Launch screen and native splash (`app.json` splash `backgroundColor` must match) |
| `brand.greenTop` / `brand.greenBottom` | `#022322` / `#060A0A` | Sign-in gradient, ending near the glass screens' black |
| `brand.glow` | `150,225,210` | Faint mint light behind the emblem |

## Backdrop

Built in `Screen.tsx`, bottom to top:

1. Diagonal gradient `#0C0D11` to `#07080A` to `#0A0B0E`.
2. Top-right glow: 560pt, `rgb(150,168,205)`, strength 0.26.
3. Bottom-left glow: 540pt, `rgb(120,128,150)`, strength 0.16.
4. Dark blur layer at intensity 90.

Each glow is 36 stacked translucent discs. That many layers is what keeps rings from showing on Android, where the blur layer does very little. Fewer layers brings the rings back.

To make the backdrop more or less colourful, change the `rgb` and `strength` on the two `Glow` lines.

## Spacing and shape

| Token | Value |
| --- | --- |
| Screen side margin (`SCREEN_GUTTER`) | 20 |
| `spacing` xs / sm / md / lg / xl / xxl | 4 / 8 / 16 / 24 / 32 / 48 |
| `radius` sm / md / lg / pill | 10 / 16 / 24 / 999 |

- Inputs, buttons, filter pills and the tab bar use `radius.pill`.
- List groups, cards and suggestion rows use `radius.md`.
- The Home recorder card uses `radius.lg`.
- Standard input and button height is 52 to 56. Round icon buttons are 40. Send buttons are 38.

## Type

System font only. Hierarchy comes from size and weight.

| Style | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `display` | 30 / 36 | 700 | Home greeting |
| `title` | 28 / 34 | 700 | Screen titles |
| `heading` | 17 / 22 | 600 | Section titles, row emphasis |
| `body` | 16 / 24 | 400 | Running text, row titles |
| `label` | 15 / 20 | 500 | Buttons, small emphasis |
| `caption` | 13 / 18 | 400 | Secondary lines, section labels |

Chat messages use 16 / 25 for easier reading.

## Icons

Feather, through `Icon` from `src/components/Icon.tsx`. Sizes: 22 in rows and tabs, 20 in buttons and inputs, 12 to 16 for inline hints.

Feather has no filled versions, so selection is never shown by a filled icon. Other packs such as Lucide or Phosphor need `react-native-svg` and a new dev build.

## Tab bar

A floating glass pill, 66pt tall, 16pt from the sides, at least 12pt above the bottom edge.

- A lighter pill springs to the selected tab (damping 16, stiffness 210).
- The selected icon lifts 8pt and grows to 1.1x while its label fades in underneath (damping 13, stiffness 230).
- Unselected tabs show the icon only.
- It hides while the Android keyboard is open.

`Screen` reserves room for the bar automatically on tab screens, so content never sits under it.

## Screen patterns

- **Every tab** starts with `Header` (large title, optional icon buttons on the right) inside `Screen`.
- **Home:** date and greeting, a centred glass card with the large mic button, the ask pill, then recent sessions as a list group.
- **Recording:** large timer, glass stats block, solid red stop button. Opens as a sheet over the tabs.
- **Timeline:** pill date switcher (left arrow goes back a day, right arrow stops at today), a scrolling row of filter pills, then sessions with timestamped transcript paragraphs.
- **Search:** pill search field, results as glass cards with the text first and the time underneath.
- **Chat:** questions in soft grey bubbles on the right, answers as plain text, source times as small tags (three shown, the rest behind "+N"), three dots while waiting.
- **Settings:** list groups with a small caption above each. Destructive rows are red and sit last.
- **Launch:** plain brand green, a 76pt chrome emblem fading and scaling in with a faint glow, then the whole layer dissolving into the first screen. The native splash is the same green with no image, so nothing large flashes.
- **Login:** brand green backdrop, small emblem and "onusmu" at the top, a sliding Σύνδεση / Εγγραφή switch, Google first, then labelled fields with a focus edge and inline errors. "Ξέχασες τον κωδικό;" opens its own reset view with a back button. Errors and notices are banners with an icon.
- **Home additions:** the mic button also works as hold to talk (release saves). After recordings are processed, a card "Κατάλαβα από τις καταγραφές σου" lists what was understood, each line with "Αναίρεση", and "OK" clears it.
- **Search additions:** exact matches first with the matched words in bold, then "Σχετικά" results found by meaning, which load a moment later under their own caption.
- **Chat additions:** while waiting, the typing dots carry a status line ("Ψάχνω στις καταγραφές σου…"); the answer then appears as it is written. Up to three follow-up questions sit under the latest answer as glass pills.
- **Names (Ονόματα):** a sheet from Settings listing people, businesses, places and things by group, with how often each was heard and its misheard spellings; tap to edit inline.

## Wording

| English | Greek used in the app |
| --- | --- |
| session | καταγραφή |
| chunk | τμήμα |
| memory | μνήμη |
| timeline | χρονολόγιο |
| chat | συνομιλία |
| task | εκκρεμότητα |
| reminder | υπενθύμιση |
| names list | ονόματα |
| morning briefing | πρωινή ενημέρωση |

Dates use the `el-GR` locale. Durations read "45 δευτ.", "12 λεπ.", "1 ώρ. 5 λεπ.". "onusmu" is the product name, always lower case.

## Known limits

- Real backdrop blur is iOS only. On Android the glass is translucent, not frosted.
- The keyboard and system alerts only turn dark after the next dev build (`userInterfaceStyle` is `dark` in `app.json`).
- Messages that come from the server, and the language of chat answers, are not translated by the app.
