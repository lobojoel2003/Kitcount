import * as Crypto from 'expo-crypto';

import { setRandomSource } from '../core/crypto/random';

/** Routes all key, nonce and id generation through the platform CSPRNG. */
export function installRandomSource(): void {
  setRandomSource((n) => Crypto.getRandomBytes(n));
}
