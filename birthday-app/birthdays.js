'use strict';

// All birthday calculations use UTC calendar dates. Ghana observes UTC+00 year-round.
const isLeap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const isValidBirthday = (month, day) => Number.isInteger(month) && Number.isInteger(day)
  && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
const observedDate = (month, day, year) => {
  if (!isValidBirthday(month, day)) throw new Error('Invalid birthday');
  return new Date(Date.UTC(year, month - 1, month === 2 && day === 29 && !isLeap(year) ? 28 : day));
};
const iso = (date) => date.toISOString().slice(0, 10);
const nextBirthday = (month, day, reference = new Date()) => {
  const today = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  let next = observedDate(month, day, today.getUTCFullYear());
  if (next < today) next = observedDate(month, day, today.getUTCFullYear() + 1);
  return { date: iso(next), daysUntil: Math.round((next.getTime() - today.getTime()) / 86400000) };
};
function staffWithBirthday(staff, reference = new Date(), greetedDates = new Set()) {
  const next = nextBirthday(Number(staff.birth_month), Number(staff.birth_day), reference);
  return { ...staff, next_birthday: next.date, days_until: next.daysUntil,
    greeted: greetedDates.has(String(staff.id) + ':' + next.date) };
}
module.exports = { isLeap, isValidBirthday, observedDate, nextBirthday, staffWithBirthday };
