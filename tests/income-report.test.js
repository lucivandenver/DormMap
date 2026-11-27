import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIncome, incomeAnalytics, incomeEntries } from '../services/incomeReport.js';

test('compares equal custom ranges and uses Manila dates for reservations', () => {
  const entries = incomeEntries([
    { status: 'paid', paidDate: '2026-12-29', amount: '100.00' },
    { status: 'paid', paidDate: '2027-01-02', amount: '100.00', amountPaid: '79.75' },
    { status: 'paid', month: '2027-01', amount: '20.00' },
    { status: 'pending', paidDate: '2027-01-01', amount: '1000.00' },
  ], [{ reservationApprovedAt: new Date('2026-12-31T16:15Z'), reservationAmountPaid: '10.25' }]);

  assert.deepEqual([...groupIncome(entries, 'week')], [['2026-12-28', 190]]);
  assert.deepEqual([...groupIncome(entries)], [['2026-12', 100], ['2027-01', 110]]);
  const result = incomeAnalytics(entries, 'day', '2027-01-01', '2027-01-03');
  assert.equal(result.total, 90);
  assert.equal(result.rent, 79.75);
  assert.equal(result.reservations, 10.25);
  assert.equal(result.comparison.previousFrom, '2026-12-29');
  assert.equal(result.comparison.previousTo, '2026-12-31');
  assert.equal(result.comparison.change, -10);
  assert.equal(result.comparison.percent, -10);
  assert.deepEqual(result.trend, [
    { period: '2027-01-01', total: 10.25, rent: 0, reservations: 10.25 },
    { period: '2027-01-02', total: 79.75, rent: 79.75, reservations: 0 },
    { period: '2027-01-03', total: 0, rent: 0, reservations: 0 }
  ]);
});

test('uses matching month-to-date windows for an unfiltered comparison', () => {
  const entries = incomeEntries([
    { status: 'paid', paidDate: '2024-01-05', amount: '100.00' },
    { status: 'paid', paidDate: '2024-01-06', amount: '150.00' },
    { status: 'paid', paidDate: '2024-02-05', amount: '125.00' },
  ], []);

  const { comparison } = incomeAnalytics(entries, 'month', '', '', '2024-02-05');
  assert.equal(comparison.previousTo, '2024-01-05');
  assert.equal(comparison.previous, 100);
  assert.equal(comparison.change, 25);
  assert.equal(comparison.percent, 25);
});
