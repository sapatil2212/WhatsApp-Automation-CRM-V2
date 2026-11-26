/**
 * Social platforms a business can show on its universal QR page.
 *
 * Logos are the official brand marks from Simple Icons (CC0,
 * https://simpleicons.org), embedded as base64 SVG so the public page needs
 * no third-party request. They are drawn as CSS masks, so each logo takes
 * the platform's own colours (see `tile` / `glyph`). LinkedIn is not in
 * Simple Icons, so its "in" mark is drawn here.
 *
 * Owners may paste a full link or just a handle; `normalizeSocialLink`
 * builds the canonical profile URL and only accepts the platform's own
 * domains, so a QR page can never send visitors to an unrelated site.
 */

export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'youtube', 'x', 'linkedin', 'whatsapp', 'threads', 'telegram', 'pinterest', 'snapchat', 'tiktok', 'website'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

interface PlatformInfo {
  label: string;
  /** Call to action on the customer page. */
  cta: string;
  /** Tile background (CSS background value). */
  tile: string;
  /** Logo colour drawn on the tile. */
  glyph: string;
  /** Base64 SVG of the logo (null = generic globe). */
  icon: string | null;
  /** Accepted hosts (exact or subdomain). Empty = any https site. */
  hosts: string[];
  /** Builds a URL from a bare handle, or null when a full link is required. */
  fromHandle: ((h: string) => string) | null;
  placeholder: string;
}

const svg64 = (lines: string[]) => lines.join('');
const LINKEDIN_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="5.5" cy="5.6" r="2.1"/><rect x="3.7" y="8.9" width="3.6" height="11.4" rx=".3"/><path d="M9.6 8.9h3.45v1.56h.05c.48-.9 1.66-1.85 3.41-1.85 3.65 0 4.32 2.4 4.32 5.52v6.17h-3.6v-5.47c0-1.3-.02-2.98-1.82-2.98-1.82 0-2.1 1.42-2.1 2.89v5.56H9.6z"/></svg>';
const toBase64 = (s: string) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64'));

const handle = (h: string) => h.trim().replace(/^@+/, '');

export const PLATFORM: Record<SocialPlatform, PlatformInfo> = {
  instagram: {
    label: 'Instagram',
    cta: 'Follow us on Instagram',
    tile: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+SW5zdGFncmFtPC90',
      'aXRsZT48cGF0aCBkPSJNNy4wMzAxLjA4NGMtMS4yNzY4LjA2MDItMi4xNDg3',
      'LjI2NC0yLjkxMS41NjM0LS43ODg4LjMwNzUtMS40NTc1LjcyLTIuMTIyOCAx',
      'LjM4NzctLjY2NTIuNjY3Ny0xLjA3NSAxLjMzNjgtMS4zODAyIDIuMTI3LS4y',
      'OTU0Ljc2MzgtLjQ5NTYgMS42MzY1LS41NTIgMi45MTQtLjA1NjQgMS4yNzc1',
      'LS4wNjg5IDEuNjg4Mi0uMDYyNiA0Ljk0Ny4wMDYyIDMuMjU4Ni4wMjA2IDMu',
      'NjY3MS4wODI1IDQuOTQ3My4wNjEgMS4yNzY1LjI2NCAyLjE0ODIuNTYzNSAy',
      'LjkxMDcuMzA4Ljc4ODkuNzIgMS40NTczIDEuMzg4IDIuMTIyOC42Njc5LjY2',
      'NTUgMS4zMzY1IDEuMDc0MyAyLjEyODUgMS4zOC43NjMyLjI5NSAxLjYzNjEu',
      'NDk2MSAyLjkxMzQuNTUyIDEuMjc3My4wNTYgMS42ODg0LjA2OSA0Ljk0NjIu',
      'MDYyNyAzLjI1NzgtLjAwNjIgMy42NjgtLjAyMDcgNC45NDc4LS4wODE0IDEu',
      'MjgtLjA2MDcgMi4xNDctLjI2NTIgMi45MDk4LS41NjMzLjc4ODktLjMwODYg',
      'MS40NTc4LS43MiAyLjEyMjgtMS4zODgxLjY2NS0uNjY4MiAxLjA3NDUtMS4z',
      'Mzc4IDEuMzc5NS0yLjEyODQuMjk1Ny0uNzYzMi40OTY2LTEuNjM2LjU1Mi0y',
      'LjkxMjQuMDU2LTEuMjgwOS4wNjkyLTEuNjg5OC4wNjMtNC45NDgtLjAwNjMt',
      'My4yNTgzLS4wMjEtMy42NjY4LS4wODE3LTQuOTQ2NS0uMDYwNy0xLjI3OTct',
      'LjI2NC0yLjE0ODctLjU2MzMtMi45MTE3LS4zMDg0LS43ODg5LS43Mi0xLjQ1',
      'NjgtMS4zODc2LTIuMTIyOEMyMS4yOTgyIDEuMzMgMjAuNjI4LjkyMDggMTku',
      'ODM3OC42MTY1IDE5LjA3NC4zMjEgMTguMjAxNy4xMTk3IDE2LjkyNDQuMDY0',
      'NSAxNS42NDcxLjAwOTMgMTUuMjM2LS4wMDUgMTEuOTc3LjAwMTQgOC43MTgu',
      'MDA3NiA4LjMxLjAyMTUgNy4wMzAxLjA4MzltLjE0MDIgMjEuNjkzMmMtMS4x',
      'Ny0uMDUwOS0xLjgwNTMtLjI0NTMtMi4yMjg3LS40MDgtLjU2MDYtLjIxNi0u',
      'OTYtLjQ3NzEtMS4zODE5LS44OTUtLjQyMi0uNDE3OC0uNjgxMS0uODE4Ni0u',
      'OS0xLjM3OC0uMTY0NC0uNDIzNC0uMzYyNC0xLjA1OC0uNDE3MS0yLjIyOC0u',
      'MDU5NS0xLjI2NDUtLjA3Mi0xLjY0NDItLjA3OS00Ljg0OC0uMDA3LTMuMjAz',
      'Ny4wMDUzLTMuNTgzLjA2MDctNC44NDguMDUtMS4xNjkuMjQ1Ni0xLjgwNS40',
      'MDgtMi4yMjgyLjIxNi0uNTYxMy40NzYyLS45Ni44OTUtMS4zODE2LjQxODgt',
      'LjQyMTcuODE4NC0uNjgxNCAxLjM3ODMtLjkwMDMuNDIzLS4xNjUxIDEuMDU3',
      'NS0uMzYxNCAyLjIyNy0uNDE3MSAxLjI2NTUtLjA2IDEuNjQ0Ny0uMDcyIDQu',
      'ODQ4LS4wNzkgMy4yMDMzLS4wMDcgMy41ODM1LjAwNSA0Ljg0OTUuMDYwOCAx',
      'LjE2OS4wNTA4IDEuODA1My4yNDQ1IDIuMjI4LjQwOC41NjA4LjIxNi45Ni40',
      'NzU0IDEuMzgxNi44OTUuNDIxNy40MTk0LjY4MTYuODE3Ni45MDA1IDEuMzc4',
      'Ny4xNjUzLjQyMTcuMzYxNyAxLjA1Ni40MTY5IDIuMjI2My4wNjAyIDEuMjY1',
      'NS4wNzM5IDEuNjQ1LjA3OTYgNC44NDguMDA1OCAzLjIwMy0uMDA1NSAzLjU4',
      'MzQtLjA2MSA0Ljg0OC0uMDUxIDEuMTctLjI0NSAxLjgwNTUtLjQwOCAyLjIy',
      'OTQtLjIxNi41NjA0LS40NzYzLjk2LS44OTU0IDEuMzgxNC0uNDE5LjQyMTUt',
      'LjgxODEuNjgxMS0xLjM3ODMuOS0uNDIyNC4xNjQ5LTEuMDU3Ny4zNjE3LTIu',
      'MjI2Mi40MTc0LTEuMjY1Ni4wNTk1LTEuNjQ0OC4wNzItNC44NDkzLjA3OS0z',
      'LjIwNDUuMDA3LTMuNTgyNS0uMDA2LTQuODQ4LS4wNjA4TTE2Ljk1MyA1LjU4',
      'NjRBMS40NCAxLjQ0IDAgMSAwIDE4LjM5IDQuMTQ0YTEuNDQgMS40NCAwIDAg',
      'MC0xLjQzNyAxLjQ0MjRNNS44Mzg1IDEyLjAxMmMuMDA2NyAzLjQwMzIgMi43',
      'NzA2IDYuMTU1NyA2LjE3MyA2LjE0OTMgMy40MDI2LS4wMDY1IDYuMTU3LTIu',
      'NzcwMSA2LjE1MDYtNi4xNzMzLS4wMDY1LTMuNDAzMi0yLjc3MS02LjE1NjUt',
      'Ni4xNzQtNi4xNDk4LTMuNDAzLjAwNjctNi4xNTYgMi43NzEtNi4xNDk2IDYu',
      'MTczOE04IDEyLjAwNzdhNCA0IDAgMSAxIDQuMDA4IDMuOTkyMUEzLjk5OTYg',
      'My45OTk2IDAgMCAxIDggMTIuMDA3NyIvPjwvc3ZnPg==',
    ]),
    hosts: ['instagram.com', 'instagr.am'],
    fromHandle: (h) => `https://www.instagram.com/${handle(h)}/`,
    placeholder: '@yourbusiness or instagram.com/yourbusiness',
  },
  facebook: {
    label: 'Facebook',
    cta: 'Follow our Facebook page',
    tile: '#0866FF',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+RmFjZWJvb2s8L3Rp',
      'dGxlPjxwYXRoIGQ9Ik05LjEwMSAyMy42OTF2LTcuOThINi42Mjd2LTMuNjY3',
      'aDIuNDc0di0xLjU4YzAtNC4wODUgMS44NDgtNS45NzggNS44NTgtNS45Nzgu',
      'NDAxIDAgLjk1NS4wNDIgMS40NjguMTAzYTguNjggOC42OCAwIDAgMSAxLjE0',
      'MS4xOTV2My4zMjVhOC42MjMgOC42MjMgMCAwIDAtLjY1My0uMDM2IDI2Ljgw',
      'NSAyNi44MDUgMCAwIDAtLjczMy0uMDA5Yy0uNzA3IDAtMS4yNTkuMDk2LTEu',
      'Njc1LjMwOWExLjY4NiAxLjY4NiAwIDAgMC0uNjc5LjYyMmMtLjI1OC40Mi0u',
      'Mzc0Ljk5NS0uMzc0IDEuNzUydjEuMjk3aDMuOTE5bC0uMzg2IDIuMTAzLS4y',
      'ODcgMS41NjRoLTMuMjQ2djguMjQ1QzE5LjM5NiAyMy4yMzggMjQgMTguMTc5',
      'IDI0IDEyLjA0NGMwLTYuNjI3LTUuMzczLTEyLTEyLTEycy0xMiA1LjM3My0x',
      'MiAxMmMwIDUuNjI4IDMuODc0IDEwLjM1IDkuMTAxIDExLjY0N1oiLz48L3N2',
      'Zz4=',
    ]),
    hosts: ['facebook.com', 'fb.com', 'fb.me'],
    fromHandle: (h) => `https://www.facebook.com/${handle(h)}`,
    placeholder: 'facebook.com/yourpage',
  },
  youtube: {
    label: 'YouTube',
    cta: 'Subscribe on YouTube',
    tile: '#ffffff',
    glyph: '#FF0000',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+WW91VHViZTwvdGl0',
      'bGU+PHBhdGggZD0iTTIzLjQ5OCA2LjE4NmEzLjAxNiAzLjAxNiAwIDAgMC0y',
      'LjEyMi0yLjEzNkMxOS41MDUgMy41NDUgMTIgMy41NDUgMTIgMy41NDVzLTcu',
      'NTA1IDAtOS4zNzcuNTA1QTMuMDE3IDMuMDE3IDAgMCAwIC41MDIgNi4xODZD',
      'MCA4LjA3IDAgMTIgMCAxMnMwIDMuOTMuNTAyIDUuODE0YTMuMDE2IDMuMDE2',
      'IDAgMCAwIDIuMTIyIDIuMTM2YzEuODcxLjUwNSA5LjM3Ni41MDUgOS4zNzYu',
      'NTA1czcuNTA1IDAgOS4zNzctLjUwNWEzLjAxNSAzLjAxNSAwIDAgMCAyLjEy',
      'Mi0yLjEzNkMyNCAxNS45MyAyNCAxMiAyNCAxMnMwLTMuOTMtLjUwMi01Ljgx',
      'NHpNOS41NDUgMTUuNTY4VjguNDMyTDE1LjgxOCAxMmwtNi4yNzMgMy41Njh6',
      'Ii8+PC9zdmc+',
    ]),
    hosts: ['youtube.com', 'youtu.be'],
    fromHandle: (h) => `https://www.youtube.com/@${handle(h)}`,
    placeholder: '@yourchannel or youtube.com/@yourchannel',
  },
  x: {
    label: 'X',
    cta: 'Follow us on X',
    tile: '#000000',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+WDwvdGl0bGU+PHBh',
      'dGggZD0iTTE4LjkwMSAxLjE1M2gzLjY4bC04LjA0IDkuMTlMMjQgMjIuODQ2',
      'aC03LjQwNmwtNS44LTcuNTg0LTYuNjM4IDcuNTg0SC40NzRsOC42LTkuODNM',
      'MCAxLjE1NGg3LjU5NGw1LjI0MyA2LjkzMlpNMTcuNjEgMjAuNjQ0aDIuMDM5',
      'TDYuNDg2IDMuMjRINC4yOThaIi8+PC9zdmc+',
    ]),
    hosts: ['x.com', 'twitter.com'],
    fromHandle: (h) => `https://x.com/${handle(h)}`,
    placeholder: '@yourbusiness or x.com/yourbusiness',
  },
  linkedin: {
    label: 'LinkedIn',
    cta: 'Follow us on LinkedIn',
    tile: '#0A66C2',
    glyph: '#ffffff',
    icon: toBase64(LINKEDIN_SVG),
    hosts: ['linkedin.com', 'lnkd.in'],
    fromHandle: null,
    placeholder: 'linkedin.com/company/yourbusiness',
  },
  whatsapp: {
    label: 'WhatsApp',
    cta: 'Chat with us on WhatsApp',
    tile: '#25D366',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2hhdHNBcHA8L3Rp',
      'dGxlPjxwYXRoIGQ9Ik0xNy40NzIgMTQuMzgyYy0uMjk3LS4xNDktMS43NTgt',
      'Ljg2Ny0yLjAzLS45NjctLjI3My0uMDk5LS40NzEtLjE0OC0uNjcuMTUtLjE5',
      'Ny4yOTctLjc2Ny45NjYtLjk0IDEuMTY0LS4xNzMuMTk5LS4zNDcuMjIzLS42',
      'NDQuMDc1LS4yOTctLjE1LTEuMjU1LS40NjMtMi4zOS0xLjQ3NS0uODgzLS43',
      'ODgtMS40OC0xLjc2MS0xLjY1My0yLjA1OS0uMTczLS4yOTctLjAxOC0uNDU4',
      'LjEzLS42MDYuMTM0LS4xMzMuMjk4LS4zNDcuNDQ2LS41Mi4xNDktLjE3NC4x',
      'OTgtLjI5OC4yOTgtLjQ5Ny4wOTktLjE5OC4wNS0uMzcxLS4wMjUtLjUyLS4w',
      'NzUtLjE0OS0uNjY5LTEuNjEyLS45MTYtMi4yMDctLjI0Mi0uNTc5LS40ODct',
      'LjUtLjY2OS0uNTEtLjE3My0uMDA4LS4zNzEtLjAxLS41Ny0uMDEtLjE5OCAw',
      'LS41Mi4wNzQtLjc5Mi4zNzItLjI3Mi4yOTctMS4wNCAxLjAxNi0xLjA0IDIu',
      'NDc5IDAgMS40NjIgMS4wNjUgMi44NzUgMS4yMTMgMy4wNzQuMTQ5LjE5OCAy',
      'LjA5NiAzLjIgNS4wNzcgNC40ODcuNzA5LjMwNiAxLjI2Mi40ODkgMS42OTQu',
      'NjI1LjcxMi4yMjcgMS4zNi4xOTUgMS44NzEuMTE4LjU3MS0uMDg1IDEuNzU4',
      'LS43MTkgMi4wMDYtMS40MTMuMjQ4LS42OTQuMjQ4LTEuMjg5LjE3My0xLjQx',
      'My0uMDc0LS4xMjQtLjI3Mi0uMTk4LS41Ny0uMzQ3bS01LjQyMSA3LjQwM2gt',
      'LjAwNGE5Ljg3IDkuODcgMCAwMS01LjAzMS0xLjM3OGwtLjM2MS0uMjE0LTMu',
      'NzQxLjk4Mi45OTgtMy42NDgtLjIzNS0uMzc0YTkuODYgOS44NiAwIDAxLTEu',
      'NTEtNS4yNmMuMDAxLTUuNDUgNC40MzYtOS44ODQgOS44ODgtOS44ODQgMi42',
      'NCAwIDUuMTIyIDEuMDMgNi45ODggMi44OThhOS44MjUgOS44MjUgMCAwMTIu',
      'ODkzIDYuOTk0Yy0uMDAzIDUuNDUtNC40MzcgOS44ODQtOS44ODUgOS44ODRt',
      'OC40MTMtMTguMjk3QTExLjgxNSAxMS44MTUgMCAwMDEyLjA1IDBDNS40OTUg',
      'MCAuMTYgNS4zMzUuMTU3IDExLjg5MmMwIDIuMDk2LjU0NyA0LjE0MiAxLjU4',
      'OCA1Ljk0NUwuMDU3IDI0bDYuMzA1LTEuNjU0YTExLjg4MiAxMS44ODIgMCAw',
      'MDUuNjgzIDEuNDQ4aC4wMDVjNi41NTQgMCAxMS44OS01LjMzNSAxMS44OTMt',
      'MTEuODkzYTExLjgyMSAxMS44MjEgMCAwMC0zLjQ4LTguNDEzWiIvPjwvc3Zn',
      'Pg==',
    ]),
    hosts: ['wa.me', 'whatsapp.com'],
    fromHandle: (h) => {
      const digits = h.replace(/\D/g, '');
      return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
    },
    placeholder: 'WhatsApp number or wa.me/91…',
  },
  threads: {
    label: 'Threads',
    cta: 'Follow us on Threads',
    tile: '#000000',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+VGhyZWFkczwvdGl0',
      'bGU+PHBhdGggZD0iTTEyLjE4NiAyNGgtLjAwN2MtMy41ODEtLjAyNC02LjMz',
      'NC0xLjIwNS04LjE4NC0zLjUwOUMyLjM1IDE4LjQ0IDEuNSAxNS41ODYgMS40',
      'NzIgMTIuMDF2LS4wMTdjLjAzLTMuNTc5Ljg3OS02LjQzIDIuNTI1LTguNDgy',
      'QzUuODQ1IDEuMjA1IDguNi4wMjQgMTIuMTggMGguMDE0YzIuNzQ2LjAyIDUu',
      'MDQzLjcyNSA2LjgyNiAyLjA5OCAxLjY3NyAxLjI5IDIuODU4IDMuMTMgMy41',
      'MDkgNS40NjdsLTIuMDQuNTY5Yy0xLjEwNC0zLjk2LTMuODk4LTUuOTg0LTgu',
      'MzA0LTYuMDE1LTIuOTEuMDIyLTUuMTEuOTM2LTYuNTQgMi43MTdDNC4zMDcg',
      'Ni41MDQgMy42MTYgOC45MTQgMy41ODkgMTJjLjAyNyAzLjA4Ni43MTggNS40',
      'OTYgMi4wNTcgNy4xNjQgMS40MyAxLjc4MyAzLjYzMSAyLjY5OCA2LjU0IDIu',
      'NzE3IDIuNjIzLS4wMiA0LjM1OC0uNjMxIDUuOC0yLjA0NSAxLjY0Ny0xLjYx',
      'MyAxLjYxOC0zLjU5MyAxLjA5LTQuNzk4LS4zMS0uNzEtLjg3My0xLjMtMS42',
      'MzQtMS43NS0uMTkyIDEuMzUyLS42MjIgMi40NDYtMS4yODQgMy4yNzItLjg4',
      'NiAxLjEwMi0yLjE0IDEuNzA0LTMuNzMgMS43OS0xLjIwMi4wNjUtMi4zNjEt',
      'LjIxOC0zLjI1OS0uODAxLTEuMDYzLS42ODktMS42ODUtMS43NC0xLjc1Mi0y',
      'Ljk2NC0uMDY1LTEuMTkuNDA4LTIuMjg1IDEuMzMtMy4wODIuODgtLjc2IDIu',
      'MTE5LTEuMjA3IDMuNTgzLTEuMjkxYTEzLjg1MyAxMy44NTMgMCAwIDEgMy4w',
      'Mi4xNDJjLS4xMjYtLjc0Mi0uMzc1LTEuMzMyLS43NS0xLjc1Ny0uNTEzLS41',
      'ODYtMS4zMDgtLjg4My0yLjM1OS0uODloLS4wMjljLS44NDQgMC0xLjk5Mi4y',
      'MzItMi43MjEgMS4zMkw3LjczNCA3Ljg0N2MuOTgtMS40NTQgMi41NjgtMi4y',
      'NTYgNC40NzgtMi4yNTZoLjA0NGMzLjE5NC4wMiA1LjA5NyAxLjk3NSA1LjI4',
      'NyA1LjM4OC4xMDguMDQ2LjIxNi4wOTQuMzIxLjE0MiAxLjQ5LjcgMi41OCAx',
      'Ljc2MSAzLjE1NCAzLjA3Ljc5NyAxLjgyLjg3MSA0Ljc5LTEuNTQ4IDcuMTU4',
      'LTEuODUgMS44MS00LjA5NCAyLjYyOC03LjI3NyAyLjY1Wm0xLjAwMy0xMS42',
      'OWMtLjI0MiAwLS40ODcuMDA3LS43MzkuMDIxLTEuODM2LjEwMy0yLjk4Ljk0',
      'Ni0yLjkxNiAyLjE0My4wNjcgMS4yNTYgMS40NTIgMS44MzkgMi43ODQgMS43',
      'NjcgMS4yMjQtLjA2NSAyLjgxOC0uNTQzIDMuMDg2LTMuNzFhMTAuNSAxMC41',
      'IDAgMCAwLTIuMjE1LS4yMjF6Ii8+PC9zdmc+',
    ]),
    hosts: ['threads.net', 'threads.com'],
    fromHandle: (h) => `https://www.threads.net/@${handle(h)}`,
    placeholder: '@yourbusiness',
  },
  telegram: {
    label: 'Telegram',
    cta: 'Join us on Telegram',
    tile: '#26A5E4',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+VGVsZWdyYW08L3Rp',
      'dGxlPjxwYXRoIGQ9Ik0xMS45NDQgMEExMiAxMiAwIDAgMCAwIDEyYTEyIDEy',
      'IDAgMCAwIDEyIDEyIDEyIDEyIDAgMCAwIDEyLTEyQTEyIDEyIDAgMCAwIDEy',
      'IDBhMTIgMTIgMCAwIDAtLjA1NiAwem00Ljk2MiA3LjIyNGMuMS0uMDAyLjMy',
      'MS4wMjMuNDY1LjE0YS41MDYuNTA2IDAgMCAxIC4xNzEuMzI1Yy4wMTYuMDkz',
      'LjAzNi4zMDYuMDIuNDcyLS4xOCAxLjg5OC0uOTYyIDYuNTAyLTEuMzYgOC42',
      'MjctLjE2OC45LS40OTkgMS4yMDEtLjgyIDEuMjMtLjY5Ni4wNjUtMS4yMjUt',
      'LjQ2LTEuOS0uOTAyLTEuMDU2LS42OTMtMS42NTMtMS4xMjQtMi42NzgtMS44',
      'LTEuMTg1LS43OC0uNDE3LTEuMjEuMjU4LTEuOTEuMTc3LS4xODQgMy4yNDct',
      'Mi45NzcgMy4zMDctMy4yMy4wMDctLjAzMi4wMTQtLjE1LS4wNTYtLjIxMnMt',
      'LjE3NC0uMDQxLS4yNDktLjAyNGMtLjEwNi4wMjQtMS43OTMgMS4xNC01LjA2',
      'MSAzLjM0NS0uNDguMzMtLjkxMy40OS0xLjMwMi40OC0uNDI4LS4wMDgtMS4y',
      'NTItLjI0MS0xLjg2NS0uNDQtLjc1Mi0uMjQ1LTEuMzQ5LS4zNzQtMS4yOTct',
      'Ljc4OS4wMjctLjIxNi4zMjUtLjQzNy44OTMtLjY2MyAzLjQ5OC0xLjUyNCA1',
      'LjgzLTIuNTI5IDYuOTk4LTMuMDE0IDMuMzMyLTEuMzg2IDQuMDI1LTEuNjI3',
      'IDQuNDc2LTEuNjM1eiIvPjwvc3ZnPg==',
    ]),
    hosts: ['t.me', 'telegram.me'],
    fromHandle: (h) => `https://t.me/${handle(h)}`,
    placeholder: '@yourchannel or t.me/yourchannel',
  },
  pinterest: {
    label: 'Pinterest',
    cta: 'Follow us on Pinterest',
    tile: '#BD081C',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+UGludGVyZXN0PC90',
      'aXRsZT48cGF0aCBkPSJNMTIuMDE3IDBDNS4zOTYgMCAuMDI5IDUuMzY3LjAy',
      'OSAxMS45ODdjMCA1LjA3OSAzLjE1OCA5LjQxNyA3LjYxOCAxMS4xNjItLjEw',
      'NS0uOTQ5LS4xOTktMi40MDMuMDQxLTMuNDM5LjIxOS0uOTM3IDEuNDA2LTUu',
      'OTU3IDEuNDA2LTUuOTU3cy0uMzU5LS43Mi0uMzU5LTEuNzgxYzAtMS42NjMu',
      'OTY3LTIuOTExIDIuMTY4LTIuOTExIDEuMDI0IDAgMS41MTguNzY5IDEuNTE4',
      'IDEuNjg4IDAgMS4wMjktLjY1MyAyLjU2Ny0uOTkyIDMuOTkyLS4yODUgMS4x',
      'OTMuNiAyLjE2NSAxLjc3NSAyLjE2NSAyLjEyOCAwIDMuNzY4LTIuMjQ1IDMu',
      'NzY4LTUuNDg3IDAtMi44NjEtMi4wNjMtNC44NjktNS4wMDgtNC44NjktMy40',
      'MSAwLTUuNDA5IDIuNTYyLTUuNDA5IDUuMTk5IDAgMS4wMzMuMzk0IDIuMTQz',
      'Ljg4OSAyLjc0MS4wOTkuMTIuMTEyLjIyNS4wODUuMzQ1LS4wOS4zNzUtLjI5',
      'MyAxLjE5OS0uMzM0IDEuMzYzLS4wNTMuMjI1LS4xNzIuMjcxLS40MDEuMTY1',
      'LTEuNDk1LS42OS0yLjQzMy0yLjg3OC0yLjQzMy00LjY0NiAwLTMuNzc2IDIu',
      'NzQ4LTcuMjUyIDcuOTItNy4yNTIgNC4xNTggMCA3LjM5MiAyLjk2NyA3LjM5',
      'MiA2LjkyMyAwIDQuMTM1LTIuNjA3IDcuNDYyLTYuMjMzIDcuNDYyLTEuMjE0',
      'IDAtMi4zNTQtLjYyOS0yLjc1OC0xLjM3OWwtLjc0OSAyLjg0OGMtLjI2OSAx',
      'LjA0NS0xLjAwNCAyLjM1Mi0xLjQ5OCAzLjE0NiAxLjEyMy4zNDUgMi4zMDYu',
      'NTM1IDMuNTUuNTM1IDYuNjA3IDAgMTEuOTg1LTUuMzY1IDExLjk4NS0xMS45',
      'ODdDMjMuOTcgNS4zOSAxOC41OTIuMDI2IDExLjk4NS4wMjZMMTIuMDE3IDB6',
      'Ii8+PC9zdmc+',
    ]),
    hosts: ['pinterest.com', 'pinterest.co.in', 'in.pinterest.com', 'pin.it'],
    fromHandle: (h) => `https://www.pinterest.com/${handle(h)}/`,
    placeholder: 'pinterest.com/yourbusiness',
  },
  snapchat: {
    label: 'Snapchat',
    cta: 'Add us on Snapchat',
    tile: '#FFFC00',
    glyph: '#000000',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+U25hcGNoYXQ8L3Rp',
      'dGxlPjxwYXRoIGQ9Ik0xMi4yMDYuNzkzYy45OSAwIDQuMzQ3LjI3NiA1Ljkz',
      'IDMuODIxLjUyOSAxLjE5My40MDMgMy4yMTkuMjk5IDQuODQ3bC0uMDAzLjA2',
      'Yy0uMDEyLjE4LS4wMjIuMzQ1LS4wMy41MS4wNzUuMDQ1LjIwMy4wOS40MDEu',
      'MDkuMy0uMDE2LjY1OS0uMTIgMS4wMzMtLjMwMS4xNjUtLjA4OC4zNDQtLjEw',
      'NC40NjQtLjEwNC4xODIgMCAuMzU5LjAyOS41MDkuMDkuNDUuMTQ5LjczNC40',
      'NzkuNzM0LjgzOC4wMTUuNDQ5LS4zOS44MzktMS4yMTMgMS4xNjgtLjA4OS4w',
      'MjktLjIwOS4wNzUtLjM0NC4xMTktLjQ1LjEzNS0xLjEzOS4zNi0xLjMzMy44',
      'MS0uMDkuMjI0LS4wNjEuNTI0LjEyLjg2OGwuMDE1LjAxNWMuMDYuMTM2IDEu',
      'NTI2IDMuNDc1IDQuNzkxIDQuMDE0LjI1NS4wNDQuNDM1LjI3LjQyLjUwOSAw',
      'IC4wNzUtLjAxNS4xNDktLjA0NS4yMjUtLjI0LjU2OS0xLjI3My45ODgtMy4x',
      'NDYgMS4yNzEtLjA1OS4wOTEtLjEyLjM3NS0uMTY0LjU3LS4wMjkuMTc5LS4w',
      'NzQuMzYtLjEzNC41NTMtLjA3Ni4yNzEtLjI3LjQwNS0uNTU1LjQwNWgtLjAz',
      'Yy0uMTM1IDAtLjMxMy0uMDMxLS41MzgtLjA3NC0uMzYtLjA3NS0uNzY1LS4x',
      'MzUtMS4yNzMtLjEzNS0uMyAwLS41OTkuMDE1LS45MTMuMDc0LS42LjEwNC0x',
      'LjEyMy40NjQtMS43MjMuODg0LS44NTMuNTk5LTEuODI2IDEuMjg4LTMuMjk0',
      'IDEuMjg4LS4wNiAwLS4xMTktLjAxNS0uMTgtLjAxNWgtLjE0OWMtMS40Njgg',
      'MC0yLjQyNy0uNjc1LTMuMjc5LTEuMjg4LS41OTktLjQyLTEuMTA3LS43Nzkt',
      'MS43MDctLjg4NC0uMzE0LS4wNDUtLjYyOS0uMDc0LS45MjgtLjA3NC0uNTQg',
      'MC0uOTU4LjA4OS0xLjI3Mi4xNDktLjIxMS4wNDMtLjM5MS4wNzQtLjU0LjA3',
      'NC0uMzc0IDAtLjUyMy0uMjI0LS41ODMtLjQyLS4wNjEtLjE5Mi0uMDktLjM4',
      'OS0uMTM1LS41NjctLjA0Ni0uMTgxLS4xMDUtLjQ5NC0uMTY2LS41Ny0xLjkx',
      'OC0uMjIyLTIuOTUtLjY0Mi0zLjE4OS0xLjIyNi0uMDMxLS4wNjMtLjA1Mi0u',
      'MTUtLjA1NS0uMjI1LS4wMTUtLjI0My4xNjUtLjQ2NS40Mi0uNTA5IDMuMjY0',
      'LS41NCA0LjczLTMuODc5IDQuNzkxLTQuMDJsLjAxNi0uMDI5Yy4xOC0uMzQ1',
      'LjIyNC0uNjQ1LjExOS0uODY5LS4xOTUtLjQzNC0uODg0LS42NTgtMS4zMzIt',
      'LjgwOS0uMTIxLS4wMjktLjI0LS4wNzQtLjM0Ni0uMTE5LTEuMTA3LS40MzUt',
      'MS4yNTctLjkzLTEuMTk3LTEuMjczLjA5LS40NzkuNjc0LS43OTMgMS4xNjgt',
      'Ljc5My4xNDYgMCAuMjcuMDI5LjM4My4wNzQuNDIuMTk0Ljc4OS4zIDEuMTA0',
      'LjMuMjM0IDAgLjM4NC0uMDYuNDY1LS4xMDVsLS4wNDYtLjU2OWMtLjA5OC0x',
      'LjYyNi0uMjI1LTMuNjUxLjMwNy00LjgzN0M3LjM5MiAxLjA3NyAxMC43Mzku',
      'ODA3IDExLjcyNy44MDdsLjQxOS0uMDE1aC4wNnoiLz48L3N2Zz4=',
    ]),
    hosts: ['snapchat.com'],
    fromHandle: (h) => `https://www.snapchat.com/add/${handle(h)}`,
    placeholder: 'Snapchat username',
  },
  tiktok: {
    label: 'TikTok',
    cta: 'Follow us on TikTok',
    tile: '#000000',
    glyph: '#ffffff',
    icon: svg64([
      'PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0',
      'dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+VGlrVG9rPC90aXRs',
      'ZT48cGF0aCBkPSJNMTIuNTI1LjAyYzEuMzEtLjAyIDIuNjEtLjAxIDMuOTEt',
      'LjAyLjA4IDEuNTMuNjMgMy4wOSAxLjc1IDQuMTcgMS4xMiAxLjExIDIuNyAx',
      'LjYyIDQuMjQgMS43OXY0LjAzYy0xLjQ0LS4wNS0yLjg5LS4zNS00LjItLjk3',
      'LS41Ny0uMjYtMS4xLS41OS0xLjYyLS45My0uMDEgMi45Mi4wMSA1Ljg0LS4w',
      'MiA4Ljc1LS4wOCAxLjQtLjU0IDIuNzktMS4zNSAzLjk0LTEuMzEgMS45Mi0z',
      'LjU4IDMuMTctNS45MSAzLjIxLTEuNDMuMDgtMi44Ni0uMzEtNC4wOC0xLjAz',
      'LTIuMDItMS4xOS0zLjQ0LTMuMzctMy42NS01LjcxLS4wMi0uNS0uMDMtMS0u',
      'MDEtMS40OS4xOC0xLjkgMS4xMi0zLjcyIDIuNTgtNC45NiAxLjY2LTEuNDQg',
      'My45OC0yLjEzIDYuMTUtMS43Mi4wMiAxLjQ4LS4wNCAyLjk2LS4wNCA0LjQ0',
      'LS45OS0uMzItMi4xNS0uMjMtMy4wMi4zNy0uNjMuNDEtMS4xMSAxLjA0LTEu',
      'MzYgMS43NS0uMjEuNTEtLjE1IDEuMDctLjE0IDEuNjEuMjQgMS42NCAxLjgy',
      'IDMuMDIgMy41IDIuODcgMS4xMi0uMDEgMi4xOS0uNjYgMi43Ny0xLjYxLjE5',
      'LS4zMy40LS42Ny40MS0xLjA2LjEtMS43OS4wNi0zLjU3LjA3LTUuMzYuMDEt',
      'NC4wMy0uMDEtOC4wNS4wMi0xMi4wN3oiLz48L3N2Zz4=',
    ]),
    hosts: ['tiktok.com'],
    fromHandle: (h) => `https://www.tiktok.com/@${handle(h)}`,
    placeholder: '@yourbusiness',
  },
  website: {
    label: 'Website',
    cta: 'Visit our website',
    tile: '#0f172a',
    glyph: '#ffffff',
    icon: null,
    hosts: [],
    fromHandle: null,
    placeholder: 'https://yourbusiness.com',
  },
};

/** Google "G" (multi-colour), used for the review tile. */
export const GOOGLE_G_SVG = '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

const hostOk = (host: string, allowed: string[]) => allowed.some((a) => host === a || host.endsWith(`.${a}`));

/**
 * Canonical https URL for what the owner typed (link or handle), or an error.
 * YouTube channel links open the subscribe prompt directly.
 */
export function normalizeSocialLink(platform: SocialPlatform, input: string): { url: string } | { error: string } {
  const info = PLATFORM[platform];
  const raw = input.trim();
  if (!raw) return { error: `Add your ${info.label} link.` };
  const looksLikeUrl = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/|$|\?)/i.test(raw);
  let url: URL;
  if (!looksLikeUrl) {
    if (!info.fromHandle) return { error: `Paste your full ${info.label} link.` };
    const h = raw.replace(/^@+/, '');
    if (platform === 'whatsapp' ? raw.replace(/\D/g, '').length < 10 : !/^[\w.-]{1,60}$/.test(h)) return { error: `That doesn't look like a ${info.label} ${platform === 'whatsapp' ? 'number' : 'username'}.` };
    url = new URL(info.fromHandle(raw));
  } else {
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { error: `That ${info.label} link is not valid.` };
    }
  }
  url.protocol = 'https:';
  const host = url.hostname.toLowerCase();
  if (info.hosts.length && !hostOk(host, info.hosts)) return { error: `This link is not on ${info.label} (it points to ${host}).` };
  if (!info.hosts.length && (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.'))) return { error: 'Use your public website address.' };
  // A YouTube channel link that opens the "Subscribe" prompt.
  if (platform === 'youtube' && /^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)\/?$/.test(url.pathname) && !url.searchParams.has('sub_confirmation')) {
    url.searchParams.set('sub_confirmation', '1');
  }
  return { url: url.toString().slice(0, 500) };
}

/** Cleans a stored / submitted list: known platforms, valid URLs, one link per platform, in display order. */
export function sanitizeSocialLinks(value: unknown): SocialLink[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<SocialPlatform>();
  const out: SocialLink[] = [];
  for (const item of list) {
    const platform = (item as { platform?: unknown })?.platform;
    const url = (item as { url?: unknown })?.url;
    if (typeof platform !== 'string' || !(SOCIAL_PLATFORMS as readonly string[]).includes(platform) || typeof url !== 'string') continue;
    const p = platform as SocialPlatform;
    if (seen.has(p)) continue;
    const n = normalizeSocialLink(p, url);
    if ('url' in n) {
      seen.add(p);
      out.push({ platform: p, url: n.url });
    }
  }
  return out;
}
