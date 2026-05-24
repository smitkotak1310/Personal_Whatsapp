const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'],
  credentials: true,
}));
app.use(express.json());

// ──────────────────────────────────────────────
// WhatsApp Client Setup
// ──────────────────────────────────────────────
let whatsappClient = null;
let clientStatus = 'disconnected'; // disconnected | qr | authenticated | ready | loading
let currentQR = null;
let connectedUser = null;

function createWhatsAppClient() {
  if (whatsappClient) {
    try { whatsappClient.destroy(); } catch (_) {}
  }

  clientStatus = 'loading';
  currentQR = null;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-web-session' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014590669-alpha.html',
    },
  });

  // ── Events ──────────────────────────────────
  whatsappClient.on('qr', async (qr) => {
    console.log('[WA] QR received');
    clientStatus = 'qr';
    try {
      const qrDataURL = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
      currentQR = qrDataURL;
      io.emit('qr', { qr: qrDataURL });
    } catch (err) {
      console.error('QR generation error:', err);
    }
  });

  whatsappClient.on('loading_screen', (percent, message) => {
    console.log(`[WA] Loading: ${percent}% – ${message}`);
    io.emit('loading', { percent, message });
  });

  whatsappClient.on('authenticated', () => {
    console.log('[WA] Authenticated');
    clientStatus = 'authenticated';
    currentQR = null;
    io.emit('authenticated');
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('[WA] Auth failure:', msg);
    clientStatus = 'disconnected';
    io.emit('auth_failure', { message: msg });
  });

  whatsappClient.on('ready', async () => {
    console.log('[WA] Client ready');
    clientStatus = 'ready';

    try {
      const me = whatsappClient.info;
      connectedUser = {
        name: me.pushname || 'You',
        number: me.wid.user,
        platform: me.platform,
      };
      io.emit('ready', { user: connectedUser });
    } catch (e) {
      io.emit('ready', { user: null });
    }
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('[WA] Disconnected:', reason);
    clientStatus = 'disconnected';
    connectedUser = null;
    currentQR = null;
    io.emit('disconnected', { reason });
  });

  // ── Incoming Messages ────────────────────────
  whatsappClient.on('message', async (msg) => {
    try {
      const contact = await msg.getContact();
      const chat = await msg.getChat();

      const messageData = {
        id: msg.id.id,
        body: msg.body,
        type: msg.type,
        from: msg.from,
        to: msg.to,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp,
        author: msg.author || null,
        hasMedia: msg.hasMedia,
        isForwarded: msg.isForwarded,
        isStatus: msg.isStatus,
        isStarred: msg.isStarred,
        broadcast: msg.broadcast,
        contact: {
          id: contact.id.user,
          name: contact.pushname || contact.name || contact.id.user,
          number: contact.number,
          isMyContact: contact.isMyContact,
        },
        chat: {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount,
        },
      };

      io.emit('new_message', messageData);
    } catch (err) {
      console.error('[WA] Message parse error:', err.message);
    }
  });

  // Outgoing messages (ack)
  whatsappClient.on('message_ack', (msg, ack) => {
    io.emit('message_ack', { id: msg.id.id, ack });
  });

  whatsappClient.on('message_create', async (msg) => {
    if (msg.fromMe) {
      io.emit('message_sent', {
        id: msg.id.id,
        body: msg.body,
        to: msg.to,
        timestamp: msg.timestamp,
        fromMe: true,
      });
    }
  });

  whatsappClient.initialize().catch((err) => {
    console.error('[WA] Init error:', err.message);
    clientStatus = 'disconnected';
    io.emit('error', { message: err.message });
  });
}

// ──────────────────────────────────────────────
// REST API Routes
// ──────────────────────────────────────────────

// Status
app.get('/api/status', (req, res) => {
  res.json({ status: clientStatus, user: connectedUser, qr: currentQR });
});

// Initialize / Start
app.post('/api/start', (req, res) => {
  if (clientStatus === 'ready') {
    return res.json({ success: true, message: 'Already connected', user: connectedUser });
  }
  createWhatsAppClient();
  res.json({ success: true, message: 'WhatsApp client starting…' });
});

// Logout
app.post('/api/logout', async (req, res) => {
  try {
    if (whatsappClient && clientStatus === 'ready') {
      await whatsappClient.logout();
    }
    clientStatus = 'disconnected';
    connectedUser = null;
    currentQR = null;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get chats list
app.get('/api/chats', async (req, res) => {
  if (!whatsappClient || clientStatus !== 'ready') {
    return res.status(503).json({ error: 'Client not ready' });
  }
  try {
    const chats = await whatsappClient.getChats();
    const chatData = await Promise.all(
      chats.slice(0, 50).map(async (chat) => {
        let profilePic = null;
        try {
          profilePic = await whatsappClient.getProfilePicUrl(chat.id._serialized);
        } catch (_) {}

        const lastMsg = chat.lastMessage;
        return {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp,
          lastMessage: lastMsg
            ? {
                body: lastMsg.body,
                type: lastMsg.type,
                fromMe: lastMsg.fromMe,
                timestamp: lastMsg.timestamp,
              }
            : null,
          profilePic,
          pinned: chat.pinned,
          muted: chat.isMuted,
        };
      })
    );
    res.json(chatData);
  } catch (err) {
    console.error('/api/chats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a specific chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
  if (!whatsappClient || clientStatus !== 'ready') {
    return res.status(503).json({ error: 'Client not ready' });
  }
  try {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const chat = await whatsappClient.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });

    const msgData = messages.map((msg) => ({
      id: msg.id.id,
      body: msg.body,
      type: msg.type,
      from: msg.from,
      to: msg.to,
      fromMe: msg.fromMe,
      timestamp: msg.timestamp,
      hasMedia: msg.hasMedia,
      isForwarded: msg.isForwarded,
      ack: msg.ack,
      author: msg.author || null,
    }));

    res.json(msgData);
  } catch (err) {
    console.error('/api/chats/:id/messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send a message
app.post('/api/chats/:chatId/send', async (req, res) => {
  if (!whatsappClient || clientStatus !== 'ready') {
    return res.status(503).json({ error: 'Client not ready' });
  }
  try {
    const { chatId } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message body required' });

    const sent = await whatsappClient.sendMessage(chatId, message);
    res.json({ success: true, id: sent.id.id, timestamp: sent.timestamp });
  } catch (err) {
    console.error('/api/send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get contacts
app.get('/api/contacts', async (req, res) => {
  if (!whatsappClient || clientStatus !== 'ready') {
    return res.status(503).json({ error: 'Client not ready' });
  }
  try {
    const contacts = await whatsappClient.getContacts();
    const contactData = contacts
      .filter((c) => c.isMyContact && c.id.server === 'c.us')
      .map((c) => ({
        id: c.id._serialized,
        name: c.pushname || c.name || c.number,
        number: c.number,
        isMyContact: c.isMyContact,
        isBlocked: c.isBlocked,
      }));
    res.json(contactData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark chat as read
app.post('/api/chats/:chatId/read', async (req, res) => {
  if (!whatsappClient || clientStatus !== 'ready') {
    return res.status(503).json({ error: 'Client not ready' });
  }
  try {
    const chat = await whatsappClient.getChatById(req.params.chatId);
    await chat.sendSeen();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// Socket.io
// ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  // Send current status on connect
  socket.emit('status', { status: clientStatus, user: connectedUser, qr: currentQR });

  socket.on('start_client', () => {
    if (clientStatus !== 'ready') {
      createWhatsAppClient();
    } else {
      socket.emit('ready', { user: connectedUser });
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 WhatsApp Backend running on http://localhost:${PORT}`);
  console.log('   Initializing WhatsApp client…\n');
  createWhatsAppClient();
});
