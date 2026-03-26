const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Initiate a password reset: generate a hashed token, persist it, send email.
 * Always responds with success (don't reveal whether the email exists).
 */
const requestPasswordReset = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return; // Silently return to avoid email enumeration

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashResetToken(rawToken);

  user.passwordResetToken   = hashedToken;
  user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  await sendResetEmail(email, resetUrl);
};

/**
 * Complete a password reset: find user by token hash, update password, clear token.
 */
const resetPassword = async (rawToken, newPassword) => {
  const hashedToken = hashResetToken(rawToken);

  const user = await User.findOne({
    passwordResetToken:   hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires');

  if (!user) {
    const err = new Error('Token is invalid or has expired.');
    err.status = 400;
    throw err;
  }

  user.passwordHash          = newPassword; // Pre-save hook will hash it
  user.passwordResetToken    = undefined;
  user.passwordResetExpires  = undefined;
  user.emailVerified         = true;
  await user.save();

  return user;
};

const hashResetToken = (rawToken) =>
  crypto.createHash('sha256').update(rawToken).digest('hex');

const sendResetEmail = async (email, resetUrl) => {
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    `"${process.env.EMAIL_FROM_NAME || 'EntraLogin'}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to:      email,
    subject: 'Reset your password',
    text:    `Click the link below to reset your password (valid for 1 hour):\n\n${resetUrl}`,
    html:    `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Reset your password</h2>
        <p>Click the button below to reset your password. This link is valid for <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">Reset Password</a>
        <p>If you did not request this, ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { requestPasswordReset, resetPassword };
