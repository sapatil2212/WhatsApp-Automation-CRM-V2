import { Globe } from 'lucide-react';

import { GOOGLE_G_SVG, PLATFORM, type SocialPlatform } from '@/lib/reviews/social-platforms';

const SIZES = { sm: 'size-7 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl' } as const;

/** A platform's official logo on its brand-coloured tile. */
export function SocialLogo({ platform, size = 'md' }: { platform: SocialPlatform; size?: keyof typeof SIZES }) {
  const info = PLATFORM[platform];
  const mask = info.icon ? `url("data:image/svg+xml;base64,${info.icon}")` : null;
  const border = info.tile === '#ffffff' || info.tile === '#FFFC00' ? 'ring-1 ring-inset ring-black/10' : '';
  return (
    <span className={`relative grid shrink-0 place-items-center ${SIZES[size]} ${border}`} style={{ background: info.tile }} aria-hidden>
      {mask ? (
        <span
          className="block size-[58%]"
          style={{ backgroundColor: info.glyph, maskImage: mask, WebkitMaskImage: mask, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', maskSize: 'contain', WebkitMaskSize: 'contain' }}
        />
      ) : (
        <Globe className="size-[55%]" style={{ color: info.glyph }} />
      )}
    </span>
  );
}

/** Google's multi-colour "G" on a white tile. */
export function GoogleLogo({ size = 'md' }: { size?: keyof typeof SIZES }) {
  return (
    <span className={`grid shrink-0 place-items-center bg-white ring-1 ring-inset ring-black/10 ${SIZES[size]}`} aria-hidden>
      <span className="block size-[56%] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: GOOGLE_G_SVG }} />
    </span>
  );
}
