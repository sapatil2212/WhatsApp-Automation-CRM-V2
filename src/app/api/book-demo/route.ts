import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

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

      const formattedFrom = smtpFrom.includes("<") ? smtpFrom : `ChatNexGen <${smtpFrom}>`;

      // 1. Confirmation Email to the user booking the demo
      const userMailOptions = {
        from: formattedFrom,
        to: email,
        subject: "ChatNexGen Product Demo Confirmed!",
        text: `Hi ${name},\n\nYour ChatNexGen product walkthrough has been scheduled for ${date} at ${time}.\n\nMeeting link: Google Meet (the link will be attached to your calendar invite).\n\nBest regards,\nThe ChatNexGen Team`,
        html: `
          <div style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-height: 100%;">
            <div style="max-width: 460px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 24px;">
                <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Chat<span style="color: #10b981;">NexGen</span></span>
              </div>
              
              <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">Walkthrough Confirmed</h2>
              
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 20px;">
                Hi <strong>${name}</strong>,<br>Your product walkthrough has been successfully booked. Here are your details:
              </p>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px; margin-bottom: 24px; font-size: 14px; line-height: 1.6; text-align: left; max-width: 320px; margin-left: auto; margin-right: auto; color: #334155;">
                <div style="margin-bottom: 8px;"><strong>Date:</strong> ${date}</div>
                <div style="margin-bottom: 8px;"><strong>Time Slot:</strong> ${time}</div>
                <div style="margin: 0;"><strong>Location:</strong> Google Meet (invite attached to calendar)</div>
              </div>
              
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 0; margin-bottom: 24px;">
                If you need to reschedule or have any questions, please reply directly to this email.
              </p>
              
              <p style="font-size: 12px; color: #94a3b8; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                Best regards,<br>The ChatNexGen Team
              </p>
            </div>
          </div>
        `,
      };

      // 2. Notification Email to the Super Admin
      const adminMailOptions = {
        from: formattedFrom,
        to: superAdmin,
        subject: `New Demo Walkthrough Booked: ${name}`,
        text: `New ChatNexGen product demo booking.\n\nDetails:\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nSlot: ${date} at ${time}`,
        html: `
          <div style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-height: 100%;">
            <div style="max-width: 460px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
              <div style="text-align: center; margin-bottom: 24px;">
                <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Chat<span style="color: #10b981;">NexGen</span></span>
                <h2 style="font-size: 20px; font-weight: 700; color: #4f46e5; margin-top: 8px; margin-bottom: 0;">New Demo Booking</h2>
              </div>
              
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 20px; text-align: center;">
                A client has scheduled a ChatNexGen product walkthrough. Lead details:
              </p>
              
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: bold; width: 120px;">Name:</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 500; color: #0f172a;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: bold;">Email:</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 500;"><a href="mailto:${email}" style="color: #4f46e5; text-decoration: none;">${email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: bold;">Phone Number:</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 500; color: #0f172a;">${phone}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: bold;">Date:</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 500; color: #0f172a;">${date}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: bold;">Time Slot:</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 500; color: #10b981;">${time}</td>
                </tr>
              </table>
              
              <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 20px;">
                ChatNexGen Notification Engine
              </p>
            </div>
          </div>
        `,
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
