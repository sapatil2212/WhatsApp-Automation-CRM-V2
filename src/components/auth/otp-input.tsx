"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Six-box OTP input. `value` stays a single string so callers are unchanged. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = false,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const focusAt = (index: number) => {
    const target = Math.max(0, Math.min(length - 1, index));
    const el = refs.current[target];
    el?.focus();
    el?.select();
  };

  const writeChar = (index: number, digit: string) => {
    const next = Array.from({ length }, (_, i) => value[i] ?? "");
    next[index] = digit;
    onChange(next.join(""));
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      writeChar(index, "");
      return;
    }
    if (digits.length > 1) {
      onChange(digits.slice(0, length));
      focusAt(Math.min(digits.length, length) - 1);
      return;
    }
    writeChar(index, digits);
    focusAt(index + 1);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (chars[index]) {
        writeChar(index, "");
        return;
      }
      writeChar(index - 1, "");
      focusAt(index - 1);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-2"
      onPaste={(e) => {
        const digits = e.clipboardData.getData("text").replace(/\D/g, "");
        if (!digits) return;
        e.preventDefault();
        onChange(digits.slice(0, length));
        focusAt(Math.min(digits.length, length) - 1);
      }}
    >
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={char}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          aria-label={`OTP digit ${i + 1}`}
          className={cn(
            "size-11 shrink-0 rounded-xl border border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-center text-[17px] font-extrabold tabular-nums text-[var(--m-text-primary)] outline-none transition-all duration-200",
            "focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20",
            char && "border-emerald-500/40 bg-emerald-500/8",
            disabled && "cursor-not-allowed opacity-50"
          )}
        />
      ))}
    </div>
  );
}
