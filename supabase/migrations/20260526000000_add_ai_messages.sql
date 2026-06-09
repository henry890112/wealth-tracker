-- AI chat message history
create table if not exists ai_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  model       text,
  created_at  timestamptz not null default now()
);

-- Index for fast per-user ordered fetch
create index if not exists ai_messages_user_created
  on ai_messages (user_id, created_at asc);

-- RLS: each user can only access their own messages
alter table ai_messages enable row level security;

create policy "ai_messages: own rows only"
  on ai_messages
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
