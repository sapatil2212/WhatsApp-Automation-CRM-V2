import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cleanEnvValue(v?: string): string {
  return (v || "").replace(/^["']|["']$/g, "").trim()
}
