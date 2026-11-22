export function summarizeRatings(rows = []) {
  const ratings = rows.map(row => Number(typeof row === 'object' ? row.rating : row))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0;
  return { ratingAverage: Math.round(average * 10) / 10, ratingCount: ratings.length };
}

export function validateRatingPayload(body = {}) {
  const rating = Number(body.rating);
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw Object.assign(new Error('Choose a rating from 1 to 5 stars.'), { status: 422 });
  }
  if (comment.length > 1000) {
    throw Object.assign(new Error('Comments must be 1,000 characters or fewer.'), { status: 422 });
  }
  return { rating, comment: comment || null };
}
