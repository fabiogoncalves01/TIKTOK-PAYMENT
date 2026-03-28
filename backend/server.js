const express = require('express');
const cors = require('cors');
const { supabase } = require('./database');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/dashboard', async (req, res) => {
  try {
    const { data: accounts, error: errAccounts } = await supabase.from('accounts').select('*');
    if (errAccounts) throw errAccounts;

    const { data: countries, error: errCountries } = await supabase.from('countries').select('*');
    if (errCountries) throw errCountries;

    const { data: views, error: errViews } = await supabase.from('account_views').select('*');
    if (errViews) throw errViews;

    const { data: videoStatsData, error: errVS } = await supabase.from('video_stats').select('*').eq('id', 1).maybeSingle();
    if (errVS) throw errVS;

    const videoStats = videoStatsData || { count: 0, goal: 500 };

    let totalEarnings = 0;
    const accountTotals = (accounts || []).map(a => {
        let accEarn = 0;
        (countries || []).forEach(c => {
            const v = (views || []).find(vw => vw.account_id === a.id && vw.country_id === c.id);
            if(v) accEarn += (v.views * c.rpm);
        });
        totalEarnings += accEarn;
        return { ...a, totalEarn: accEarn };
    });

    res.json({ totalEarnings, accounts: accountTotals, countries, views, videoStats });
  } catch (err) {
    console.error('API /api/dashboard erro:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const id = Math.random().toString(36).slice(2,9);
    const { error } = await supabase.from('accounts').insert([{ id, name: req.body.name }]);
    if (error) throw error;
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    // Foreign key with cascade delete should handle account_views, 
    // but just in case we can explicitly delete or let database handle it
    const { error: error1 } = await supabase.from('account_views').delete().eq('account_id', req.params.id);
    if (error1) throw error1;
    
    const { error: error2 } = await supabase.from('accounts').delete().eq('id', req.params.id);
    if (error2) throw error2;

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/countries', async (req, res) => {
  try {
    const { id, name, rpm } = req.body;
    let finalId = id || Math.random().toString(36).slice(2,9);
    const { error } = await supabase.from('countries').upsert([{ id: finalId, name, rpm }]);
    if (error) throw error;
    res.json({ success: true, id: finalId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/countries/:id', async (req, res) => {
  try {
    const { error: error1 } = await supabase.from('account_views').delete().eq('country_id', req.params.id);
    if (error1) throw error1;

    const { error: error2 } = await supabase.from('countries').delete().eq('id', req.params.id);
    if (error2) throw error2;

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/views', async (req, res) => {
  try {
    const { account_id, country_id, views } = req.body;
    const { error } = await supabase.from('account_views').upsert([{ account_id, country_id, views }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/video-stats', async (req, res) => {
  try {
    const { count, goal } = req.body;
    const { error } = await supabase.from('video_stats').upsert([{ id: 1, count, goal }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Backend conectado ao Supabase rodando na porta ${PORT}`));
}

// Necessário para o Vercel Serverless
module.exports = app;
