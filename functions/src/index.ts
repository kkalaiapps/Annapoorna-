import { randomBytes } from "crypto";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, onRequest, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { extractFromPhotos, EntryType } from "./extract";
import { checkPrices, recordVerifiedPrices } from "./prices";
import { Drive, DRIVE_SCOPE, driveConfig, folderIdFromLink, oauthClient, safeName, TYPE_FOLDER } from "./drive";

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 5 });
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GOOGLE_OAUTH_CLIENT_ID = defineString("GOOGLE_OAUTH_CLIENT_ID", { default: "" });
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

type DriveFile = { path: string; id: string; link: string };

async function roleOf(req: CallableRequest) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first");
  return { uid, role: (await getFirestore().doc(`users/${uid}`).get()).get("role") as string | undefined };
}

async function getDrive() {
  const cfg = await driveConfig();
  if (!cfg || !GOOGLE_OAUTH_CLIENT_ID.value()) return null;
  return { cfg, drive: new Drive(GOOGLE_OAUTH_CLIENT_ID.value(), GOOGLE_OAUTH_CLIENT_SECRET.value(), cfg.refreshToken) };
}

/**
 * Copy photos that are still in the Firebase upload buffer into the admin's Drive folder
 * (<folder>/<YYYY-MM>/<type>/...), then delete the buffer copy. Returns the buffers so they can be read.
 */
async function archive(entryId: string, entry: FirebaseFirestore.DocumentData, paths: string[], kind: string) {
  const bucket = getStorage().bucket();
  const existing: DriveFile[] = entry.driveFiles ?? [];
  const d = await getDrive();
  const added: DriveFile[] = [];
  const buffers = new Map<string, Buffer>();
  for (const path of paths) {
    if (existing.some((f) => f.path === path)) continue;
    const [data] = await bucket.file(path).download();
    buffers.set(path, data);
    if (!d) continue; // Drive not set up yet: keep the photo in Firebase Storage
    const folder = await d.drive.ensurePath(d.cfg.folderId, [String(entry.date).slice(0, 7), TYPE_FOLDER[kind] ?? kind]);
    const n = path.split("/").pop()!.replace(/\.jpg$/, "");
    const up = await d.drive.upload(folder, `${entry.date} ${TYPE_FOLDER[kind] ?? kind} ${entryId.slice(0, 6)}-${n}.jpg`, data, "image/jpeg",
      `ANNAPOORNA Kitchener Road · ${kind} · entry ${entryId} · recorded by ${entry.createdByName ?? ""}`);
    added.push({ path, id: up.id, link: up.webViewLink });
  }
  if (added.length) {
    await getFirestore().doc(`entries/${entryId}`).update({ driveFiles: FieldValue.arrayUnion(...added) });
    await Promise.all(added.map((f) => bucket.file(f.path).delete().catch(() => undefined)));
  }
  return { added, buffers };
}

/** Load a photo from Drive if it was archived there, otherwise from the Firebase upload buffer. */
async function loadPhoto(entry: FirebaseFirestore.DocumentData, path: string): Promise<Buffer> {
  const f = (entry.driveFiles as DriveFile[] | undefined)?.find((x) => x.path === path);
  if (f) {
    const d = await getDrive();
    if (!d) throw new Error("Google Drive is not connected. Ask the admin to reconnect it in Settings.");
    return d.drive.download(f.id);
  }
  const [data] = await getStorage().bucket().file(path).download();
  return data;
}

async function readEntry(entryId: string) {
  const db = getFirestore();
  const ref = db.doc(`entries/${entryId}`);
  let entry = (await ref.get()).data();
  if (!entry) return;
  try {
    let buffers = new Map<string, Buffer>();
    try {
      ({ buffers } = await archive(entryId, entry, entry.photoPaths, entry.type));
    } catch (e: any) {
      console.error("drive archive failed", entryId, e);
      await ref.update({ driveError: String(e?.message ?? e) });
    }
    entry = (await ref.get()).data()!;
    const images = await Promise.all(
      (entry.photoPaths as string[]).map(async (p) => ({ data: buffers.get(p) ?? (await loadPhoto(entry!, p)), mediaType: "image/jpeg" }))
    );
    const x = await extractFromPhotos(entry.type as EntryType, images);
    const lines = x.lines.map((l) => ({ ...l, amount: l.amount ?? (l.quantity != null && l.unitPrice != null ? +(l.quantity * l.unitPrice).toFixed(2) : null) }));
    await ref.update({
      status: "needs_review",
      extracted: x,
      vendorName: entry.type === "vendor_bill" ? x.vendorName : null,
      invoiceNumber: x.invoiceNumber,
      documentDate: x.documentDate,
      lines,
      subtotal: x.subtotal,
      gst: x.gst,
      total: x.total ?? +lines.reduce((s, l) => s + (l.amount ?? 0), 0).toFixed(2),
      paymentBreakdown: x.paymentBreakdown,
      warnings: x.warnings,
      hasIssues: lines.some((l) => l.status !== "ok"),
      extractionError: null,
      extractedAt: FieldValue.serverTimestamp(),
    });
    // Put the vendor / invoice number in the Drive file names so the folder is easy to browse.
    const d = entry.type === "vendor_bill" && x.vendorName ? await getDrive() : null;
    if (d) {
      for (const f of (entry.driveFiles ?? []) as DriveFile[]) {
        if (!(entry.photoPaths as string[]).includes(f.path)) continue;
        const n = f.path.split("/").pop()!.replace(/\.jpg$/, "");
        await d.drive.rename(f.id, safeName(`${entry.date} ${x.vendorName}${x.invoiceNumber ? " " + x.invoiceNumber : ""} ${entryId.slice(0, 6)}-${n}`) + ".jpg").catch(() => undefined);
      }
    }
    if (entry.type === "vendor_bill") await checkPrices(entryId, x.vendorName, lines, entry.date);
  } catch (e: any) {
    console.error("extract failed", entryId, e);
    await ref.update({ status: "needs_review", extractionError: String(e?.message ?? e) });
  }
}

const withKeys = { secrets: [ANTHROPIC_API_KEY, GOOGLE_OAUTH_CLIENT_SECRET], timeoutSeconds: 300, memory: "512MiB" as const };

/** New photo entry -> save to Drive, then read it with Claude. */
export const onEntryCreated = onDocumentCreated({ document: "entries/{entryId}", ...withKeys }, async (event) => {
  if (event.data?.get("status") === "processing") await readEntry(event.params.entryId);
});

/** Level 2/3 asks to read the photos again. */
export const rereadEntry = onCall(withKeys, async (req) => {
  const { role } = await roleOf(req);
  if (role !== "L2" && role !== "L3") throw new HttpsError("permission-denied", "Level 2 or 3 only");
  const entryId = String(req.data?.entryId ?? "");
  await getFirestore().doc(`entries/${entryId}`).update({ status: "processing" });
  await readEntry(entryId);
  return { ok: true };
});

/** Verified vendor bill -> reference prices. New bank screenshot -> save to Drive. */
export const onEntryUpdated = onDocumentUpdated({ document: "entries/{entryId}", secrets: [GOOGLE_OAUTH_CLIENT_SECRET], timeoutSeconds: 120 }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const id = event.params.entryId;
  if (after.type === "vendor_bill" && before.status !== "verified" && after.status === "verified" && after.vendorName) {
    await checkPrices(id, after.vendorName, after.lines ?? [], after.date);
    await recordVerifiedPrices(id, after.vendorName, after.lines ?? [], after.date);
  }
  const proofs: string[] = after.payment?.proofPaths ?? [];
  const pending = proofs.filter((p) => !(after.driveFiles ?? []).some((f: DriveFile) => f.path === p));
  if (pending.length) {
    await archive(id, { ...after, date: after.payment?.paidDate ?? after.date }, pending, "payment").catch((e) => console.error("drive archive (payment) failed", id, e));
  }
});

/** Show a photo in the app. Photos live in the admin's Drive, so the app fetches them through here after checking access. */
export const getPhoto = onCall({ secrets: [GOOGLE_OAUTH_CLIENT_SECRET], memory: "512MiB" }, async (req) => {
  const { uid, role } = await roleOf(req);
  const entryId = String(req.data?.entryId ?? "");
  const path = String(req.data?.path ?? "");
  const entry = (await getFirestore().doc(`entries/${entryId}`).get()).data();
  if (!entry) throw new HttpsError("not-found", "No such entry");
  const isProof = (entry.payment?.proofPaths ?? []).includes(path);
  const isPhoto = (entry.photoPaths ?? []).includes(path);
  const l2 = role === "L2" || role === "L3";
  const allowed = (isPhoto && (l2 || (role === "L1" && entry.createdBy === uid))) || (isProof && l2);
  if (!allowed) throw new HttpsError("permission-denied", "No access to this photo");
  const data = await loadPhoto(entry, path);
  return { dataUrl: "data:image/jpeg;base64," + data.toString("base64") };
});

// ---------- Admin: connect Google Drive ----------

async function requireAdmin(req: CallableRequest) {
  const r = await roleOf(req);
  if (r.role !== "L3") throw new HttpsError("permission-denied", "Admin only");
  return r;
}

/** Step 1: admin clicks "Connect Google Drive" -> we return Google's consent URL. */
export const driveAuthUrl = onCall({ secrets: [GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  const { uid } = await requireAdmin(req);
  if (!GOOGLE_OAUTH_CLIENT_ID.value()) throw new HttpsError("failed-precondition", "GOOGLE_OAUTH_CLIENT_ID is not set. See README, step 8.");
  const origin = String(req.data?.origin ?? "");
  if (!/^https:\/\/[a-z0-9.-]+$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new HttpsError("invalid-argument", "Bad origin");
  const redirectUri = `${origin}/oauth/drive`;
  const state = randomBytes(16).toString("hex");
  await getFirestore().doc("private/driveAuth").set({ state, uid, redirectUri, createdAt: FieldValue.serverTimestamp() });
  const url = oauthClient(GOOGLE_OAUTH_CLIENT_ID.value(), GOOGLE_OAUTH_CLIENT_SECRET.value(), redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE, "openid", "email"],
    state,
  });
  return { url };
});

/** Step 2: Google sends the admin back here (Hosting rewrites /oauth/drive to this function). */
export const driveAuthCallback = onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_SECRET] }, async (req, res) => {
  const db = getFirestore();
  const pending = (await db.doc("private/driveAuth").get()).data();
  const back = (msg: string) => res.redirect(`/admin?drive=${encodeURIComponent(msg)}`);
  if (!pending || req.query.state !== pending.state) return back("Link expired, please try again");
  if (req.query.error) return back(String(req.query.error));
  try {
    const client = oauthClient(GOOGLE_OAUTH_CLIENT_ID.value(), GOOGLE_OAUTH_CLIENT_SECRET.value(), pending.redirectUri);
    const { tokens } = await client.getToken(String(req.query.code));
    if (!tokens.refresh_token) return back("Google did not return offline access. Remove the app at myaccount.google.com/permissions and try again");
    const email = tokens.id_token ? (await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_OAUTH_CLIENT_ID.value() })).getPayload()?.email : null;
    await db.doc("private/drive").set({ refreshToken: tokens.refresh_token, email: email ?? null, connectedBy: pending.uid, connectedAt: FieldValue.serverTimestamp() });
    await db.doc("settings/app").set({ driveConnectedEmail: email ?? "connected", driveConnectedAt: FieldValue.serverTimestamp(), driveError: null }, { merge: true });
    await db.doc("private/driveAuth").delete();
    back("connected");
  } catch (e: any) {
    console.error(e);
    back(String(e?.message ?? e));
  }
});

/** Step 3: admin pastes the folder link. We check the connected account can write there. */
export const setDriveFolder = onCall({ secrets: [GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  await requireAdmin(req);
  const link = String(req.data?.link ?? "").trim();
  const folderId = folderIdFromLink(link);
  if (!folderId) throw new HttpsError("invalid-argument", "That doesn't look like a Google Drive folder link");
  const priv = (await getFirestore().doc("private/drive").get()).data();
  if (!priv?.refreshToken) throw new HttpsError("failed-precondition", "Connect Google Drive first");
  const drive = new Drive(GOOGLE_OAUTH_CLIENT_ID.value(), GOOGLE_OAUTH_CLIENT_SECRET.value(), priv.refreshToken);
  let info;
  try {
    info = await drive.folderInfo(folderId);
  } catch (e: any) {
    throw new HttpsError("permission-denied", `The connected account (${priv.email}) can't open that folder. Share it with that account as Editor, or connect the account that owns it.`);
  }
  if (info.mimeType !== "application/vnd.google-apps.folder") throw new HttpsError("invalid-argument", "That link is a file, not a folder");
  if (info.capabilities?.canAddChildren === false) throw new HttpsError("permission-denied", "The connected account can only view that folder. It needs Editor access.");
  await getFirestore().doc("settings/app").set({ driveFolderLink: link, driveFolderId: folderId, driveFolderName: info.name, driveError: null }, { merge: true });
  return { name: info.name };
});
