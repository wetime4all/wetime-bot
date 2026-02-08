const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ✅ CONFIG: Ensure this matches your Table Name in Supabase
const INSTALL_TABLE = 'slack_installations'; 

module.exports = {

  /* ------------------------------------------------------------------
     1. AUTH & TEAMS (🔴 UPDATED to fix 'not_authed')
     ------------------------------------------------------------------ */
  
  // We switched this to save the WHOLE installation object as JSON.
  // This ensures Slack has every single permission it needs without getting confused.
  saveInstall: async (installation) => {
    const { error } = await supabase
      .from(INSTALL_TABLE)
      .upsert({ 
        team_id: installation.team.id, 
        data: installation // <--- This is the magic fix
      });

    if (error) console.error('Error saving install:', error);
    
    // Optional: Also save the admin user
    if (installation.user && installation.user.id) {
       await module.exports.saveUser(installation.user.id, installation.team.id);
    }
  },

  getInstall: async (teamId) => {
    const { data, error } = await supabase
      .from(INSTALL_TABLE)
      .select('data')
      .eq('team_id', teamId)
      .single();

    if (error) return null;
    
    // 🛠️ Unwrap the JSON so Slack can read it
    return data ? data.data : null;
  },

  /* ------------------------------------------------------------------
     2. USERS & DIRECTORY (🟢 KEPT AS IS)
     ------------------------------------------------------------------ */

  // This code is great. We added the 'saveUser' helper for simple tracking too.
  saveUser: async (userId, teamId) => {
    const { error } = await supabase
      .from('users')
      .upsert({ id: userId, team_id: teamId });
    if (error) console.error('Error saving user:', error);
  },

  getUser: async (userId, teamId) => {
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
      // Create new user if they don't exist
      const { data: newUser } = await supabase
        .from('users')
        .insert({ id: userId, team_id: teamId, credits: 0 })
        .select()
        .single();
      return newUser;
    }
    return user;
  },

  updateProfile: async (userId, updates) => {
    await supabase.from('users').update(updates).eq('id', userId);
  },

  /* ------------------------------------------------------------------
     3. SPEED COFFEE (🔴 UPDATED to match your Database)
     ------------------------------------------------------------------ */

  // Removed 'status' because your current table doesn't have that column.
  // Being in the table *implies* you are waiting.
  addToMatchQueue: async (userId, teamId, channelId) => {
    // 1. Clear old requests
    await supabase.from('match_queue').delete().eq('user_id', userId);

    // 2. Add to line
    const { error } = await supabase
      .from('match_queue')
      .upsert({ 
        user_id: userId, 
        team_id: teamId, 
        channel_id: channelId,
        joined_at: new Date().toISOString()
      });
      
    if (error) console.error("Queue Error:", error);
  },

  findMatch: async (teamId, myUserId) => {
    const { data: queue, error } = await supabase
      .from('match_queue')
      .select('*')
      .eq('team_id', teamId)
      .neq('user_id', myUserId)
      .order('joined_at', { ascending: true }) // First come, first served
      .limit(1);

    if (error || !queue || queue.length === 0) return null;

    const partner = queue[0];
    
    // Remove BOTH people from the queue
    await supabase.from('match_queue').delete().eq('user_id', partner.user_id);
    await supabase.from('match_queue').delete().eq('user_id', myUserId);

    return partner.user_id;
  },

  /* ------------------------------------------------------------------
     4. ARCADE (🟢 KEPT AS IS)
     ------------------------------------------------------------------ */

  saveScore: async (userId, teamId, gameType, score) => {
    await supabase
      .from('arcade_scores')
      .insert({
        user_id: userId,
        team_id: teamId,
        game_type: gameType,
        score: score
      });
  },

  getTopScores: async (teamId, gameType) => {
    const { data } = await supabase
      .from('arcade_scores')
      .select('*')
      .eq('team_id', teamId)
      .eq('game_type', gameType)
      .order('score', { ascending: false })
      .limit(5);
    return data;
  }
};
