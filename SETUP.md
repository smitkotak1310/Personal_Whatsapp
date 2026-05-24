# WhatsApp Web Integration Setup Guide

## Architecture
```
Frontend (React + Vite)  ←→  Backend (Node.js + Socket.io)  ←→  WhatsApp
     localhost:5173               localhost:3001
```

## Step 1: Install Backend Dependencies

```bash
cd server
npm install
```

This installs:
- `whatsapp-web.js` — Unofficial WhatsApp Web API (uses Puppeteer)
- `socket.io` — Real-time bidirectional communication
- `express` — HTTP server
- `qrcode` — QR code image generation
- `cors` — Cross-origin resource sharing

## Step 2: Start Backend Server

```bash
cd server
npm start
```

The backend will:
1. Start on http://localhost:3001
2. Launch a headless Chrome instance via Puppeteer
3. Connect to WhatsApp Web infrastructure
4. Generate a QR code for authentication

## Step 3: Start Frontend

```bash
# In project root
npm run dev
```

Open http://localhost:5173

## Step 4: Scan QR Code

1. Open WhatsApp on your phone
2. Go to **Settings** → **Linked Devices** → **Link a Device**
3. Point your camera at the QR code on screen
4. Wait for authentication (may take 10–20 seconds)
5. Your chats will load automatically!

## Features

- ✅ Real-time QR code generation and scanning
- ✅ Displays all your real WhatsApp chats
- ✅ Send and receive messages in real-time
- ✅ Message read receipts (✓✓ ticks)
- ✅ Unread message counts
- ✅ Profile pictures
- ✅ Group chats support
- ✅ Media message previews (image, video, audio)
- ✅ Session persistence (no re-scan after restart)
- ✅ Socket.io for real-time updates

## Requirements

- Node.js 18+
- Google Chrome or Chromium (installed on your system)
- Active WhatsApp account with internet access

## Troubleshooting

### "Backend Not Connected" error
- Make sure the backend server is running: `cd server && npm start`
- Check that port 3001 is not blocked

### QR code not appearing
- Wait 15–20 seconds after starting the backend
- The first launch downloads Chrome — may take a minute

### "Auth failure"
- Try refreshing the QR code
- Make sure your phone has internet access

### Session expired
- Delete the `.wwebjs_auth` folder in the server directory
- Restart the backend to get a fresh QR code
