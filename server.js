const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 3002;
// In development, Turbopack on Windows has a known junction point bug with Prisma (os error 80).
// Using webpack on Windows avoids junction point collisions and prevents 500/404 HTML errors on API routes.
const isWindows = process.platform === "win32";
const app = next({ 
  dev, 
  hostname, 
  port,
  ...(dev && isWindows ? { webpack: true } : {})
});
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

  const allowedOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
  ].filter(Boolean);

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, server-to-server) or in development
        if (!origin || dev) {
          return callback(null, true);
        }
        if (allowedOrigins.some((allowed) => origin === allowed || origin.startsWith(allowed))) {
          return callback(null, true);
        }
        return callback(new Error("[Socket.io] CORS policy violation: origin not allowed"), false);
      },
      methods: ["GET", "POST"],
      credentials: true,
    }
  });

  io.on("connection", (socket) => {
    console.log("[Socket.io] Client connected:", socket.id);

    // Clients call 'join-tenant' upon authentication to join their isolated room
    // Only the tenant the signed-in user belongs to may be joined: the
    // access-token cookie is verified and the tenant resolved server-side.
    socket.on("join-tenant", async (tenantId) => {
      try {
        if (!tenantId) return;
        const cookieHeader = socket.handshake.headers.cookie || "";
        const match = cookieHeader.match(/(?:^|;\s*)accessToken=([^;]+)/);
        if (!match) return;
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(decodeURIComponent(match[1]), process.env.JWT_SECRET || "dev_jwt_access_secret_key_change_me");
        const profile = await prisma.profile.findUnique({ where: { userId: payload.userId }, select: { tenantId: true } });
        if (profile && profile.tenantId === tenantId) socket.join(tenantId);
      } catch {
        /* invalid / expired token — ignore the join */
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
    startCampaignTicker();
  });

  /**
   * Campaign dispatcher. Starts scheduled campaigns when they fall due and
   * sends pending recipients in bounded batches (/api/broadcasts/cron).
   * Without this nothing ever advanced a campaign past "scheduled"/"sending"
   * unless an external cron was configured.
   *
   * Uses AUTOMATION_CRON_SECRET; when it is not configured a random
   * per-process secret is generated (route handlers share this process's env).
   * Set CAMPAIGN_TICKER=off when an external scheduler calls the cron instead.
   */
  function startCampaignTicker() {
    if (process.env.CAMPAIGN_TICKER === "off") return;
    if (!process.env.AUTOMATION_CRON_SECRET) {
      process.env.AUTOMATION_CRON_SECRET = require("crypto").randomBytes(24).toString("hex");
    }
    const intervalMs = Number(process.env.CAMPAIGN_TICK_MS) || 15_000;
    let running = false;
    let tick = 0;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const headers = { "x-cron-secret": process.env.AUTOMATION_CRON_SECRET };
        const res = await fetch(`http://127.0.0.1:${port}/api/broadcasts/cron`, { method: "POST", headers }).catch(() => ({ ok: false, status: 0 }));
        if (!res.ok && res.status !== 404) {
          console.warn(`[Campaign Ticker] cron returned ${res.status}`);
        }
        // Drip sequences — every tick.
        const drip = await fetch(`http://127.0.0.1:${port}/api/sequences/cron`, { method: "POST", headers }).catch(() => ({ ok: false, status: 0 }));
        if (!drip.ok && drip.status !== 404) console.warn(`[Drip Ticker] returned ${drip.status}`);
        // Flow runs: resume finished delay steps and time out abandoned runs — every minute.
        if (tick % Math.max(1, Math.round(60_000 / intervalMs)) === 0) {
          const flows = await fetch(`http://127.0.0.1:${port}/api/flows/cron`, { method: "POST", headers }).catch(() => ({ ok: false, status: 0 }));
          if (!flows.ok && flows.status !== 404) console.warn(`[Flow Ticker] returned ${flows.status}`);
        }
        // Delayed automation steps ("wait" nodes) — every tick. Without this
        // a parked wait step never resumed.
        const auto = await fetch(`http://127.0.0.1:${port}/api/automations/cron`, { method: "GET", headers }).catch(() => ({ ok: false, status: 0 }));
        if (!auto.ok && auto.status !== 404) console.warn(`[Automation Ticker] cron returned ${auto.status}`);
        // Appointment confirmations / reminders / follow-ups — once a minute.
        tick += 1;
        if (tick % Math.max(1, Math.round(60_000 / intervalMs)) === 0) {
          // Isolated: a failure in any other job must never skip patient
          // reminders (1 day / 2 hours / 1 hour before) for this minute.
          try {
            const life = await fetch(`http://127.0.0.1:${port}/api/appointments/lifecycle`, { method: "POST", headers });
            if (!life.ok && life.status !== 404) console.warn(`[Appointment Ticker] lifecycle returned ${life.status}`);
          } catch (err) {
            console.warn("[Appointment Ticker] lifecycle failed:", err.message || err);
          }
        }        // Sales follow-ups for customers who went quiet — every 5 minutes.
        if (tick % Math.max(1, Math.round(300_000 / intervalMs)) === 0) {
          const nurture = await fetch(`http://127.0.0.1:${port}/api/leads/nurture`, { method: "POST", headers });
          if (!nurture.ok && nurture.status !== 404) console.warn(`[Lead Nurture Ticker] returned ${nurture.status}`);
        }
      } catch (err) {
        console.warn("[Campaign Ticker] tick failed:", err.message || err);
      } finally {
        running = false;
      }
    }, intervalMs);
    console.log(`> [Campaign Ticker] dispatching campaigns every ${intervalMs / 1000}s`);
  }
});
