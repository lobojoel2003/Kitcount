import { webcrypto } from 'node:crypto';

import { setRandomSource } from './src/core/crypto/random';

setRandomSource((n) => webcrypto.getRandomValues(new Uint8Array(n)));
