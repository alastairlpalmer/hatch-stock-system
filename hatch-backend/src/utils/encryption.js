import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyHex = process.env.VENDLIVE_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('VENDLIVE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText) {
  const key = getKey();
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function hasEncryptionKey() {
  const keyHex = process.env.VENDLIVE_ENCRYPTION_KEY;
  return keyHex && keyHex.length === 64;
}
