/** Map Postgres RPC error codes to human-readable messages.
 *  Pure — safe to import on the client and server. */
export function friendlyError(err: { message?: string; code?: string } | null | undefined): string {
  const msg = err?.message ?? '';
  // Postgres constraint errors (surfaced by PostgREST)
  if (err?.code === '23503' || /foreign key constraint/i.test(msg)) {
    return 'This record is in use (e.g. by sessions, bookings or invoices). Deactivate it instead of deleting.';
  }
  if (err?.code === '23505' || /duplicate key value/i.test(msg)) {
    return 'A record with these details already exists.';
  }
  if (err?.code === '22P02' || /invalid input syntax for type uuid/i.test(msg)) {
    return 'Record not found.';
  }
  const code = msg.match(/([A-Z_]{4,})/)?.[1];
  switch (code) {
    case 'SLOT_TAKEN':
      return 'That time slot is already booked. Pick another slot.';
    case 'RESOURCE_BUSY':
      return 'This station already has a running session.';
    case 'RESOURCE_UNAVAILABLE':
      return 'This station is not available right now.';
    case 'SESSION_NOT_ACTIVE':
      return 'This session is no longer active.';
    case 'SESSION_NOT_PAUSED':
      return 'This session is not paused.';
    case 'SESSION_NOT_FOUND':
      return 'Session not found.';
    case 'BOOKING_NOT_FOUND':
      return 'Booking not found.';
    case 'BOOKING_CLOSED':
      return 'This booking is already closed.';
    case 'BOOKINGS_DISABLED':
      return 'Online bookings are currently disabled.';
    case 'WAITLIST_DISABLED':
      return 'The waitlist is currently disabled.';
    case 'INVALID_NAME':
      return 'Please enter a valid name.';
    case 'INVALID_MOBILE':
      return 'Please enter a valid mobile number.';
    case 'INVALID_DURATION':
      return 'Please choose a valid duration.';
    case 'INVALID_START_TIME':
      return 'Please choose a valid start time.';
    case 'TOO_FAR_AHEAD':
      return 'Bookings can only be made a limited number of days ahead.';
    case 'INVALID_PLAN':
      return 'The selected pricing plan is unavailable.';
    case 'INVALID_CUSTOMER':
      return 'Customer not found.';
    case 'INVALID_QUANTITY':
      return 'Invalid quantity.';
    case 'INVALID_DISCOUNT_TYPE':
    case 'INVALID_DISCOUNT_VALUE':
      return 'Invalid discount.';
    case 'INVALID_PAYMENT_METHOD':
      return 'Invalid payment method.';
    case 'INVALID_STATUS':
      return 'Invalid status change.';
    case 'INSUFFICIENT_STOCK':
      return 'Not enough stock for this item.';
    case 'ITEM_NOT_FOUND':
      return 'This item is unavailable.';
    case 'NO_PRICING_PLAN':
      return 'No pricing plan configured for this resource.';
    case 'PAUSE_DISABLED':
      return 'Pause is disabled in cafe settings.';
    case 'BILLING_MISMATCH':
      return 'Billing could not be verified. Please retry.';
    case 'BOOKING_NOT_CANCELLABLE':
      return 'This booking can no longer be cancelled online. Please contact the cafe.';
    case 'INVALID_AMOUNT':
      return 'Please enter a valid amount.';
    case 'INVOICE_NOT_FOUND':
      return 'Invoice not found.';
    case 'INVOICE_VOID':
      return 'This invoice has been voided.';
    case 'PAYMENT_EXCEEDS_BALANCE':
      return 'Payment exceeds the remaining balance.';
    case 'INVALID_PRICE':
      return 'Please enter a valid price.';
    case 'NOT_AUTHENTICATED':
      return 'You must be signed in.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
