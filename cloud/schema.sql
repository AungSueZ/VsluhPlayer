-- ============================================================
--  Вслух в облаке: схема и политики доступа
--
--  ЧЕРНОВИК. Ничего этого пока не применено и применять некуда:
--  проекта в Supabase нет. Лежит рядом с заглушкой в src/cloud.js
--  и удаляется вместе с ней.
--
--  Главное, что определило всю схему: в плеере id трека - это
--  md5 от пути к файлу (lib/library.js, idOf). На другом компьютере
--  тот же трек лежит по другому пути, значит и id у него другой.
--  Поэтому в облаке треки опознаются не по id, а по содержимому:
--  исполнитель + название + длительность. См. track_key ниже.
-- ============================================================

-- gen_random_uuid() входит в ядро с Postgres 13, расширение не нужно.

-- ------------------------------------------------------------
--  Общее: когда строку меняли в последний раз
--  По этому полю клиент забирает только то, что поменялось:
--  select ... where user_id = auth.uid() and updated_at > $последняя_сверка
-- ------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
--  1. Профиль: один на человека
-- ============================================================

create table public.profiles (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '' check (length(name) <= 64),
  tag         text          default '' check (length(tag)  <= 32),
  status      text          default '' check (length(status) <= 120),
  about       text          default '' check (length(about)  <= 1000),
  -- соц-сети: плеер хранит короткое имя, а адрес собирает сам из известных
  -- доменов. Здесь то же самое - в базу не должна попасть чужая ссылка
  links       jsonb not null default '{}'::jsonb,
  title       text          default '' check (length(title) <= 24),
  updated_at  timestamptz not null default now(),

  constraint links_is_object check (jsonb_typeof(links) = 'object')
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ============================================================
--  2. Оформление: тоже один блок на человека
--     Держим отдельно от профиля нарочно: тема меняется по десять раз
--     за вечер, а имя - раз в год. Незачем дёргать одну строку на двоих.
-- ============================================================

create table public.prefs (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  theme       jsonb not null default '{}'::jsonb,
  lyrics      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),

  constraint theme_is_object  check (jsonb_typeof(theme)  = 'object'),
  constraint lyrics_is_object check (jsonb_typeof(lyrics) = 'object')
);

create trigger prefs_touch before update on public.prefs
  for each row execute function public.touch_updated_at();


-- ============================================================
--  3. Плейлисты
--
--  id приходит от клиента: плейлист заводят без сети, и ему нужен
--  постоянный номер ещё до первой сверки. uuid v4 разбрасывает вставки
--  по индексу, но плейлистов у человека десятки, а не миллионы -
--  фрагментация тут не стоит разговора.
--
--  deleted_at вместо настоящего удаления: иначе компьютер, который
--  проспал удаление, послушно зальёт плейлист обратно.
-- ============================================================

create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(name) between 1 and 120),
  author      text default '' check (length(author) <= 64),
  description text default '' check (length(description) <= 300),
  -- путь в Storage: covers/{user_id}/{playlist_id}. Сама картинка в базе
  -- не лежит, для картинок есть Storage
  cover_path  text,
  -- порядок самих плейлистов в списке
  position    numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- нужен для составного внешнего ключа из playlist_tracks, см. ниже
  unique (id, user_id)
);

create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_updated_at();

-- под политику доступа и под выборку "что поменялось"
create index playlists_user_updated_idx on public.playlists (user_id, updated_at);
-- живые плейлисты читают чаще всего: частичный индекс меньше и быстрее
create index playlists_user_alive_idx on public.playlists (user_id, position)
  where deleted_at is null;


-- ============================================================
--  4. Треки в плейлисте
--
--  track_key - отпечаток содержимого, его считает клиент:
--    sha256( lower(артист) | lower(название) | round(секунды) )
--  Нормализация - та же чистка, что в lib/lyrics.js clean(): она уже
--  умеет выкидывать "(Official Video)" и прочий мусор из названий,
--  скачанных с ютуба.
--
--  Рядом лежат artist/title/album/duration_ms - не ради красоты:
--  на компьютере, где этого файла нет, строка всё равно должна
--  показаться, пусть и серой.
--
--  position - дробное. Перетащил трек между двумя соседями - ему
--  достаётся среднее между их позициями, и переписывать весь список
--  не надо. Это ровно тот случай, под который делалось перетаскивание.
-- ============================================================

create table public.playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null,
  -- user_id продублирован нарочно: политика доступа тогда смотрит в одну
  -- колонку своей же таблицы, а не ходит подзапросом в playlists на каждую строку
  user_id     uuid not null default auth.uid(),
  track_key   text not null check (track_key ~ '^[0-9a-f]{64}$'),

  artist      text not null default '',
  title       text not null default '',
  album       text not null default '',
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),

  position    numeric not null,
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- составной ключ вместо триггера: подсунуть свою строку в чужой плейлист
  -- нельзя даже теоретически - пары (плейлист, хозяин) просто не найдётся
  foreign key (playlist_id, user_id)
    references public.playlists (id, user_id) on delete cascade
);

create trigger playlist_tracks_touch before update on public.playlist_tracks
  for each row execute function public.touch_updated_at();

-- внешний ключ Postgres сам не индексирует, а без индекса каскадное
-- удаление плейлиста прочитает всю таблицу
create index playlist_tracks_playlist_idx on public.playlist_tracks (playlist_id, position)
  where deleted_at is null;
create index playlist_tracks_user_updated_idx on public.playlist_tracks (user_id, updated_at);

-- один и тот же трек дважды в одном плейлисте - это опечатка синхронизации,
-- а не желание человека
create unique index playlist_tracks_uniq on public.playlist_tracks (playlist_id, track_key)
  where deleted_at is null;


-- ============================================================
--  5. Любимое
-- ============================================================

create table public.favorites (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  track_key   text not null check (track_key ~ '^[0-9a-f]{64}$'),

  artist      text not null default '',
  title       text not null default '',
  album       text not null default '',
  duration_ms integer,

  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  primary key (user_id, track_key)
);

create trigger favorites_touch before update on public.favorites
  for each row execute function public.touch_updated_at();

create index favorites_user_updated_idx on public.favorites (user_id, updated_at);


-- ============================================================
--  6. Что наслушал
--     Нужно "Моей волне": она отличает привычное от забытого.
--     Без этой таблицы волна на втором компьютере начнёт с нуля.
-- ============================================================

create table public.plays (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  track_key   text not null check (track_key ~ '^[0-9a-f]{64}$'),
  plays       integer not null default 0 check (plays >= 0),
  seconds     integer not null default 0 check (seconds >= 0),
  last_at     timestamptz,
  updated_at  timestamptz not null default now(),

  primary key (user_id, track_key)
);

create trigger plays_touch before update on public.plays
  for each row execute function public.touch_updated_at();

create index plays_user_updated_idx on public.plays (user_id, updated_at);


-- ============================================================
--  ПОЛИТИКИ ДОСТУПА
--
--  Это не украшение в конце, а единственное, что отделяет чужие
--  плейлисты от твоих. Без RLS любой вошедший читает всю таблицу:
--  фильтр в коде приложения тут не считается - его можно обойти,
--  обратившись к базе напрямую тем же ключом.
--
--  auth.uid() обёрнут в (select ...) нарочно: иначе Postgres зовёт
--  функцию на каждую строку. На тысяче строк разница заметная.
--
--  force - чтобы политики действовали и на владельца таблицы. Учти:
--  после этого запрос из редактора SQL может вернуть пусто - так и задумано.
--  Смотреть всё целиком нужно ролью с правом обходить RLS (service_role).
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.prefs           enable row level security;
alter table public.playlists       enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.favorites       enable row level security;
alter table public.plays           enable row level security;

alter table public.profiles        force row level security;
alter table public.prefs           force row level security;
alter table public.playlists       force row level security;
alter table public.playlist_tracks force row level security;
alter table public.favorites       force row level security;
alter table public.plays           force row level security;


-- Правила одинаковые для всех шести таблиц: видно и правится только своё.
-- Расписаны по одному действию, а не одним "for all": так на чтение
-- проверяется using, на запись - with check, и перепутать их нельзя.

-- ---- профиль ----
create policy profiles_read   on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- оформление ----
create policy prefs_read   on public.prefs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy prefs_insert on public.prefs for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy prefs_update on public.prefs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy prefs_delete on public.prefs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- плейлисты ----
create policy playlists_read   on public.playlists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy playlists_insert on public.playlists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy playlists_update on public.playlists for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy playlists_delete on public.playlists for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- треки в плейлистах ----
create policy playlist_tracks_read   on public.playlist_tracks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy playlist_tracks_insert on public.playlist_tracks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy playlist_tracks_update on public.playlist_tracks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy playlist_tracks_delete on public.playlist_tracks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- любимое ----
create policy favorites_read   on public.favorites for select to authenticated
  using ((select auth.uid()) = user_id);
create policy favorites_insert on public.favorites for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy favorites_update on public.favorites for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy favorites_delete on public.favorites for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- наслушал ----
create policy plays_read   on public.plays for select to authenticated
  using ((select auth.uid()) = user_id);
create policy plays_insert on public.plays for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy plays_update on public.plays for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy plays_delete on public.plays for delete to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================
--  Права: anon не нужен вообще
--  Пока не вошёл - смотреть нечего. Незачем оставлять открытой дверь,
--  в которую всё равно никто не должен заходить.
-- ============================================================

revoke all on public.profiles, public.prefs, public.playlists,
              public.playlist_tracks, public.favorites, public.plays
  from anon;

grant select, insert, update, delete
  on public.profiles, public.prefs, public.playlists,
     public.playlist_tracks, public.favorites, public.plays
  to authenticated;


-- ============================================================
--  Обложки плейлистов: Storage, папка на человека
-- ============================================================

insert into storage.buckets (id, name, public)
values ('covers', 'covers', false)
on conflict (id) do nothing;

-- Путь: covers/{user_id}/{playlist_id}.jpg
-- Первый кусок пути - это и есть хозяин папки
create policy covers_read on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy covers_write on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- на update нужны обе проверки. using говорит, чью строку можно трогать,
-- with check - какой ей разрешено стать. Без второй строку можно переименовать
-- в covers/<чужой-id>/... и положить файл в чужую папку
create policy covers_replace on storage.objects for update to authenticated
  using      (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ============================================================
--  Первый заход: строки профиля заводит сам клиент
--
--  Напрашивался триггер на auth.users, который создавал бы профиль
--  при регистрации. Но с force row level security политикам подчиняется
--  и владелец таблицы, а функция security definer как раз им и работает -
--  под политику "to authenticated" она не подходит, и вставка молча
--  провалилась бы. Заводить строки клиентом и проще, и честнее: он всё
--  равно приходит уже вошедшим, и его собственные политики работают.
--
--    insert into profiles default values on conflict (user_id) do nothing;
--    insert into prefs    default values on conflict (user_id) do nothing;
--
--  user_id подставится сам из auth.uid().
-- ============================================================


-- ============================================================
--  ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ
--
--  * самой музыки. Ни файлов, ни кусков - только списки;
--  * путей к файлам на диске. Они бесполезны на другом компьютере
--    и заодно рассказывают, как у человека разложены папки;
--  * ytKey, куков браузера и любых других ключей. Им место
--    на своём компьютере, и точка;
--  * чужих плейлистов. Публичных ссылок в этой схеме нет вовсе -
--    захочется делиться, это отдельный разговор и отдельные политики.
-- ============================================================
