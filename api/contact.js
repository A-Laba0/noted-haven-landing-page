// api/contact.js — receives a contact-form POST and stores it in the Supabase "signups" table.
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'Server is missing Supabase configuration.' });
  }

  // Vercel parses JSON and urlencoded request bodies into req.body automatically.
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name || !email) {
    return res.status(400).json({ ok: false, error: 'Name and email are required.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await supabase
    .from('signups')
    .insert({ name, email, message: message || null });

  if (error) {
    console.error('Supabase insert failed:', error);
    return res.status(500).json({ ok: false, error: 'Could not save your message. Please try again.' });
  }

  return res.status(200).json({ ok: true, message: 'Thanks! Your message has been received.' });
};
