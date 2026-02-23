[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

# FoxTrot

End-to-end encrypted messenger for Android, built with React Native and TypeScript.

Backend repo: [FoxTrot-Back-End](https://github.com/reznik99/FoxTrot-Back-End)

## Features

- **Encrypted messaging** — Send text, photos, and voice messages. Everything is encrypted before it leaves your device.
- **Audio & video calls** — Peer-to-peer calls that connect directly between devices when possible, with relay fallback.
- **Biometric unlock** — Log in with your fingerprint or device passcode.
- **Push notifications** — Get notified of new messages and incoming calls, with a full-screen call UI.
- **Security verification** — Verify your contact's identity with a shareable security code.
- **Device migration** — Export your identity keys to a password-protected file and import them on a new device.

## Security

All encryption happens on-device. The server only stores and relays ciphertext.

### Key Exchange
Each user generates an ECDH P-384 keypair on signup. The public key is uploaded to the server. When you open a conversation, a shared AES-256 session key is derived from your private key and the contact's public key via ECDH key agreement.

### Message Encryption
Messages (including any attached media) are encrypted with **AES-256-GCM** using a random 12-byte IV per message. Each conversation has its own session key. Messages are stored encrypted at rest and decrypted on-demand when you tap them.

### Local Storage
- **SQLite** database encrypted with SQLCipher (AES-256-CBC + HMAC-SHA512). Encryption key stored in device Keychain.
- **MMKV** key-value store encrypted with AES-CFB-128. Key stored in device Keychain.
- **Identity keys** stored in device secure hardware via `react-native-keychain`, protected by biometric or device passcode.

### Calls
WebRTC with DTLS-SRTP. Signaling goes through the WebSocket server. ICE candidates use STUN/TURN with fallback to TURN over TCP and TLS.

### Key Backup
Identity keys can be exported encrypted with a password-derived key (PBKDF2, 100k iterations, SHA-256 → AES-256-GCM).

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | [React Native](https://reactnative.dev/) 0.80, [TypeScript](https://www.typescriptlang.org/) |
| State | [Redux Toolkit](https://redux-toolkit.js.org/) |
| Crypto | [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto) (SubtleCrypto API) |
| Database | [op-sqlite](https://github.com/OP-Engineering/op-sqlite) with SQLCipher |
| Storage | [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) (encrypted) |
| Camera | [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) |
| Audio | [react-native-nitro-sound](https://github.com/hyochan/react-native-nitro-sound) |
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

## TODO
- [ ] Video messages
- [ ] GIF support
- [ ] Group messaging

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/reznik99/FoxTrot-Front-End.svg?style=for-the-badge
[contributors-url]: https://github.com/reznik99/FoxTrot-Front-End/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/reznik99/FoxTrot-Front-End.svg?style=for-the-badge
[forks-url]: https://github.com/reznik99/FoxTrot-Front-End/network/members
[stars-shield]: https://img.shields.io/github/stars/reznik99/FoxTrot-Front-End.svg?style=for-the-badge
[stars-url]: https://github.com/reznik99/FoxTrot-Front-End/stargazers
[issues-shield]: https://img.shields.io/github/issues/reznik99/FoxTrot-Front-End.svg?style=for-the-badge
[issues-url]: https://github.com/reznik99/FoxTrot-Front-End/issues
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/francesco-gorini/
