const { App } = require('@slack/bolt');
const admin = require('firebase-admin');
require('dotenv').config();

// --- 1. Initialize Firebase ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- 2. Initialize Slack App ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// --- 3. The Dashboard UI (Block Kit) ---
// This function generates the specific UI blocks for a user
const getDashboardBlocks = (user, coinBalance) => {
  return [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": `Welcome back, ${user}!`
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Connection Streak:* 🔥 4 Weeks\n*Coin Balance:* 🪙 ${coinBalance}`
      }
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Choose your break:*"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "☕ Speed Coffee (1:1)",
            "emoji": true
          },
          "style": "primary",
          "action_id": "btn_speed_coffee"
        },
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "🎮 Micro-Game (Group)",
            "emoji": true
          },
          "action_id": "btn_game"
        },
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "🧘 MeTime",
            "emoji": true
          },
          "action_id": "btn_metime"
        }
      ]
    }
  ];
};

// --- 4. Event: User Opens App Home ---
app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    // In a real app, fetch coinBalance from Firebase here
    const coinBalance = 450; 

    // Publish the Home View
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        callback_id: 'home_view',
        blocks: getDashboardBlocks(event.user, coinBalance)
      }
    });
  } catch (error) {
    logger.error(error);
  }
});

// --- 5. Command: /wetime ---
app.command('/wetime', async ({ command, ack, respond }) => {
  await ack(); // Acknowledge the command instantly

  // Respond with the dashboard buttons inside the chat
  await respond({
    blocks: getDashboardBlocks(command.user_name, 450),
    text: "Welcome to WeTime!" // Fallback text
  });
});

// --- 6. Action: Button Clicks ---
app.action('btn_speed_coffee', async ({ body, ack, say }) => {
  await ack();
  // We will build the queue logic here in Phase 3
  await say(`You clicked Speed Coffee! <@${body.user.id}> joined the queue.`);
});

app.action('btn_game', async ({ body, ack, say }) => {
  await ack();
  await say(`Game mode selected! Looking for players...`);
});

app.action('btn_metime', async ({ body, ack, say }) => {
  await ack();
  await say(`MeTime activated. Snoozing notifications for 1 hour. 🧘`);
});

// --- 7. Start App ---
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ WeTime Bot is running!');
})();