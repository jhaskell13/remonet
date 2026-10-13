import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const cost = 32_768;
const blockSize = 8;
const parallelism = 1;
const keyLength = 64;
const maxMemory = 64 * 1024 * 1024;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: maxMemory,
  });
  return `scrypt$${cost}$${blockSize}$${parallelism}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, encodedCost, encodedBlockSize, encodedParallelism, saltText, hashText] =
    encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    Number(encodedCost) !== cost ||
    Number(encodedBlockSize) !== blockSize ||
    Number(encodedParallelism) !== parallelism ||
    !saltText ||
    !hashText
  )
    return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = scryptSync(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: maxMemory,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
