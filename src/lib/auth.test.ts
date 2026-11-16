import { describe, expect, it } from 'vitest';
import {
  generateAccessToken,
  generateSuperAdminToken,
  hashPassword,
  verifyAccessToken,
  verifyPassword,
  verifySuperAdminToken,
} from './auth';

describe('auth utilities', () => {
  describe('password hashing', () => {
    it('hashes and verifies a password correctly', async () => {
      const password = 'mySecurePassword123!';
      const hash = await hashPassword(password);
      expect(hash).not.toEqual(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('wrongPassword', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('access tokens', () => {
    it('generates and verifies access token', () => {
      const payload = { userId: 'user-123', email: 'test@example.com', role: 'tenant_admin' };
      const token = generateAccessToken(payload);
      expect(typeof token).toBe('string');

      const verified = verifyAccessToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe('user-123');
      expect(verified?.email).toBe('test@example.com');
    });

    it('rejects invalid access tokens', () => {
      expect(verifyAccessToken('invalid.token.here')).toBeNull();
    });
  });

  describe('super admin tokens', () => {
    it('generates and verifies signed super admin token', () => {
      const email = 'superadmin@chatnexgen.com';
      const token = generateSuperAdminToken(email);
      expect(typeof token).toBe('string');

      const verified = verifySuperAdminToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.email).toBe(email);
      expect(verified?.role).toBe('super_admin');
    });

    it('rejects forged or plain string tokens', () => {
      expect(verifySuperAdminToken('authenticated')).toBeNull();
      expect(verifySuperAdminToken('random-forged-string')).toBeNull();
      expect(verifySuperAdminToken('')).toBeNull();
    });

    it('rejects access tokens as super admin tokens (secret segregation)', () => {
      const userToken = generateAccessToken({ userId: 'u1', email: 'a@b.com', role: 'super_admin' });
      const verified = verifySuperAdminToken(userToken);
      expect(verified).toBeNull();
    });
  });
});
