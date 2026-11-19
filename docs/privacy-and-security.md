# Privacy and security

Kitcount handles some of the most sensitive data there is: who uses drugs,
when, and where they get help. The design starts from one rule: **collect as
little as possible, and make what is collected useless to anyone who seizes
it.**

## What is stored

| Stored | Not stored |
| --- | --- |
| A keyed hash of the participant code | Names, initials or the code itself |
| Counts: supplies out, syringes in, reversals, secondary reach | Free-text notes (there are no text fields) |
| Referral categories | Locations, GPS or photos |
| Stock receipts and adjustments | Phone numbers, contacts or device identifiers |
| Program settings (supply catalog, code hint) | Analytics or crash reports (there are none) |

## Participant codes

Programs use self-made codes such as *first + last initial + birth month*
(`JD03`). Kitcount normalises them (case, spaces, punctuation, accents) and
stores only `HMAC-SHA256(codeKey, code)` truncated to 128 bits.

Codes have very little entropy (`JD03` is one of roughly 8,000 combinations),
so a plain hash could be reversed by trying them all. The HMAC key is derived
from the program secret, which never leaves the program's devices. Without it,
a stolen database or a server dump cannot be linked back to a code. With the
same key on every device, the same person gets the same hash everywhere. That
is what makes **unduplicated participant** counts possible.

## On the phone

| Threat | Protection |
| --- | --- |
| Lost or stolen phone | Database encrypted with **SQLCipher** (AES-256). Its 256-bit key lives in the iOS Keychain or Android Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and is never backed up. Android backups are disabled. |
| Someone picks up an unlocked phone | 6-digit PIN. Auto-lock after 1 minute in the background. Data screens unmount while locked. |
| PIN guessing | Wipes everything after **10 wrong PINs**. PIN verifiers are PBKDF2-SHA256 hashes. |
| Coercion ("unlock it") | A **duress PIN** silently wipes the device, which then looks like a fresh install. |
| Imminent seizure | **Panic wipe**: hold the button for 3 seconds (Settings, or the lock screen's *Emergency wipe*). |
| Phone lost while offline | An administrator marks it `wipe` on the server. It erases itself the next time it connects. |
| Shoulder surfing, screenshots, app switcher | Screenshots, screen recording and app-switcher previews are blocked. The participant code field disables autocorrect, suggestions and autofill. |
| Exported reports lingering | Exports are written to a private cache folder that is cleared on lock and wipe. Reports contain only aggregate counts. |

A wipe closes the database, deletes the file and deletes every key from the
keystore. Without the keys, any surviving copy of the file is unreadable.
Visits that were not yet synced are lost, by design.

## In transit and on the server

- Every event is encrypted on the phone with XChaCha20-Poly1305 under a key
  the server never sees (see [sync-protocol.md](sync-protocol.md)). TLS
  protects the connection itself. The app refuses plain `http://` except on
  private network addresses.
- The server stores ciphertext, a random event id, the uploading device's id
  and the time received. It cannot count visits, see supplies or link
  participants.
- Device tokens are stored as SHA-256 hashes. Admin and device authentication
  failures are rate-limited. Request logs never include bodies, query strings
  or tokens.
- The server runs as a static, non-root, read-only container with all
  capabilities dropped.

## What Kitcount does **not** protect against

- A compromised phone (malware with root access) while Kitcount is unlocked.
- Someone who holds both an enrolled, unlocked device and its PIN.
- The **enrollment QR code**: it contains the program secret. Show it only
  to staff, never photograph or send it, and re-key the program if it leaks.
  To re-key, create a new program and enrol devices again.
- Traffic analysis: the server operator can see when and how much each device
  syncs.
- Data in exported CSV and PDF files after they leave the phone. Treat
  submitted reports like any other program document.

## Reporting vulnerabilities

Please see [SECURITY.md](../SECURITY.md).
