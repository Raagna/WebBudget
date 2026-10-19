// Outgoing email. There's no email service by default, so with no SMTP_HOST
// set, messages are written to the server console instead - enough for a
// self-hosted install where the person running the server is the person
// who forgot their password. Set SMTP_* in backend/.env to really send.
//
// nodemailer is only loaded when SMTP is configured, so the console path
// has no extra startup cost.

let transport = null;

function smtpConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (!transport) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; anything else upgrades with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) {
    console.log(`[mail] SMTP is not configured - not sending. To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

// Base URL of the web app, for links in emails. The app uses HashRouter,
// so routes live after "#/" (see frontend/src/App.jsx). A token in the
// fragment also never reaches any server's access logs or a Referer header.
function appUrl() {
  const base = process.env.APP_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0];
  return base.trim().replace(/\/+$/, '');
}

async function sendPasswordReset(email, token) {
  const link = `${appUrl()}/#/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: 'Reset your password',
    text:
      `Someone asked to reset the password for this account.\n\n` +
      `Open this link within an hour to choose a new one:\n${link}\n\n` +
      `If it wasn't you, ignore this email - your password stays the same.`,
  });
}

module.exports = { sendMail, sendPasswordReset };
