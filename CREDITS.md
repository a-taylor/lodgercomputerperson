# Credits

## Graphics

**Graphics created by Penzilla Design.**
House interior pack: [Platformer House Interior (Pixel Art)](https://penzilla.itch.io/house-interior), used under the Penzilla Design Standard Licence (`assets/penzilla/PenzillaDesign_StandardLicense.pdf`).

Tenant: **based on graphics by Penzilla Design**, [Free Protagonist (Animated Character)](https://penzilla.itch.io/protagonist-character), same licence (`assets/penzilla-protagonist/`).

All three art packs were bought on itch.io. The Penzilla files are not in this repository, because their licence doesn't allow sharing them; see `docs/art.md`.

### Edits to the Penzilla assets

The licence asks for any edits to be listed in full.

- House interior pack: none. The PNG files are used unchanged and drawn as they are, arranged into rooms.
- Free Protagonist: the PNG file is unchanged, but on screen each frame is changed as it's drawn:
  - coloured by region (the sheet is plain white): his head in his skin tone (softened slightly), the three rows below his chin in his shirt colour, the rest in his trouser colour; lying down, the same split runs sideways;
  - his face tinted green while he's sick, and his shirt shown as skin in the bath;
  - mirrored horizontally when he faces left (and when he lies with his head to the left).
  The last frame of the "die" animation is used as his sleeping pose in bed.

## The dog

**Dog sprites by NVPH Studio:** [Dog Animation - 4 Different Dogs](https://nvph-studio.itch.io/dog-animation-4-different-dogs), licensed under [CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/) (`assets/nvph/license.txt`).

Changes: none to the artwork. The sprite sheets are used exactly as supplied; when the dog walks left, the game shows the same frame mirrored on screen. Because the licence is "NoDerivatives", don't recolour, redraw or outline these sprites, and don't distribute an edited version.

### Original artwork

Everything else is original to this project:

- Extra furniture the pack doesn't include (piano, fireplace, telephone table, dog bowl, record player, typewriter desk, computer desk, grandfather clock, games cabinet, wardrobe, exercise rug). These are drawn in code in `src/render/drawnSprites.ts`, using the pack's colour palette so they sit alongside it. They are not derived from the pack's image files.
- The control icons (food, phone, gear and so on), drawn in code in `src/ui/icons.ts`.

### Sound

All sound is original and synthesised in code with Web Audio (`src/audio/`): no sample files. The two record tunes are original.

### Font

[Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), copyright 2021 The Pixelify Sans Project Authors, under the [SIL Open Font License 1.1](https://openfontlicense.org). Bundled from the `@fontsource/pixelify-sans` package.

## Licence obligations to remember

- Keep the credit line above visible wherever the game credits people.
- If any Penzilla image is modified, list the change under "Edits" above.
- Don't redistribute the Penzilla pack files: they are kept out of the public repo (gitignored, pulled from a private repo at build time). Serving them as part of the deployed game is allowed.
- Once the game is publicly available, send a link to PenzillaDesign@gmail.com. Done 2026-10-18 (both packs, live Pages link). Send again if the URL changes.
- The dog sprites are CC BY-ND, so they can stay in the public repo unchanged. NVPH Studio has said edits for use in your own game are fine as long as the edited files aren't shared on their own; list any edits under "Changes" above.
- Don't use the pack's images to make AI or machine-learning datasets or models.
