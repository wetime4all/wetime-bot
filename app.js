const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
require('dotenv').config();

// 👇 IMPORT YOUR DATABASE TOOL
const db = require('./db'); 

// --- 🔍 STARTUP DIAGNOSTICS ---
console.log("------------------------------------------------");
console.log("🔍 STARTUP DIAGNOSTICS:");
console.log(`1. SLACK_CLIENT_ID:      ${process.env.SLACK_CLIENT_ID ? '✅ Found' : '❌ MISSING'}`);
console.log(`2. SUPABASE_URL:         ${process.env.SUPABASE_URL ? '✅ Found' : '❌ MISSING'}`);
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
    // This handles the internal Bolt cleanup
    await db.deleteInstallation(installQuery.teamId);
    console.log("🗑️ Bolt requested deletion for", installQuery.teamId);
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
  socketMode: false,
  
  installerOptions: {
    callbackOptions: {
      success: async (installation, installOptions, req, res) => {
        const client = new WebClient(installation.bot.token);
        try {
          await client.chat.postMessage({
            channel: installation.user.id,
            text: "🚀 Thanks for adding WeTime to your workspace! To get started and view your Control Center, simply type `/wetime` in any channel or DM, or click the *Home* tab at the top of this screen!"
          });
        } catch (error) {
          console.error("Failed to send welcome message:", error);
        }

        res.writeHead(302, { Location: `slack://app?team=${installation.team.id}&id=${installation.appId}` }); 
        res.end();
      },
      failure: (error, installOptions, req, res) => {
        res.writeHead(302, { Location: 'https://wetimeapp.com/error' }); 
        res.end();
      }
    }
  }
});

// --- DASHBOARD UI ---
const getDashboardBlocks = (userId) => {
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
        url: `${myAppUrl}/games`,
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
        url: `${myAppUrl}/metime`,
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
      const blocks = getDashboardBlocks(event.user);
      await client.views.publish({
        user_id: event.user,
        view: { type: 'home', blocks: blocks }
      });
  } catch (error) {
      console.error("Error publishing home view:", error);
  }
});

// 🛠️ NEW: AUTOMATIC UNINSTALL HANDLER
app.event('app_uninstalled', async ({ body }) => {
  const teamId = body.team_id;
  try {
    await db.deleteInstallation(teamId);
    console.log(`⚠️ WeTime was uninstalled from team ${teamId}. Data purged.`);
  } catch (error) {
    console.error("Error during uninstallation cleanup:", error);
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
    await db.addToMatchQueue(userId, teamId, body.channel?.id || 'direct_message');
    const partnerId = await db.findMatch(teamId, userId);

    if (partnerId) {
       const result = await client.conversations.open({
           users: `${userId},${partnerId}`
       });

       if (result.ok) {
           const groupChannelId = result.channel.id;
           await client.chat.postMessage({
               channel: groupChannelId,
               text: "🎉 It's a Match!",
               blocks: [
                   {
                       type: "header",
                       text: { type: "plain_text", text: "🎉 It's a Match!" }
                   },
                   {
                       type: "section",
                       text: { type: "mrkdwn", text: `👋 <@${userId}>, meet <@${partnerId}>!` }
                   },
                   { type: "divider" },
                   {
                       type: "section",
                       text: {
                           type: "mrkdwn",
                           text: "*Step 1: Sync Up* 💬\nSend a quick message below to confirm you're both free right now."
                       }
                   },
                   {
                       type: "section",
                       text: {
                           type: "mrkdwn",
                           text: "*Step 2: Start Talking* 🗣️\nOnce confirmed, click the *Huddle toggle* (headphone icon bottom-left) to start the call."
                       }
                   },
                   {
                       type: "section",
                       text: {
                           type: "mrkdwn",
                           text: "*Step 3: Play (Optional)* 🎮\nWant to break the ice? Jump into the arcade!"
                       },
                       accessory: {
                           type: "button",
                           text: { type: "plain_text", text: "Open WeTime Arcade 🕹️" },
                           url: "https://wetimeapp.com/games", 
                           style: "primary",
                           action_id: "btn_arcade_link"
                       }
                   }
               ]
           });
       }
    } else {
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
                     url: "https://wetimeapp.com/games",
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
