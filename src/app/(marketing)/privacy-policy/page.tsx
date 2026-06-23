"use client";

import React from "react";
import { Shield } from "lucide-react";

export default function PrivacyPolicyPage() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Shield className="size-3" /> Legal Document
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">Last updated: June 23, 2026</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          This Privacy Policy (the &quot;Policy&quot;) describes how ChatNexGen Technologies (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, maintains, and discloses information from users of our Platform. By accessing or using the ChatNexGen SaaS platform, you consent to the practices described in this Policy. If you do not agree, please do not use the Platform.
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">1. User Data Collection</h3>
          <p>
            We collect personal details that you provide directly to us during registration, setup, and support inquiries. This may include:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>Your name, company name, billing address, and account details.</li>
            <li>Email address (e.g., support details, correspondence logs).</li>
            <li>WhatsApp Business Account (WABA) numbers and integration tokens.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">2. CRM Data Storage</h3>
          <p>
            All contact details, tags, logs, custom fields, and conversation histories uploaded or generated within the CRM dashboard are stored securely on our database. We employ advanced hosting architecture to ensure data isolation, high availability, and routine encrypted backups. Your customer records remain your property, and we act strictly as data processors for this information.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">3. WhatsApp Communication</h3>
          <p>
            To facilitate communications through the WhatsApp Business API, we transmit messaging payloads (text templates, quick-reply responses, dynamic variables, and rich media assets) directly to Meta's servers. These communications comply fully with the WhatsApp Business Platform policies. We do not inspect message contents except as technically required to render the service, trigger workflows, or debug API performance.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">4. Cookies & Tracking Technologies</h3>
          <p>
            We utilize persistent and session cookies to recognize authenticated user sessions, store dashboard configuration preferences, and monitor platform stability. You may opt to disable cookies in your browser settings, though doing so might affect platform performance and prevent access to certain interactive services.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">5. Analytics & Usage Metrics</h3>
          <p>
            To maintain high-quality uptime and diagnose performance anomalies, we track system parameters, browser types, log events, and screen interactions. These analytics help us optimize loading times, evaluate user flow effectiveness, and security-audit suspicious logins.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">6. Security Practices</h3>
          <p>
            Security is central to the ChatNexGen architecture. All data transfers between the browser and our servers are encrypted using TLS 1.3 (HTTPS). Core databases are isolated, and payment transactions are offloaded entirely to PCI-DSS compliant third-party payment gateways (e.g., Razorpay).
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">7. User Rights & Data Portability</h3>
          <p>
            Under relevant data protection regulations (including GDPR and Indian IT policies), you retain the right to request access to, correction of, or portable exportation of the personal information stored in your account. To retrieve your data files, contact our compliance officer.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">8. Data Deletion Requests</h3>
          <p>
            You may request complete and permanent deletion of your profile, CRM contact records, and metadata history at any time. Refer to our dynamic <a href="/data-deletion" className="text-emerald-400 hover:underline">Data Deletion Instructions</a> page or email our support desk. Upon validation, deletion is processed within 7 business days.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">9. Third-Party Integrations</h3>
          <p>
            ChatNexGen integrates with third-party software (such as e-commerce systems, spreadsheet tools, and messaging networks). We are not responsible for the privacy policies of these external platforms. We advise checking their independent terms before configuring webhook endpoints or sync permissions.
          </p>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">10. Contact & Regulatory Information</h3>
          <p>
            For questions or requests regarding your data, contact ChatNexGen Technologies:
          </p>
          <div className="text-xs text-[var(--m-text-tertiary)] mt-3 space-y-1">
            <p className="font-bold text-[var(--m-text-primary)]">ChatNexGen Technologies</p>
            <p>Compliance Department</p>
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
