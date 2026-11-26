import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import crypto from 'crypto'
import { sendSystemEmail } from '@/lib/email/smtp'
import { emailLayout, emailHeading, emailSubtitle, emailOtp, emailText, emailTokens } from '@/lib/email/template'

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, businessName, businessType, phoneNumber, selectedPlan } = await req.json()

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: !email ? 'Enter your email.' : !password ? 'Create a password.' : 'Enter your name.', field: !email ? 'email' : !password ? 'password' : 'fullName' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.', field: 'password' }, { status: 400 })
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
        return NextResponse.json({ error: 'An account with this email already exists.', field: 'email', code: 'email_taken' }, { status: 409 })
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
    const otpCode = result.user.verificationToken!

    const htmlContent = emailLayout({
      title: "Verify your ChatNexGen account",
      preview: `Your verification code is ${otpCode}`,
      contentHtml:
        emailHeading("Verify your account") +
        emailSubtitle("Use the 6-digit code below to complete your signup.") +
        emailOtp(otpCode) +
        emailText(
          "This code is valid for <strong>5 minutes</strong>. If you didn't request this, you can safely ignore this email.",
          { size: 12, color: emailTokens.muted }
        ),
    });

    sendSystemEmail({
      to: email,
      subject: "Verify your ChatNexGen Account",
      text: `Your verification code is: ${otpCode}. It is valid for 5 minutes.`,
      html: htmlContent,
    })
      .then(() => {
        console.log(`[SMTP SIGNUP] OTP verification email sent to ${email}`);
      })
      .catch((mailErr: any) => {
        console.error('[signup] Error sending verification email:', mailErr?.message || mailErr);
      });

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
