import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book a station',
  description: 'Live availability and instant booking — pick a station, a time and you’re in. No account needed.',
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
