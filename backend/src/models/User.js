const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, trim: true },
    givenName:   { type: String, trim: true },
    surname:     { type: String, trim: true },
    passwordHash: { type: String, select: false },  // nullable – OTP-only users have no password

    role: {
      type: String,
      enum: ['user', 'admin', 'moderator'],
      default: 'user',
    },

    emailVerified: { type: Boolean, default: false },

    // Set when the account was created / linked via Entra ID
    entraExternalId: { type: String, sparse: true, unique: true },

    lastLoginAt:   { type: Date },
    profilePicture: { type: String },

    preferences: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Password-reset token fields (future use)
    passwordResetToken:   { type: String, select: false },
    passwordResetExpires: { type: Date,   select: false },
  },
  { timestamps: true }
);

// Hash the password before saving when it is set / changed
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

userSchema.methods.verifyPassword = async function (plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    givenName: this.givenName,
    surname: this.surname,
    role: this.role,
    emailVerified: this.emailVerified,
    profilePicture: this.profilePicture,
    preferences: this.preferences,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports = mongoose.model('User', userSchema);
