export function positivePaymentAmount(value) {
  const input = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  const amount = Number(input);
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(input) || amount <= 0 || amount > 99999999.99) {
    throw Object.assign(new Error('Enter an amount paid greater than ₱0, with up to eight whole digits and two decimal places.'), { status: 422 });
  }
  return amount;
}

export function rentBillTotal(bill) {
  return (Math.round(Number(bill.amount) * 100) + Math.round(Number(bill.penalty || 0) * 100)) / 100;
}

export function confirmedRentAmount(bill) {
  return bill.amountPaid == null ? rentBillTotal(bill) : Number(bill.amountPaid);
}
