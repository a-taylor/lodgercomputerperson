# Credits

## Graphics

**Graphics created by Penzilla Design.**
House interior pack: [Platformer House Interior (Pixel Art)](https://penzilla.itch.io/house-interior), used under the Penzilla Design Standard Licence (`assets/penzilla/PenzillaDesign_StandardLicense.pdf`).

Tenant: [Free Protagonist (Animated Character)](https://penzilla.itch.io/protagonist-character), also by Penzilla Design, same licence (`assets/penzilla-protagonist/`).

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

### Sound

All sound is original and synthesised in code with Web Audio (`src/audio/`): no sample files. The two record tunes are original.

## Licence obligations to remember

- Keep the credit line above visible wherever the game credits people.
- If any Penzilla image is modified, list the change under "Edits" above.
- Don't redistribute the raw pack files (the repo must stay private while they're in it).
- If the game is ever made publicly available, send a link to PenzillaDesign@gmail.com.
- Don't use the pack's images to make AI or machine-learning datasets or models.
