import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  bccEmail?: string | null;
  secure?: boolean;
}

const cleanEnv = (val: string | undefined): string => {
  if (!val) return "";
  return val.replace(/^["']|["']$/g, "").trim();
};

export async function getSmtpConfig(): Promise<SmtpConfig> {
  try {
    const setting = await prisma.cmsSetting.findUnique({
      where: { key: "smtp_config" },
    });

    if (setting && setting.value && typeof setting.value === "object") {
      const v = setting.value as any;
      if (v.host && v.user && v.pass) {
        return {
          host: String(v.host).trim(),
          port: Number(v.port) || 587,
          user: String(v.user).trim(),
          pass: String(v.pass).trim(),
          fromName: String(v.fromName || "ChatNexGen Support").trim(),
          fromEmail: String(v.fromEmail || v.user).trim(),
          bccEmail: v.bccEmail ? String(v.bccEmail).trim() : null,
          secure: Boolean(v.secure || Number(v.port) === 465),
        };
      }
    }
  } catch (err) {
    console.warn("[SMTP Config] Error reading CMS settings from DB, falling back to ENV:", err);
  }

  // Fallback to environment variables
  const host = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com");
  const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
  const port = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
  const user = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
  const pass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
  const bcc = cleanEnv(process.env.EMAIL_BCC || process.env.SMTP_BCC);

  return {
    host,
    port,
    user,
    pass,
    fromName: "ChatNexGen Support",
    fromEmail: user || "support@chatnexgen.com",
    bccEmail: bcc || null,
    secure: port === 465,
  };
}

export async function createMailTransporter(customConfig?: Partial<SmtpConfig>) {
  const config = customConfig && customConfig.host && customConfig.user && customConfig.pass
    ? {
        host: customConfig.host,
        port: customConfig.port || 587,
        user: customConfig.user,
        pass: customConfig.pass,
        fromName: customConfig.fromName || "ChatNexGen Support",
        fromEmail: customConfig.fromEmail || customConfig.user,
        bccEmail: customConfig.bccEmail || null,
        secure: customConfig.secure !== undefined ? customConfig.secure : (customConfig.port === 465),
      }
    : await getSmtpConfig();

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false, // Prevents self-signed or internal cert issues
    },
  });

  return { transporter, config };
}

export async function sendSystemEmail(options: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  customConfig?: Partial<SmtpConfig>;
}) {
  const { transporter, config } = await createMailTransporter(options.customConfig);

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  if (config.bccEmail) {
    mailOptions.bcc = config.bccEmail;
  }

  return transporter.sendMail(mailOptions);
}
