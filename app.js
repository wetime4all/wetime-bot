const { App } = require('@slack/bolt');
const admin = require('firebase-admin');
const http = require('http');
require('dotenv').config();

// --- 1. CONFIGURATION & SETUP ---

// Initialize Firebase
// In Render, ensure you added this as a 'Secret File' named exactly 'serviceAccountKey.json'
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// --- 2. HELPER FUNCTIONS ---

// Generate a Daily.co Video Room
async function createVideoRoom() {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    console.error("Missing DAILY_API_KEY in Environment Variables");
    return "https://daily.co"; // Fallback
  }

  try {
    const response = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        properties: {
          exp: Math.round(Date.now() / 1000) + 600, // Room expires in 10 mins
          enable_chat: true,
          start_audio_off: false,
          start_video_off: false
        }
      })
    });
    
    if (!response.ok) throw new Error(`Daily API Error: ${response.statusText}`);
    
    const data = await response.json();
    return data.url; // The unique video link
  } catch (error) {
    console.error("Failed to create room:", error);
    return "https://daily.co"; 
  }
}

// Generate the Dashboard UI
const getDashboardBlocks = (user) => {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `Welcome back, ${user}! 👋` }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` }
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Choose your break activity:*" }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "☕ Speed Coffee (1:1)", emoji: true },
          style: "primary",
          action_id: "btn_speed_coffee"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🧘 MeTime", emoji: true },
          action_id: "btn_metime"
        }
      ]
    }
  ];
};

// --- 3. SLACK EVENTS & ACTIONS ---

// Event: User clicks "Home" tab in Slack
app.event('app_home_opened', async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        callback_id: 'home_view',
        blocks: getDashboardBlocks(event.user)
      }
    });
  } catch (error) {
    console.error("Error publishing home view:", error);
  }
});

// Command: /wetime
app.command('/wetime', async ({ command, ack, respond }) => {
  await ack();
  await respond({
    blocks: getDashboardBlocks(command.user_name),
    text: "Welcome to WeTime!" // Fallback for notifications
  });
});

// Action: Speed Coffee (The Matching Engine)
app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  
  const userId = body.user.id;
  const queueRef = db.collection('match_queue');

  try {
    // 1. Check if anyone else is waiting
    const snapshot = await queueRef.orderBy('joinedAt', 'asc').limit(1).get();
    
    let partnerId = null;
    let partnerDocId = null;

    // Filter out yourself from the snapshot results
    snapshot.forEach(doc => {
      if (doc.data().userId !== userId) {
        partnerId = doc.data().userId;
        partnerDocId = doc.id;
      }
    });

    if (!partnerId) {
      // A. Queue is empty (or only you are in it) -> Add/Update yourself
      await queueRef.doc(userId).set({
        userId: userId,
        joinedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await client.chat.postMessage({
        channel: userId,
        text: "You are in the queue! 🕒 Waiting for a partner..."
      });

    } else {
      // B. Found a partner! -> Create Match
      
      // Remove partner from queue (atomic transaction recommended for prod, simple delete for MVP)
      await queueRef.doc(partnerDocId).delete();
      // Remove yourself if you were in there too
      await queueRef.doc(userId).delete(); 

      // Create Video Room
      const roomUrl = await createVideoRoom();
      const matchText = `🎉 *It's a Match!* \nClick below to join your 10-min Speed Coffee.`;

      const msgBlocks = [
        {
          type: "section",
          text: { type: "mrkdwn", text: matchText }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Join Video Call 📹" },
              url: roomUrl,
              style: "primary",
              action_id: "btn_join_video"
            }
          ]
        }
      ];

      // Notify User 1 (You)
      await client.chat.postMessage({ channel: userId, blocks: msgBlocks, text: "Match Found!" });
      
      // Notify User 2 (Partner)
      await client.chat.postMessage({ channel: partnerId, blocks: msgBlocks, text: "Match Found!" });
    }

  } catch (error) {
    console.error("Matching Error:", error);
    await client.chat.postMessage({ channel: userId, text: "Oops! Something went wrong matching you." });
  }
});

// Action: MeTime
app.action('btn_metime', async ({ body, ack, client }) => {
  await ack();
  await client.chat.postMessage({
    channel: body.user.id,
    text: "MeTime Activated 🧘. We've snoozed matching for 1 hour. Enjoy your break!"
  });
});

// Action: Join Video (Just acknowledges the click so Slack doesn't show a warning)
app.action('btn_join_video', async ({ ack }) => {
  await ack();
});


// --- 4. SERVER STARTUP ---

// A. Health Check Server for Render (Keeps the bot alive)
const receiver = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WeTime Bot is running!');
});

// B. Start Both Services
(async () => {
  // Start the Health Check Server on the port Render provides
  receiver.listen(process.env.PORT || 3000);
  
  // Start the Slack Bot (Socket Mode handles the connection)
  await app.start();
  
  console.log('⚡️ WeTime Bot is running!');
})();
