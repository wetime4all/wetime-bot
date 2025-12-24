const { App } = require('@slack/bolt');
const admin = require('firebase-admin');
require('dotenv').config();

// --- 1. Initialize Firebase ---
const serviceAccount = require('./serviceAccountKey.json'); // Local dev
// For Render (Production), we check if the secret file exists, or handle via ENV if you preferred that route.
// Since you used "Secret Files" in Render, this path './serviceAccountKey.json' works perfectly there too!

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- 2. Initialize Slack App ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Auto-disabled in production if appToken is missing, but good to keep
  appToken: process.env.SLACK_APP_TOKEN
});

// --- HELPER: Create Daily.co Room ---
async function createVideoRoom() {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return "https://daily.co"; // Fallback if key missing

  try {
    const response = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        properties: {
          exp: Math.round(Date.now() / 1000) + 600, // Expires in 10 mins
          enable_chat: true
        }
      })
    });
    const data = await response.json();
    return data.url; // Returns the unique room link
  } catch (error) {
    console.error("Daily API Error:", error);
    return "https://daily.co";
  }
}

// --- HELPER: Dashboard Blocks ---
const getDashboardBlocks = (user) => {
  return [
    { type: "header", text: { type: "plain_text", text: `Welcome back, ${user}!` } },
    { type: "section", text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*Choose your break:*" } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "☕ Speed Coffee (1:1)", emoji: true }, style: "primary", action_id: "btn_speed_coffee" },
        { type: "button", text: { type: "plain_text", text: "🧘 MeTime", emoji: true }, action_id: "btn_metime" }
      ]
    }
  ];
};

// --- EVENTS ---

// 1. Home Tab
app.event('app_home_opened', async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: { type: 'home', blocks: getDashboardBlocks(event.user) }
  });
});

// 2. Command
app.command('/wetime', async ({ command, ack, respond }) => {
  await ack();
  await respond({ blocks: getDashboardBlocks(command.user_name) });
});

// 3. ACTION: Speed Coffee (THE MATCHING LOGIC)
app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  const userId = body.user.id;
  const queueRef = db.collection('match_queue');

  // Check if anyone else is waiting
  const snapshot = await queueRef.limit(1).get();

  if (snapshot.empty) {
    // A. Queue is empty -> Add yourself
    await queueRef.doc(userId).set({
      userId: userId,
      joinedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await client.chat.postMessage({
      channel: userId,
      text: "You are in the queue! 🕒 Waiting for a partner..."
    });

  } else {
    // B. Found someone! -> Match them
    let partnerId;
    snapshot.forEach(doc => { partnerId = doc.id; });

    // Prevent matching with self (edge case)
    if (partnerId === userId) {
      await client.chat.postMessage({ channel: userId, text: "You are already in the queue." });
      return;
    }

    // Remove partner from queue
    await queueRef.doc(partnerId).delete();

    // Create Room
    const roomUrl = await createVideoRoom();

    // Notify BOTH users
    const matchMsg = `🎉 *It's a Match!* \nClick below to join your 10-min Speed Coffee.`;
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: matchMsg } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Join Video Call 📹" }, url: roomUrl, style: "primary" }] }
    ];

    // Send to You
    await client.chat.postMessage({ channel: userId, blocks: blocks, text: "Match found!" });
    // Send to Partner
    await client.chat.postMessage({ channel: partnerId, blocks: blocks, text: "Match found!" });
  }
});

app.action('btn_metime', async ({ body, ack, client }) => {
  await ack();
  await client.chat.postMessage({ channel: body.user.id, text: "MeTime Activated. See you in an hour! 🧘" });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ WeTime Bot is running!');
})();
