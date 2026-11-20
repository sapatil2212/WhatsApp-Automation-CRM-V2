import QRCode from 'qrcode';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value) ? value : fallback;
}

/** Public URL a QR code points at. */
export function reviewUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/review/${token}`;
}

export async function qrSvg(url: string, opts: { fg?: string | null; bg?: string | null; logoUrl?: string | null }): Promise<string> {
  const fg = safeColor(opts.fg, '#0f172a');
  const bg = safeColor(opts.bg, '#ffffff');
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, width: 512, color: { dark: fg, light: bg } });
  const logo = opts.logoUrl && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(opts.logoUrl) ? opts.logoUrl.replace(/"/g, '%22') : null;
  if (!logo) return svg;
  // ~20% of the symbol in the centre; level-H error correction tolerates this.
  const size = 512;
  const box = Math.round(size * 0.22);
  const pos = Math.round((size - box) / 2);
  const overlay = `<rect x="${pos - 4}" y="${pos - 4}" width="${box + 8}" height="${box + 8}" rx="10" fill="${bg}"/><image href="${logo}" x="${pos}" y="${pos}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"/>`;
  return svg.replace('</svg>', `${overlay}</svg>`);
}

export async function qrPng(url: string, opts: { fg?: string | null; bg?: string | null }): Promise<Buffer> {
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'H', margin: 2, width: 1024, color: { dark: safeColor(opts.fg, '#0f172a'), light: safeColor(opts.bg, '#ffffff') } });
}