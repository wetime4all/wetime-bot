const { App } = require('@slack/bolt');
const admin = require('firebase-admin');
const http = require('http');
require('dotenv').config();

// --- CONFIG ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// --- HELPER: Video Link Generator ---
function createVideoRoom(userId) {
  const uniqueId = Math.random().toString(36).substring(2, 12);
  const roomName = `WeTime-${uniqueId}`;
  
  // Your GitHub URL
  const myAppUrl = "https://trgrubman-debug.github.io/wetime-website/"; 
  
  return `${myAppUrl}?room=${roomName}&user=${userId}`;
}

// --- DASHBOARD UI ---
const getDashboardBlocks = (userId) => {
  // Your GitHub URL
  const myAppUrl = "https://trgrubman-debug.github.io/wetime-website/"; 

  return [
    { type: "header", text: { type: "plain_text", text: `Welcome back! 👋` } },
    { type: "section", text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` } },
    { type: "divider" },
    { type: "actions", elements: [
        // Button 1: Speed Coffee
        { 
          type: "button", 
          text: { type: "plain_text", text: "☕ Speed Coffee" }, 
          style: "primary", 
          action_id: "btn_speed_coffee" 
        },

        // Button 2: Arcade (UPDATED ORDER: mode first, then user)
        // Format: .../?mode=games&user=U12345
        { 
          type: "button", 
          text: { type: "plain_text", text: "🎮 WeTime Arcade" }, 
          url: `${myAppUrl}?mode=games&user=${userId}`, 
          action_id: "btn_arcade_link" 
        },

        // Button 3: MeTime (UPDATED ORDER: mode first, then user)
        // Format: .../?mode=metime&user=U12345
        { 
          type: "button", 
          text: { type: "plain_text", text: "🧘 MeTime" }, 
          url: `${myAppUrl}?mode=metime&user=${userId}`,
          action_id: "btn_metime_link"
        }
      ]
    }
  ];
};

// --- EVENTS ---

app.event('app_home_opened', async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: { type: 'home', blocks: getDashboardBlocks(event.user) }
  });
});

app.command('/wetime', async ({ command, ack, respond }) => {
  await ack();
  await respond({ blocks: getDashboardBlocks(command.user_id) });
});

// --- ACTION 1: SPEED COFFEE ---
app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client, 'match_queue', '');
});

// --- SHARED MATCHMAKING LOGIC ---
async function handleMatchmaking(body, client, collectionName, urlSuffix) {
  const userId = body.user.id;
  const queueRef = db.collection(collectionName);

  const snapshot = await queueRef.orderBy('joinedAt', 'asc').limit(1).get();
  let partnerId = null;
  let partnerDocId = null;

  snapshot.forEach(doc => {
    if (doc.data().userId !== userId) {
      partnerId = doc.data().userId;
      partnerDocId = doc.id;
    }
  });

  if (!partnerId) {
    await queueRef.doc(userId).set({
      userId: userId,
      joinedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await client.chat.postMessage({ channel: userId, text: "You are in the queue! 🕒 Waiting for a partner..." });
  } else {
    await queueRef.doc(partnerDocId).delete();
    await queueRef.doc(userId).delete(); 

    const roomUrl1 = createVideoRoom(userId);
    const roomUrl2 = createVideoRoom(partnerId); 
    
    const uniqueId = Math.random().toString(36).substring(2, 12);
    const roomName = `WeTime-${uniqueId}`;
    const baseUrl = "https://trgrubman-debug.github.io/wetime-website/";
    
    const finalUrl1 = `${baseUrl}?room=${roomName}&user=${userId}`;
    const finalUrl2 = `${baseUrl}?room=${roomName}&user=${partnerId}`;

    const matchText = `🎉 *It's a Match!*`;

    await client.chat.postMessage({ 
        channel: userId, 
        text: "Match found!",
        blocks: [
            { type: "section", text: { type: "mrkdwn", text: matchText } },
            { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Join Call 📹" }, url: finalUrl1, style: "primary" }] }
        ]
    });
    
    await client.chat.postMessage({ 
        channel: partnerId, 
        text: "Match found!",
        blocks: [
            { type: "section", text: { type: "mrkdwn", text: matchText } },
            { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Join Call 📹" }, url: finalUrl2, style: "primary" }] }
        ]
    });
  }
}

// --- SERVER ---
const receiver = http.createServer((req, res) => {
  res.writeHead(200); res.end('WeTime Bot is running!');
});
receiver.listen(process.env.PORT || 3000);

(async () => {
  await app.start();
  console.log('⚡️ WeTime Bot is running!');
})();
