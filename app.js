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

// --- DASHBOARD UI ---
const getDashboardBlocks = (userId) => {
  const myAppUrl = "https://wetime.lovable.app"; 

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
        // Button 2: Arcade
        { 
          type: "button", 
          text: { type: "plain_text", text: "🎮 WeTime Arcade" }, 
          url: `${myAppUrl}/games`, 
          action_id: "btn_arcade_link" 
        },
        // Button 3: MeTime
        { 
          type: "button", 
          text: { type: "plain_text", text: "🧘 MeTime" }, 
          url: `${myAppUrl}/metime`,
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

// --- BUTTON LISTENERS (The "Nod" Fix 🫡) ---
app.action('btn_arcade_link', async ({ ack }) => { await ack(); });
app.action('btn_metime_link', async ({ ack }) => { await ack(); });
app.action('btn_solo_game', async ({ ack }) => { await ack(); });
app.action('btn_people_directory', async ({ ack }) => { await ack(); }); 

app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client, 'match_queue');
});


// --- SHARED MATCHMAKING LOGIC ---
async function handleMatchmaking(body, client, baseCollectionName) {
  const userId = body.user.id;
  const teamId = body.team.id; 

  // 1. CREATE SECURE QUEUE NAME
  const collectionName = `${baseCollectionName}_${teamId}`;
  const queueRef = db.collection(collectionName);

  // 2. Calculate "Stale Time" (30 minutes ago)
  const staleTimeThreshold = new Date(Date.now() - 30 * 60 * 1000);

  // 3. Check the waiting list
  const snapshot = await queueRef.orderBy('joinedAt', 'asc').get();
  
  let partnerId = null;
  let partnerDocId = null;

  // 4. Loop through to find a VALID partner
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.userId === userId) continue;

    const joinedAt = data.joinedAt.toDate();
    if (joinedAt < staleTimeThreshold) {
        console.log(`User ${data.userId} is stale. Removing from queue.`);
        await queueRef.doc(doc.id).delete();
        continue; 
    }

    partnerId = data.userId;
    partnerDocId = doc.id;
    break; 
  }

  if (!partnerId) {
    // --- NO MATCH FOUND: ADD TO QUEUE ---
    await queueRef.doc(userId).set({
      userId: userId,
      joinedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Send "Wait" message with Solo Game
    await client.chat.postMessage({ 
        channel: userId, 
        text: "You are in the queue! 🕒 Waiting for a partner...",
        blocks: [
            { type: "section", text: { type: "mrkdwn", text: "🕒 *You are in the queue!*" } },
            { type: "section", text: { type: "mrkdwn", text: "We're looking for a partner. (Valid for 30 mins)" } },
            { type: "divider" },
            { 
                type: "section", 
                text: { type: "mrkdwn", text: "🎮 *While you wait...*\nWhy not play a quick solo game to warm up?" },
                accessory: {
                    type: "button",
                    text: { type: "plain_text", text: "Play Solo Game 🕹️" },
                    url: "https://wetime.lovable.app/games",
                    style: "primary",
                    action_id: "btn_solo_game"
                }
            }
        ]
    });

  } else {
    // --- MATCH FOUND! ---
    await queueRef.doc(partnerDocId).delete();
    await queueRef.doc(userId).delete(); 

    try {
        const result = await client.conversations.open({
            users: `${userId},${partnerId}`
        });

        if (result.ok) {
            const groupChannelId = result.channel.id;
            
            // 3. Send the Match Message
            await client.chat.postMessage({
                channel: groupChannelId,
                text: "🎉 *It's a Match!*",
                blocks: [
                    { type: "header", text: { type: "plain_text", text: "🎉 It's a Match!" } },
                    { type: "section", text: { type: "mrkdwn", text: `👋 <@${userId}>, meet <@${partnerId}>!` } },
                    { type: "divider" },

                    // --- STEP 1: CHECK-IN ---
                    { 
                        type: "section", 
                        text: { type: "mrkdwn", text: "💬 *Step 1: Say Hi*\nSend a message to confirm you're both still free for a break." } 
                    },

                    // --- STEP 2: HUDDLE ---
                    { 
                        type: "section", 
                        text: { type: "mrkdwn", text: "🎧 *Step 2: Start Talking*\nOnce you're ready, click the *headphone icon* (usually top right) to start the Huddle." } 
                    },

                    // --- STEP 3: ICEBREAKERS (Action Bar) ---
                    { 
                        type: "section", 
                        // UPDATED TEXT: Simplified phrasing as requested
                        text: { type: "mrkdwn", text: "❄️ *Step 3: Break the Ice (Optional)*\nJump into the arcade or learn more about each other in the directory!" } 
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "🎮 Open Arcade" },
                                url: "https://wetime.lovable.app/games",
                                style: "primary",
                                action_id: "btn_arcade_link"
                            },
                            {
                                type: "button",
                                text: { type: "plain_text", text: "👤 View People Directory" },
                                url: "https://wetime.lovable.app/directory", 
                                action_id: "btn_people_directory"
                            }
                        ]
                    }
                ]
            });
        }
    } catch (error) {
        console.error("Error creating match:", error);
        await client.chat.postMessage({ channel: userId, text: `You matched with <@${partnerId}>! Go say hi!` });
        await client.chat.postMessage({ channel: partnerId, text: `You matched with <@${userId}>! Go say hi!` });
    }
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
