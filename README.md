# LOYALCORE — Loyalty Platform

A full-stack loyalty program platform split into two separate apps that share live data via `window.storage`.

```
loyalcore/
├── apps/
│   ├── admin/          # Admin Portal (dark theme)
│   └── member/         # Member Portal (warm luxury theme)
└── .github/workflows/  # GitHub Actions CI/CD
```

## Apps

| App | Description | Demo |
|-----|-------------|------|
| **Admin Portal** | Manage members, award points, configure tiers & referral overrides | `apps/admin` |
| **Member Portal** | View points, redeem rewards, track referral network | `apps/member` |

## Live Data Sync — Firebase Firestore

Both apps share data through Firebase Firestore using `onSnapshot` — a persistent WebSocket connection that pushes changes instantly, with **zero polling**.

| Document | Contents |
|----------|----------|
| `lc__members` | All member records + transactions |
| `lc__tiers` | Tier configuration |
| `lc__refLevels` | Referral override levels |

When Admin awards points, the Member portal updates in **under 200ms** on any device, anywhere in the world.

For full setup instructions see **[FIREBASE_SETUP.md](./FIREBASE_SETUP.md)**.

## Local Development

### Prerequisites
- Node.js 18+
- npm 9+

### Run Admin Portal
```bash
cd apps/admin
npm install
npm run dev
# → http://localhost:5173
```

### Run Member Portal
```bash
cd apps/member
npm install
npm run dev
# → http://localhost:5174
```

> **Note:** `window.storage` is a Claude artifact API. In production, replace it with a real backend (e.g. Firebase, Supabase, or a custom REST API). See [Storage Adapter](#storage-adapter) below.

## Deployment

Each app deploys independently as a static site. GitHub Actions workflows are included for both.

### Deploy to GitHub Pages (automatic)

1. Push to `main` branch
2. GitHub Actions builds and deploys both apps:
   - Admin → `https://<username>.github.io/loyalcore/admin/`
   - Member → `https://<username>.github.io/loyalcore/member/`

### Deploy to Vercel / Netlify

Each app is a standard Vite project. Point your hosting to:
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Root directory:** `apps/admin` or `apps/member`

## Storage Adapter

The apps use `window.storage` as the storage API. In the Claude artifact environment this is provided natively. In hosted deployments, `src/firebase.js` installs a Firestore-backed adapter that matches the same interface.

If you want to swap to a different backend (Supabase, PlanetScale, etc.), implement these four methods in `firebase.js`:

```js
window.storage = {
  async get(key, shared)    { /* return { value: string } or throw */ },
  async set(key, val, shared) { /* persist and return { key, value } */ },
  async delete(key, shared) { /* remove key */ },
  async list(prefix, shared){ /* return { keys: string[] } */ },
}
```

And export a `subscribeToKey(key, callback)` function that returns an unsubscribe function for real-time updates.

## Tech Stack

- **Framework:** React 18 + Vite
- **Styling:** Inline styles (zero dependencies)
- **Fonts:** Google Fonts (Cormorant Garamond, DM Sans, Playfair Display)
- **Storage:** `window.storage` shared API (Claude artifact environment)
