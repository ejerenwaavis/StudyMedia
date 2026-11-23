const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getDBStatus } = require('../config/db');

function safeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured on the server');
  }
  return jwt.sign(
    {
      sub: String(user._id),
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
    secret,
    { expiresIn: '15d' }
  );
}

function formatUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

exports.register = async (req, res) => {
  if (!getDBStatus()) {
    return res.status(503).json({ error: 'Database unavailable. Check MongoDB Atlas connection.' });
  }

  const expectedInvite = (process.env.INVITE_CODE || '').trim();
  if (!expectedInvite || !process.env.JWT_SECRET) {
    return res
      .status(503)
      .json({ error: 'Invite-only registration is not configured on the server yet.' });
  }

  const { email, password, displayName, inviteCode } = req.body || {};

  if (!inviteCode || !safeStringEqual(String(inviteCode).trim(), expectedInvite)) {
    return res.status(403).json({ error: 'Invalid invite code.' });
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(displayName || '').trim();
  const cleanPass = String(password || '');

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Display name must be at least 2 characters.' });
  }
  if (cleanPass.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const userCount = await User.countDocuments();
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const role = userCount === 0 || (adminEmail && cleanEmail === adminEmail) ? 'admin' : 'member';

    const passwordHash = await bcrypt.hash(cleanPass, 12);
    const user = await User.create({
      email: cleanEmail,
      passwordHash,
      displayName: cleanName,
      role,
    });

    const token = signToken(user);
    return res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    return res.status(500).json({ error: 'Registration failed', details: err.message });
  }
};

exports.login = async (req, res) => {
  if (!getDBStatus()) {
    return res.status(503).json({ error: 'Database unavailable. Check MongoDB Atlas connection.' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'Server authentication not configured (missing JWT_SECRET).' });
  }

  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '');

  if (!cleanEmail || !cleanPass) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(cleanPass, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user);
    return res.json({ token, user: formatUser(user) });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed', details: err.message });
  }
};

exports.getMe = async (req, res) => {
  if (!getDBStatus()) {
    // Allow returning verified JWT claims cleanly if DB is temporarily unreachable
    return res.json({ user: req.user, dbConnected: false });
  }

  try {
    const user = await User.findById(req.user.id).select('-passwordHash').lean();
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    return res.json({ user: formatUser(user), dbConnected: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile', details: err.message });
  }
};
