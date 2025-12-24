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
  
  // !!! UPDATE THIS WITH YOUR GITHUB PAGES URL !!!
  const myAppUrl = "https://wetime4all.github.io/wetime-bot/"; 
  
  // We return the base URL here. We append &user= later in logic.
  // Actually, let's keep it simple and handle params in the actions.
  return `${myAppUrl}?room=${roomName}&user=${userId}`;
}

// --- DASHBOARD UI ---
const getDashboardBlocks = (user) => {
  return [
    { type: "header", text: { type: "plain_text", text: `Welcome back, ${user}! 👋` } },
    { type: "section", text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` } },
    { type: "divider" },
    { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "☕ Speed Coffee" }, style: "primary", action_id: "btn_speed_coffee" },
        { type: "button", text: { type: "plain_text", text: "🎮 WeTime Arcade" }, action_id: "btn_arcade" }, // RENAMED
        { type: "button", text: { type: "plain_text", text: "🧘 MeTime" }, action_id: "btn_metime" }
      ]
    }
  ];
};

// 2. Add the Generic "Arcade" Handler (Replaces btn_connect4)
app.action('btn_arcade', async ({ body, ack, client }) => {
  await ack();
  // Send them to the 'lobby' mode. The frontend handles the rest.
  await handleMatchmaking(body, client, 'game_queue', '&mode=lobby');
});

// --- EVENTS ---

app.event('app_home_opened', async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: { type: 'home', blocks: getDashboardBlocks(event.user) }
  });
});

app.command('/wetime', async ({ command, ack, respond }) => {
  await ack();
  await respond({ blocks: getDashboardBlocks(command.user_name) });
});

// --- ACTION 1: SPEED COFFEE ---
app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client, 'match_queue', '');
});

// --- ACTION 2: CONNECT 4 (NEW) ---
app.action('btn_connect4', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client, 'game_queue', '&mode=connect4');
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
    const roomUrl2 = createVideoRoom(partnerId) + urlSuffix; // Note: In a real app, room name must be same.
    
    // FIX: Generate ONE room name for both
    const uniqueId = Math.random().toString(36).substring(2, 12);
    const roomName = `WeTime-${uniqueId}`;
    const baseUrl = "https://wetime4all.github.io/wetime-bot/"; // UPDATE THIS
    
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

app.action('btn_metime', async ({ body, ack, client }) => {
  await ack();
  await client.chat.postMessage({ channel: body.user.id, text: "MeTime Activated 🧘. Matching snoozed." });
});

// --- SERVER ---
const receiver = http.createServer((req, res) => {
  res.writeHead(200); res.end('WeTime Bot is running!');
});
receiver.listen(process.env.PORT || 3000);

(async () => {
  await app.start();
  console.log('⚡️ WeTime Bot is running!');
})();