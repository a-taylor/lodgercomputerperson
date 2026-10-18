# Art files

The house and the tenant use two paid packs by Penzilla Design. Their licence doesn't allow redistributing the files, so they are **not in this repository**:

- `assets/penzilla/`: [Platformer House Interior (Pixel Art)](https://penzilla.itch.io/house-interior)
- `assets/penzilla-protagonist/`: [Free Protagonist (Animated Character)](https://penzilla.itch.io/protagonist-character)

Both folders are gitignored. Without them, `npm run dev` and `npm run build` stop with "Penzilla art missing".

## Getting the files

- **The owner:** clone the private `a-taylor/lodgercomputerperson-art` repo and copy its two folders into `assets/`. CI does the same using a read-only deploy key (see `docs/deploy.md`).
- **Anyone else:** buy both packs on itch.io (the licence only covers paid copies), then unzip them so the files sit at `assets/penzilla/{House,Furniture}/*.png` and `assets/penzilla-protagonist/AnimationSheet.png`.

The dog sprites (`assets/nvph/`, NVPH Studio, CC BY-ND 4.0) can be shared unchanged, so they stay in the repo. See CREDITS.md for all credits and the edits made on screen.
