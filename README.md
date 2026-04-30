# 🐶 Winnie

Shared puppy tracker. PWA, no auth, syncs between phones via JSONBin.

## Project layout

```
winnie/
├── public/         # served by Netlify — this is the entire app
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json
│   ├── sw.js
│   ├── icon-192.png
│   └── icon-512.png
├── seed/           # historical data import — not deployed
│   ├── 2026-03.json
│   ├── 2026-04.json
│   ├── seed.json   # combined { schemaVersion: 3, events: [...] }
│   └── push-seed.mjs
├── .gitignore
├── netlify.toml    # Netlify config — publish dir, cache headers
├── README.md
└── CHANGELOG.md
```

The app is **vanilla HTML/CSS/JS — no build step**. Edit, commit, push, deployed.

## First-time deploy

### 1. Initialize the repo

```bash
cd winnie
git init
git add .
git commit -m "Initial v2.4"
```

### 2. Push to GitHub

Create a private repo on GitHub (call it `winnie` or whatever), then:

```bash
git remote add origin git@github.com:YOUR_USERNAME/winnie.git
git branch -M main
git push -u origin main
```

### 3. Connect to Netlify

You're already on Netlify. To swap from drag-and-drop to Git-deploy:

1. Netlify dashboard → your existing Winnie site → **Site configuration → Build & deploy → Continuous deployment**
2. **Link site to a Git repository** → pick GitHub → pick the `winnie` repo
3. Build settings should auto-detect from `netlify.toml`:
   - Build command: *(empty)*
   - Publish directory: `public`
4. Save. First deploy kicks off automatically.

That's it. From now on: `git push` → live in ~30 seconds.

## Day-to-day workflow

```bash
# Edit files in VS Code
# Test locally (optional — see below)

git add .
git commit -m "fix: timezone bug in slumber pairing"
git push

# Wait ~30 seconds, refresh app on phone
```

### Testing locally

For a quick local server:

```bash
cd public
python3 -m http.server 8000
# open http://localhost:8000
```

Or use the VS Code "Live Server" extension — right-click `index.html`, "Open with Live Server."

## Seeding historical data

Two ways to push `seed/seed.json` to JSONBin:

**Option A: Manual paste** (what you did first time)
1. Open `seed/seed.json`
2. Copy the whole thing
3. Paste into JSONBin bin editor
4. Save

**Option B: CLI push** (faster for re-seeds)
```bash
BIN_ID=your_bin_id_here node seed/push-seed.mjs
```

If your bin is private, also set `MASTER_KEY=...`.

## Schema v3 reference

See `CHANGELOG.md` for version history. Schema v3 events look like:

```js
{
  id: "imp_2026-03_001",
  type: "pee",                  // see TYPE_DEFS in app.js for full list
  time: 1772379840000,          // ms epoch
  end_time: null,               // ranges only
  time_precision: "exact",      // exact | approx | unknown
  timezone: "America/Los_Angeles",
  tags: ["accident"],
  who: "us",                    // us | trainer | sitter | unknown
  location: "downtown",
  note: "",
  retroactive: false,
  source: "manual",
  created: 1777267800000
}
```

Top-level wrapper for JSONBin: `{ schemaVersion: 3, events: [...] }`.

## Versioning

When you ship a meaningful change, bump the version in `CHANGELOG.md` and tag the commit:

```bash
git tag v2.5
git push --tags
```

That way you can always `git checkout v2.4` to see what was running on April 30.

## Files NOT to edit

- `seed/2026-03.json`, `seed/2026-04.json` — frozen month-by-month imports. If you re-import a month, regenerate from Notes; don't edit by hand.
- `seed/seed.json` — generated from the month files. Combine in code, not by hand.
