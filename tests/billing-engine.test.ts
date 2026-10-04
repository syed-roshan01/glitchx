// Billing engine unit tests — Node built-in test runner.
// Run: npm test  (node --experimental-strip-types --test tests/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundBillableMinutes,
  matchPricingRule,
  computeGamingCharge,
  liveElapsedSeconds,
  estimateBookingAmount,
  calculateSessionBreakdown,
  type PlanSnapshot,
  type RateRule,
} from '../lib/billing/engine.ts';

const money = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `expected ${expected}, got ${actual}`);

const hourly100: PlanSnapshot = {
  name: 'PS5 Hourly',
  billing_type: 'HOURLY',
  price: 100,
  duration_minutes: null,
};

const pool300: PlanSnapshot = {
  name: 'Pool Hourly',
  billing_type: 'HOURLY',
  price: 300,
  duration_minutes: null,
};

const pkg180: PlanSnapshot = {
  name: 'PS5 2h Package',
  billing_type: 'PACKAGE',
  price: 180,
  duration_minutes: 120,
};

describe('roundBillableMinutes', () => {
  it('EXACT_MINUTES rounds up partial minutes', () => {
    assert.equal(roundBillableMinutes(61 * 60, 'EXACT_MINUTES'), 61);
    assert.equal(roundBillableMinutes(61.5 * 60, 'EXACT_MINUTES'), 62);
    assert.equal(roundBillableMinutes(30, 'EXACT_MINUTES'), 1);
    assert.equal(roundBillableMinutes(0, 'EXACT_MINUTES'), 0);
  });

  it('ROUND_UP_15 rounds to quarter hours', () => {
    assert.equal(roundBillableMinutes(52 * 60, 'ROUND_UP_15'), 60);
    assert.equal(roundBillableMinutes(45 * 60, 'ROUND_UP_15'), 45);
    assert.equal(roundBillableMinutes(46 * 60, 'ROUND_UP_15'), 60);
    assert.equal(roundBillableMinutes(5 * 60, 'ROUND_UP_15'), 15);
  });

  it('ROUND_UP_30 and ROUND_UP_60 behave', () => {
    assert.equal(roundBillableMinutes(52 * 60, 'ROUND_UP_30'), 60);
    assert.equal(roundBillableMinutes(31 * 60, 'ROUND_UP_30'), 60);
    assert.equal(roundBillableMinutes(52 * 60, 'ROUND_UP_60'), 60);
    assert.equal(roundBillableMinutes(61 * 60, 'ROUND_UP_60'), 120);
  });

  it('applies the minimum billing duration', () => {
    assert.equal(roundBillableMinutes(5 * 60, 'ROUND_UP_15', 30), 30);
    assert.equal(roundBillableMinutes(45 * 60, 'ROUND_UP_15', 60), 60);
  });
});

describe('matchPricingRule (peak hours)', () => {
  const peakRule: RateRule = {
    id: 'r1',
    name: 'Evening peak',
    resource_id: null,
    resource_type: 'PLAYSTATION',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '18:00:00',
    end_time: '23:00:00',
    price: 150,
    priority: 0,
  };

  it('matches inside the window in the cafe timezone', () => {
    const ist9pm = new Date('2026-10-03T15:30:00Z'); // 9:00 PM IST — inside window
    const rule = matchPricingRule([peakRule], {
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      startTimestamp: ist9pm,
      timeZone: 'Asia/Kolkata',
    });
    assert.equal(rule?.id, 'r1');
  });

  it('does not match outside the window', () => {
    const ist2pm = new Date('2026-10-03T08:30:00Z'); // 2:00 PM IST — outside
    const rule = matchPricingRule([peakRule], {
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      startTimestamp: ist2pm,
      timeZone: 'Asia/Kolkata',
    });
    assert.equal(rule, null);
  });

  it('ignores rules scoped to other resources', () => {
    const otherResource: RateRule = { ...peakRule, resource_id: 'other' };
    const ist9pm = new Date('2026-10-03T15:30:00Z');
    assert.equal(
      matchPricingRule([otherResource], {
        resourceId: 'ps1',
        resourceType: 'PLAYSTATION',
        startTimestamp: ist9pm,
        timeZone: 'Asia/Kolkata',
      }),
      null
    );
  });

  it('prefers the most specific rule', () => {
    const globalRule: RateRule = { ...peakRule, id: 'g', resource_type: null, price: 120 };
    const typeRule: RateRule = { ...peakRule, id: 't', price: 140 };
    const resourceRule: RateRule = { ...peakRule, id: 's', resource_id: 'ps1', price: 160 };
    const ist9pm = new Date('2026-10-03T15:30:00Z');
    const ctx = {
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      startTimestamp: ist9pm,
      timeZone: 'Asia/Kolkata',
    };
    assert.equal(matchPricingRule([globalRule, typeRule, resourceRule], ctx)?.id, 's');
    assert.equal(matchPricingRule([globalRule, typeRule], ctx)?.id, 't');
  });
});

describe('computeGamingCharge', () => {
  const ctx = { resourceId: 'ps1', resourceType: 'PLAYSTATION', startTimestamp: '2026-10-03T10:00:00Z', timeZone: 'UTC' };

  it('prorates hourly rate per billable minute (₹100/hr × 42 min = ₹70)', () => {
    const { amount } = computeGamingCharge(hourly100, [], ctx, 42);
    money(amount, 70);
  });

  it('applies the peak rule rate when one matches', () => {
    const peak: RateRule = {
      id: 'p', name: 'Peak', resource_id: null, resource_type: 'PLAYSTATION',
      days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '00:00:00', end_time: '23:59:59',
      price: 150, priority: 0,
    };
    const { amount, ruleApplied } = computeGamingCharge(hourly100, [peak], ctx, 60);
    money(amount, 150);
    assert.equal(ruleApplied?.id, 'p');
  });

  it('PACKAGE charges flat price within the package window', () => {
    const { amount } = computeGamingCharge(pkg180, [], ctx, 90);
    money(amount, 180);
  });

  it('PACKAGE prorates extra time beyond the window', () => {
    // 150 min on a 120-min ₹180 package → 180 + 30 × 1.5 = 225
    const { amount } = computeGamingCharge(pkg180, [], ctx, 150);
    money(amount, 225);
  });

  it('FIXED charges the flat price regardless of minutes', () => {
    const fixed: PlanSnapshot = { name: 'Flat', billing_type: 'FIXED', price: 99, duration_minutes: null };
    money(computeGamingCharge(fixed, [], ctx, 5).amount, 99);
    money(computeGamingCharge(fixed, [], ctx, 500).amount, 99);
  });

  it('bills zero for zero minutes', () => {
    money(computeGamingCharge(hourly100, [], ctx, 0).amount, 0);
  });
});

describe('liveElapsedSeconds (pause handling)', () => {
  const start = '2026-10-03T20:00:00Z';
  const now = new Date('2026-10-03T21:00:00Z');

  it('computes elapsed time without pauses', () => {
    assert.equal(liveElapsedSeconds({ actual_start_time: start, paused_at: null, total_paused_seconds: 0 }, now), 3600);
  });

  it('subtracts accumulated pause time', () => {
    assert.equal(liveElapsedSeconds({ actual_start_time: start, paused_at: null, total_paused_seconds: 600 }, now), 3000);
  });

  it('subtracts an ongoing pause', () => {
    const pausedAt = '2026-10-03T20:40:00Z';
    assert.equal(liveElapsedSeconds({ actual_start_time: start, paused_at: pausedAt, total_paused_seconds: 300 }, now), 2100);
  });

  it('never returns negative', () => {
    assert.equal(liveElapsedSeconds({ actual_start_time: '2026-10-03T22:00:00Z', paused_at: null, total_paused_seconds: 0 }, now), 0);
  });
});

describe('estimateBookingAmount', () => {
  it('HOURLY prorates by duration', () => {
    money(estimateBookingAmount(hourly100, 120), 200);
    money(estimateBookingAmount(pool300, 30), 150);
  });

  it('PER_MINUTE multiplies', () => {
    money(estimateBookingAmount({ name: 'PM', billing_type: 'PER_MINUTE', price: 2, duration_minutes: null }, 45), 90);
  });

  it('PACKAGE adds prorated extra time', () => {
    money(estimateBookingAmount(pkg180, 120), 180);
    money(estimateBookingAmount(pkg180, 150), 225);
  });
});

describe('calculateSessionBreakdown (end-to-end bill)', () => {
  const timing = { actual_start_time: '2026-10-03T20:00:00Z', paused_at: null, total_paused_seconds: 0 };
  const end = new Date('2026-10-03T20:52:00Z'); // 52 minutes

  it('computes the example bill: gaming + items + services - discount', () => {
    const b = calculateSessionBreakdown({
      plan: hourly100,
      rules: [],
      billingMode: 'EXACT_MINUTES',
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      timing,
      endAt: end,
      itemAmount: 110, // coke 80 + chips 30
      serviceAmount: 50, // extra controller
      discount: { type: 'FIXED', value: 10 },
      tax: { enabled: false, rate: 0 },
    });
    money(b.gamingAmount, 86.67); // 52 × 100/60
    money(b.subtotal, 246.67);
    money(b.discountAmount, 10);
    money(b.taxAmount, 0);
    money(b.total, 236.67);
    assert.equal(b.billableMinutes, 52);
  });

  it('applies rounding mode before pricing', () => {
    const b = calculateSessionBreakdown({
      plan: hourly100,
      rules: [],
      billingMode: 'ROUND_UP_30',
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      timing,
      endAt: end, // 52 min → rounds to 60
      tax: { enabled: false, rate: 0 },
    });
    assert.equal(b.billableMinutes, 60);
    money(b.gamingAmount, 100);
  });

  it('computes percentage discounts and tax on the discounted amount', () => {
    const b = calculateSessionBreakdown({
      plan: hourly100,
      rules: [],
      billingMode: 'EXACT_MINUTES',
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      timing,
      endAt: end, // gaming 86.67
      itemAmount: 113.33, // subtotal 200
      discount: { type: 'PERCENT', value: 10 },
      tax: { enabled: true, name: 'GST', rate: 18 },
    });
    money(b.subtotal, 200);
    money(b.discountAmount, 20);
    money(b.taxAmount, 32.4); // (200-20) × 18%
    money(b.total, 212.4);
  });

  it('excludes paused time from the bill', () => {
    const b = calculateSessionBreakdown({
      plan: hourly100,
      rules: [],
      billingMode: 'EXACT_MINUTES',
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      timing: { ...timing, total_paused_seconds: 12 * 60 },
      endAt: end, // 52 - 12 = 40 min
      tax: { enabled: false, rate: 0 },
    });
    assert.equal(b.elapsedSeconds, 40 * 60);
    money(b.gamingAmount, 66.67);
  });

  it('caps fixed discounts at the subtotal', () => {
    const b = calculateSessionBreakdown({
      plan: hourly100,
      rules: [],
      billingMode: 'EXACT_MINUTES',
      resourceId: 'ps1',
      resourceType: 'PLAYSTATION',
      timing,
      endAt: end,
      itemAmount: 0,
      serviceAmount: 0,
      discount: { type: 'FIXED', value: 500 },
      tax: { enabled: false, rate: 0 },
    });
    money(b.discountAmount, 86.67);
    money(b.total, 0);
  });
});
