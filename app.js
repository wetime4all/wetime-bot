const { App } = require('@slack/bolt');
require('dotenv').config();

// 👇 IMPORT YOUR NEW DATABASE TOOL
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
    // 1. Save the token to Supabase
    if (installation.team !== undefined) {
      await db.saveInstall(installation);
      console.log("✅ SUCCESS: Saved Team Token for " + installation.team.id);
      return;
    }
    throw new Error('❌ DATA ERROR: Installation data missing team ID');
  },
  fetchInstallation: async (installQuery) => {
    // 2. Fetch the token from Supabase
    if (installQuery.teamId !== undefined) {
      const data = await db.getInstall(installQuery.teamId);
      return data;
    }
    throw new Error('Failed fetching installation');
  },
  deleteInstallation: async (installQuery) => {
    // We can implement delete later if needed
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

// --- DASHBOARD UI ---
const getDashboardBlocks = (userId) => {
  const myAppUrl = "https://wetime.lovable.app"; 

  return [
    { type: "header", text: { type: "plain_text", text: `Welcome back! 👋` } },
    { type: "section", text: { type: "mrkdwn", text: `*Status:* Ready to connect 🚀` } },
    { type: "divider" },
    { type: "actions", elements: [
        { 
          type: "button", 
          text: { type: "plain_text", text: "☕ Speed Coffee" }, 
          style: "primary", 
          action_id: "btn_speed_coffee" 
        },
        { 
          type: "button", 
          text: { type: "plain_text", text: "🎮 WeTime Arcade" }, 
          url: `${myAppUrl}/games`, 
          action_id: "btn_arcade_link" 
        },
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
  try {
      await client.views.publish({
        user_id: event.user,
        view: { type: 'home', blocks: getDashboardBlocks(event.user) }
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


// --- NEW CLEAN MATCHMAKING LOGIC (SUPABASE) ---
async function handleMatchmaking(body, client) {
  const userId = body.user.id;
  const teamId = body.team.id; 

  try {
    // 1. Put me in the queue
    // (This uses the function we wrote in db.js)
    await db.addToMatchQueue(userId, teamId, body.channel?.id || 'direct_message');

    // 2. Look for a partner
    // (This automatically searches ONLY within my team)
    const partnerId = await db.findMatch(teamId, userId);

    if (partnerId) {
       // --- MATCH FOUND! ---
       // Open a group message with both users
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
       // --- NO MATCH YET ---
       // Send the "Waiting" message to just the user
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
                     url: "https://wetime.lovable.app/games",
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
