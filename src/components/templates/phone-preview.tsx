'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Phone, MessageSquareReply, FileText, Film, Image as ImageIcon } from 'lucide-react';

interface PreviewButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phone_number?: string;
}

interface PhonePreviewProps {
  headerType: 'none' | 'text' | 'image' | 'video' | 'document';
  headerText?: string;
  bodyText?: string;
  footerText?: string;
  buttons?: PreviewButton[];
  businessName?: string;
  theme?: 'light' | 'dark';
}

/** Render {{n}} placeholders with sample values or a greyed span */
function fillPreview(text: string, isDark: boolean, sampleMap?: Record<number, string>): React.ReactNode[] {
  const mutedColor = isDark ? 'text-[#8696a0]' : 'text-[#667781]';
  const textColor = isDark ? 'text-[#e9edef]' : 'text-[#111b21]';
  const varBg = isDark ? 'bg-white/10' : 'bg-black/5';

  if (!text) return [<span key="empty" className={mutedColor}>Your message body appears here…</span>];

  const parts = text.split(/(\{\{\d+\}\}|\n)/g);
  return parts.map((part, i) => {
    if (part === '\n') return <br key={i} />;
    const varMatch = part.match(/^\{\{(\d+)\}\}$/);
    if (varMatch) {
      const n = parseInt(varMatch[1], 10);
      const sample = sampleMap?.[n];
      return sample ? (
        <span key={i} className={`${textColor} font-medium`}>{sample}</span>
      ) : (
        <span key={i} className={`rounded ${varBg} px-1.5 ${mutedColor} text-[11px]`}>{`{{${n}}}`}</span>
      );
    }
    return <span key={i} className={textColor}>{part}</span>;
  });
}

function HeaderMedia({ type, isDark }: { type: 'image' | 'video' | 'document'; isDark: boolean }) {
  const mediaBg = isDark ? 'bg-[#1a2b35]' : 'bg-[#f0f2f5]';
  const mediaText = isDark ? 'text-[#8696a0]' : 'text-[#667781]';
  const iconColor = isDark ? 'text-[#aebac1]' : 'text-[#54656f]';

  return (
    <div className={`mb-1.5 flex h-[90px] w-full items-center justify-center rounded-md ${mediaBg} ${mediaText}`}>
      {type === 'image' && <><ImageIcon className={`size-6 mr-1.5 ${iconColor}`} /><span className="text-xs">Image</span></>}
      {type === 'video' && <><Film className={`size-6 mr-1.5 ${iconColor}`} /><span className="text-xs">Video</span></>}
      {type === 'document' && <><FileText className={`size-6 mr-1.5 ${iconColor}`} /><span className="text-xs">Document</span></>}
    </div>
  );
}

export function PhonePreview({
  headerType,
  headerText,
  bodyText,
  footerText,
  buttons = [],
  businessName = 'Your Business',
  theme = 'light',
}: PhonePreviewProps) {
  const hasContent = bodyText || headerText || footerText || buttons.length > 0;
  const isDark = theme === 'dark';

  // Theme-specific styles
  const phoneBg = isDark ? 'bg-[#1c1c1e]' : 'bg-[#f8f9fa]';
  const statusBarText = isDark ? 'text-white/80' : 'text-slate-800';
  const headerBg = isDark ? 'bg-[#1f2c34]' : 'bg-[#008069]';
  const avatarBg = isDark ? 'bg-emerald-700' : 'bg-[#005e54]';
  const titleText = isDark ? 'text-[#e9edef]' : 'text-white';
  const subText = isDark ? 'text-[#8696a0]' : 'text-emerald-100/80';
  const iconColor = isDark ? 'text-[#aebac1]' : 'text-white';
  
  // Chat Wallpapers
  const darkWallpaper = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23111b21'/%3E%3Cpath d='M25 25L75 75M75 25L25 75' stroke='%23ffffff05' stroke-width='1'/%3E%3C/svg%3E")`;
  const lightWallpaper = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23efeae2'/%3E%3Cpath d='M25 25L75 75M75 25L25 75' stroke='%2300000003' stroke-width='1'/%3E%3C/svg%3E")`;
  const chatBgColor = isDark ? '#111b21' : '#efeae2';
  const chatBgImage = isDark ? darkWallpaper : lightWallpaper;

  // Bubbles
  const bubbleBg = isDark ? 'bg-[#202c33]' : 'bg-[#ffffff]';
  const bubbleBorder = isDark ? 'border-transparent' : 'border border-slate-200/40';
  const headerTextColor = isDark ? 'text-[#e9edef]' : 'text-[#111b21]';
  const footerTextColor = isDark ? 'text-[#8696a0]' : 'text-[#667781]';
  const timeTextColor = isDark ? 'text-[#8696a0]' : 'text-[#667781]';
  const tailColor = isDark ? '#202c33' : '#ffffff';

  // Buttons
  const buttonBg = isDark ? 'bg-[#202c33]' : 'bg-[#ffffff]';
  const buttonText = isDark ? 'text-[#53bdeb]' : 'text-[#00a884] hover:bg-slate-50';
  const buttonBorder = isDark ? 'border-transparent' : 'border border-slate-200/40';

  // Input Bar
  const barBg = isDark ? 'bg-[#1f2c34] border-transparent' : 'bg-[#f0f2f5] border-t border-slate-200';
  const inputBg = isDark ? 'bg-[#2a3942] border-transparent text-[#e9edef]' : 'bg-[#ffffff] border border-slate-200/80 text-[#111b21]';
  const inputPlaceholderColor = isDark ? 'text-[#8696a0]' : 'text-[#667781]';
  const sendBtnBg = isDark ? 'bg-emerald-600' : 'bg-[#00a884]';

  return (
    <div className="flex flex-col items-center select-none">
      {/* ── Phone shell ── */}
      <div
        className={`relative flex flex-col overflow-hidden rounded-[2.5rem] ${phoneBg} shadow-2xl transition-all duration-300`}
        style={{ width: 240, height: 480, border: `8px solid ${isDark ? '#2a2a2e' : '#d1d5db'}` }}
      >
        {/* Dynamic island / notch */}
        <div className="absolute top-2.5 left-1/2 z-20 h-[22px] w-[75px] -translate-x-1/2 rounded-full bg-[#0a0a0a]" />

        {/* Status bar */}
        <div className={`relative z-10 flex items-center justify-between px-6 pt-3 pb-1 text-[10px] ${statusBarText} font-medium`}>
          <span className="font-semibold">9:41</span>
          <div className="flex items-center gap-1">
            <span>●●●</span>
            <span>WiFi</span>
            <span>🔋</span>
          </div>
        </div>

        {/* WhatsApp header bar */}
        <div className={`flex items-center gap-2.5 ${headerBg} px-3 py-2.5 z-10 transition-colors duration-300`}>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${avatarBg} text-xs font-bold text-white transition-colors duration-300`}>
            {businessName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-xs font-semibold ${titleText} transition-colors`}>{businessName}</p>
            <p className={`text-[10px] ${subText} transition-colors`}>{isDark ? 'Business Account' : 'online'}</p>
          </div>
          <div className={`flex items-center gap-3 ${iconColor} transition-colors`}>
            <Phone className="size-3.5" />
          </div>
        </div>

        {/* Chat area */}
        <div
          className="flex-1 overflow-hidden px-2.5 py-2 transition-all duration-300"
          style={{
            backgroundImage: chatBgImage,
            backgroundColor: chatBgColor,
          }}
        >
          <AnimatePresence mode="wait">
            {hasContent ? (
              <motion.div
                key="bubble"
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="mt-1"
              >
                {/* Message bubble */}
                <div className="relative max-w-[200px]">
                  {/* Tail */}
                  <div
                    className="absolute -left-2 top-0 h-0 w-0"
                    style={{
                      borderTop: `10px solid ${tailColor}`,
                      borderLeft: '8px solid transparent',
                    }}
                  />
                  <div className={`rounded-lg rounded-tl-none ${bubbleBg} p-2.5 shadow-sm ${bubbleBorder} transition-colors duration-300`}>
                    {/* Header */}
                    {headerType === 'text' && headerText && (
                      <motion.p
                        key={headerText}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`mb-1 text-[12px] font-semibold ${headerTextColor}`}
                      >
                        {headerText}
                      </motion.p>
                    )}
                    {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                      <HeaderMedia type={headerType} isDark={isDark} />
                    )}

                    {/* Body */}
                    <p className="whitespace-pre-wrap text-[12px] leading-[1.5]">
                      {fillPreview(bodyText || '', isDark)}
                    </p>

                    {/* Footer */}
                    {footerText && (
                      <p className={`mt-1 text-[10px] ${footerTextColor}`}>{footerText}</p>
                    )}

                    {/* Timestamp */}
                    <p className={`mt-1 text-right text-[9px] ${timeTextColor}`}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                    </p>
                  </div>

                  {/* Buttons */}
                  {buttons.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {buttons.map((btn, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 * i }}
                          className={`flex items-center justify-center gap-1.5 rounded-lg ${buttonBg} py-2 text-[11px] font-semibold ${buttonText} shadow-sm ${buttonBorder} cursor-pointer transition-colors duration-300`}
                        >
                          {btn.type === 'URL' && <Link2 className="size-3" />}
                          {btn.type === 'PHONE_NUMBER' && <Phone className="size-3" />}
                          {btn.type === 'QUICK_REPLY' && <MessageSquareReply className="size-3" />}
                          {btn.text || 'Button label'}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-full items-center justify-center"
              >
                <p className={`text-center text-[11px] ${isDark ? 'text-[#8696a0]' : 'text-[#667781]'} px-4 font-medium`}>
                  Start building your template to see a live preview here
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input bar */}
        <div className={`flex items-center gap-2 ${barBg} px-3 py-2 transition-colors duration-300`}>
          <div className={`flex-1 rounded-full ${inputBg} px-3 py-1.5 text-[11px] ${inputPlaceholderColor} transition-colors`}>
            Type a message
          </div>
          <div className={`flex h-7 w-7 items-center justify-center rounded-full ${sendBtnBg} text-white`}>
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </div>
        </div>

        {/* Home indicator */}
        <div className="flex justify-center pb-1.5 pt-1">
          <div className={`h-1 w-24 rounded-full ${isDark ? 'bg-white/30' : 'bg-slate-300'}`} />
        </div>
      </div>

      {/* Label */}
      <p className="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
        Live WhatsApp Preview
      </p>
    </div>
  );
}
