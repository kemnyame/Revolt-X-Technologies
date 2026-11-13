import { z } from 'zod';
import { dateInZone, fail } from './db.mjs';

export const label = (max = 120) => z.string().trim().min(1).max(max);
export const optional = (max = 120) => z.string().trim().max(max).nullish().transform(v => v || null);
export const uuid = z.uuid();
export const isoDate = z.iso.date();
export const integer = z.number().int().min(0).max(1000000000);
export const quantity = z.number().int().positive().max(1000000);
export const minor = z.number().int().min(0).max(10000000000);
export const positiveMinor = minor.min(1);
export const email = z.email().max(254).transform(v => v.toLowerCase());
export const role = z.enum(['admin','warehouse','sales','finance','viewer']);
export const password = z.string().min(12).max(128);
export const paymentMethod = z.enum(['cash','cheque','momo']);
export const currency = z.enum(['GHS','USD','GBP','EUR','NGN']);
export const timezone = label(64).refine(v => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}, 'Choose a valid time zone.');
export const why = z.object({reason: label(240)});

export function effectiveDate(date, context) {
  if (date > dateInZone(context.timezone)) fail(400,'The transaction date cannot be in the future.');
  return date;
}

export function totalOf(lines, field) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line[field], 0);
  if (!Number.isSafeInteger(total) || total > 100000000000000) fail(400,'The document total is too large.');
  return total;
}

export function paymentReference(method, reference) {
  if (method !== 'cash' && !reference) fail(400,method === 'cheque' ? 'Enter the cheque number.' : 'Enter the Mobile Money reference.');
  return reference;
}
