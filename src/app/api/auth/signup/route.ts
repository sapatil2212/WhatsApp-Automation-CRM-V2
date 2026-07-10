import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, businessName, businessType, phoneNumber, selectedPlan } = await req.json()

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })
    
    if (existingUser) {
      // If the existing user is unverified and the OTP has expired, delete them so they can signup again
      if (
        !existingUser.isVerified &&
        existingUser.verificationTokenExpiry &&
        existingUser.verificationTokenExpiry < new Date()
      ) {
        console.log(`[signup] Deleting expired unverified user: ${email}`)
        await prisma.user.delete({
          where: { id: existingUser.id }
        })
      } else {
        return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 })
      }
    }

    // 2. Hash password
    const passwordHash = await hashPassword(password)

    // 3. Create database records in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 3.0. Generate 6-digit OTP code and expiry
      const otpCode = crypto.randomInt(100000, 999999).toString()
      const verificationTokenExpiry = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

      // 3.1. Create User
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'tenant_admin', // First user is the admin/owner of the tenant
          verificationToken: otpCode,
          verificationTokenExpiry,
          isVerified: false,
          isEmailVerified: false,
          selectedPlan: selectedPlan || 'starter'
        }
      })

      // 3.2. Create Tenant
      const tenantName = businessName || `${fullName}'s Organization`
      let slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      slug = `${slug}-${user.id.substring(0, 8)}`

      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug,
          ownerUserId: user.id,
          settings: {}
        }
      })

      // 3.3. Create Default Workspace
      const workspace = await tx.workspace.create({
        data: {
          tenantId: tenant.id,
          name: 'Default Workspace',
          slug: 'default',
          settings: {},
          isDefault: true
        }
      })

      // 3.4. Seed System Roles for the Tenant
      const rolesToCreate = [
        { name: 'owner', description: 'Full access to all features', permissions: ['*'], isSystem: true },
        { name: 'admin', description: 'Administrative access', permissions: ['inbox:*', 'contacts:*', 'broadcasts:*', 'automations:*', 'flows:*', 'pipelines:*', 'settings:*', 'members:manage', 'analytics:*', 'templates:*', 'healthcare:*'], isSystem: true },
        { name: 'manager', description: 'Team management access', permissions: ['inbox:*', 'contacts:*', 'broadcasts:*', 'automations:view', 'flows:view', 'pipelines:*', 'analytics:view', 'templates:*'], isSystem: true },
        { name: 'agent', description: 'Inbox and contact access', permissions: ['inbox:view', 'inbox:reply', 'contacts:view', 'contacts:edit', 'pipelines:view', 'templates:view'], isSystem: true },
        { name: 'doctor', description: 'Healthcare provider access', permissions: ['inbox:view', 'inbox:reply', 'contacts:view', 'healthcare:*', 'analytics:view'], isSystem: true },
        { name: 'receptionist', description: 'Front desk access', permissions: ['inbox:view', 'inbox:reply', 'contacts:*', 'healthcare:appointments', 'analytics:view'], isSystem: true }
      ]

      await tx.role.createMany({
        data: rolesToCreate.map(r => ({
          tenantId: tenant.id,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          isSystem: r.isSystem
        }))
      })

      // Fetch the owner role to associate member
      const ownerRole = await tx.role.findFirstOrThrow({
        where: { tenantId: tenant.id, name: 'owner' }
      })

      // 3.5. Create Workspace Member
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          roleId: ownerRole.id,
          status: 'active'
        }
      })

      // 3.6. Create User Profile
      const profile = await tx.profile.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          fullName,
          email,
          role: 'tenant_admin',
          businessName,
          businessType,
          phoneNumber,
          betaFeatures: []
        } as any
      })

      // 3.7. Create Tenant Configuration
      await tx.tenantConfiguration.create({
        data: {
          tenantId: tenant.id
        }
      })

      return { user, tenant, profile }
    })

    // 4. Send Verification Email with 6-digit OTP
    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
    const smtpBcc = cleanEnv(process.env.EMAIL_BCC);

    const otpCode = result.user.verificationToken!

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
            body {
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
              background-color: #f8fafc;
              color: #0f172a;
              margin: 0;
              padding: 0;
              text-align: center;
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background-color: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 40px 30px;
              text-align: center;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            }
            .logo-text {
              font-size: 24px;
              font-weight: 800;
              color: #4f46e5;
              margin-bottom: 25px;
              letter-spacing: -0.025em;
              display: inline-block;
            }
            h1 {
              font-size: 24px;
              font-weight: 700;
              color: #0f172a;
              margin: 0 0 10px 0;
              line-height: 1.3;
            }
            p.subtitle {
              font-size: 15px;
              color: #475569;
              margin: 0 0 30px 0;
              line-height: 1.5;
            }
            .divider {
              height: 1px;
              background-color: #e2e8f0;
              margin: 30px 0;
            }
            .otp-code {
              display: inline-block;
              font-size: 32px;
              font-weight: 800;
              color: #059669;
              letter-spacing: 0.15em;
              background-color: #f1f5f9;
              border: 1px dashed #10b981;
              border-radius: 8px;
              padding: 12px 24px;
              margin: 20px 0;
            }
            p.body-text {
              font-size: 14px;
              color: #334155;
              margin: 0 0 30px 0;
              line-height: 1.6;
            }
            .footer {
              font-size: 12px;
              color: #64748b;
              line-height: 1.5;
            }
            .footer a {
              color: #059669;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo-text">ChatNexGen</div>
            <h1>Verify Your ChatNexGen Account</h1>
            <p class="subtitle">Please use the 6-digit OTP code below to complete your signup.</p>
            <div class="divider"></div>
            <div class="otp-code">${otpCode}</div>
            <p class="body-text">
              This code is valid for <strong>5 minutes</strong>. If you did not request this, please ignore this email.
            </p>
            <div class="divider"></div>
            <p class="footer">
              This is an automated verification email from ChatNexGen.<br>
              Need help? Reach out at <a href="mailto:chatnexgen@gmail.com">chatnexgen@gmail.com</a>.
            </p>
          </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
          from: `"ChatNexGen Support" <${smtpUser}>`,
          to: email,
          bcc: smtpBcc || undefined,
          subject: "Verify your ChatNexGen Account",
          text: `Your verification code is: ${otpCode}. It is valid for 5 minutes.`,
          html: htmlContent
        });
        console.log(`[SMTP SIGNUP] OTP verification email sent to ${email}`);
      } catch (mailErr: any) {
        console.error('[signup] Error sending verification email:', mailErr.message || mailErr)
      }
    } else {
      console.warn("SMTP settings are not configured. Falling back to mock console output.");
      console.log(`[SMTP MOCK SIGNUP] OTP code for ${email}: ${otpCode}`);
    }

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        profile: {
          id: result.profile.id,
          fullName: result.profile.fullName,
          tenantId: result.profile.tenantId,
          businessName: result.profile.businessName,
          businessType: result.profile.businessType,
          phoneNumber: (result.profile as any).phoneNumber
        }
      }
    }, { status: 201 })

  } catch (error: any) {
    console.error('[signup] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
