# FIREBASE_SETUP.md — Cross-Device Live Sync Setup

This guide walks you through connecting LOYALCORE to Firebase Firestore for
real-time, cross-device data sync between the Admin and Member portals.
Estimated time: **15–20 minutes**.

---

## Architecture Overview

```
Admin Portal  ──write──▶  Firestore  ◀──onSnapshot──  Member Portal
     │                    (Cloud DB)                        │
     └──────────────── onSnapshot ──────────────────────────┘
                    (instant push, no polling)
```

Both apps share **3 Firestore documents** in the `loyalcore` collection:

| Document ID   | Contents                              |
|---------------|---------------------------------------|
| `lc__members` | All member records + transactions     |
| `lc__tiers`   | Tier config (thresholds, multipliers) |
| `lc__refLevels` | Referral override percentages       |

> Note: `:` in keys is stored as `__` since Firestore IDs can't contain colons.

---

## Step 1 — Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"**
3. Name it: `loyalcore` (or anything you like)
4. **Disable** Google Analytics (not needed)
5. Click **"Create project"** → wait ~30 seconds

---

## Step 2 — Enable Firestore

1. In the left sidebar click **"Build"** → **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in production mode"** (we'll set rules next)
4. Select a region close to your users (e.g. `asia-southeast1` for Malaysia)
5. Click **"Enable"**

---

## Step 3 — Set Security Rules

1. In Firestore, click the **"Rules"** tab
2. Replace the contents with the rules from `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /loyalcore/{key} {
      allow read: if true;
      allow write: if true;
      allow create, update: if request.resource.data.keys().hasAll(['value'])
                            && request.resource.data.value is string
                            && request.resource.data.value.size() < 1048576;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. Click **"Publish"**

> ⚠️ These rules allow open writes for the demo. See Step 6 to lock them down.

---

## Step 4 — Register a Web App & Get Config

1. In Firebase Console, click the **gear icon** → **"Project settings"**
2. Scroll to **"Your apps"** → click the **`</>`** (Web) icon
3. App nickname: `loyalcore-web`
4. **Do NOT** check "Firebase Hosting" (we're using GitHub Pages)
5. Click **"Register app"**
6. You'll see a config object like this — **copy the values**:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "loyalcore-abc12.firebaseapp.com",
  projectId:         "loyalcore-abc12",
  storageBucket:     "loyalcore-abc12.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123..."
};
```

---

## Step 5 — Configure Environment Variables

### For Local Development

Create `.env.local` in **both** app folders:

**`apps/admin/.env.local`**
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=loyalcore-abc12.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=loyalcore-abc12
VITE_FIREBASE_STORAGE_BUCKET=loyalcore-abc12.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123...
```

**`apps/member/.env.local`**
```env
# Same values as admin — both apps share the same Firebase project
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=loyalcore-abc12.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=loyalcore-abc12
VITE_FIREBASE_STORAGE_BUCKET=loyalcore-abc12.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123...
```

> `.env.local` is already in `.gitignore` — it will never be committed.

### For GitHub Pages (GitHub Actions)

Add **6 repository secrets** so the CI build can inject the values:

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"** for each:

| Secret Name                       | Value from Firebase config     |
|-----------------------------------|-------------------------------|
| `FIREBASE_API_KEY`                | `apiKey`                      |
| `FIREBASE_AUTH_DOMAIN`            | `authDomain`                  |
| `FIREBASE_PROJECT_ID`             | `projectId`                   |
| `FIREBASE_STORAGE_BUCKET`         | `storageBucket`               |
| `FIREBASE_MESSAGING_SENDER_ID`    | `messagingSenderId`           |
| `FIREBASE_APP_ID`                 | `appId`                       |

The `deploy.yml` workflow already reads these secrets and injects them as
`VITE_*` environment variables at build time.

---

## Step 6 — Test Locally

```bash
# Terminal 1 — Admin
cd apps/admin
npm install
npm run dev
# → http://localhost:5173

# Terminal 2 — Member
cd apps/member
npm install
npm run dev
# → http://localhost:5174
```

Open both in different browser windows (or different devices on the same network).

**Test the live sync:**
1. In Admin → Award Points to Aisha Rahman (200 pts)
2. Immediately in Member → log in as Aisha
3. Watch her balance update in real-time **without any refresh**

---

## Step 7 — Deploy to GitHub Pages

```bash
git add .
git commit -m "Add Firebase live sync"
git push origin main
```

GitHub Actions will build both apps with the Firebase secrets injected and
deploy to:
- `https://YOUR_USERNAME.github.io/loyalcore/admin/`
- `https://YOUR_USERNAME.github.io/loyalcore/member/`

---

## Step 8 — Verify Firestore Data

After running both apps, open Firebase Console → Firestore Database.

You should see a `loyalcore` collection with documents:
```
loyalcore/
  lc__members    { value: "[{\"id\":\"m001\",...}]", updatedAt: ... }
  lc__tiers      { value: "[{\"id\":\"bronze\",...}]", updatedAt: ... }
  lc__refLevels  { value: "[{\"level\":1,...}]", updatedAt: ... }
```

---

## Step 6 (Optional) — Harden Security Rules for Production

The default rules allow anyone to write. Once you're ready to protect real
customer data, add Firebase Authentication:

### 6a. Enable Email/Password Auth

Firebase Console → Build → Authentication → Sign-in method → Email/Password → Enable

### 6b. Create an Admin User

Authentication → Users → Add user
- Email: `admin@yourcompany.com`
- Password: (strong password)

### 6c. Set a Custom Claim via Firebase Admin SDK

```js
// run-once script: set-admin-claim.js
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.auth().setCustomUserClaims('ADMIN_USER_UID', { admin: true });
```

### 6d. Update Firestore Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /loyalcore/{key} {
      // Anyone can read (members need no auth to load their data)
      allow read: if true;

      // Only authenticated admins can write
      allow write: if request.auth != null
                   && request.auth.token.admin == true;
    }
  }
}
```

### 6e. Add Sign-In to the Admin App

In `apps/admin/src/firebase.js`, add:

```js
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
export const auth = getAuth(app)
export const signIn = (email, password) =>
  signInWithEmailAndPassword(auth, email, password)
```

Then wrap the Admin app in an auth check before rendering.

---

## Troubleshooting

**"Missing or insufficient permissions" error in console**
→ Your Firestore rules are blocking the write. Check the Rules tab and make
  sure you published them correctly.

**Data not appearing in Firestore**
→ Check browser console for Firebase errors. Most common cause: wrong
  `projectId` in `.env.local`.

**Real-time updates not arriving in Member app**
→ Make sure both apps are using the same `projectId`. Open the browser
  Network tab and look for a long-polling WebSocket connection to
  `firestore.googleapis.com` — that's the live channel.

**Build fails in GitHub Actions**
→ Check that all 6 secrets are added to the repo. The build will fail
  silently with blank env vars if any are missing.

**CORS error on `firebaseapp.com`**
→ Firebase Hosting domains are whitelisted automatically. For custom domains,
  add them in Firebase Console → Authentication → Authorized domains.
