# LOYALCORE — Member Portal

Mobile-first member portal with a warm luxury aesthetic.

## Features

- **Home** — Animated membership card with tier glow, shimmer, live point counter and progress bar
- **Rewards** — Category-filtered catalog, affordability states, bottom-sheet redemption confirmation
- **Refer** — Referral code copy, multi-level override breakdown, live downline network
- **History** — Full transaction log with earn/redeem filter, running totals
- **Profile** — Tier journey map, membership details, benefits list

## Development

```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # production build → dist/
npm run preview   # preview production build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BASE_URL` | `/loyalcore/member/` | Base URL for asset paths (set to `/` for Vercel/Netlify) |

## Mobile PWA

The app is optimised for mobile with:
- `viewport` meta tag preventing zoom
- `overscroll-behavior: none` on body
- `100dvh` min-height for correct mobile viewport
- Apple mobile web app meta tags for Add to Home Screen
