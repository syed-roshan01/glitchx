import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { isRelayAuthorized, RELAY_UNAUTHORIZED } from '@/lib/whatsapp/relay-auth';
import { buildInvoicePdf } from '@/lib/invoice-pdf';
import { mapInvoice, mapInvoiceItem, mapPayment, mapSettings } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

let logoPromise: Promise<{ dataUrl: string; w: number; h: number } | null> | null = null;
function loadLogoServer() {
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const buf = await readFile(path.join(process.cwd(), 'components', 'ui', 'logo.jpeg'));
        return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, w: 1536, h: 1024 };
      } catch {
        return null;
      }
    })();
  }
  return logoPromise;
}

/** GET /api/relay/whatsapp/pdf?invoice=<id> — the invoice as a PDF
 *  document, ready for the relay to send over WhatsApp. */
export async function GET(req: NextRequest) {
  if (!isRelayAuthorized(req)) return NextResponse.json(RELAY_UNAUTHORIZED, { status: 401 });
  const admin = createAdminClient();

  const invoiceId = req.nextUrl.searchParams.get('invoice');
  if (!invoiceId) return NextResponse.json({ error: 'invoice required' }, { status: 400 });

  const { data: raw, error } = await admin.from('invoices').select('*').eq('id', invoiceId).single();
  if (error || !raw) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const [itemsRes, paymentsRes, settingsRes] = await Promise.all([
    admin.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
    admin.from('payments').select('*').eq('invoice_id', invoiceId).order('paid_at'),
    admin.from('settings').select('*').eq('id', 'default').single(),
  ]);

  const blob = await buildInvoicePdf(
    mapInvoice(raw),
    (itemsRes.data ?? []).map(mapInvoiceItem),
    (paymentsRes.data ?? []).map(mapPayment),
    mapSettings(settingsRes.data ?? {}),
    { logo: await loadLogoServer() }
  );

  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${String(raw.invoice_number ?? 'invoice').replace(/[^\w.-]+/g, '_')}.pdf"`,
    },
  });
}
