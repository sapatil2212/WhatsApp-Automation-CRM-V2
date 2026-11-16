/**
 * Shared email template system.
 *
 * All transactional emails (OTP verification, password reset, account
 * activation, admin notifications, demo bookings) are built from these
 * helpers so they share one consistent, modern look:
 *  - centered ChatNexGen logo (light-mode navbar logo)
 *  - faint gray border card on a soft gray background
 *  - compact typography and OTP digits
 *
 * Styles are inlined on every element for maximum email-client compatibility.
 */

// The logo is a ChatNexGen brand asset and must load from a publicly reachable
// URL in every recipient's inbox. It intentionally uses the canonical brand
// domain (matching the OG image host in app/layout.tsx) rather than a
// per-deployment NEXT_PUBLIC_SITE_URL, which may be a private/placeholder host.
// Override with EMAIL_LOGO_URL if the logo is hosted elsewhere.
const LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  "https://chatnexgen.online/images/logo/chatnexgen-logo-light.png";
const SUPPORT_EMAIL = "chatnexgen@gmail.com";

// ─── Design tokens ──────────────────────────────────────────────────────────
const C = {
  pageBg: "#f5f6f8",
  cardBg: "#ffffff",
  border: "#e9ecf1", // faint gray border
  heading: "#0f172a",
  text: "#475569",
  muted: "#94a3b8",
  brand: "#059669",
  brandBtn: "#10b981",
  divider: "#eef1f5",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ─── Building blocks ──────────────────────────────────────────────────────────

/** Section heading. */
export function emailHeading(text: string): string {
  return `<h1 style="margin:0 0 8px 0;font-family:${FONT};font-size:18px;line-height:1.35;font-weight:600;color:${C.heading};">${text}</h1>`;
}

/** Small supporting/subtitle text. */
export function emailSubtitle(html: string): string {
  return `<p style="margin:0 0 4px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.text};">${html}</p>`;
}

/** Standard body paragraph. */
export function emailText(html: string, opts?: { color?: string; size?: number; bold?: boolean }): string {
  const color = opts?.color ?? C.text;
  const size = opts?.size ?? 13;
  const weight = opts?.bold ? "600" : "400";
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:${size}px;line-height:1.6;font-weight:${weight};color:${color};">${html}</p>`;
}

/** Thin horizontal divider. */
export function emailDivider(): string {
  return `<div style="height:1px;line-height:1px;font-size:0;background-color:${C.divider};margin:24px 0;">&nbsp;</div>`;
}

/** A compact OTP / verification code block. */
export function emailOtp(code: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto;">
    <tr>
      <td style="background-color:#f1f5f9;border:1px dashed ${C.brandBtn};border-radius:8px;padding:12px 22px;font-family:${FONT};font-size:24px;font-weight:700;letter-spacing:0.32em;color:${C.brand};text-align:center;">
        ${code}
      </td>
    </tr>
  </table>`;
}

/** Primary call-to-action button. */
export function emailButton(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 4px auto;">
    <tr>
      <td style="border-radius:8px;background-color:${C.brandBtn};">
        <a href="${href}" target="_blank" style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;padding:11px 28px;border-radius:8px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** Key/value detail rows, e.g. for admin notifications. */
export function emailDetails(rows: { label: string; value: string; highlight?: boolean }[]): string {
  const body = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:9px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${C.divider};` : ""}font-family:${FONT};font-size:12px;font-weight:600;color:${C.muted};width:140px;vertical-align:top;">${r.label}</td>
        <td style="padding:9px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${C.divider};` : ""}font-family:${FONT};font-size:13px;font-weight:500;color:${r.highlight ? C.brand : C.heading};">${r.value}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px 0;">${body}</table>`;
}

/** Subtle note / callout box. */
export function emailNote(html: string): string {
  return `<div style="background-color:#f8fafc;border:1px solid ${C.border};border-radius:8px;padding:12px 14px;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.text};text-align:center;">${html}</div>`;
}

// ─── Layout shell ─────────────────────────────────────────────────────────────

/**
 * Wraps content HTML in the shared email shell (logo + faint bordered card + footer).
 * @param opts.center whether inner content is centered (default true)
 */
export function emailLayout(opts: {
  title: string;
  contentHtml: string;
  preview?: string;
  center?: boolean;
}): string {
  const align = opts.center === false ? "left" : "center";
  const preview = opts.preview
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preview}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.pageBg};">
  ${preview}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.pageBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;max-width:100%;background-color:${C.cardBg};border:1px solid ${C.border};border-radius:14px;">
          <tr>
            <td style="padding:36px 36px 32px 36px;text-align:${align};">
              <!-- Logo -->
              <div style="text-align:center;margin-bottom:26px;">
                <img src="${LOGO_URL}" alt="ChatNexGen" height="30" style="height:30px;width:auto;display:inline-block;border:0;outline:none;text-decoration:none;">
              </div>
              ${opts.contentHtml}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;max-width:100%;">
          <tr>
            <td style="padding:18px 36px 0 36px;text-align:center;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.muted};">
              This is an automated email from ChatNexGen.<br>
              Need help? Reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.brand};text-decoration:none;">${SUPPORT_EMAIL}</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const emailTokens = C;
