import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { requireAuth, jsonError } from '@/lib/supabase/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/qr?format=png|svg
 * Stable QR code pointing at the public booking page (/book).
 * The URL is fixed, so the QR never changes between generations.
 */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  const format = req.nextUrl.searchParams.get('format') ?? 'png';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const target = `${appUrl.replace(/\/$/, '')}/book`;

  try {
    if (format === 'svg') {
      const svg = await QRCode.toString(target, {
        type: 'svg',
        margin: 2,
        width: 512,
        color: { dark: '#09090b', light: '#ffffff' },
      });
      return new NextResponse(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-store',
        },
      });
    }

    const buffer = await QRCode.toBuffer(target, {
      type: 'png',
      margin: 2,
      width: 720,
      color: { dark: '#09090b', light: '#ffffff' },
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="booking-qr.png"',
      },
    });
  } catch {
    return jsonError('Could not generate the QR code', 500);
  }
}
