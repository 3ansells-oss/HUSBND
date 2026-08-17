# HUSBND (web app)

A home-screen app for two people: one of you proposes chores with a BJ value attached, the other accepts or counters with a different number of BJs, then does the chore and gets it approved to bank the BJs. No Mac, no Xcode, no App Store — this is a website that installs to your iPhone's home screen and looks and behaves like a normal app.

## What's included

- `index.html`, `app.js` — the whole app (plain HTML/CSS/JavaScript, no build step).
- `manifest.json` + `icons/` — makes "Add to Home Screen" give it a real icon and a normal, full-screen app window instead of opening inside Safari's browser chrome.
- Syncs both phones in real time using Firebase (specifically Firestore, Google's free app database).

There's nothing to compile. You just need to (1) create a free backend for it to sync through, and (2) put these files somewhere with a web address, since phones won't run the sync features from a file with no address. Both steps are free and doable entirely from a phone or any browser — no computer required, and definitely no Mac.

## Part 1 — Create your free Firebase project (~5 minutes)

This is the "database" the app syncs through. Do this once.

1. Go to **console.firebase.google.com** and sign in with any Google account.
2. **Add project** → give it any name (e.g. "husbnd") → you can turn off Google Analytics, you don't need it → **Create project**.
3. Firebase's console layout changes from time to time — the menu names below might not match exactly what you see. If a step doesn't look right, use the **search icon** at the top of the left sidebar and type the product name ("Firestore", "Authentication") to jump straight to it.
4. In the left sidebar, look for a category like **Databases & Storage** (or just **Build**, on older layouts) → **Firestore** → **Create database**. Pick any region close to you, and choose **Start in production mode**. Click through.
5. In the left sidebar, look for a category like **Security** (or **Build**, on older layouts) → **Authentication** → **Get started**. Under **Sign-in method**, choose **Anonymous**, toggle it **Enable**, and save. (This lets both your phones connect without you having to build a login screen — it's the standard lightweight way to secure a small personal app like this.)
6. Go to **Firestore Database → Rules** and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /chores/{choreId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   Click **Publish**. This means only someone who has actually opened your app (and gotten an anonymous sign-in from it) can read or write chores — reasonable for a private household app, though not bank-grade security, since anyone who found your exact project ID could in principle also sign in anonymously. It keeps the data off the open internet by default.
7. Back at **Project Overview** (gear icon → **Project settings**), scroll to **Your apps**, click the **</>** (web) icon, give the app any nickname, and click **Register app**. Firebase will show you a code block that includes something like:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```
   **Copy that whole block.** You'll paste it straight into the app later — no code editing needed.

## Part 2 — Put the files online with GitHub Pages (~5 minutes)

1. Go to **github.com** and sign up for a free account if you don't have one.
2. Click the **+** in the top right → **New repository**. Name it anything (e.g. `husbnd-app`). Set it to **Public**. Create it.
3. On the new repo's page, click **Add file → Upload files**, then drag in every file and folder from this zip (`index.html`, `app.js`, `manifest.json`, and the whole `icons` folder). Commit the changes.
4. Go to the repo's **Settings → Pages**. Under **Build and deployment → Source**, choose **Deploy from a branch**, set branch to `main` and folder to `/ (root)`, then **Save**.
5. Wait about a minute, then refresh that page — GitHub will show you the live URL, something like `https://yourname.github.io/husbnd-app/`. That's your app's address.

## Part 3 — Install it on both phones

On **each** iPhone:

1. Open the GitHub Pages URL from Part 2 in **Safari** (must be Safari, not Chrome, for "Add to Home Screen" to make a proper app icon on iOS).
2. You'll see a **Set up HUSBND** screen. Paste the `firebaseConfig` snippet from Part 1, step 7 (the *same* snippet on both phones — it points both of you at the same synced data), then tap **Save & Continue**.
3. Pick your role: **Wife** or **Husband**. This choice is just remembered on that one phone.
4. Tap the **Share** icon in Safari's toolbar → **Add to Home Screen** → **Add**. You'll now have a HUSBND icon on your home screen that opens full-screen, like any other app.

## How the negotiation works

1. **Wife** opens the **Propose** tab, writes the chore, sets a BJ value, taps **Propose Chore**.
2. **Husband's** phone shows it under **Needs Your Response**, where he can:
   - **Accept** the offered BJs, or
   - **Counter** with a different number (flips it back to her to accept or counter again), or
   - **Decline** it outright.
3. This can go back and forth — whoever didn't make the last offer is the one shown "Needs Your Response."
4. Once someone accepts, it moves to **In Progress**.
5. He taps **Mark as Done**, which puts it in **Awaiting Approval** on her side.
6. She taps **Approve & Pay Out** (credits the BJs to the Balance tab) or **Send Back** if it's not actually done.

Updates sync in real time — if you're both looking at the app at the same time, you'll see each other's actions appear within a second or two, no refreshing needed.

## Troubleshooting

- **"Anonymous sign-in isn't enabled" error during setup** — you skipped Part 1, step 5. Go enable it in the Firebase console.
- **"Can't read chores — check your Firestore security rules"** — you skipped Part 1, step 6, or mistyped the rules. Re-paste them exactly as shown and hit Publish.
- **Icon doesn't look right / opens inside Safari instead of full-screen** — make sure you used Safari (not Chrome) to add it to the home screen, and that the `manifest.json` and `icons` folder were actually uploaded to GitHub alongside `index.html`.
- **Changed something and it's not showing up** — GitHub Pages can take a minute to update after you edit files in the repo; also try closing and reopening the app from the home screen.

## Data model

Everything lives in one Firestore collection, `chores`, with documents shaped like: `title`, `notes`, `bjValue`, `proposedBy` (`"wife"`/`"husband"`), `status` (`"proposed"`/`"accepted"`/`"completed"`/`"approved"`/`"rejected"`), `createdAt`, `completedAt`, `approvedAt`. The Balance tab is just the sum of `bjValue` across every chore with `status == "approved"` — there's no separate balance record to keep in sync.

## Known limitations / natural next steps

- Only the wife can originate new chore proposals in this version; the husband can respond/counter but not create one from scratch. Easy to open up if you want both directions.
- No editing or deleting a chore once proposed (you can Decline it, though).
- No rewards/redemption store for spending BJs — the app just tracks the balance.
- Security relies on your Firebase project ID + Firestore rules rather than a real login; fine for a private household app, but don't put anything sensitive in it.
- No offline support (no service worker) — you need an internet connection to load and use it, same as most simple web apps.

## File layout

```
index.html      Markup + all styling (single stylesheet, inline)
app.js          All app logic: Firebase wiring, rendering, event handling
manifest.json   Makes "Add to Home Screen" behave like a real app
icons/          App icons for the home screen
```
