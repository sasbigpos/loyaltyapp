# LOYALCORE — GitHub Hosting Setup Guide

Follow these steps to host both apps on GitHub Pages in under 10 minutes.

---

## Step 1 — Create the GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it exactly: **`loyalcore`**
3. Set visibility to **Public** (required for free GitHub Pages)
4. Leave "Add README" unchecked (we have our own)
5. Click **Create repository**

---

## Step 2 — Upload the Code

### Option A — GitHub Web UI (no Git required)

1. Download/unzip all these files to a folder on your computer
2. On your new repo page, click **"uploading an existing file"**
3. Drag the entire `loyalcore/` folder contents into the upload area
4. Commit message: `Initial commit`
5. Click **Commit changes**

### Option B — Git CLI

```bash
# Clone your new empty repo
git clone https://github.com/YOUR_USERNAME/loyalcore.git
cd loyalcore

# Copy all these files into it, then:
git add .
git commit -m "Initial commit"
git push origin main
```

---

## Step 3 — Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages** (left sidebar)
2. Under **Source**, select **GitHub Actions**
3. That's it — no branch to select

---

## Step 4 — Trigger the Deployment

The workflow runs automatically on every push to `main`.

To trigger it manually:
1. Go to **Actions** tab in your repo
2. Click **"Deploy to GitHub Pages"** workflow
3. Click **"Run workflow"** → **"Run workflow"**

Wait ~2 minutes for the build to complete.

---

## Step 5 — Access Your Apps

Once deployed, your apps are live at:

| App | URL |
|-----|-----|
| 🏠 Landing | `https://YOUR_USERNAME.github.io/loyalcore/` |
| ⚙️ Admin Portal | `https://YOUR_USERNAME.github.io/loyalcore/admin/` |
| 🥇 Member Portal | `https://YOUR_USERNAME.github.io/loyalcore/member/` |

Replace `YOUR_USERNAME` with your actual GitHub username.

---

## Step 6 — Verify Live Sync

> **Important:** On GitHub Pages (and any static host), `window.storage` falls back to `localStorage` (see the shim in `src/main.jsx`). This means sync works **within the same browser** only.

To test live sync locally:
1. Open Admin at `http://localhost:5173`
2. Open Member at `http://localhost:5174`
3. Award points in Admin → refresh Member tab → see updated balance

For **real cross-device live sync**, see [Storage Adapter in README.md](./README.md#storage-adapter).

---

## Troubleshooting

**Build fails with "npm ci" error:**
The repo needs a `package-lock.json`. Run `npm install` locally in each app folder first, then commit the generated lock files.

```bash
cd apps/admin && npm install && cd ../..
cd apps/member && npm install && cd ../..
git add apps/admin/package-lock.json apps/member/package-lock.json
git commit -m "Add lock files"
git push
```

**Pages shows 404:**
- Make sure the repo is named exactly `loyalcore`
- Check Settings → Pages → Source is set to **GitHub Actions** (not a branch)
- Check the Actions tab for build errors

**Assets not loading (blank page):**
The `VITE_BASE_URL` must match your repo name. If you named your repo differently, update the `env:` block in `.github/workflows/deploy.yml`:
```yaml
env:
  VITE_BASE_URL: /YOUR_REPO_NAME/admin/
```

---

## Optional — Custom Domain

1. Settings → Pages → Custom domain → enter your domain
2. Update `VITE_BASE_URL` in the workflow to `/` (root)
3. Add a `CNAME` file to the `site/` folder in the deploy step
