# Publishing to VS Code Marketplace

Step-by-step guide to publish this extension with GitHub Actions CI/CD.

## Prerequisites

- A [GitHub repository](https://github.com) for this project
- An [Azure DevOps](https://dev.azure.com) account (free, required for VS Code Marketplace)
- Node.js >= 18

## Step 1: Create a Publisher

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your Microsoft/Azure account.
3. Click **Create publisher**.
4. Choose a publisher ID (e.g. `your-username`). This goes in `package.json` under `"publisher"`.
5. Fill in display name and other details.

## Step 2: Generate a Personal Access Token (PAT)

1. Go to https://dev.azure.com
2. Click your profile icon (top right) > **Personal Access Tokens**.
3. Click **New Token**.
4. Set:
   - **Name**: `vsce-publish`
   - **Organization**: `All accessible organizations`
   - **Scopes**: Click **Show all scopes**, then check **Marketplace > Manage**
   - **Expiration**: choose a reasonable period (e.g. 1 year)
5. Click **Create** and copy the token immediately (you won't see it again).

## Step 3: Update package.json

```json
{
  "publisher": "your-publisher-id",
  "version": "0.1.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/namanbarkiya/code-bridge"
  },
  "icon": "icon.png"
}
```

- Set `publisher` to the ID from Step 1.
- Add `repository` URL.
- Add a 128x128 or 256x256 `icon.png` in the project root.

## Step 4: Test packaging locally

```bash
npm install
npm run build
npx @vscode/vsce package
```

This produces a `.vsix` file. Verify it installs correctly:

```bash
# In Cursor or VS Code
code --install-extension code-bridge-0.1.0.vsix
```

## Step 5: Test publishing manually (optional)

```bash
npx @vscode/vsce publish --pat YOUR_PAT_TOKEN
```

Or publish a specific version:

```bash
npx @vscode/vsce publish 0.1.0 --pat YOUR_PAT_TOKEN
```

## Step 6: Add GitHub Secrets

In your GitHub repository, go to **Settings > Secrets and variables > Actions** and add:

| Secret name | Value |
|-------------|-------|
| `VSCE_PAT` | Your Azure DevOps Personal Access Token from Step 2 |

## Step 7: Add GitHub Actions workflow

Create `.github/workflows/release.yml`:

```yaml
name: Build, Test & Publish

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  release:
    types: [published]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run typecheck
      - run: npm run build

      - name: Package VSIX
        run: npx @vscode/vsce package --no-dependencies
        # --no-dependencies because grammy is bundled by esbuild

      - name: Upload VSIX artifact
        uses: actions/upload-artifact@v4
        with:
          name: vsix
          path: "*.vsix"

  publish:
    needs: build
    if: github.event_name == 'release'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build

      - name: Publish to VS Code Marketplace
        run: npx @vscode/vsce publish --no-dependencies --pat ${{ secrets.VSCE_PAT }}

      - name: Package VSIX for release asset
        run: npx @vscode/vsce package --no-dependencies

      - name: Attach VSIX to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: "*.vsix"
```

## Step 8: Release workflow

### For every push/PR to main

The `build` job runs: install, typecheck, build, and package. This catches build errors early. The `.vsix` is uploaded as a GitHub Actions artifact for manual testing.

### To publish a new version

1. Bump the version in `package.json`:

```bash
# Patch: 0.1.0 -> 0.1.1
npm version patch

# Minor: 0.1.0 -> 0.2.0
npm version minor

# Major: 0.1.0 -> 1.0.0
npm version major
```

2. Push the commit and tag:

```bash
git push && git push --tags
```

3. Go to GitHub > **Releases** > **Draft a new release**.
4. Choose the tag you just pushed (e.g. `v0.2.0`).
5. Write release notes.
6. Click **Publish release**.

The `publish` job triggers automatically:
- Publishes to VS Code Marketplace
- Attaches the `.vsix` to the GitHub Release

## Step 9: Verify

1. Check https://marketplace.visualstudio.com/items?itemName=your-publisher-id.code-bridge
2. In Cursor/VS Code, search for "Code Bridge" in the Extensions panel.
3. Verify the latest version appears.

## Publishing to Open VSX (optional)

If you also want to publish to [Open VSX Registry](https://open-vsx.org) (used by VSCodium, Gitpod, etc.):

1. Create an account at https://open-vsx.org
2. Generate a token from your profile settings.
3. Add `OVSX_PAT` as a GitHub secret.
4. Add this step to the `publish` job:

```yaml
      - name: Publish to Open VSX
        run: npx ovsx publish --pat ${{ secrets.OVSX_PAT }}
```

## Checklist before first publish

- [ ] `publisher` in `package.json` is set to your real publisher ID
- [ ] `version` is set to `0.1.0` or higher
- [ ] `repository` URL is added to `package.json`
- [ ] `icon.png` exists in project root (128x128 or 256x256)
- [ ] `README.md` is up to date
- [ ] `LICENSE` file exists
- [ ] `.vscodeignore` excludes source files, dev configs, and `.code-bridge/`
- [ ] Local `npx @vscode/vsce package` succeeds without warnings
- [ ] `VSCE_PAT` secret is set in GitHub repo settings
- [ ] Extension installs and works from the `.vsix` file
- [ ] No secrets (tokens, keys) are committed to the repo

## Version strategy

Use [Semantic Versioning](https://semver.org):

- **Patch** (`0.1.1`): bug fixes, minor improvements
- **Minor** (`0.2.0`): new features (e.g. new Telegram commands), backward-compatible
- **Major** (`1.0.0`): breaking changes to settings or behavior

## Troubleshooting

**"ERROR: Access Denied"** when publishing
- Your PAT may have expired or lack the **Marketplace > Manage** scope. Generate a new one.

**"ERROR: Publisher not found"**
- Make sure `publisher` in `package.json` matches your Marketplace publisher ID exactly.

**"WARNING: Missing repository"**
- Add `"repository"` field to `package.json`.

**VSIX too large**
- Check `.vscodeignore` is excluding `node_modules/`, `src/`, `.code-bridge/`, etc. The esbuild bundle in `out/` should be the only runtime code.
