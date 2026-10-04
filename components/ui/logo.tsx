import Image from 'next/image';
import logoSrc from './logo.jpeg';

/**
 * The cafe logo.
 *
 * The source image is 1536×1024 (3:2 landscape), so size it by HEIGHT and
 * let the width follow: `<Logo className="h-10 w-auto" />`. Corners are
 * rounded to match the design system (JPEGs have no alpha channel).
 */
export function Logo({
  className = 'h-10 w-auto',
  alt = 'logo',
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <Image
      src={logoSrc}
      alt={alt}
      priority
      className={`rounded-xl object-contain ${className}`}
    />
  );
}
