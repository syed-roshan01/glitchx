import { Anton, Chakra_Petch } from 'next/font/google';

/**
 * Homepage display typography.
 *  - Anton: ultra-condensed impact font for giant headlines
 *  - Chakra Petch: squarish techno font for HUD-style labels
 * Applied via CSS variables on the homepage root (see app/page.tsx).
 */
export const anton = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-anton',
  display: 'swap',
});

export const chakraPetch = Chakra_Petch({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-chakra',
  display: 'swap',
});
