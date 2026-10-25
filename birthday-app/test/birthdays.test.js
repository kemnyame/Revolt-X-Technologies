const test = require('node:test');
const assert = require('node:assert/strict');
const { nextBirthday, isValidBirthday, observedDate, staffWithBirthday } = require('../birthdays');

test('shows birthdays today', () => {
  assert.deepEqual(nextBirthday(10, 25, new Date('2026-10-25T21:00:00Z')), { date: '2026-10-25', daysUntil: 0 });
});
test('rolls over to the following year', () => {
  assert.deepEqual(nextBirthday(10, 24, new Date('2026-10-25')), { date: '2027-10-24', daysUntil: 364 });
});
test('handles leap day on February 28 in non-leap years', () => {
  assert.equal(observedDate(2, 29, 2027).toISOString().slice(0,10), '2027-02-28');
  assert.equal(observedDate(2, 29, 2028).toISOString().slice(0,10), '2028-02-29');
});
test('rejects nonexistent calendar dates', () => {
  assert.equal(isValidBirthday(4, 31), false);
  assert.equal(isValidBirthday(2, 29), true);
});
test('identifies staff whose upcoming birthday was acknowledged', () => {
  const s={id:'abc',birth_month:10,birth_day:25};
  assert.equal(staffWithBirthday(s,new Date('2026-10-25'), new Set(['abc:2026-10-25'])).greeted, true);
});
