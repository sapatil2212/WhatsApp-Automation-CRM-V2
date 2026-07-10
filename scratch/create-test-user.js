const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = "test@gmail.com";
  const password = "123";

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: { profile: true }
  });

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  if (existingUser) {
    console.log("User already exists. Updating to be verified with password '123'...");
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash,
        isVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      }
    });
    console.log("User updated successfully.");
    return;
  }

  console.log("Creating new verified user 'test@gmail.com' with password '123'...");
  await prisma.$transaction(async (tx) => {
    // Create User
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "tenant_admin",
        isVerified: true
      }
    });

    // Create Tenant
    const tenantName = "Test organization";
    const slug = `test-org-${user.id.substring(0, 8)}`;
    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        slug,
        ownerUserId: user.id,
        settings: {}
      }
    });

    // Create Default Workspace
    const workspace = await tx.workspace.create({
      data: {
        tenantId: tenant.id,
        name: "Default Workspace",
        slug: "default",
        settings: {},
        isDefault: true
      }
    });

    // Seed System Roles for the Tenant
    const rolesToCreate = [
      { name: "owner", description: "Full access to all features", permissions: ["*"], isSystem: true },
      { name: "admin", description: "Administrative access", permissions: ["*"], isSystem: true }
    ];

    await tx.role.createMany({
      data: rolesToCreate.map(r => ({
        tenantId: tenant.id,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: r.isSystem
      }))
    });

    const ownerRole = await tx.role.findFirstOrThrow({
      where: { tenantId: tenant.id, name: "owner" }
    });

    // Create Workspace Member
    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        roleId: ownerRole.id,
        status: "active"
      }
    });

    // Create User Profile
    await tx.profile.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        fullName: "Test User",
        email,
        role: "tenant_admin",
        businessName: "Test Business",
        businessType: "Technology",
        phoneNumber: "1234567890",
        betaFeatures: []
      }
    });

    // Create Tenant Configuration
    await tx.tenantConfiguration.create({
      data: {
        tenantId: tenant.id
      }
    });

    console.log("Successfully created user, tenant, workspace, roles, and profile!");
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
