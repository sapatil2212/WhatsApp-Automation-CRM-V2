import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and verification code are required' }, { status: 400 })
    }

    // Find user with this email
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      include: { profile: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User registration not found or expired' }, { status: 404 })
    }

    // If already verified, return error
    if (user.isVerified) {
      return NextResponse.json({ error: 'User is already verified and active.' }, { status: 400 })
    }

    // Check code
    if (user.verificationToken !== code) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
    }

    // Check expiry
    if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
      // Purge the unverified user
      console.log(`[verify] Purging expired unverified user: ${email}`)
      await prisma.user.delete({
        where: { id: user.id }
      })
      return NextResponse.json({
        error: 'Verification code expired. Your registration has been cancelled. Please sign up again.'
      }, { status: 400 })
    }

    // Mark email as verified, but isVerified remains false until super-admin approves
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      }
    })

    // Notify Super Admin via Email
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const superAdminEmail = process.env.SUPER_ADMIN_USERNAME || 'test@gmail.com'
    const approveUrl = `${siteUrl}/api/super-admin/approve?userId=${user.id}`

    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);

    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; }
            h2 { color: #4f46e5; margin-top: 0; }
            .detail-row { display: flex; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
            .detail-label { font-weight: bold; width: 150px; color: #475569; }
            .detail-val { color: #0f172a; }
            .btn { display: inline-block; background-color: #10b981; color: #ffffff !important; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 24px; border-radius: 8px; margin-top: 20px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>New User Registration Awaiting Payment & Approval</h2>
            <p>A new tenant has registered, completed OTP email verification, and requires payment review:</p>
            
            <div class="detail-row">
              <div class="detail-label">Name:</div>
              <div class="detail-val">${user.profile?.fullName || 'N/A'}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Email:</div>
              <div class="detail-val">${user.email}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Phone:</div>
              <div class="detail-val">${(user.profile as any)?.phoneNumber || 'N/A'}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Selected Plan:</div>
              <div class="detail-val" style="text-transform: uppercase; font-weight: bold; color: #059669;">${user.selectedPlan || 'starter'}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Business Name:</div>
              <div class="detail-val">${user.profile?.businessName || 'N/A'}</div>
            </div>

            <a href="${approveUrl}" class="btn">Approve Access & Activate Subscription</a>
            
            <p style="font-size: 12px; color: #64748b; margin-top: 30px;">
              You can also approve this user from the "New Users" menu inside the Super Admin Dashboard.
            </p>
          </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
          from: `"ChatNexGen Notification" <${smtpUser}>`,
          to: superAdminEmail,
          subject: `🔔 New User Awaiting Approval: ${user.profile?.fullName || user.email}`,
          text: `A new user has registered and is awaiting approval: ${user.email}. Selected plan: ${user.selectedPlan || 'starter'}. Approve here: ${approveUrl}`,
          html: htmlContent
        });
        console.log(`[SMTP] Registration approval notification sent to admin for ${email}`);
      } catch (mailErr: any) {
        console.error('[verify] Error sending notification email to admin:', mailErr.message || mailErr)
      }
    } else {
      console.warn("SMTP settings not configured. Logging admin verification link below:");
      console.log(`[VERIFY MOCK] Admin approval link: ${approveUrl}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Email OTP code verified successfully. Please proceed to payment step.',
      userId: updatedUser.id,
      email: updatedUser.email
    })

  } catch (error: any) {
    console.error('[verify] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
