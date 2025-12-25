import { ethers } from 'ethers';

const KEY_BYTES = 32;
const MAX_MESSAGE_BYTES = KEY_BYTES - 1;

function deriveKeyBytes(groupKey: string): Uint8Array {
  const normalized = groupKey.startsWith('0x')
    ? groupKey
    : ethers.toBeHex(BigInt(groupKey));
  const hashed = ethers.keccak256(ethers.getBytes(normalized));
  return ethers.getBytes(hashed);
}

export function normalizeGroupKey(value: string | bigint): string {
  const bigValue = typeof value === 'bigint' ? value : BigInt(value);
  return ethers.toBeHex(bigValue, 20);
}

export function sealMessage(message: string, groupKey: string): bigint {
  const keyBytes = deriveKeyBytes(groupKey);
  const encoded = new TextEncoder().encode(message);

  if (encoded.length > MAX_MESSAGE_BYTES) {
    throw new Error(`Message too long. Limit ${MAX_MESSAGE_BYTES} bytes`);
  }

  const payload = new Uint8Array(KEY_BYTES);
  payload[0] = encoded.length;
  payload.set(encoded, 1);

  for (let i = 0; i < KEY_BYTES; i++) {
    payload[i] ^= keyBytes[i];
  }

  const cipherHex = ethers.hexlify(payload);
  return BigInt(cipherHex);
}

export function openMessage(cipherValue: bigint, groupKey: string): string {
  const keyBytes = deriveKeyBytes(groupKey);
  const padded = ethers.zeroPadValue(ethers.toBeHex(cipherValue), KEY_BYTES);
  const payload = ethers.getBytes(padded);

  const plain = payload.map((byte, idx) => byte ^ keyBytes[idx]);
  const length = plain[0];
  const slice = plain.slice(1, 1 + length);

  return new TextDecoder().decode(slice);
}

export function shortenAddress(address?: string, size = 4): string {
  if (!address) return '';
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}
