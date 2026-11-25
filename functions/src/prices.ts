import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const keyOf = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "unknown";

type Line = { itemName: string; unitPrice: number | null; unit: string | null; status?: string };

/** Compare each line's unit price with the last verified price from the same vendor and raise an alert on any change. */
export async function checkPrices(entryId: string, vendorName: string | null, lines: Line[], date: string) {
  if (!vendorName) return 0;
  const db = getFirestore();
  const vendorKey = keyOf(vendorName);
  let raised = 0;
  for (const line of lines) {
    if (line.unitPrice == null || line.status === "not_delivered") continue;
    const itemKey = keyOf(line.itemName);
    const snap = await db.doc(`items/${itemKey}`).get();
    const ref = snap.get(`prices.${vendorKey}`) as { unitPrice: number; unit: string | null; date: string; entryId: string } | undefined;
    if (!ref || ref.entryId === entryId) continue;
    const diff = line.unitPrice - ref.unitPrice;
    if (Math.abs(diff) < 0.005) continue;
    try {
      // Deterministic id: one alert per entry+item, never duplicated, never un-acknowledged by a re-run.
      await db.doc(`priceAlerts/${entryId}_${itemKey}`).create({
        entryId,
        date,
        itemKey,
        itemName: line.itemName,
        vendorKey,
        vendorName,
        unit: line.unit,
        oldPrice: ref.unitPrice,
        oldDate: ref.date,
        oldEntryId: ref.entryId,
        newPrice: line.unitPrice,
        changePct: ref.unitPrice ? Math.round((diff / ref.unitPrice) * 1000) / 10 : null,
        acknowledged: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      raised++;
    } catch (e: any) {
      if (e?.code !== 6 /* ALREADY_EXISTS */) throw e;
    }
  }
  return raised;
}

/** After Level 2 verifies a bill, its prices become the reference for future bills, and vendor/item masters are kept up to date. */
export async function recordVerifiedPrices(entryId: string, vendorName: string, lines: Line[], date: string) {
  const db = getFirestore();
  const vendorKey = keyOf(vendorName);
  const batch = db.batch();
  batch.set(db.doc(`vendors/${vendorKey}`), { name: vendorName, lastBillDate: date, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  for (const line of lines) {
    if (line.unitPrice == null || line.status === "not_delivered") continue;
    const itemKey = keyOf(line.itemName);
    const ref = db.doc(`items/${itemKey}`);
    const cur = (await ref.get()).get(`prices.${vendorKey}`) as { date: string } | undefined;
    if (cur && cur.date > date) continue; // don't let an older bill overwrite a newer price
    batch.set(
      ref,
      {
        name: line.itemName,
        unit: line.unit ?? null,
        prices: { [vendorKey]: { unitPrice: line.unitPrice, unit: line.unit ?? null, date, entryId, vendorName } },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}
