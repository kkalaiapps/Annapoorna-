import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/** What Claude returns for one entry (one or more photos of the same document). */
export const LineSchema = z.object({
  itemName: z.string().describe("Item name as written, cleaned up (e.g. 'Onion Big', 'Basmati Rice 25kg')"),
  quantity: z.number().nullable(),
  unit: z.string().nullable().describe("kg, g, pcs, pkt, ctn, btl, L, tray, bag ... or null"),
  unitPrice: z.number().nullable().describe("Price per unit in SGD, before GST"),
  amount: z.number().nullable().describe("Line total in SGD"),
  status: z
    .enum(["ok", "not_delivered", "short_delivered", "to_replace", "returned"])
    .describe("Delivery/quality status, mostly from handwritten marks next to the line"),
  note: z.string().nullable().describe("Any handwritten mark or note on this line, verbatim"),
});

export const ExtractionSchema = z.object({
  documentKind: z.enum(["pos_printout", "handwritten_sheet", "vendor_invoice", "delivery_order", "receipt", "bank_screenshot", "other"]),
  vendorName: z.string().nullable().describe("Supplier / company name for bills; null for sales reports"),
  invoiceNumber: z.string().nullable(),
  documentDate: z.string().nullable().describe("Date printed or written on the document, YYYY-MM-DD"),
  lines: z.array(LineSchema),
  subtotal: z.number().nullable(),
  gst: z.number().nullable(),
  total: z.number().nullable(),
  paymentBreakdown: z
    .array(z.object({ method: z.string(), amount: z.number() }))
    .describe("Sales reports only: totals by payment mode (Cash, NETS, Visa/Master, PayNow, GrabFood, foodpanda, Deliveroo ...). Empty otherwise."),
  handwrittenNotes: z.array(z.string()).describe("Handwritten notes that are not tied to a single line"),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()).describe("Anything unreadable, inconsistent totals, or guesses the reviewer should check"),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export type EntryType = "sales" | "cashout" | "vendor_bill" | "wastage";

const SYSTEM = `You read photos of bookkeeping documents for ANNAPOORNA Kitchener Road, an Indian restaurant in Singapore.
Amounts are in SGD. GST in Singapore is 9%.
Photos are taken on a phone: they may be POS thermal printouts, supplier invoices / delivery orders, or handwritten sheets (English, sometimes Tamil words for ingredients - translate item names to English and keep the original in the note).
Several photos can be pages of the same document; combine them into one result and do not repeat lines.

Handwritten marks next to a line matter. Staff write them when checking a delivery:
- a cross, "X", "NA", "not received", "nil", or the quantity struck out -> status "not_delivered"
- a corrected lower quantity, "short", "only N" -> status "short_delivered" and use the delivered quantity, put the original in the note
- "b", "B", "bad", "replace", "R", "exchange", "rotten", "damaged" -> status "to_replace"
- "return", "RTN" -> status "returned"
- a tick or nothing -> status "ok"
Always copy the mark itself into the line's note. If a mark is unclear, keep status "ok", put the mark in the note and add a warning.

Never invent numbers. Use null for anything you cannot read and add a warning. Check that quantity x unit price matches the line amount and that lines add up to the total; if not, add a warning.`;

const TASK: Record<EntryType, string> = {
  vendor_bill:
    "This is a vendor supply bill (invoice or delivery order). Extract the vendor, invoice number, date, every item line with quantity, unit, unit price and amount, and the totals.",
  sales:
    "This is a daily sales report (POS printout or handwritten sheet). Extract every menu item sold as a line (quantity sold, unit price, amount), the payment-mode breakdown, and the totals. vendorName is null.",
  cashout:
    "This is a daily cash-out record: money paid out of the cash drawer. Each payout is a line (itemName = what it was for, amount = money paid). Put the payee in the note if written.",
  wastage:
    "This is a wastage sheet: food or ingredients thrown away. Each wasted item is a line with quantity and unit; put the reason in the note. Prices are usually not written - use null.",
};

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export async function extractFromPhotos(type: EntryType, images: { data: Buffer; mediaType: string }[]): Promise<Extraction> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg", data: img.data.toString("base64") },
  }));
  content.push({ type: "text", text: TASK[type] });

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error("The reader declined this photo. Please enter it by hand.");
  if (response.stop_reason === "max_tokens") throw new Error("The document was too long to read in one go. Try fewer photos per entry.");
  if (!response.parsed_output) throw new Error("Could not read the photo. Please enter it by hand.");
  return response.parsed_output;
}
