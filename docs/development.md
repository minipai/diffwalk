# Development

Use Bun and the pnpm version pinned in [package.json](../package.json).
The [CI workflow](../.github/workflows/ci.yml) records the tool versions used for checks.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

`pnpm check` runs type checks, unit tests, and visual regression tests. Pull requests
targeting `main` run the same check in CI. Install the visual-test dependencies
below before running the full check for the first time.

## Local report preview

```bash
pnpm dev:report
```

Open `http://localhost:4399/`. The server binds to `0.0.0.0`, so another device
on the same network can use the development machine's LAN address. To use another
port, run `PORT=4400 pnpm dev:report`. Stop with Ctrl+C.

Edit [fixtures/report-preview.json](../fixtures/report-preview.json) for sample
content. The preview uses the real [report renderer](../src/report/render.ts) and
[browser client](../src/report/client.ts). Source and sample edits are watched;
refresh the browser to see changes, including rebuilt browser-client code.
The preview does not publish or change saved walks.

## Visual regression tests

The report's presentation is covered by pixel snapshots rather than assertions
about CSS class names or stylesheet text. The suite renders the report in Chromium
at desktop, tablet, narrow, and phone widths, plus a print layout.

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:visual
pnpm test:visual:update
```

Install `fonts-dejavu-core` on Debian/Ubuntu for the `DejaVu Sans` font used by the
suite. CI installs both the browser dependencies and this font package.

Snapshots live in [test/visual/__screenshots__](../test/visual/__screenshots__),
one directory per breakpoint. Fixed fixtures, fonts, viewports, and device scale
keep comparisons consistent; see [playwright.config.ts](../playwright.config.ts).

Use `pnpm test:visual:update` only after an intentional visual change. Open every
changed PNG, confirm it shows the intended appearance, and commit the images with
the code. Failed comparisons produce actual and diff images in `test-results/`.

## Review service

The service uses a Cloudflare Worker, a private R2 bucket, and shared static assets.
[wrangler.jsonc](../wrangler.jsonc) configures the Worker, assets, and R2 binding.

[infra/setup.sh](../infra/setup.sh) provisions the bucket and configures zone-level
settings, including disabling public R2 access, WAF rules, and rate limits. It
requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` in the environment.

```bash
./infra/setup.sh
```

For routine application deployments, build and deploy the Worker and report assets:

```bash
pnpm deploy
```

Infrastructure setup is separate from routine application deployment.
