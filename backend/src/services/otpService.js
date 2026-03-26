const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { getRedisClient } = require('../config/redis');

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

// Redis key helpers
const otpKey     = (email) => `otp:${email}`;
const attemptsKey = (email) => `otp_attempts:${email}`;

/**
 * Generate and store a 6-digit OTP, then email it to the user.
 */
const sendOtp = async (email) => {
  const redis = getRedisClient();

  // Check if we're rate-limiting this address
  const attempts = await redis.get(attemptsKey(email));
  if (Number(attempts) >= OTP_MAX_ATTEMPTS) {
    const err = new Error('Too many OTP requests. Please try again in 10 minutes.');
    err.status = 429;
    throw err;
  }

  const otp = crypto.randomInt(100000, 999999).toString();

  // Store OTP (overwrite any previous) and increment attempt counter
  await redis.setex(otpKey(email), OTP_TTL_SECONDS, otp);
  await redis.setex(attemptsKey(email), OTP_TTL_SECONDS, (Number(attempts) || 0) + 1);

  await deliverOtpEmail(email, otp);
};

/**
 * Verify the OTP provided by the user.
 * Returns true on success, throws on failure.
 */
const verifyOtp = async (email, code) => {
  const redis = getRedisClient();
  const stored = await redis.get(otpKey(email));

  if (!stored) {
    const err = new Error('OTP expired or not found. Please request a new one.');
    err.status = 400;
    throw err;
  }

  // Constant-time comparison to prevent timing attacks
  const storedBuf = Buffer.from(stored);
  const inputBuf  = Buffer.from(code);
  const match =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!match) {
    const err = new Error('Invalid OTP.');
    err.status = 400;
    throw err;
  }

  // Delete OTP after successful verification (one-time use)
  await redis.del(otpKey(email));
  await redis.del(attemptsKey(email));

  return true;
};

// ---------- Email delivery ----------

const getTransporter = () => {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const deliverOtpEmail = async (email, otp) => {
  if (!process.env.SMTP_HOST) {
    const err = new Error('SMTP is not configured. Set SMTP_HOST and related variables in .env.');
    err.status = 500;
    throw err;
  }

  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'EntraLogin'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com'}>`,
    to: email,
    subject: 'Your one-time passcode',
    text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Your verification code</h2>
        <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#2563eb">${otp}</p>
        <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      </div>
    `,
  });

};

module.exports = { sendOtp, verifyOtp };
