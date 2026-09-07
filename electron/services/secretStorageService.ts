import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENCRYPTION_PREFIX = 'enc_v1:';
const SECRETS_DIR = path.join(os.homedir(), '.projecthub');
const SECRETS_FILE = path.join(SECRETS_DIR, 'secrets.enc.json');

export class SecretStorageService {
  private inMemoryCache = new Map<string, string>();
  private initialized = false;

  constructor() {
    this.ensureDir();
  }

  private ensureDir() {
    // Синхронно: промис fs.mkdir без await внутри try не ловится и становится unhandled rejection
    if (!existsSync(SECRETS_DIR)) {
      try {
        mkdirSync(SECRETS_DIR, { recursive: true });
      } catch (e) {
        console.error('[SecretStorage] Failed to create dir:', e);
      }
    }
  }

  /**
   * Check if OS-level encryption (Windows DPAPI / macOS Keychain / Linux Libsecret) is available.
   */
  public isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Encrypt a plain text string using safeStorage.
   * Returns a prefixed base64 string, or original text if safeStorage is unavailable.
   */
  public encrypt(plainText: string): string {
    if (!plainText || plainText.startsWith(ENCRYPTION_PREFIX)) {
      return plainText;
    }

    if (this.isEncryptionAvailable()) {
      try {
        const buffer = safeStorage.encryptString(plainText);
        return `${ENCRYPTION_PREFIX}${buffer.toString('base64')}`;
      } catch (err) {
        console.warn('[SecretStorage] safeStorage.encryptString failed, using plain fallback:', err);
        return plainText;
      }
    }

    return plainText;
  }

  /**
   * Decrypt an encrypted string.
   * If string is not encrypted (does not start with enc_v1:), returns as-is (auto-migration).
   */
  public decrypt(cipherText: string): string {
    if (!cipherText) return '';

    if (!cipherText.startsWith(ENCRYPTION_PREFIX)) {
      // Plain text (existing legacy or unencrypted)
      return cipherText;
    }

    if (this.isEncryptionAvailable()) {
      try {
        const base64Data = cipherText.slice(ENCRYPTION_PREFIX.length);
        const buffer = Buffer.from(base64Data, 'base64');
        return safeStorage.decryptString(buffer);
      } catch (err) {
        console.error('[SecretStorage] safeStorage.decryptString failed:', err);
        return '';
      }
    }

    console.warn('[SecretStorage] Decryption requested but safeStorage is unavailable');
    return '';
  }

  /**
   * Masks a secret string for safe logging and UI display.
   * e.g. "sk-ant-api03-abcdef123456" -> "sk-ant-***...***3456"
   */
  public mask(secret: string): string {
    if (!secret) return '';
    const clean = secret.startsWith(ENCRYPTION_PREFIX) ? this.decrypt(secret) : secret;
    if (clean.length <= 8) return '********';
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }

  private async loadSecretsFile(): Promise<Record<string, string>> {
    try {
      if (existsSync(SECRETS_FILE)) {
        const raw = await fs.readFile(SECRETS_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[SecretStorage] Error reading secrets file:', err);
    }
    return {};
  }

  private async saveSecretsFile(data: Record<string, string>): Promise<void> {
    this.ensureDir();
    await fs.writeFile(SECRETS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Store a secret key-value pair encrypted on disk.
   */
  public async setSecret(key: string, value: string): Promise<void> {
    const encrypted = this.encrypt(value);
    this.inMemoryCache.set(key, value);

    const all = await this.loadSecretsFile();
    all[key] = encrypted;
    await this.saveSecretsFile(all);
    console.log(`[SecretStorage] Secret saved (DPAPI: ${this.isEncryptionAvailable()})`);
  }

  /**
   * Retrieve and decrypt a secret key-value pair.
   */
  public async getSecret(key: string): Promise<string | null> {
    if (this.inMemoryCache.has(key)) {
      return this.inMemoryCache.get(key)!;
    }

    const all = await this.loadSecretsFile();
    const val = all[key];
    if (!val) return null;

    const decrypted = this.decrypt(val);
    this.inMemoryCache.set(key, decrypted);
    return decrypted;
  }

  /**
   * Delete a stored secret.
   */
  public async deleteSecret(key: string): Promise<boolean> {
    this.inMemoryCache.delete(key);
    const all = await this.loadSecretsFile();
    if (key in all) {
      delete all[key];
      await this.saveSecretsFile(all);
      return true;
    }
    return false;
  }
}

export const secretStorageService = new SecretStorageService();
