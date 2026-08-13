# Input Builder — architecture and known gaps

The Input Builder is a split-screen panel: sections on the left, the assembled
deck on the right, pre-insert checks underneath. It replaced a single wizard that
generated a fixed deck and could not repeat anything.

## Shape of the code

| File | Role |
|---|---|
| `src/inputBuilder/deckModel.ts` | Headless model and code generation. A deck is an ordered list of independent sections (`materials`, `pincell`, `lattice`, `boundary`, `run`, `tally`, `surface`, `cell`, `custom`); any kind can repeat. `IdAllocator` hands out cell / surface / material / universe numbers, so a second lattice cannot reuse the first one's planes. `buildDeckDocument` returns the text plus per-line ownership and per-section line spans. |
| `src/inputBuilder/deckChecks.ts` | `checkDeck(model, doc)` → error / warning / info entries, each optionally carrying a section id and a line number. |
| `src/inputBuilder/materials.ts` | The shared material library. Also used by the older material wizard, so changes here affect both. |
| `src/panels/inputBuilder.ts` | Host: owns generation, checks and everything touching the editor. |
| `src/panels/inputBuilderWebview.ts` | UI: owns the section model and the forms, and no generation logic. |

The webview posts a `DeckModel` on every edit; the host answers with
`{ text, lines, owners, sections, counts, checks, summary }`. Line ownership is
what the right-hand pane highlights from when a section is selected, and what a
check row scrolls to. Errors block insertion behind a modal "Insert anyway";
warnings and infos do not block.

Webview exceptions post `clientError` so the host can surface them — without it a
thrown render simply stops the panel updating, with nothing in any log.

## Coverage

- `src/test/suite/deckModel.test.ts` — model, id allocation, per-code assembly,
  material binding, SCONE structure, and the checks.
- `src/test/suite/inputBuilderWebview.test.ts` — boots the real webview in the
  test instance and drives the handshake, the document round trip and
  `focusSection`, asserting no `clientError` arrives. This is what catches a typo
  in the injected script, which is otherwise invisible until a user opens it.

## Known gaps

- Some library entries (`ss316`, `carbon-steel`, `graphite`, `inconel-718`,
  `borated-poly`, `sodium`, `heavy-water`, `flibe`, `mox-5pct`) still fall
  through to the placeholder branch: a U-238-only card with a comment. Each needs
  a real composition, not a plausible one.
- SCONE emits an empty `cells { }` block when no cell section exists. It parses,
  but it has not been run against SCONE itself.
- MCNP pin cells emit their own bounding planes even inside a lattice that
  already defines the unit cell. Valid but redundant.
