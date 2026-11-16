"use client";

import React, { useState, useMemo } from "react";
import { Sparkles, Calendar, Clock, Video, CheckCircle, User, Mail, Phone, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const slots = ["10:00 AM", "11:30 AM", "2:00 PM", "3:30 PM", "5:00 PM"];

export default function BookDemoPage() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Generate 6 upcoming business days dynamically
  const dates = useMemo(() => {
    const list = [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const stdMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const current = new Date();
    if (current.getHours() >= 17) {
      current.setDate(current.getDate() + 1);
    }
    
    while (list.length < 6) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dayName = days[dayOfWeek];
        const monthName = stdMonths[current.getMonth()];
        const dateNum = current.getDate();
        const year = current.getFullYear();
        
        const label = `${dayName}, ${monthName} ${dateNum}`;
        const val = `${year}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
        list.push({ label, val });
      }
      current.setDate(current.getDate() + 1);
    }
    return list;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime || !name || !email || !phone) {
      setError("Please select a date, time slot, and fill all contact fields.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/book-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          date: selectedDate,
          time: selectedTime,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to schedule walkthrough. Please try again.");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
      {/* Description Column */}
      <div className="space-y-6 lg:sticky lg:top-24">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3.5" /> 1-on-1 walkthrough
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
          Book a Live <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Product Walkthrough.
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
          Schedule a live screen-share with a technical specialist from Brightwave Digital Products LLP. Learn how to configure your Meta WhatsApp Cloud API credentials, test automated response workflows, and organize customer conversations.
        </p>

        {/* Video details */}
        <div className="space-y-3.5 border-t border-[var(--m-border-primary)] pt-6 mt-6">
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Clock className="size-4 text-emerald-400 shrink-0" />
            <span>30-minute tailored walkthrough</span>
          </div>
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Video className="size-4 text-teal-400 shrink-0" />
            <span>Live Google Meet session</span>
          </div>
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Calendar className="size-4 text-emerald-400 shrink-0" />
            <span>Dedicated engineer support from Brightwave Digital Products LLP (India)</span>
          </div>
        </div>
      </div>

      {/* Scheduler Widget Column */}
      <div className="relative">
        <div className="absolute inset-0 bg-emerald-500/5 blur-[95px] pointer-events-none" />

        {success ? (
          <Card className="border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-8 backdrop-blur text-center relative z-10 shadow-2xl">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
                <CheckCircle className="size-6" />
              </div>
              <h3 className="text-xl font-bold text-[var(--m-text-heading)]">Consultation Confirmed!</h3>
              <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-sm mx-auto">
                Thank you, <strong className="text-[var(--m-text-primary)]">{name}</strong>! Your walkthrough has been confirmed for <strong className="text-emerald-400">{selectedDate}</strong> at <strong className="text-emerald-400">{selectedTime}</strong>. A calendar invite with Google Meet details has been dispatched to {email}.
              </p>
              <div className="pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSuccess(false);
                    setSelectedDate(null);
                    setSelectedTime(null);
                    setName("");
                    setEmail("");
                    setPhone("");
                  }}
                  className="text-xs border-[var(--m-border-primary)]"
                >
                  Schedule Another Time
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-6 backdrop-blur relative z-10 shadow-2xl space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="size-4.5 text-emerald-400" />
              <span className="text-xs font-bold text-[var(--m-text-secondary)]">Choose Date &amp; Time</span>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            {/* Date Select Grid */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-[var(--m-text-muted)]">Available Dates</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {dates.map((d) => (
                  <button
                    type="button"
                    key={d.val}
                    onClick={() => setSelectedDate(d.label)}
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      selectedDate === d.label
                        ? "bg-[var(--m-bg-secondary)] border-emerald-500/50 text-emerald-400"
                        : "bg-[var(--m-bg-card)] border-[var(--m-border-glass)] text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time Select Grid */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-[var(--m-text-muted)]">Select Time Slot (IST)</span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {slots.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setSelectedTime(s)}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      selectedTime === s
                        ? "bg-[var(--m-bg-secondary)] border-emerald-500/50 text-emerald-400"
                        : "bg-[var(--m-bg-card)] border-[var(--m-border-glass)] text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* User Details */}
            <div className="border-t border-[var(--m-border-primary)] pt-5 space-y-3.5">
              <span className="text-[10px] uppercase font-bold text-[var(--m-text-muted)] block">Your Contact Information</span>

              <div className="space-y-1.5">
                <Label htmlFor="demo-name" className="text-xs text-[var(--m-text-tertiary)]">Full Name</Label>
                <div className="relative">
                  <User className="size-3.5 text-[var(--m-text-muted)] absolute left-3 top-3" />
                  <Input
                    id="demo-name"
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="pl-9 text-xs h-9 bg-[var(--m-input-bg)] border-[var(--m-input-border)] text-[var(--m-text-primary)]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="demo-email" className="text-xs text-[var(--m-text-tertiary)]">Work Email</Label>
                <div className="relative">
                  <Mail className="size-3.5 text-[var(--m-text-muted)] absolute left-3 top-3" />
                  <Input
                    id="demo-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-9 text-xs h-9 bg-[var(--m-input-bg)] border-[var(--m-input-border)] text-[var(--m-text-primary)]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="demo-phone" className="text-xs text-[var(--m-text-tertiary)]">WhatsApp Number</Label>
                <div className="relative">
                  <Phone className="size-3.5 text-[var(--m-text-muted)] absolute left-3 top-3" />
                  <Input
                    id="demo-phone"
                    type="tel"
                    placeholder="+91 99999 99999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="pl-9 text-xs h-9 bg-[var(--m-input-bg)] border-[var(--m-input-border)] text-[var(--m-text-primary)]"
                  />
                </div>
              </div>
            </div>

            {/* Confirm button */}
            <Button
              type="submit"
              disabled={loading || !selectedDate || !selectedTime}
              className="w-full h-10 bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center transition-colors hover:bg-emerald-400 cursor-pointer shadow-[0_0_12px_rgba(16,185,129,0.2)] disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-2" /> Booking Walkthrough...
                </>
              ) : (
                "Confirm Walkthrough Session"
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
