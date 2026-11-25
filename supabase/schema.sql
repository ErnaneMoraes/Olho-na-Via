-- Schema SQL de Referência — Olho na Via (Iteração 4 / Supabase)
-- Execute no SQL Editor do projeto Supabase antes de ativar a sincronização em produção.

create extension if not exists "pgcrypto";

-- 1. Perfis públicos (apelido dos usuários autenticados)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) >= 2),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Perfis visíveis para leitura pública"
  on public.profiles for select
  using (true);

create policy "Usuário cria o próprio perfil"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Usuário atualiza o próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- 2. Relatos de buracos (exibe "Usuário Anônimo" ao público preservando user_id para moderação administrativa)
create table if not exists public.potholes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  author_nickname text,
  is_anonymous boolean not null default false,
  latitude double precision not null,
  longitude double precision not null,
  street_address text not null,
  comment text not null default '',
  status text not null default 'open' check (status in ('open', 'fixed')),
  thumb_url text not null,
  full_url text not null,
  confirmations integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.potholes
  drop constraint if exists potholes_lgpd_anonymous_check;

alter table public.potholes
  drop constraint if exists potholes_comment_check;

alter table public.potholes
  add constraint potholes_comment_check
  check (comment is null or char_length(comment) <= 280);

alter table public.potholes
  alter column comment set default '';

create index if not exists idx_potholes_lat_lng
  on public.potholes (latitude, longitude);

alter table public.potholes enable row level security;

create policy "Buracos visíveis para leitura pública"
  on public.potholes for select
  using (true);

create policy "Usuários autenticados publicam buracos mantendo vínculo interno"
  on public.potholes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      not is_anonymous
      or author_nickname is null
      or author_nickname = 'Usuário Anônimo'
    )
  );

create policy "Usuários autenticados atualizam status do buraco"
  on public.potholes for update
  to authenticated
  using (true)
  with check (status in ('open', 'fixed'));

drop policy if exists "Autor original atualiza status do proprio relato" on public.potholes;
create policy "Autor original atualiza status do proprio relato"
  on public.potholes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status in ('open', 'fixed'));

-- 3. Histórico de verificações comunitárias ("Continua Aberto" / "Já foi Tampado")
create table if not exists public.pothole_updates (
  id uuid primary key default gen_random_uuid(),
  pothole_id uuid not null references public.potholes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author_nickname text,
  is_anonymous boolean not null default false,
  status text not null check (status in ('open', 'fixed')),
  note text default '',
  thumb_url text,
  full_url text,
  created_at timestamptz not null default now()
);

alter table public.pothole_updates
  alter column thumb_url drop not null;

alter table public.pothole_updates
  alter column full_url drop not null;

alter table public.pothole_updates
  drop constraint if exists pothole_updates_lgpd_anonymous_check;

alter table public.pothole_updates
  drop constraint if exists updates_lgpd_anonymous_check;

create index if not exists idx_pothole_updates_pothole_id
  on public.pothole_updates (pothole_id, created_at desc);

alter table public.pothole_updates enable row level security;

create policy "Verificações visíveis para leitura pública"
  on public.pothole_updates for select
  using (true);

create policy "Usuários autenticados registram verificações mantendo vínculo interno"
  on public.pothole_updates for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      not is_anonymous
      or author_nickname is null
      or author_nickname = 'Usuário Anônimo'
    )
  );

-- 4. Bucket de Storage para miniaturas (thumbs/) e fotos originais (originals/)
insert into storage.buckets (id, name, public)
values ('pothole-photos', 'pothole-photos', true)
on conflict (id) do nothing;

create policy "Leitura pública de fotos de buracos"
  on storage.objects for select
  using (bucket_id = 'pothole-photos');

create policy "Upload autenticado de fotos de buracos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'pothole-photos');

-- 5. Sistema de Moderação Administrativa Estritamente Restrito
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

create policy "Usuário autenticado verifica apenas o próprio status de admin"
  on public.app_admins for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins where user_id = auth.uid()
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin();
$$;

-- RPC segura para administradores identificarem autores reais de publicações anônimas
create or replace function public.admin_get_user_identities()
returns table (
  user_id uuid,
  email text,
  nickname text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: somente administradores podem consultar identidades de autores.';
  end if;

  return query
  select
    u.id as user_id,
    u.email::text as email,
    coalesce(p.nickname, 'Cidadão')::text as nickname
  from auth.users u
  left join public.profiles p on p.id = u.id;
end;
$$;

revoke all on function public.admin_get_user_identities() from public;
grant execute on function public.admin_get_user_identities() to authenticated;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created_at
  on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

create policy "Somente admins leem auditoria"
  on public.admin_audit_logs for select
  to authenticated
  using (public.is_app_admin());

create policy "Somente admins gravam auditoria"
  on public.admin_audit_logs for insert
  to authenticated
  with check (public.is_app_admin());

-- Políticas DELETE restritas a administradores
create policy "Somente admins excluem buracos"
  on public.potholes for delete
  to authenticated
  using (public.is_app_admin());

create policy "Somente admins excluem atualizações"
  on public.pothole_updates for delete
  to authenticated
  using (public.is_app_admin());

create policy "Somente admins apagam perfis"
  on public.profiles for delete
  to authenticated
  using (public.is_app_admin());

create policy "Somente admins removem fotos de buracos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'pothole-photos' and public.is_app_admin());

-- RPC segura para exclusão completa de conta em auth.users (cascateando profiles)
create or replace function public.admin_delete_user_account(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado: somente administradores podem excluir contas.';
  end if;

  if target_user_id is null then
    raise exception 'ID de usuário inválido.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Operação bloqueada: você não pode excluir a própria conta administrativa.';
  end if;

  if exists (select 1 from public.app_admins where user_id = target_user_id) then
    raise exception 'Operação bloqueada: remova os privilégios de administrador antes de excluir esta conta.';
  end if;

  delete from auth.users where id = target_user_id;

  insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  values (auth.uid(), 'DELETE_FULL_ACCOUNT', 'auth_user', target_user_id::text, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.admin_delete_user_account(uuid) from public;
grant execute on function public.admin_delete_user_account(uuid) to authenticated;

-- RPC segura para redefinição administrativa de senha de qualquer usuário
create or replace function public.admin_reset_user_password(target_user_id uuid, new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado: somente administradores podem redefinir senhas.';
  end if;

  if target_user_id is null then
    raise exception 'ID de usuário inválido.';
  end if;

  if char_length(coalesce(new_password, '')) < 6 then
    raise exception 'A nova senha deve ter pelo menos 6 caracteres.';
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  values (auth.uid(), 'RESET_USER_PASSWORD', 'auth_user', target_user_id::text, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.admin_reset_user_password(uuid, text) from public;
grant execute on function public.admin_reset_user_password(uuid, text) to authenticated;

-- 7. Notificações no App (Revisão de Correção pelo Autor)
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  pothole_id uuid not null references public.potholes(id) on delete cascade,
  pothole_update_id uuid references public.pothole_updates(id) on delete set null,
  type text not null default 'repair_review_requested',
  title text not null,
  body text not null,
  is_read boolean not null default false,
  review_decision text check (review_decision in ('approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_recipient_unread
  on public.user_notifications (recipient_user_id, is_read, created_at desc);

create unique index if not exists idx_unique_pending_review_per_actor
  on public.user_notifications (pothole_id, actor_user_id)
  where type = 'repair_review_requested'
    and review_decision is null
    and actor_user_id is not null;

alter table public.user_notifications enable row level security;

drop policy if exists "Recipients can view own notifications" on public.user_notifications;
create policy "Recipients can view own notifications"
  on public.user_notifications for select
  using (
    auth.uid() = recipient_user_id
    or auth.uid() = actor_user_id
    or (type = 'repair_review_requested' and review_decision is null)
  );

drop policy if exists "Recipients can update own notifications" on public.user_notifications;
create policy "Recipients can update own notifications"
  on public.user_notifications for update
  to authenticated
  using (auth.uid() = recipient_user_id)
  with check (auth.uid() = recipient_user_id);

drop policy if exists "Authenticated users can notify repair review" on public.user_notifications;
create policy "Authenticated users can notify repair review"
  on public.user_notifications for insert
  to authenticated
  with check (
    auth.uid() = actor_user_id
    and recipient_user_id is not null
    and recipient_user_id <> auth.uid()
  );
