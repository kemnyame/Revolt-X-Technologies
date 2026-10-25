const test = require('node:test');
const assert = require('node:assert/strict');
const { nextBirthday, isValidBirthday, observedDate, staffWithBirthday, birthdayCountdownLabel } = require('../birthdays');

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

test('pending export labels today tomorrow and dates further ahead clearly', () => {
  assert.equal(birthdayCountdownLabel(0), 'Today');
  assert.equal(birthdayCountdownLabel(1), 'Tomorrow');
  assert.equal(birthdayCountdownLabel(3), 'In 3 days');
  assert.equal(birthdayCountdownLabel(30), 'In 30 days');
  assert.throws(() => birthdayCountdownLabel(-1));
});
test('future birthday date and countdown reflect the same calendar day', () => {
  const inThreeDays=nextBirthday(10,28,new Date('2026-10-25T23:45:00Z'));
  assert.equal(inThreeDays.date,'2026-10-28');
  assert.equal(birthdayCountdownLabel(inThreeDays.daysUntil),'In 3 days');
});
