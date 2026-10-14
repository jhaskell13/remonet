import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../server/passwords.ts';

describe('password hashing', () => {
  it('produces a self-describing scrypt hash with a random salt', () => {
    const first = hashPassword('CorrectHorseBatteryStaple');
    const second = hashPassword('CorrectHorseBatteryStaple');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('CorrectHorseBatteryStaple');
  });

  it('verifies the original password and rejects others', () => {
    const encoded = hashPassword('CorrectHorseBatteryStaple');
    expect(verifyPassword('CorrectHorseBatteryStaple', encoded)).toBe(true);
    expect(verifyPassword('correcthorsebatterystaple', encoded)).toBe(false);
    expect(verifyPassword('CorrectHorseBatteryStaple ', encoded)).toBe(false);
    expect(verifyPassword('', encoded)).toBe(false);
  });

  it('rejects hashes with unexpected algorithms or parameters instead of guessing', () => {
    const encoded = hashPassword('CorrectHorseBatteryStaple');
    const [, cost, blockSize, parallelism, salt, hash] = encoded.split('$');
    expect(
      verifyPassword(
        'CorrectHorseBatteryStaple',
        `bcrypt$${cost}$${blockSize}$${parallelism}$${salt}$${hash}`,
      ),
    ).toBe(false);
    expect(
      verifyPassword('CorrectHorseBatteryStaple', `scrypt$1024$${blockSize}$${parallelism}$${salt}$${hash}`),
    ).toBe(false);
    expect(
      verifyPassword('CorrectHorseBatteryStaple', `scrypt$${cost}$${blockSize}$${parallelism}$$${hash}`),
    ).toBe(false);
    expect(
      verifyPassword('CorrectHorseBatteryStaple', `scrypt$${cost}$${blockSize}$${parallelism}$${salt}$`),
    ).toBe(false);
    expect(verifyPassword('CorrectHorseBatteryStaple', '')).toBe(false);
    expect(verifyPassword('CorrectHorseBatteryStaple', 'scrypt$broken')).toBe(false);
  });

  it('rejects a tampered digest', () => {
    const encoded = hashPassword('CorrectHorseBatteryStaple');
    const parts = encoded.split('$');
    const digest = parts[5]!;
    // Change a character in the middle of the digest; the trailing character only carries padding bits.
    const position = 20;
    parts[5] =
      digest.slice(0, position) + (digest[position] === 'A' ? 'B' : 'A') + digest.slice(position + 1);
    expect(verifyPassword('CorrectHorseBatteryStaple', parts.join('$'))).toBe(false);
  });
});
