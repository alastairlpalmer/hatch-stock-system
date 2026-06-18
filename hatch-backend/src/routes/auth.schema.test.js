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
