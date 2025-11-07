// Authentication utilities for Prodit
import bcrypt from 'bcrypt';
import { createUser, findUserByEmail, findUserById, updateUserLastLogin } from './database/db.js';
import { createOrganization, getOrganizationById, canAccessSystem, setEmailVerificationToken } from './database/organizations.js';

const SALT_ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function registerUser({ email, password, fullName, companyName, accountType = 'company' }) {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Validate company name
  if (!companyName || companyName.trim().length === 0) {
    throw new Error('Company name is required');
  }

  // Check if user already exists
  const existing = await findUserByEmail(email.toLowerCase());
  if (existing) {
    throw new Error('Email already registered');
  }

  // Create organization first
  const organization = await createOrganization({
    companyName: companyName.trim(),
    ownerEmail: email.toLowerCase(),
    accountType
  });

  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email: email.toLowerCase(),
    passwordHash,
    fullName: fullName || null,
    organizationId: organization.id,
    isAdmin: true // First user is always org admin
  });

  // Generate email verification token (but don't send email yet)
  // await setEmailVerificationToken(user.id);

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    isAdmin: user.is_admin || false,
    organizationId: organization.id,
    organization: {
      id: organization.id,
      companyName: organization.company_name,
      accountType: organization.account_type,
      trialEndDate: organization.trial_end_date,
      subscriptionStatus: organization.subscription_status
    },
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

  // Get organization info
  const organization = await getOrganizationById(user.organization_id);
  if (!organization) {
    throw new Error('Organization not found');
  }

  // Update last login
  await updateUserLastLogin(user.id);

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    isAdmin: user.is_admin || false,
    isSuperAdmin: user.is_super_admin || false,
    organizationId: organization.id,
    organization: {
      id: organization.id,
      companyName: organization.company_name,
      accountType: organization.account_type,
      trialEndDate: organization.trial_end_date,
      subscriptionStatus: organization.subscription_status
    },
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
    req.organizationId = req.session.organizationId;

    // Fetch and attach user info
    try {
      const user = await findUserById(req.session.userId);
      req.isAdmin = user?.is_admin || false;
      req.isSuperAdmin = user?.is_super_admin || false;

      // Fetch organization
      if (user?.organization_id) {
        const organization = await getOrganizationById(user.organization_id);
        req.organization = organization;
        req.organizationId = organization?.id;
      }
    } catch (error) {
      req.isAdmin = false;
      req.isSuperAdmin = false;
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

// Middleware to require super admin privileges
export function requireSuperAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin privileges required' });
  }
  next();
}

// Middleware to check trial/subscription status
export function requireActiveSubscription(req, res, next) {
  // Super admins bypass subscription checks
  if (req.isSuperAdmin) {
    return next();
  }

  if (!req.organization) {
    return res.status(403).json({ error: 'No organization found' });
  }

  // Check if organization can access the system
  if (!canAccessSystem(req.organization)) {
    return res.status(402).json({
      error: 'Subscription required',
      trialExpired: true,
      subscriptionStatus: req.organization.subscription_status,
      trialEndDate: req.organization.trial_end_date
    });
  }

  next();
}
