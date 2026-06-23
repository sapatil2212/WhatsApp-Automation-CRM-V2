"use client";

import React from "react";
import { Scale } from "lucide-react";

export default function TermsAndConditionsPage() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Scale className="size-3" /> Legal Document
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          Terms & Conditions
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">Last updated: June 23, 2026</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          Welcome to ChatNexGen. These Terms & Conditions (&quot;Terms&quot;) govern your access to and use of the website, SaaS dashboard, automation engines, APIs, and customer relationship interfaces provided by ChatNexGen Technologies (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). By subscribing to or utilizing our Platform, you agree to comply with and be bound by these Terms.
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">1. SaaS Subscription & Billing</h3>
          <p>
            Subscribing to ChatNexGen grants your business a non-exclusive, non-transferable, revocable license to access our platform services.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>Subscriptions are billed monthly or annually in advance based on the plan selected.</li>
            <li>Setup fees (if applicable) and custom configuration/consulting fees are collected prior to service provisioning.</li>
            <li>Failure to pay active subscription invoices will result in account lockout and eventual data purge.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">2. User Responsibilities & Acceptable Use</h3>
          <p>
            You agree to use ChatNexGen only for lawful business operations and in absolute compliance with local, national, and international laws.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>You must verify and manage the permissions of any team member added to your workspace.</li>
            <li>You are responsible for obtaining explicit opt-in consent from end-users/customers before messaging them.</li>
            <li>You are prohibited from using this Platform to distribute spam, fraudulent deals, threat messages, or unsolicited marketing material.</li>
            <li>You must not reverse engineer, decompile, or attempt to disrupt the performance of our SaaS nodes.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">3. Meta & WhatsApp Policy Compliance</h3>
          <p>
            ChatNexGen operates using the official WhatsApp Business API provided by Meta. All customers must comply with Meta's developer policies and WhatsApp Business Platform guidelines.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>You represent that your business profile, logos, and links submitted for verification are authentic.</li>
            <li>Bulk blasting, automated message bombing, and scrapers are strictly prohibited.</li>
            <li>You agree to comply with WhatsApp's template pre-approval workflows.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">4. Account Suspension & Termination</h3>
          <p>
            We reserve the right to suspend or permanently terminate your workspace access, without refund, under the following circumstances:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>Detection of unauthorized bulk messaging or automated spam reports from WhatsApp users.</li>
            <li>Suspension or termination of your WhatsApp Business Account (WABA) by Meta due to policy violations.</li>
            <li>Non-compliance with acceptable usage policies or local governing regulations.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">5. Intellectual Property</h3>
          <p>
            All technology, graphic user interfaces, chatbot designs, workflow visualizations, logos, and custom code modules remain the exclusive intellectual property of ChatNexGen Technologies or its licensors. You may not distribute or copy any portion of our software.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">6. Service Limitations & Disclaimers</h3>
          <p>
            ChatNexGen is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis. While we maintain a high standard of platform stability, we do not warrant that service will be uninterrupted.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>We are not responsible for delivery delays or downtime caused directly by Meta/WhatsApp API node failures.</li>
            <li>We do not control client carrier connections or recipient network coverage.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">7. Governing Law & Jurisdiction</h3>
          <p>
            These Terms and any dispute arising from the use of this Platform shall be governed by, interpreted, and enforced in accordance with the laws of **India**. Any disputes shall be subject to the exclusive jurisdiction of the courts located in **Pune, Maharashtra, India**.
          </p>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">8. Contact Us</h3>
          <p>
            If you have questions regarding these Terms & Conditions, contact ChatNexGen Technologies:
          </p>
          <div className="text-xs text-[var(--m-text-tertiary)] mt-3 space-y-1">
            <p className="font-bold text-[var(--m-text-primary)]">ChatNexGen Technologies</p>
            <p>Pune, Maharashtra, India</p>
            <p>
              Email: <a href="mailto:chatnexgen@gmail.com" className="text-emerald-400 hover:underline">chatnexgen@gmail.com</a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
