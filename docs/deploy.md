# Deploying

The game is a static Vite build on GitHub Pages: <https://a-taylor.github.io/lodgercomputerperson/>. The Worker (phase 11) will be added here.

## Art repo and deploy key (once)

The Penzilla art lives in the private repo `a-taylor/lodgercomputerperson-art` (see `docs/art.md`). CI reads it with a read-only deploy key:

1. `ssh-keygen -t ed25519 -N "" -C lcp-art-ci -f lcp-art-key`
2. In the art repo: Settings → Deploy keys → Add, paste `lcp-art-key.pub`, leave "Allow write access" off.
3. In the game repo: Settings → Secrets and variables → Actions → New repository secret `ART_DEPLOY_KEY`, paste the contents of `lcp-art-key`.
4. Delete both local key files.

## Pages (once)

In the game repo: Settings → Pages → Source: **GitHub Actions**.

## Workflows

- `ci.yml`: on every push and pull request: typecheck, unit tests, build. The Playwright smoke test runs locally (`npm run test:e2e`).
- `deploy-pages.yml`: on push to main (or by hand): builds with `VITE_BASE=/lodgercomputerperson/` and publishes `dist/` to Pages.

For a custom domain later, change `VITE_BASE` to `/`.
