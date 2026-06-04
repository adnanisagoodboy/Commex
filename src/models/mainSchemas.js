const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

//  User Model 
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_-]+$/,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false,
  },
  displayName: { type: String, maxlength: 60, default: '' },
  avatar: { type: String, default: '' },
  bio: { type: String, maxlength: 300, default: '' },
  website: { type: String, default: '' },
  
  // Roles & status
  role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' },

  // Stats
  commentCount: { type: Number, default: 0 },
  reactionCount: { type: Number, default: 0 },

  // Orgs this user belongs to / owns
  ownedOrgs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization' }],
  memberOrgs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization' }],

  // Settings
  emailNotifications: { type: Boolean, default: true },
  showOnlineStatus: { type: Boolean, default: true },

  // Auth
  refreshToken: { type: String, select: false },
  passwordResetToken: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  
  lastActiveAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.password; return ret; } },
});

userSchema.index({ username: 1 });
userSchema.index({ email: 1 });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual('effectiveDisplayName').get(function() {
  return this.displayName || this.username;
});

const User = mongoose.model('User', userSchema);

//  Organization Model ─
const orgSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 60,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/,
  },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['admin', 'moderator', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  }],

  // Display
  description: { type: String, maxlength: 500, default: '' },
  logo: { type: String, default: '' },
  websiteUrl: { type: String, default: '' },
  accentColor: { type: String, default: '#6366f1' },
  theme: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },

  // Database
  dbConnectionString: { type: String, required: true, select: false }, // encrypted in prod
  dbStatus: { type: String, enum: ['connected', 'error', 'pending'], default: 'pending' },
  dbLastChecked: { type: Date, default: null },

  // Features
  features: {
    reactions: { type: Boolean, default: true },
    gifs: { type: Boolean, default: true },
    images: { type: Boolean, default: true },
    threading: { type: Boolean, default: true },
    voting: { type: Boolean, default: true },
    markdown: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    notifications: { type: Boolean, default: true },
    anonymousComments: { type: Boolean, default: false },
    requireApproval: { type: Boolean, default: false },
    customEmojis: { type: Boolean, default: false },
  },

  // Custom reaction emojis
  customEmojis: [{
    name: String,
    emoji: String,
    image: String,
  }],

  // Allowed domains (restrict embed to these)
  allowedDomains: [{ type: String }],

  // Stats
  totalComments: { type: Number, default: 0 },
  totalReactions: { type: Number, default: 0 },
  totalPages: { type: Number, default: 0 },

  // Moderation
  bannedWords: [{ type: String }],
  autoModeration: { type: Boolean, default: false },

  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

orgSchema.index({ slug: 1 });
orgSchema.index({ owner: 1 });

const Organization = mongoose.model('Organization', orgSchema);

module.exports = { User, Organization };
