# LOYALCORE — Admin Portal

Dark-themed admin dashboard for managing the loyalty program.

## Features

- **Dashboard** — KPI cards, tier distribution, top members leaderboard
- **Members** — Searchable table with tier badges and point balances
- **Enroll Member** — Add new members with optional referrer selection
- **Award Points** — Real-time preview with tier multiplier + referral cascade
- **Configuration** — Live-editable tier thresholds, multipliers, icons, and referral override percentages

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview production build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BASE_URL` | `/loyalcore/admin/` | Base URL for asset paths (set to `/` for Vercel/Netlify) |

## Data Sync

All writes go through `window.storage` with `shared: true`. The Member app reads the same keys. Without a real backend, the localStorage shim in `main.jsx` keeps everything working locally (single browser tab only — not cross-device).
