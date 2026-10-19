# Lights On website

This directory is the complete static site: HTML, CSS and a local SVG. It has
no build step, JavaScript, external fonts, analytics or runtime dependencies.
Links to the full documentation point to the source repository on GitHub.
All site assets and home links are relative, so it works at a repository
subpath such as `https://scovetta.github.io/lights-on/` or at a domain root.

## Preview locally

Open `index.html` in a browser, or serve the site with Python 3:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory web
```

From the repository root, this serves `http://127.0.0.1:8000/`.
To check a subpath, omit `--directory web` and visit
`http://127.0.0.1:8000/web/`. Stop the preview with Ctrl+C.

## Deploy with GitHub Pages

The workflow in [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
uploads **only `web/`**, then deploys it using GitHub's Pages actions.
It runs only on manual dispatch, on the repository's default branch.
Adding these files or pushing a commit does not publish a website.

When you are ready to publish:

1. Review and commit the site, workflow and tests to your default branch.
2. Open **Settings > Pages > Build and deployment** and select **GitHub Actions**
   as the source. Repository/organization policy must permit Pages deployments.
3. Check the `github-pages` environment's deployment rules. Permit the default
   branch; add required reviewers if you want approval before each deployment.
4. Open **Actions > Deploy website to GitHub Pages > Run workflow**, select the
   default branch and run it.
5. Use the deployment URL shown by the `deploy` job. For this repository the
   usual URL is `https://scovetta.github.io/lights-on/`, unless you configure a
   custom domain. That address is an expected destination, not a claim that
   the site is already deployed.

Repeat the manual dispatch after future site updates. Runs from other branches
are skipped. The workflow does not enable Pages, change repository settings,
or configure a custom domain for you.

The validation/upload job has only `contents: read`. The deployment job has
only `pages: write` and `id-token: write`, with the `github-pages` environment.
Workflow-level permissions are empty, action references are commit-pinned and
checkout credentials are not persisted. No provider or registry secrets are
needed. The maintenance installers do not copy this website or its workflow
into adopting repositories.

## Checks and editing

From the repository root, with Node.js 24 or later:

```powershell
node --test tests\web.test.mjs
```

These dependency-free tests check local navigation and assets at both `/` and
`/lights-on/`, documentation paths and heading anchors against the local
checkout, basic semantic structure, and the manual-only deployment contract.
The existing `node --test` CI job includes them automatically.

For presentation changes, also inspect 320px mobile, tablet and desktop
viewports, keyboard navigation, code-block scrolling, 200% text zoom and
reduced-motion preferences in a browser. Static tests do not replace a visual
or assistive-technology review.

Keep asset references relative (`./assets/site.css`, not `/assets/site.css`).
There is no router or generated base URL to configure. Edit `index.html` for
copy and `assets/site.css` for presentation. Keep claims and examples aligned
with the repository guides; rollout recommendations are not necessarily the
shipped configuration defaults. If publishing a fork, update the GitHub source
and documentation links intentionally.
