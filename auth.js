// Authentication utilities for Prodit
import bcrypt from 'bcrypt';
import { createUser, findUserByEmail, findUserById, updateUserLastLogin } from './database/db.js';

const SALT_ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function registerUser({ email, password, fullName }) {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Check if user already exists
  const existing = await findUserByEmail(email.toLowerCase());
  if (existing) {
    throw new Error('Email already registered');
  }

  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email: email.toLowerCase(),
    passwordHash,
    fullName: fullName || null
  });

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    isAdmin: user.is_admin || false,
    createdAt: user.created_at
  };
}

export async function loginUser({ email, password }) {
  const user = await findUserByEmail(email.toLowerCase());
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  // Update last login
  await updateUserLastLogin(user.id);

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    isAdmin: user.is_admin || false,
    lastLogin: new Date()
  };
}

// Middleware to require authentication
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Middleware to attach user info to request
export async function attachUser(req, res, next) {
  if (req.session?.userId) {
    req.userId = req.session.userId;
    req.userEmail = req.session.userEmail;

    // Fetch and attach admin status
    try {
      const user = await findUserById(req.session.userId);
      req.isAdmin = user?.is_admin || false;
    } catch (error) {
      req.isAdmin = false;
    }
  }
  next();
}

// Middleware to require admin privileges
export function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}
