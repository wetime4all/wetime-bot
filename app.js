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
// Used only for the Speed Coffee matchmaking logic
function createVideoRoom(userId) {
  const uniqueId = Math.random().toString(36).substring(2, 12);
  const roomName = `WeTime-${uniqueId}`;
  
  // !!! UPDATE THIS WITH YOUR GITHUB PAGES URL !!!
  const myAppUrl = "https://wetime4all.github.io/wetime-bot/"; 
  
  return `${myAppUrl}?room=${roomName}&user=${userId}`;
}

// --- DASHBOARD UI (UPDATED FOR DIRECT LINKS) ---
const getDashboardBlocks = (userId) => {
  // Define base URL for your website
  const myAppUrl = "https://wetime4all.github.io/wetime-bot/"; 

  return [
    { type: "header", text: { type: "plain_text", text: `Welcome back! 👋` } },
    { type: "section", text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` } },
    { type: "divider" },
    { type: "actions", elements: [
        // Button 1: Speed Coffee (Still uses backend logic)
        { 
          type: "button", 
          text: { type: "plain_text", text: "☕ Speed Coffee" }, 
          style: "primary", 
          action_id: "btn_speed_coffee" 
        },

        // Button 2: Arcade (DIRECT LINK -> Games Tab)
        // We add '&mode=arcade' so the HTML knows to switch tabs
        { 
          type: "button", 
          text: { type: "plain_text", text: "🎮 WeTime Arcade" }, 
          url: `${myAppUrl}?user=${userId}&mode=arcade`, 
          action_id: "btn_arcade_link" 
        },

        // Button 3: MeTime (DIRECT LINK -> MeTime Tab)
        // We add '&mode=metime' so the HTML knows to switch tabs
        { 
          type: "button", 
          text: { type: "plain_text", text: "🧘 MeTime" }, 
          url: `${myAppUrl}?user=${userId}&mode=metime`,
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
  // Crucial: We use command.user_id so the website knows WHO clicked the link
  await respond({ blocks: getDashboardBlocks(command.user_id) });
});

// --- ACTION 1: SPEED COFFEE ---
// This is the only button that triggers backend code (matchmaking)
app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client, 'match_queue', '');
});

// Note: 'btn_arcade' and 'btn_metime' handlers are REMOVED 
// because the buttons now open the browser directly!

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
    // Add to queue
    await queueRef.doc(userId).set({
      userId: userId,
      joinedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await client.chat.postMessage({ channel: userId, text: "You are in the queue! 🕒 Waiting for a partner..." });
  } else {
    // Match found!
    await queueRef.doc(partnerDocId).delete();
    await queueRef.doc(userId).delete(); 

    // Generate Base URL for User 1
    const roomUrl1 = createVideoRoom(userId) + urlSuffix;
    // Generate Base URL for User 2
    const roomUrl2 = createVideoRoom(partnerId) + urlSuffix; 
    
    // In a real app, ensure room name is identical for both
    const uniqueId = Math.random().toString(36).substring(2, 12);
    const roomName = `WeTime-${uniqueId}`;
    const baseUrl = "https://wetime4all.github.io/wetime-bot/"; 
    
    const finalUrl1 = `${baseUrl}?room=${roomName}&user=${userId}${urlSuffix}`;
    const finalUrl2 = `${baseUrl}?room=${roomName}&user=${partnerId}${urlSuffix}`;

    const matchText = `🎉 *It's a Match!*`;

    // Notify User 1
    await client.chat.postMessage({ 
        channel: userId, 
        text: "Match found!",
        blocks: [
            { type: "section", text: { type: "mrkdwn", text: matchText } },
            { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Join Call 📹" }, url: finalUrl1, style: "primary" }] }
        ]
    });
    
    // Notify User 2
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
