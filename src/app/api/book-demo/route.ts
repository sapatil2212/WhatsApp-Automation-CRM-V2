import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailDetails } from "@/lib/email/template";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, date, time } = await req.json();

    if (!name || !email || !phone || !date || !time) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const superAdmin = process.env.SUPER_ADMIN_USERNAME || "chatnexgen@gmail.com";

    // Setup SMTP Transporter
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || "chatnexgen@gmail.com";

    // Developer Fallback: Log demo booking details to terminal console
    console.log(`
\n=== [NEW DEMO BOOKING REGISTERED] ===
Customer: ${name} (${email})
Phone:    ${phone}
Slot:     ${date} at ${time}
Notification sent to Super Admin: ${superAdmin}
======================================\n
    `);

    if (smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      // 1. Confirmation Email to the user booking the demo
      const userMailOptions = {
        from: smtpFrom,
        to: email,
        subject: "ChatNexGen Product Demo Confirmed!",
        text: `Hi ${name},\n\nYour ChatNexGen product walkthrough has been scheduled for ${date} at ${time}.\n\nMeeting link: Google Meet (the link will be attached to your calendar invite).\n\nBest regards,\nThe ChatNexGen Team`,
        html: emailLayout({
          title: "Your ChatNexGen demo is confirmed",
          preview: `Your demo is booked for ${date} at ${time}`,
          center: false,
          contentHtml:
            emailHeading("Demo confirmed 🎉") +
            emailSubtitle(`Hi ${name}, your product walkthrough is booked. Here are your details:`) +
            emailDetails([
              { label: "Date", value: date },
              { label: "Time slot", value: time, highlight: true },
              { label: "Location", value: "Google Meet (invite attached to calendar)" },
            ]) +
            emailText("Need to reschedule or have questions? Just reply to this email.", { size: 12 }),
        }),
      };

      // 2. Notification Email to the Super Admin
      const adminMailOptions = {
        from: smtpFrom,
        to: superAdmin,
        subject: `New Demo Walkthrough Booked: ${name}`,
        text: `New ChatNexGen product demo booking.\n\nDetails:\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nSlot: ${date} at ${time}`,
        html: emailLayout({
          title: "New demo booking",
          preview: `${name} booked a demo for ${date} at ${time}`,
          center: false,
          contentHtml:
            emailHeading("New demo booking") +
            emailSubtitle("A client scheduled a ChatNexGen product walkthrough. Lead details:") +
            emailDetails([
              { label: "Name", value: name },
              { label: "Email", value: `<a href="mailto:${email}" style="color:#059669;text-decoration:none;">${email}</a>` },
              { label: "Phone", value: phone },
              { label: "Date", value: date },
              { label: "Time slot", value: time, highlight: true },
            ]),
        }),
      };

      try {
        await Promise.all([
          transporter.sendMail(userMailOptions),
          transporter.sendMail(adminMailOptions),
        ]);
      } catch (mailErr: any) {
        console.error("Failed to send demo emails:", mailErr);
        // Do not block user in development if SMTP details fail
        if (process.env.NODE_ENV === "development") {
          return NextResponse.json({ 
            success: true, 
            note: "SMTP send failed, but booking logged locally." 
          });
        }
        return NextResponse.json({ error: `SMTP Send Error: ${mailErr.message || mailErr}` }, { status: 500 });
      }
    } else {
      if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "SMTP host not configured on backend." }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Book demo backend error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
