const { App } = require('@slack/bolt');
require('dotenv').config();

// 👇 IMPORT YOUR DATABASE TOOL
const db = require('./db'); 

// --- 🔍 STARTUP DIAGNOSTICS ---
console.log("------------------------------------------------");
console.log("🔍 STARTUP DIAGNOSTICS:");
console.log(`1. SLACK_CLIENT_ID:     ${process.env.SLACK_CLIENT_ID ? '✅ Found' : '❌ MISSING'}`);
console.log(`2. SUPABASE_URL:        ${process.env.SUPABASE_URL ? '✅ Found' : '❌ MISSING'}`);
console.log("------------------------------------------------");

// --- OAUTH INSTALLATION STORE (SUPABASE VERSION) ---
const installationStore = {
  storeInstallation: async (installation) => {
    if (installation.team !== undefined) {
      await db.saveInstall(installation);
      console.log("✅ SUCCESS: Saved Team Token for " + installation.team.id);
      return;
    }
    throw new Error('❌ DATA ERROR: Installation data missing team ID');
  },
  fetchInstallation: async (installQuery) => {
    if (installQuery.teamId !== undefined) {
      const data = await db.getInstall(installQuery.teamId);
      return data;
    }
    throw new Error('Failed fetching installation');
  },
  deleteInstallation: async (installQuery) => {
    console.log("Delete requested for", installQuery.teamId);
  }
};

// --- APP INITIALIZATION ---
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: ['chat:write', 'commands', 'mpim:write', 'im:write'], 
  installationStore: installationStore,
  socketMode: false 
});

// --- DASHBOARD UI (PROFESSIONAL VERSION) ---
const getDashboardBlocks = (userId) => {
  // ⚡️ UPDATED: Points to your new App Domain
  const myAppUrl = "https://wetimeapp.com"; 

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "WeTime Control Center 🚀" }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Hello <@${userId}>!* Welcome to your company's social hub. Use the tools below to connect with your team.`
      }
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "☕ *Speed Coffee*\nGet paired with a random teammate for a 15-minute break. Great for meeting people outside your immediate circle!"
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Join Queue" },
        style: "primary",
        action_id: "btn_speed_coffee"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🎮 *WeTime Arcade*\nCompete in quick browser games and climb the company leaderboard."
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Open Arcade" },
        url: `${myAppUrl}/games`, // uses wetimeapp.com
        action_id: "btn_arcade_link"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🧘 *MeTime*\nTake a moment for guided wellness and personal reflection."
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "MeTime" },
        url: `${myAppUrl}/metime`, // uses wetimeapp.com
        action_id: "btn_metime_link"
      }
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "💡 *Pro-tip:* Type `/wetime` in any channel to pull up this menu instantly."
        }
      ]
    }
  ];
};

// --- EVENTS ---

app.event('app_home_opened', async ({ event, client }) => {
  try {
      console.log(`🏠 App Home opened by user: ${event.user}`);
      // Note: getDashboardBlocks requires the userId to generate the blocks
      const blocks = getDashboardBlocks(event.user);
      
      await client.views.publish({
        user_id: event.user,
        view: { type: 'home', blocks: blocks }
      });
  } catch (error) {
      console.error("Error publishing home view:", error);
  }
});

app.command('/wetime', async ({ command, ack, respond }) => {
  await ack();
  await respond({ blocks: getDashboardBlocks(command.user_id) });
});

// --- BUTTON LISTENERS ---
app.action('btn_arcade_link', async ({ ack }) => { await ack(); });
app.action('btn_metime_link', async ({ ack }) => { await ack(); });
app.action('btn_solo_game', async ({ ack }) => { await ack(); });
app.action('btn_people_directory', async ({ ack }) => { await ack(); }); 

app.action('btn_speed_coffee', async ({ body, ack, client }) => {
  await ack();
  await handleMatchmaking(body, client);
});

// --- MATCHMAKING LOGIC (SUPABASE) ---
async function handleMatchmaking(body, client) {
  const userId = body.user.id;
  const teamId = body.team.id; 

  try {
    // Add user to queue
    await db.addToMatchQueue(userId, teamId, body.channel?.id || 'direct_message');
    // Try to find a match immediately
    const partnerId = await db.findMatch(teamId, userId);

    if (partnerId) {
       // Open a group DM
       const result = await client.conversations.open({
           users: `${userId},${partnerId}`
       });

       if (result.ok) {
           const groupChannelId = result.channel.id;
           await client.chat.postMessage({
               channel: groupChannelId,
               text: "🎉 *It's a Match!*",
               blocks: [
                   { type: "header", text: { type: "plain_text", text: "🎉 It's a Match!" } },
                   { type: "section", text: { type: "mrkdwn", text: `👋 <@${userId}>, meet <@${partnerId}>!` } },
                   { type: "divider" },
                   { type: "section", text: { type: "mrkdwn", text: "Say hi and take a 15-min break!" } }
               ]
           });
       }
    } else {
       // No match found -> Send "Waiting" message with Solo Game link
       await client.chat.postMessage({ 
         channel: userId, 
         text: "You are in the queue! 🕒 Waiting for a partner...",
         blocks: [
             { type: "section", text: { type: "mrkdwn", text: "🕒 *You are in the queue!*" } },
             { type: "section", text: { type: "mrkdwn", text: "We're looking for a partner in your company." } },
             { type: "divider" },
             { 
                 type: "section", 
                 text: { type: "mrkdwn", text: "🎮 *While you wait...*\nWhy not play a quick solo game?" },
                 accessory: {
                     type: "button",
                     text: { type: "plain_text", text: "Play Solo Game 🕹️" },
                     url: "https://wetimeapp.com/games", // ⚡️ UPDATED LINK
                     action_id: "btn_solo_game"
                 }
             }
         ]
       });
    }
  } catch (error) {
    console.error("Matchmaking Error:", error);
  }
}

// --- SERVER ---
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ WeTime Bot is running with Supabase!');
})();
