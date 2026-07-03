import { describe, it, expect } from 'vitest';
import { createUserSchema, resetPasswordSchema } from './auth.js';

describe('createUserSchema (POST /auth/users)', () => {
  it('accepts a valid user payload', () => {
    const parsed = createUserSchema.parse({
      email: 'staff@example.com',
      password: 'hunter2hunter',
      name: 'Staff Member',
    });
    expect(parsed.email).toBe('staff@example.com');
    expect(parsed.name).toBe('Staff Member');
  });

  it('treats name as optional', () => {
    const parsed = createUserSchema.parse({
      email: 'staff@example.com',
      password: 'hunter2hunter',
    });
    expect(parsed.name).toBeUndefined();
  });

  it('trims surrounding whitespace from email and name', () => {
    const parsed = createUserSchema.parse({
      email: '  staff@example.com  ',
      password: 'hunter2hunter',
      name: '  Staff Member  ',
    });
    expect(parsed.email).toBe('staff@example.com');
    expect(parsed.name).toBe('Staff Member');
  });

  it('rejects an invalid email', () => {
    expect(() => createUserSchema.parse({
      email: 'not-an-email',
      password: 'hunter2hunter',
    })).toThrow();
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(() => createUserSchema.parse({
      email: 'staff@example.com',
      password: 'short',
    })).toThrow();
  });

  it('requires email and password', () => {
    expect(() => createUserSchema.parse({ password: 'hunter2hunter' })).toThrow();
    expect(() => createUserSchema.parse({ email: 'staff@example.com' })).toThrow();
  });
});

describe('resetPasswordSchema (POST /auth/users/:id/reset-password)', () => {
  it('accepts a password of at least 8 characters', () => {
    const parsed = resetPasswordSchema.parse({ password: 'newpassword1' });
    expect(parsed.password).toBe('newpassword1');
  });

  it('rejects a short password', () => {
    expect(() => resetPasswordSchema.parse({ password: 'short' })).toThrow();
  });

  it('requires a password', () => {
    expect(() => resetPasswordSchema.parse({})).toThrow();
  });
});

describe('rolePolicy (route-level role enforcement)', async () => {
  const { rolePolicy } = await import('../middleware/auth.js');

  const run = (method, url, role) => {
    const req = { method, originalUrl: url, path: url.split('?')[0], user: role ? { role } : undefined };
    let statusCode = null;
    const res = { status: (c) => { statusCode = c; return res; }, json: () => res };
    let passed = false;
    rolePolicy(req, res, () => { passed = true; });
    return { passed, statusCode };
  };

  const withAuthOn = (fn) => {
    const prev = process.env.AUTH_ENABLED;
    process.env.AUTH_ENABLED = 'true';
    try { fn(); } finally {
      if (prev === undefined) delete process.env.AUTH_ENABLED;
      else process.env.AUTH_ENABLED = prev;
    }
  };

  it('is a no-op while AUTH_ENABLED is off (deploy-safe)', () => {
    const prev = process.env.AUTH_ENABLED;
    delete process.env.AUTH_ENABLED;
    try {
      expect(run('DELETE', '/api/products/X', undefined).passed).toBe(true);
    } finally {
      if (prev !== undefined) process.env.AUTH_ENABLED = prev;
    }
  });

  it('lets any role read', () => withAuthOn(() => {
    expect(run('GET', '/api/products', 'user').passed).toBe(true);
  }));

  it('lets admins write anything', () => withAuthOn(() => {
    expect(run('DELETE', '/api/products/X', 'admin').passed).toBe(true);
  }));

  it('blocks non-admin master-data writes with 403', () => withAuthOn(() => {
    expect(run('DELETE', '/api/products/X', 'user').statusCode).toBe(403);
    expect(run('POST', '/api/buying-lists', 'user').statusCode).toBe(403);
    expect(run('PUT', '/api/vendlive/config', 'user').statusCode).toBe(403);
    expect(run('POST', '/api/orders', 'user').statusCode).toBe(403);
  }));

  it('allows the operational writes a restocker needs', () => withAuthOn(() => {
    expect(run('POST', '/api/inventory/stock-checks', 'user').passed).toBe(true);
    expect(run('POST', '/api/inventory/restocks', 'user').passed).toBe(true);
    expect(run('POST', '/api/inventory/removals', 'user').passed).toBe(true);
    expect(run('POST', '/api/pick-lists/generate', 'user').passed).toBe(true);
    expect(run('PUT', '/api/pick-lists/abc123', 'user').passed).toBe(true);
    expect(run('POST', '/api/pick-lists/abc123/complete', 'user').passed).toBe(true);
    expect(run('POST', '/api/orders/ord-1/receive', 'user').passed).toBe(true);
    expect(run('POST', '/api/vendlive/stock/sync-location/loc-1', 'user').passed).toBe(true);
    expect(run('POST', '/api/auth/me/password', 'user').passed).toBe(true);
  }));

  it('does not let the receive pattern leak to other order writes', () => withAuthOn(() => {
    expect(run('DELETE', '/api/orders/ord-1', 'user').statusCode).toBe(403);
    expect(run('PUT', '/api/orders/ord-1', 'user').statusCode).toBe(403);
  }));

  it('ignores query strings when matching', () => withAuthOn(() => {
    expect(run('POST', '/api/inventory/restocks?x=1', 'user').passed).toBe(true);
  }));
});

describe('email case-insensitivity', async () => {
  const { createUserSchema, normalizeEmail } = await import('./auth.js');

  it('createUserSchema lowercases emails', () => {
    const parsed = createUserSchema.parse({ email: 'Driver.One@Example.COM', password: 'password123' });
    expect(parsed.email).toBe('driver.one@example.com');
  });

  it('normalizeEmail trims and lowercases, tolerating null', () => {
    expect(normalizeEmail('  Alastair@Hatch.CO ')).toBe('alastair@hatch.co');
    expect(normalizeEmail(null)).toBe('');
  });
});
