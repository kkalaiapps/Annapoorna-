# ANNAPOORNA Books

A mobile bookkeeping web app (installable PWA) for **ANNAPOORNA Kitchener Road**.

Staff photograph daily sales reports, cash-out records, vendor supply bills and wastage sheets. The photo reader (Claude, by Anthropic) reads each photo: vendor, items, quantity, unit price and amount. It also catches handwritten marks for items that were not delivered or need replacing. A verifier checks and corrects the result. Dashboards show items sold, items bought and spend by vendor, by day, week or month. Unit price changes raise alerts.

Stack: React + Vite PWA · Firebase Auth (Google sign-in) · Cloud Firestore · Cloud Functions (Node 22) · Claude API for reading photos · **Google Drive** (one shared folder chosen by the admin) for every bill photo and bank screenshot. Region: `asia-southeast1` (Singapore). Currency: SGD. Dates: Asia/Singapore.

## Access levels

| Level | Who | Can |
|---|---|---|
| Level 1 · Staff | Restaurant staff | Record entries with the camera or phone gallery; see their own entries |
| Level 2 · Verifier | Manager / accounts | Everything in Level 1, plus: verify, edit or reject entries; record vendor payments with bank screenshots; see dashboards and price alerts |
| Level 3 · Admin | Owner (`kkalai@gmail.com`) | Everything in Level 2, plus: approve or deny new sign-ins, pre-approve emails, change levels, remove access, and choose the Google Drive folder for photos |

New Google sign-ins wait as "pending" until the admin approves them. The admin can also pre-approve an email so that person gets their level on first sign-in. The admin account can't be demoted or deleted from the app.

## How an entry flows

1. **Record (Level 1+)**: pick the entry type, then **Take photo** or **Upload from phone**. Add one photo per page. Photos are shrunk to about 1600 px before upload.
2. **Save to Drive (automatic)**: the photo first lands in a short-lived Firebase upload buffer. A Cloud Function then copies it into the admin's Google Drive folder and deletes the buffer copy. Files are sorted as `<folder>/2026-11/Vendor bills/2026-11-25 Ah Seng INV-20431 ab12cd-1.jpg`. Staff phones never use their own Drive. If Drive isn't set up yet, or a copy fails, the photo stays in Firebase and the entry shows a warning.
3. **Read (automatic)**: the same function sends the photos to Claude, which returns structured data:
   - vendor, invoice number, date, GST and total
   - each line: item, qty, unit, unit price, amount, status, and the handwritten note
   - line status comes from the handwritten notes staff write on the printout: not received / missed / `X` means **not delivered**; a corrected qty means **short delivered**; bad / damaged / replace means **to replace (quality)**; `RTN` means **returned**. Lines that aren't delivered are left out of "items bought".
   - sales reports also get the payment-mode breakdown (Cash, NETS, GrabFood …)
   - warnings for anything unreadable or totals that don't add up
4. **Price check (automatic)**: each vendor-bill line is compared with the **last verified** unit price from the same vendor for the same item. Any change creates an alert (🔔 badge for Level 2/3).
5. **Verify (Level 2+)**: compare the photo with the extracted lines, edit anything wrong, then **Verify** or **Reject**. Verified prices become the new reference prices.
6. **Pay (Level 2+)**: on a vendor bill, record the amount paid, the date, the bank reference and the bank-transfer screenshot(s). Screenshots go to `<folder>/<month>/Bank payments/`. The Payments tab shows the amount owed per vendor.

The app shows photos by fetching them from Drive through a Cloud Function that checks access: Level 1 sees only their own entries, and only Level 2/3 see bank screenshots. Level 2/3 also get an "Open in Drive" link.

## Data model (Firestore)

```
users/{uid}          email, name, role: pending|L1|L2|L3|disabled, approvedBy
invites/{email}      role                          (pre-approved emails)
entries/{id}         type: sales|cashout|vendor_bill|wastage
                     date (YYYY-MM-DD, SG), status: processing|needs_review|verified|rejected
                     photoPaths[], remarks, createdBy, createdByName
                     vendorName, invoiceNumber, documentDate, subtotal, gst, total
                     lines[]: itemName, quantity, unit, unitPrice, amount, status, note
                     paymentBreakdown[] (sales), warnings[], hasIssues, extracted (raw reader output)
                     verifiedBy, verifiedAt, rejectReason, editLog[]
                     driveFiles[]: path, id, link   (where each photo/screenshot lives in Drive), driveError
                     payment (vendor_bill): status unpaid|partial|paid, paidAmount, paidDate, bankRef, proofPaths[]
items/{itemKey}      name, unit, prices.{vendorKey}: unitPrice, date, entryId   (reference prices)
vendors/{vendorKey}  name, lastBillDate
priceAlerts/{entryId_itemKey}  item, vendor, oldPrice, newPrice, changePct, acknowledged
settings/app         driveFolderLink, driveFolderId, driveFolderName, driveConnectedEmail
private/drive        Google refresh token of the connected Drive account (no app access, functions only)
recipes/{id}         (future) menuItem, yieldPortions, ingredients[]: itemKey, quantity, unit, sop
```

Firebase Storage is only an upload buffer: `entries/{entryId}/{n}.jpg` and `payments/{entryId}/*.jpg`. Files are deleted once they're copied to Drive.

### Ready for SOP quantities and P&L later

- `recipes` holds each menu item's ingredient quantities (the cooking SOP). Sales lines × recipes give **theoretical consumption**. Compare that with **items bought** minus **wastage** to see variance.
- `items.prices` already holds the latest verified unit cost per vendor, so the app can work out **cost per dish** and **food cost %**.
- A P&L adds fixed costs (rent, wages, utilities) as a new entry type or collection. Sales, purchases, cash-out and wastage are already captured by day.

## One-time setup (about 30 minutes)

You need a computer with **Node.js 22** and the Firebase CLI: `npm i -g firebase-tools`.

1. **Create the Firebase project** at <https://console.firebase.google.com> (for example `annapoorna-books`).
   - Upgrade to the **Blaze (pay as you go)** plan. Cloud Functions require it. Set a budget alert (for example S$20/month). A single restaurant normally stays near the free allowance.
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → Create → **production mode**, location **asia-southeast1 (Singapore)**.
4. **Storage** → Get started → same location.
5. **Project settings → Your apps → Web app (`</>`)** → register. Copy the config values into `web/.env` (start from `web/.env.example`).
6. Put your project id in `.firebaserc`.
7. **Anthropic API key**: create one at <https://console.anthropic.com> (add billing), then run:
   ```
   firebase login
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
8. **Google Drive access** (so the app can save photos into your folder):
   - In <https://console.cloud.google.com>, select the same project. Go to **APIs & Services → Library**, find **Google Drive API** and click **Enable**.
   - **APIs & Services → OAuth consent screen**: choose External, set the app name to "ANNAPOORNA Books" and enter your email. Add the scope `.../auth/drive`, then click **Publish app**. Publishing matters: in "Testing" mode Google disconnects Drive every 7 days.
   - **Credentials → Create credentials → OAuth client ID → Web application**. Under Authorised redirect URIs, add `https://<project-id>.web.app/oauth/drive` and `https://<project-id>.firebaseapp.com/oauth/drive`.
   - Put the client id in `functions/.env` as `GOOGLE_OAUTH_CLIENT_ID=...`, then run `firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET`.
9. Install and deploy:
   ```
   npm --prefix web install
   npm --prefix functions install
   firebase deploy
   ```
   On the first deploy, Firebase may ask you to let Storage read Firestore (needed for the role checks in `storage.rules`). Answer **yes**.
10. Open `https://<project-id>.web.app` on your phone and sign in with **kkalai@gmail.com**. You become Level 3 automatically. Use **Share → Add to Home Screen** to install the app.
11. In **Admin → Settings**, tap **Connect Google Drive** and sign in with the Google account that owns the photo folder. Google will say *"Google hasn't verified this app"*. That's expected for your own private app: tap **Advanced → Go to ANNAPOORNA Books**. Then paste the folder link (Drive → right-click the folder → Share → Copy link) and tap **Save folder**.
12. Approve staff in the **Admin** tab, or pre-approve their Gmail addresses.

### Running costs (estimates)
- Firebase: the free tier covers about 20k document writes per day and 5 GB of photos. A restaurant uses a small fraction of that.
- Photo reading: Claude Opus 5.5, roughly **US$0.03–0.08 per entry**, depending on the number of pages. At about 10 entries a day, that's about US$10–25 a month.

## Local development & tests

```
firebase emulators:start --only auth,firestore,storage,functions
# in another terminal
cd web && VITE_USE_EMULATORS=1 npm run dev
```
In emulator mode you can sign in from the browser console with `__emuLogin('kkalai@gmail.com')`.

Security-rules tests (29 cases: the bootstrap admin, pending users, invites, L1/L2/L3 permissions, payment proofs):
```
cd tests && npm install && npm test
```
Also tested in the emulator: a new entry runs the save/read function, the photo stays in Firebase while Drive isn't connected, the app fetches photos through the access check (the owner can, a stranger can't), and only the admin can change Drive settings. The Drive calls themselves were tested against a mock; check them once on the real project.

Known emulator limitation: the Storage emulator in our test run could not read Firestore for the role checks, so the two "allowed upload" storage cases fail locally. Every "denied" case passes. Check uploads once on the real project after deploying.

## Files

```
web/          React PWA (pages/, components/, lib/aggregate.ts = dashboard maths)
functions/    Cloud Functions: photo reader (extract.ts), price alerts (prices.ts), triggers (index.ts)
firestore.rules, storage.rules, firestore.indexes.json, firebase.json
tests/        security-rules tests
```
