import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailDetails } from "@/lib/email/template";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, msg, message } = await req.json();
    const inquiryMessage = msg || message;

    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
    }

    const superAdmin = process.env.SUPER_ADMIN_USERNAME || "support@chatnexgen.online";

    console.log(`
=== [NEW CONTACT INQUIRY RECEIVED] ===
Name:    ${name}
Email:   ${email}
Phone:   ${phone || "Not provided"}
Message: ${inquiryMessage || "No message body"}
Target:  Brightwave Digital Products LLP (${superAdmin})
======================================
    `);

    // Setup SMTP Transporter if credentials available
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || "support@chatnexgen.online";

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

      // Email notification to Admin
      await transporter.sendMail({
        from: smtpFrom,
        to: superAdmin,
        subject: `[Contact Form] New Inquiry from ${name}`,
        text: `New contact inquiry received:\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone || "N/A"}\nMessage:\n${inquiryMessage}`,
      }).catch(err => console.error("[Contact Admin Email Error]", err));

      // Auto-acknowledgment email to the user
      await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: "We received your message — ChatNexGen",
        text: `Hi ${name},\n\nThank you for reaching out to ChatNexGen (operated by Brightwave Digital Products LLP). We have received your inquiry and our team will get back to you shortly.\n\nBest regards,\nBrightwave Digital Products LLP / ChatNexGen Support`,
        html: emailLayout({
          title: "We received your inquiry",
          preview: "Thank you for contacting ChatNexGen",
          center: false,
          contentHtml:
            emailHeading("Message received") +
            emailSubtitle(`Hi ${name}, thank you for reaching out to ChatNexGen.`) +
            emailText("Our business operations team at Brightwave Digital Products LLP has received your request and will follow up with you within 1 business day.") +
            emailDetails([
              { label: "Your Email", value: email },
              { label: "Phone", value: phone || "Not provided" },
              { label: "Operating Entity", value: "Brightwave Digital Products LLP" },
            ]),
        }),
      }).catch(err => console.error("[Contact User Ack Email Error]", err));
    }

    return NextResponse.json({ success: true, message: "Inquiry submitted successfully." });
  } catch (error: any) {
    console.error("[Contact API Error]", error);
    return NextResponse.json({ error: "Failed to submit inquiry. Please try again." }, { status: 500 });
  }
}
