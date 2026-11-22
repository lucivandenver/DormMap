import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRatings, validateRatingPayload } from '../services/boardingHouseRatingService.js';

test('tenant ratings return the combined average and count', () => {
  assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 3 }]), {
    ratingAverage: 4,
    ratingCount: 3,
  });
  assert.deepEqual(summarizeRatings([]), { ratingAverage: 0, ratingCount: 0 });
});

test('tenant ratings accept whole stars from one through five only', () => {
  assert.deepEqual(validateRatingPayload({ rating: '5', comment: '  Clean rooms  ' }), { rating: 5, comment: 'Clean rooms' });
  for (const rating of [0, 6, 2.5, 'not a rating']) {
    assert.throws(() => validateRatingPayload({ rating }), { status: 422 });
  }
  assert.throws(() => validateRatingPayload({ rating: 4, comment: 'x'.repeat(1001) }), { status: 422 });
});
