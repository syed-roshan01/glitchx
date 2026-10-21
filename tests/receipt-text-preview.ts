// Smoke the receipt text formatter and print the framed message.
import { buildReceiptText, whatsappReceiptUrl } from '../lib/whatsapp/receipt-text.ts';

const text = buildReceiptText(
  {
    invoiceNumber: 'INV-2026-00069',
    issuedAt: '2026-10-21T09:01:42.000Z',
    customerName: 'MOHYUDDIN',
    resourceName: 'Billiard Table (Snooker)',
    sessionStart: '2026-10-21T08:31:00.000Z',
    sessionEnd: '2026-10-21T09:01:42.000Z',
    durationSeconds: 1842,
    sessionLines: [{ name: 'Base (4P) · ₹200/hr', amount: 400 }],
    itemLines: [
      { name: 'Coke', quantity: 2, amount: 60 },
      { name: 'French Fries', quantity: 1, amount: 90 },
    ],
    subtotal: 550,
    discountAmount: 200,
    taxLabel: 'GST',
    taxAmount: 17.5,
    total: 367.5,
    paid: true,
    paymentMethod: 'CASH',
  },
  { cafeName: 'GlitchX Gaming Cafe', currency: '₹', timezone: 'Asia/Kolkata' }
);

console.log(text);
console.log('\n================== the link ==================');
console.log(whatsappReceiptUrl(text, '918780066721').slice(0, 160) + '…');
console.log('\nno-number variant:', whatsappReceiptUrl(text, '').slice(0, 60) + '…');
