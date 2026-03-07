[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

# FoxTrot

End-to-end encrypted messenger for Android, built with React Native and TypeScript.

Backend repo: [FoxTrot-Back-End](https://github.com/reznik99/FoxTrot-Back-End)

## Features

- **Encrypted messaging** — Text, photos, videos, and voice messages. Everything is encrypted before it leaves your device — the server only ever sees ciphertext.
- **Replies and reactions** — Reply to any message with text or emoji. Swipe to reply, tap a quoted reply to jump to the original.
- **Voice messages** — Tap to lock recording or hold to record. Preview before sending.
- **Audio & video calls** — Peer-to-peer with relay fallback. Speaker, mute, camera toggle, and live connection stats. Option to force relay to hide your IP.
- **Contact presence** — See when contacts are online, recently active, or offline.
- **Push notifications** — Messages and incoming calls, with a full-screen call UI.
- **Biometric unlock** — Fingerprint or device passcode.
- **Identity verification** — Security codes to verify contacts. System messages when a contact rotates their keys.
- **Key export & import** — Migrate your identity to a new device with a password-protected backup file.
- **Screen security** — Block screenshots and hide app content in the recent apps switcher.
- **Customizable theme** — Multiple accent color presets.
- **Call history** — Grouped by day, with type, direction, duration, and bulk delete.
- **Message management** — Long-press to copy, save media, view info, reply, or delete.
- **Media cache** — Auto-evicts oldest cached media when storage exceeds 500MB.

## Security

All encryption happens on-device. The server only stores and relays ciphertext.

### Key Exchange
Each user generates an **ECDH P-384** keypair on signup. The public key is uploaded to the server. When you open a conversation, a shared session key is derived from your private key and the contact's public key via ECDH key agreement.

### Message Encryption
Text messages are encrypted with **AES-256-GCM** using a random 12-byte IV per message. Each conversation has its own session key derived via ECDH.

Media files (images, videos, audio) are each encrypted with a **random per-file AES-256-GCM key** before upload to S3 via presigned URLs. The file key and IV are embedded in the E2EE message payload, so only the intended recipient can decrypt the media. A low-resolution thumbnail is included inline for instant preview before the full file is downloaded.

Messages are stored encrypted at rest in SQLCipher and decrypted on-demand when opened. Legacy AES-256-CBC messages (protocol v0) are auto-detected and decrypted transparently.

### Local Storage
- **SQLite** database encrypted with SQLCipher (AES-256-CBC + HMAC-SHA512). Encryption key stored in device Keychain.
- **MMKV** key-value store encrypted with AES-CFB-128. Key stored in device Keychain.
- **Identity keys** stored in device secure hardware via `react-native-keychain`, protected by biometric or device passcode.

### Calls
WebRTC with DTLS-SRTP. Signaling goes through the WebSocket server. ICE candidates use STUN/TURN with fallback to TURN over TCP and TLS. Data channel used for in-call signaling (mute, camera toggle, hangup).

### Key Backup
Identity keys can be exported encrypted with a password-derived key (PBKDF2, 250k iterations, SHA-256 → AES-256-GCM).

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | [React Native](https://reactnative.dev/) 0.80, [TypeScript](https://www.typescriptlang.org/) |
| State | [Redux Toolkit](https://redux-toolkit.js.org/) |
| Crypto | [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto) (SubtleCrypto API) |
| Database | [op-sqlite](https://github.com/OP-Engineering/op-sqlite) with SQLCipher |
| Storage | [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) (encrypted) |
| Camera | [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) |
| Video | [react-native-video](https://github.com/TheWidlarzGroup/react-native-video), [react-native-compressor](https://github.com/numandev1/react-native-compressor) |
| Audio | [react-native-nitro-sound](https://github.com/hyochan/react-native-nitro-sound) |
| Gestures | [react-native-gesture-handler](https://docs.swmansion.com/react-native-gesture-handler/), [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/) |
| Networking | [Axios](https://github.com/axios/axios), WebSocket, [WebRTC](https://github.com/react-native-webrtc/react-native-webrtc) |
| Notifications | [Firebase Cloud Messaging](https://rnfirebase.io/messaging/usage) |
| UI | [React Native Paper](https://reactnativepaper.com/) (Material Design 3) |

## Running Locally

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run on Android
npm run android

```

Requires Node >= 20.

## Roadmap
- [ ] GIF support
- [ ] User avatars
- [ ] Picture-in-picture call
- [ ] Edge-to-edge display
- [ ] Key ratcheting (Signal-style forward secrecy)
- [ ] Group messaging

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/reznik99/FoxTrot-FrontEnd.svg?style=for-the-badge
[contributors-url]: https://github.com/reznik99/FoxTrot-FrontEnd/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/reznik99/FoxTrot-FrontEnd.svg?style=for-the-badge
[forks-url]: https://github.com/reznik99/FoxTrot-FrontEnd/network/members
[stars-shield]: https://img.shields.io/github/stars/reznik99/FoxTrot-FrontEnd.svg?style=for-the-badge
[stars-url]: https://github.com/reznik99/FoxTrot-FrontEnd/stargazers
[issues-shield]: https://img.shields.io/github/issues/reznik99/FoxTrot-FrontEnd.svg?style=for-the-badge
[issues-url]: https://github.com/reznik99/FoxTrot-FrontEnd/issues
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/francesco-gorini/
