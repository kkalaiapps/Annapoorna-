import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'

const env = await initializeTestEnvironment({
  projectId: 'demo-annapoorna',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9199 },
})
const ctx = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true })
const admin = ctx('admin', 'kkalai@gmail.com'), staff = ctx('staff', 'staff@x.com'), ver = ctx('ver', 'ver@x.com'), rando = ctx('r', 'r@x.com'), inv = ctx('inv', 'inv@x.com')
let pass = 0, fail = 0
const t = async (name, p) => { try { await p; pass++; console.log('ok  ', name) } catch (e) { fail++; console.log('FAIL', name, e.message) } }

const prof = (uid, email, role) => ({ uid, email, name: uid, role })
await t('admin bootstraps as L3', assertSucceeds(setDoc(doc(admin.firestore(), 'users/admin'), prof('admin', 'kkalai@gmail.com', 'L3'))))
await t('random cannot self-assign L3', assertFails(setDoc(doc(rando.firestore(), 'users/r'), prof('r', 'r@x.com', 'L3'))))
await t('random signs up pending', assertSucceeds(setDoc(doc(rando.firestore(), 'users/r'), prof('r', 'r@x.com', 'pending'))))
await t('pending cannot promote self', assertFails(updateDoc(doc(rando.firestore(), 'users/r'), { role: 'L2' })))
await t('admin invites inv as L2', assertSucceeds(setDoc(doc(admin.firestore(), 'invites/inv@x.com'), { role: 'L2' })))
await t('non-admin cannot invite', assertFails(setDoc(doc(rando.firestore(), 'invites/z@x.com'), { role: 'L3' })))
await t('invited user gets L2', assertSucceeds(setDoc(doc(inv.firestore(), 'users/inv'), prof('inv', 'inv@x.com', 'L2'))))
await t('staff signs up pending', assertSucceeds(setDoc(doc(staff.firestore(), 'users/staff'), prof('staff', 'staff@x.com', 'pending'))))
await t('admin approves staff L1', assertSucceeds(updateDoc(doc(admin.firestore(), 'users/staff'), { role: 'L1' })))
await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'users/ver'), prof('ver', 'ver@x.com', 'L2')))

const entry = { type: 'vendor_bill', date: '2026-11-25', status: 'processing', photoPaths: ['entries/e1/1.jpg'], createdBy: 'staff', createdByName: 'staff', payment: { status: 'unpaid' } }
await t('pending cannot create entry', assertFails(setDoc(doc(rando.firestore(), 'entries/e0'), { ...entry, createdBy: 'r' })))
await t('L1 creates entry', assertSucceeds(setDoc(doc(staff.firestore(), 'entries/e1'), entry)))
await t('L1 cannot spoof createdBy', assertFails(setDoc(doc(staff.firestore(), 'entries/e2'), { ...entry, createdBy: 'ver' })))
await t('L1 reads own entry', assertSucceeds(getDoc(doc(staff.firestore(), 'entries/e1'))))
await t('L1 lists own entries', assertSucceeds(getDocs(query(collection(staff.firestore(), 'entries'), where('createdBy', '==', 'staff')))))
await t('L1 cannot list all entries', assertFails(getDocs(collection(staff.firestore(), 'entries'))))
await t('L1 cannot verify', assertFails(updateDoc(doc(staff.firestore(), 'entries/e1'), { status: 'verified' })))
await t('L2 verifies + edits', assertSucceeds(updateDoc(doc(ver.firestore(), 'entries/e1'), { status: 'verified', total: 12.5 })))
await t('L2 cannot change photos', assertFails(updateDoc(doc(ver.firestore(), 'entries/e1'), { photoPaths: [] })))
await t('L2 marks paid', assertSucceeds(updateDoc(doc(ver.firestore(), 'entries/e1'), { payment: { status: 'paid', paidAmount: 12.5 } })))
await t('L2 cannot change roles', assertFails(updateDoc(doc(ver.firestore(), 'users/staff'), { role: 'L3' })))
await t('admin cannot be demoted', assertFails(updateDoc(doc(admin.firestore(), 'users/admin'), { role: 'L1' })))
await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'priceAlerts/a1'), { acknowledged: false, newPrice: 2 }))
await t('L1 cannot read alerts', assertFails(getDoc(doc(staff.firestore(), 'priceAlerts/a1'))))
await t('L2 acknowledges alert', assertSucceeds(updateDoc(doc(ver.firestore(), 'priceAlerts/a1'), { acknowledged: true })))
await t('L2 cannot alter alert price', assertFails(updateDoc(doc(ver.firestore(), 'priceAlerts/a1'), { newPrice: 1 })))

const img = new Uint8Array([1, 2, 3])
await t('L1 uploads bill photo', assertSucceeds(uploadBytes(ref(staff.storage(), 'entries/e1/1.jpg'), img, { contentType: 'image/jpeg' })))
await t('pending cannot upload', assertFails(uploadBytes(ref(rando.storage(), 'entries/e9/1.jpg'), img, { contentType: 'image/jpeg' })))
await t('L1 cannot upload bank proof', assertFails(uploadBytes(ref(staff.storage(), 'payments/e1/1.jpg'), img, { contentType: 'image/jpeg' })))
await t('L2 uploads bank proof', assertSucceeds(uploadBytes(ref(ver.storage(), 'payments/e1/1.jpg'), img, { contentType: 'image/jpeg' })))
await t('photos cannot be overwritten', assertFails(uploadBytes(ref(staff.storage(), 'entries/e1/1.jpg'), img, { contentType: 'image/jpeg' })))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
