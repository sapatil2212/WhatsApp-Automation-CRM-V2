const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 3002;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Periodically clean up unverified users whose OTP has expired (runs every 1 minute)
  setInterval(async () => {
    try {
      const now = new Date();
      // Find expired unverified users first
      const expiredUsers = await prisma.user.findMany({
        where: {
          isVerified: false,
          verificationTokenExpiry: { lt: now }
        },
        select: { id: true }
      });

      if (expiredUsers.length === 0) return;

      const ids = expiredUsers.map(u => u.id);

      // Delete dependent rows first to avoid FK constraint errors
      const tenantIds = (await prisma.tenant.findMany({
        where: { ownerUserId: { in: ids } },
        select: { id: true }
      })).map(t => t.id);

      if (tenantIds.length > 0) {
        await prisma.workspaceMember.deleteMany({
          where: {
            workspace: {
              tenantId: { in: tenantIds }
            }
          }
        });
      }

      await prisma.workspaceMember.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });

      // Now delete the users (cascade will handle other relations)
      const deleted = await prisma.user.deleteMany({
        where: { id: { in: ids } }
      });

      if (deleted.count > 0) {
        console.log(`[Cleanup Job] Purged ${deleted.count} expired unverified users.`);
      }
    } catch (err) {
      console.error("[Cleanup Job] Error cleaning up expired unverified users:", err.message || err);
    }
  }, 60 * 1000); // 1 minute

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    console.log("[Socket.io] Client connected:", socket.id);

    // Clients call 'join-tenant' upon authentication to join their isolated room
    socket.on("join-tenant", (tenantId) => {
      if (tenantId) {
        socket.join(tenantId);
        console.log(`[Socket.io] Socket ${socket.id} joined room for tenantId: ${tenantId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log("[Socket.io] Client disconnected:", socket.id);
    });
  });

  // Expose Socket.io instance globally so Next.js Route Handlers can trigger realtime events
  global.io = io;

  httpServer.once("error", (err) => {
    console.error("[Socket.io] Server error:", err);
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.log(`> [Socket.io] Ready on http://${hostname}:${port}`);
  });
});
