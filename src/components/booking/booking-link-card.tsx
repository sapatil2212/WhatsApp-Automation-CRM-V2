'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Download, ExternalLink, Link2, MessageCircle, Printer, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface LinkData { url: string; name: string; kind: 'clinic' | 'business'; qrPng: string; qrSvg: string }

/**
 * Shareable booking link + QR code. Customers book from it without
 * WhatsApp back-and-forth; every booking gets a queue number and a WhatsApp
 * confirmation.
 */
export function BookingLinkCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<LinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/booking-link', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !b?.success) throw new Error(b?.message || 'Complete Business Setup to get your booking link.');
        setData(b.data);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      toast.success('Booking link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy failed — select and copy the link manually.');
    }
  }

  function download(kind: 'png' | 'svg') {
    if (!data) return;
    const a = document.createElement('a');
    a.href = kind === 'png' ? data.qrPng : URL.createObjectURL(new Blob([data.qrSvg], { type: 'image/svg+xml' }));
    a.download = `booking-qr-${data.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${kind}`;
    a.click();
  }

  function printPoster() {
    if (!data) return;
    const w = window.open('', '_blank', 'width=720,height=960');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Book with ${data.name}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#0f172a}
      h1{font-size:34px;margin:0 0 8px}p{color:#475569;font-size:18px;margin:0 0 28px}
      img{width:360px;height:360px;border:12px solid #10b981;border-radius:24px;padding:12px}
      .u{margin-top:24px;font-size:15px;color:#047857;word-break:break-all}.s{margin-top:36px;font-size:13px;color:#94a3b8}</style>
      </head><body><h1>${data.name.replace(/</g, '&lt;')}</h1><p>Scan to book your appointment instantly</p>
      <img src="${data.qrPng}" alt="QR code"/><div class="u">${data.url}</div>
      <div class="s">Get your queue number and reminders on WhatsApp</div>
      <script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        <Link2 className="size-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!data) return <div className={`animate-pulse rounded-2xl bg-muted/60 ${compact ? 'h-24' : 'h-40'}`} />;

  const shareText = encodeURIComponent(`Book your appointment with ${data.name} here: ${data.url}`);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center">
      {!compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.qrPng} alt="Booking QR code" className="size-32 shrink-0 self-center rounded-xl border border-border bg-white p-1.5" />
      )}
      <div className="min-w-0 flex-1 space-y-2.5">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold"><QrCode className="size-4 text-primary" /> Your booking link</p>
          <p className="text-xs text-muted-foreground">Share it on WhatsApp, Instagram, Google Business or print the QR at your front desk. Customers pick a slot and get a queue number on WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{data.url}</span>
          <button onClick={copy} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Copy link">
            {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open(data.url, '_blank')} className="gap-1.5"><ExternalLink className="size-3.5" /> Open</Button>
          <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${shareText}`, '_blank')} className="gap-1.5"><MessageCircle className="size-3.5" /> Share</Button>
          <Button size="sm" variant="outline" onClick={() => download('png')} className="gap-1.5"><Download className="size-3.5" /> QR PNG</Button>
          <Button size="sm" variant="outline" onClick={() => download('svg')} className="gap-1.5"><Download className="size-3.5" /> QR SVG</Button>
          <Button size="sm" variant="outline" onClick={printPoster} className="gap-1.5"><Printer className="size-3.5" /> Print poster</Button>
        </div>
      </div>
    </div>
  );
}
