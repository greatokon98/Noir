// mailer.js
// Thin wrapper around nodemailer. Sends lead-alert emails when SMTP is
// configured. Fails silently in development or when credentials are missing.

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
  return transporter;
}

async function sendLeadAlert(lead) {
  const transport = getTransporter();
  if (!transport) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const to = process.env.SMTP_TO || process.env.SMTP_USER;
  const subject = `New lead: ${lead.name} (${lead.preferred_time})`;
  const text = [
    `New tour request`,
    ``,
    `Name:    ${lead.name}`,
    `Email:   ${lead.email}`,
    `Phone:   ${lead.phone || '—'}`,
    `Time:    ${lead.preferred_time}`,
    `Source:  ${lead.source}`,
    ``,
    `View in admin: /admin/leads`
  ].join('\n');
  try {
    await transport.sendMail({ from, to, subject, text });
  } catch (err) {
    console.error('SMTP lead alert failed:', err.message);
  }
}

module.exports = { sendLeadAlert };
