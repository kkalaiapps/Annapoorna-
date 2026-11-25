import type { Timestamp } from 'firebase/firestore'

export type Role = 'pending' | 'L1' | 'L2' | 'L3' | 'disabled'
export const ROLE_LABEL: Record<Role, string> = {
  pending: 'Waiting for approval',
  L1: 'Level 1 · Staff',
  L2: 'Level 2 · Verifier',
  L3: 'Level 3 · Admin',
  disabled: 'Access removed',
}

export interface UserProfile {
  uid: string
  email: string
  name: string
  photoURL?: string | null
  role: Role
  createdAt?: Timestamp
  approvedBy?: string | null
  approvedAt?: Timestamp | null
}

export type EntryType = 'sales' | 'cashout' | 'vendor_bill' | 'wastage'
export const ENTRY_LABEL: Record<EntryType, string> = {
  sales: 'Daily sales report',
  cashout: 'Cash out',
  vendor_bill: 'Vendor supply bill',
  wastage: 'Wastage bill',
}
export const ENTRY_ICON: Record<EntryType, string> = { sales: '🧾', cashout: '💵', vendor_bill: '🚚', wastage: '🗑️' }

export type LineStatus = 'ok' | 'not_delivered' | 'short_delivered' | 'to_replace' | 'returned'
export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  ok: 'OK',
  not_delivered: 'Not delivered',
  short_delivered: 'Short delivered',
  to_replace: 'To replace (quality)',
  returned: 'Returned',
}

export interface Line {
  itemName: string
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  amount: number | null
  status: LineStatus
  note: string | null
}

export type EntryStatus = 'processing' | 'needs_review' | 'verified' | 'rejected'

export interface Payment {
  status: 'unpaid' | 'partial' | 'paid'
  paidAmount?: number | null
  paidDate?: string | null
  bankRef?: string | null
  proofPaths?: string[]
  markedBy?: string | null
}

export interface Entry {
  id: string
  entity: string
  type: EntryType
  date: string // business date YYYY-MM-DD, Singapore time
  status: EntryStatus
  photoPaths: string[]
  remarks?: string | null
  createdBy: string
  createdByName: string
  createdAt?: Timestamp
  // filled by the photo reader, editable by Level 2
  vendorName?: string | null
  invoiceNumber?: string | null
  documentDate?: string | null
  lines?: Line[]
  subtotal?: number | null
  gst?: number | null
  total?: number | null
  paymentBreakdown?: { method: string; amount: number }[]
  warnings?: string[]
  hasIssues?: boolean
  extractionError?: string | null
  // verification
  verifiedBy?: string | null
  verifiedByName?: string | null
  verifiedAt?: Timestamp | null
  rejectReason?: string | null
  editLog?: { by: string; at: string; summary: string }[]
  // photos archived in the admin's Google Drive folder (path = original upload path)
  driveFiles?: { path: string; id: string; link: string }[]
  driveError?: string | null
  // vendor bills only
  payment?: Payment
}

export interface PriceAlert {
  id: string
  entryId: string
  date: string
  itemName: string
  vendorName: string
  unit: string | null
  oldPrice: number
  oldDate: string
  newPrice: number
  changePct: number | null
  acknowledged: boolean
}

/** Future: recipe / SOP quantities per menu item, used for theoretical consumption and P&L. */
export interface Recipe {
  id: string
  menuItem: string // must match sales line itemName
  yieldPortions: number
  ingredients: { itemKey: string; itemName: string; quantity: number; unit: string }[]
  sop?: string
}

export interface AppSettings {
  driveFolderLink?: string
  driveFolderId?: string
  driveFolderName?: string
  driveConnectedEmail?: string
  driveError?: string | null
}
