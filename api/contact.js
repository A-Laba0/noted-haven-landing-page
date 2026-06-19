// api/contact.js — stores a contact-form submission in Supabase, then sends a best-effort confirmation email.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

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

  // Best-effort confirmation email. The submission is already saved, so any
  // email failure is logged and swallowed — it must never change the response.
  await sendConfirmationEmail(name, email);

  return res.status(200).json({ ok: true, message: 'Thanks! Your message has been received.' });
};

async function sendConfirmationEmail(name, email) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping confirmation email.');
    return;
  }

  const safeName = name.replace(/[<>&]/g, function (c) {
    return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;';
  });

  const text =
    `Hi ${name},\n\n` +
    `Thanks so much for reaching out to Noted Haven — your message just landed with us!\n\n` +
    `We can't wait to help make something that feels unmistakably yours. We'll be in touch ` +
    `soon with a free design preview, and there's no commitment until you love it.\n\n` +
    `Talk soon,\n` +
    `The Noted Haven team`;

  const html =
    `<div style="font-family: Arial, Helvetica, sans-serif; color: #16302F; line-height: 1.6;">` +
      `<p>Hi ${safeName},</p>` +
      `<p>Thanks so much for reaching out to <strong>Noted Haven</strong> — your message just landed with us!</p>` +
      `<p>We can't wait to help make something that feels unmistakably yours. We'll be in touch soon ` +
      `with a <strong>free design preview</strong>, and there's no commitment until you love it.</p>` +
      `<p>Talk soon,<br>The Noted Haven team</p>` +
    `</div>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: `Thanks for reaching out, ${name}`,
      text: text,
      html: html
    });
    if (error) {
      console.error('Resend email failed:', error);
    }
  } catch (e) {
    console.error('Resend email threw:', e);
  }
}
