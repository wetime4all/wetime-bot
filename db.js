const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Supabase
// These automatically pull the keys you saved in Render earlier
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
  /* ------------------------------------------------------------------
     1. AUTH & TEAMS (The "Keys")
     ------------------------------------------------------------------ */
  
  // Save a new team when they install the app
  saveInstall: async (installation) => {
    const { error } = await supabase
      .from('slack_installations')
      .upsert({
        team_id: installation.team.id,
        team_name: installation.team.name,
        bot_token: installation.bot.token,
        bot_id: installation.bot.id,
        bot_user_id: installation.bot.userId,
        installed_at: new Date()
      });
    
    if (error) console.error('Error saving install:', error);
    return !error;
  },

  // Get a team's tokens so the bot can reply
  getInstall: async (teamId) => {
    const { data, error } = await supabase
      .from('slack_installations')
      .select('*')
      .eq('team_id', teamId)
      .single();

    if (error) console.error('Error fetching install:', error);
    return data;
  },

  /* ------------------------------------------------------------------
     2. USERS & DIRECTORY
     ------------------------------------------------------------------ */

  // Get a user (or create them if new)
  getUser: async (userId, teamId) => {
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ id: userId, team_id: teamId, credits: 0 })
        .select()
        .single();
      return newUser;
    }
    return user;
  },

  // Save Directory Info (Department, Interests)
  updateProfile: async (userId, updates) => {
    await supabase
      .from('users')
      .update(updates) // e.g. { department: 'Sales', interests: ['Skiing'] }
      .eq('id', userId);
  },

  /* ------------------------------------------------------------------
     3. COFFEE CHATS (The Queue)
     ------------------------------------------------------------------ */

  addToMatchQueue: async (userId, teamId, channelId) => {
    // Remove any old waiting requests first
    await supabase.from('match_queue').delete().eq('user_id', userId);

    await supabase
      .from('match_queue')
      .insert({
        user_id: userId,
        team_id: teamId,
        channel_id: channelId,
        status: 'waiting'
      });
  },

  findMatch: async (teamId, currentUserId) => {
    // Find someone else in the SAME team who is 'waiting'
    const { data } = await supabase
      .from('match_queue')
      .select('*')
      .eq('team_id', teamId)
      .neq('user_id', currentUserId)
      .eq('status', 'waiting')
      .limit(1)
      .single();

    if (data) {
      // Remove both users from the queue so they don't get matched again
      await supabase.from('match_queue').delete().eq('id', data.id);
      await supabase.from('match_queue').delete().eq('user_id', currentUserId);
      return data.user_id; // Return the match's ID
    }
    return null;
  },

  /* ------------------------------------------------------------------
     4. ARCADE (High Scores)
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
