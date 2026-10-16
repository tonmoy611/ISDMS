'use strict';
// Pure fee maths. All money is handled in integer cents so rounding errors cannot creep in.
const toCents = (x) => Math.round(Number(x) * 100);
const fromCents = (c) => c / 100;
const CALC_TYPES = ['fixed', 'per_credit', 'per_course', 'per_lab_course'];

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** A program's own item for a fee head replaces the university default for that head. Items: {headId, ...}. */
function resolveSchedule(defaults, program) {
  const map = new Map(defaults.map((i) => [i.headId, i]));
  program.forEach((i) => map.set(i.headId, i));
  return [...map.values()];
}

const quantityFor = (calcType, f) => ({ fixed: 1, per_credit: f.credits, per_course: f.courses, per_lab_course: f.labCourses }[calcType] ?? 0);

/** schedule: [{headId, name, calcType, unitCents}], facts: {credits, courses, labCourses}. Lines with nothing to charge are left out. */
function computeCharges(schedule, facts) {
  return schedule.map((s) => {
    const qty = Number(quantityFor(s.calcType, facts)) || 0;
    return { kind: 'charge', feeHeadId: s.headId, description: s.name, quantity: qty, unitCents: s.unitCents, amountCents: Math.round(s.unitCents * qty) };
  }).filter((l) => l.quantity > 0 && l.amountCents > 0);
}

/**
 * Concessions are worked out on the original charge, never on each other, and can never push a charge below zero.
 * concession: {id, kind, mode: 'percent'|'fixed', value, feeHeadId|null, reason}
 */
function applyConcessions(charges, concessions) {
  const remaining = charges.map((l) => l.amountCents);
  const out = [];
  for (const c of concessions) {
    const targets = charges.map((_, i) => i).filter((i) => c.feeHeadId == null || charges[i].feeHeadId === c.feeHeadId);
    const base = targets.reduce((a, i) => a + charges[i].amountCents, 0);
    if (!base) continue;
    const room = targets.reduce((a, i) => a + remaining[i], 0);
    const want = Math.min(c.mode === 'percent' ? Math.round((base * Number(c.value)) / 100) : toCents(c.value), room);
    if (want <= 0) continue;
    let left = want;
    for (const i of targets) { const t = Math.min(left, remaining[i]); remaining[i] -= t; left -= t; if (!left) break; }
    out.push({ kind: 'discount', concessionId: c.id, description: `${c.kind[0].toUpperCase()}${c.kind.slice(1)}${c.reason ? `: ${c.reason}` : ''}`, quantity: 1, unitCents: -want, amountCents: -want });
  }
  return out;
}

/** settings: {lateMode: none|flat|percent, lateValue, graceDays, capCents|null}. Returns cents (0 when no late fee applies). */
function lateFeeCents(settings, { dueDate, today, balanceCents, alreadyAssessed }) {
  if (!settings || settings.lateMode === 'none' || alreadyAssessed || balanceCents <= 0 || !dueDate) return 0;
  if (today <= addDays(dueDate, settings.graceDays || 0)) return 0;
  let fee = settings.lateMode === 'flat' ? toCents(settings.lateValue) : Math.round((balanceCents * Number(settings.lateValue)) / 100);
  if (settings.capCents != null) fee = Math.min(fee, settings.capCents);
  return Math.max(0, fee);
}

/** Installments are paid in order. Returns each with the amount covered so far and a status. */
function allocateInstallments(installments, paidCents, today) {
  let left = paidCents;
  return installments.map((i) => {
    const covered = Math.min(i.amountCents, Math.max(0, left)); left -= covered;
    const status = covered >= i.amountCents ? 'paid' : covered > 0 ? 'partial' : 'unpaid';
    return { ...i, coveredCents: covered, status, overdue: status !== 'paid' && i.dueDate < today };
  });
}

/** The date that decides lateness: the first installment not fully paid (the last one if all are covered but something is still owed), else the invoice due date; null once nothing is owed. */
function effectiveDueDate({ invoiceDue, installments, paidCents, totalCents }) {
  if (paidCents >= totalCents) return null;
  if (!installments.length) return invoiceDue;
  const next = allocateInstallments(installments, paidCents, '0000-00-00').find((i) => i.status !== 'paid');
  return next ? next.dueDate : installments[installments.length - 1].dueDate;
}

function invoiceState({ totalCents, paidCents, cancelled, dueDate, today }) {
  if (cancelled) return 'cancelled';
  if (totalCents <= 0 || paidCents >= totalCents) return 'paid';
  if (dueDate && today > dueDate) return 'overdue';
  return paidCents > 0 ? 'partial' : 'unpaid';
}

/** Equal parts; any leftover cents go on the last one. */
function splitInstallments(balanceCents, count, firstDue, intervalDays) {
  const base = Math.floor(balanceCents / count);
  return Array.from({ length: count }, (_, i) => ({ dueDate: addDays(firstDue, i * intervalDays), amountCents: i === count - 1 ? balanceCents - base * (count - 1) : base }));
}

function installmentProblems(list, balanceCents) {
  const out = [];
  if (!Array.isArray(list) || list.length < 2 || list.length > 12) return ['Use between 2 and 12 installments.'];
  let sum = 0; let prev = '';
  list.forEach((x, i) => {
    if (!isDate(x.dueDate)) out.push(`Installment ${i + 1}: enter a valid due date.`);
    else if (prev && x.dueDate <= prev) out.push(`Installment ${i + 1}: the due date must be after the previous one.`);
    if (!(x.amountCents > 0)) out.push(`Installment ${i + 1}: the amount must be above zero.`);
    sum += x.amountCents || 0; prev = x.dueDate || prev;
  });
  if (!out.length && sum !== balanceCents) out.push(`The installments add up to ${fromCents(sum).toFixed(2)} but the invoice total is ${fromCents(balanceCents).toFixed(2)}.`);
  return out;
}

module.exports = { toCents, fromCents, CALC_TYPES, isDate, addDays, resolveSchedule, computeCharges, applyConcessions, lateFeeCents, allocateInstallments, effectiveDueDate, invoiceState, splitInstallments, installmentProblems };
