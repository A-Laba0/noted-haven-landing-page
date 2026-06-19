-- Create the signups table for the landing-page contact form.
create table if not exists signups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  message    text,
  created_at timestamptz not null default now()
);

-- Disable row level security (requested; revisit before exposing writes publicly).
alter table signups disable row level security;
