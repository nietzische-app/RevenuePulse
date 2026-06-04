-- ============================================================================
-- RevenuePulse — Supabase / PostgreSQL Veritabanı Şeması (MVP)
-- ============================================================================
-- Nasıl kullanılır:
--   1. Supabase projeni aç → sol menü → "SQL Editor" → "New query"
--   2. Bu dosyanın TAMAMINI yapıştır → "Run" (Çalıştır) butonuna bas.
--   3. Tablolar, indeksler ve RLS politikaları otomatik oluşur.
--
-- Mimari mantık (multi-tenant SaaS):
--   organizations (müşteri şirket)
--     └── tracking_sites (sitenin takip anahtarı = pulse.js'e gömülür)
--     └── users (o şirketin satış ekibi)
--     └── integrations (Slack/CRM bağlantı bilgileri)
--     └── leads (ziyaretçiler — anonim veya tanımlı)
--           └── sessions (ziyaret oturumları)
--                 └── events (ham davranış olayları)
--           └── lead_scores (Claude çıktısı: puan + aksiyon cümlesi)
--           └── lead_embeddings (vektör — benzer lead araması için)
--     └── actions (tetiklenen aksiyonlar: Slack/email/crm log'u)
-- ============================================================================

-- pgvector eklentisi (vektör veritabanı için) — Supabase'de tek satırla açılır
create extension if not exists vector;
create extension if not exists "uuid-ossp";


-- ----------------------------------------------------------------------------
-- 1) ORGANIZATIONS — Bizim müşterilerimiz (kiracı / tenant)
-- ----------------------------------------------------------------------------
create table if not exists organizations (
    id              uuid primary key default uuid_generate_v4(),
    name            text not null,
    domain          text,                       -- ör: musteri.com
    plan            text not null default 'trial', -- trial | starter | pro | enterprise
    -- KVKK: veri saklama süresi (gün). Süre dolan ham olaylar silinebilir.
    data_retention_days integer not null default 180,
    created_at      timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 2) USERS — Müşteri şirketteki satış ekibi (Supabase Auth'a bağlanır)
-- ----------------------------------------------------------------------------
create table if not exists users (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    auth_user_id    uuid,                       -- Supabase auth.users.id ile eşleşir
    email           text not null,
    full_name       text,
    role            text not null default 'sales', -- admin | manager | sales
    slack_member_id text,                       -- kişiye özel Slack DM için
    created_at      timestamptz not null default now()
);
create index if not exists idx_users_org on users(org_id);


-- ----------------------------------------------------------------------------
-- 3) TRACKING_SITES — pulse.js'in kullandığı site anahtarı (API key)
-- ----------------------------------------------------------------------------
create table if not exists tracking_sites (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    site_key        text not null unique,       -- pulse.js içine gömülen public anahtar
    name            text,                       -- ör: "Ana web sitesi"
    allowed_origins text[],                     -- CORS: sadece bu domainlerden veri kabul et
    is_active       boolean not null default true,
    created_at      timestamptz not null default now()
);
create index if not exists idx_sites_org on tracking_sites(org_id);
create index if not exists idx_sites_key on tracking_sites(site_key);


-- ----------------------------------------------------------------------------
-- 4) INTEGRATIONS — Aksiyon kanalları (Slack webhook, CRM token vb.)
-- ----------------------------------------------------------------------------
-- NOT: Hassas token'lar ideal olarak Supabase Vault'ta şifreli tutulmalı.
create table if not exists integrations (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    kind            text not null,              -- slack | email | hubspot | salesforce | pipedrive
    config          jsonb not null default '{}',-- ör: {"webhook_url": "...", "channel": "#satis"}
    is_active       boolean not null default true,
    created_at      timestamptz not null default now()
);
create index if not exists idx_integrations_org on integrations(org_id);


-- ----------------------------------------------------------------------------
-- 5) LEADS — Ziyaretçiler. Anonim başlar, form doldurunca tanımlı olur.
-- ----------------------------------------------------------------------------
-- KVKK: E-posta gibi PII'yi DÜZ metin tutmuyoruz. pulse.js anonim bir
-- visitor_id üretir; tanımlı bilgi gelirse hash'lenmiş tutulur.
create table if not exists leads (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    site_id         uuid references tracking_sites(id) on delete set null,
    visitor_id      text not null,              -- pulse.js'in ürettiği anonim çerez/ID
    email_hash      text,                       -- sha256(lower(email)) — eşleştirme için
    -- Anonimleştirilmiş/serbest profil alanları (KVKK uyumlu minimal veri)
    company_guess   text,                       -- IP/firmografik tahmini (varsa)
    country         text,
    consent         boolean not null default false, -- KVKK rıza durumu
    first_seen_at   timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    unique (org_id, visitor_id)
);
create index if not exists idx_leads_org on leads(org_id);
create index if not exists idx_leads_visitor on leads(visitor_id);
create index if not exists idx_leads_email_hash on leads(email_hash);


-- ----------------------------------------------------------------------------
-- 6) SESSIONS — Bir ziyaret oturumu (UTM, cihaz, referans vb.)
-- ----------------------------------------------------------------------------
create table if not exists sessions (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    lead_id         uuid not null references leads(id) on delete cascade,
    started_at      timestamptz not null default now(),
    ended_at        timestamptz,
    utm_source      text,
    utm_medium      text,
    utm_campaign    text,
    referrer        text,
    device          text,                       -- mobile | desktop | tablet
    landing_page    text
);
create index if not exists idx_sessions_lead on sessions(lead_id);


-- ----------------------------------------------------------------------------
-- 7) EVENTS — Ham davranış olayları (pulse.js'in gönderdiği her şey)
-- ----------------------------------------------------------------------------
create table if not exists events (
    id              bigserial primary key,
    org_id          uuid not null references organizations(id) on delete cascade,
    lead_id         uuid not null references leads(id) on delete cascade,
    session_id      uuid references sessions(id) on delete cascade,
    event_type      text not null,              -- page_view | click | scroll | form_submit | ...
    page_url        text,
    -- Esnek olay verisi: süre, scroll %, eleman, fiyat planı vb.
    properties      jsonb not null default '{}',
    occurred_at     timestamptz not null default now()
);
create index if not exists idx_events_lead on events(lead_id);
create index if not exists idx_events_org_time on events(org_id, occurred_at desc);
create index if not exists idx_events_type on events(event_type);


-- ----------------------------------------------------------------------------
-- 8) LEAD_SCORES — Claude'un ürettiği analiz (her puanlama bir satır)
-- ----------------------------------------------------------------------------
-- Geçmişi tutmak için "append-only" (her yeni analiz yeni satır). En güncel
-- skor için lead bazında en son created_at'e bakılır.
create table if not exists lead_scores (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    lead_id         uuid not null references leads(id) on delete cascade,
    score           integer not null,           -- 0-100 satış sıcaklık puanı
    temperature     text,                        -- cold | warm | hot
    reasoning       text,                        -- Claude'un puan gerekçesi
    recommended_action text,                     -- ör: "Şimdi telefonla ara"
    talking_script  text,                        -- temsilciye önerilen açılış cümlesi
    model           text,                        -- ör: claude-sonnet-4-6
    raw_response    jsonb,                       -- Claude ham yanıtı (denetim/iyileştirme)
    created_at      timestamptz not null default now()
);
create index if not exists idx_scores_lead_time on lead_scores(lead_id, created_at desc);
create index if not exists idx_scores_org on lead_scores(org_id);


-- ----------------------------------------------------------------------------
-- 9) ACTIONS — Tetiklenen aksiyonların kaydı (denetim + tekrar engelleme)
-- ----------------------------------------------------------------------------
create table if not exists actions (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    lead_id         uuid not null references leads(id) on delete cascade,
    score_id        uuid references lead_scores(id) on delete set null,
    channel         text not null,              -- slack | email | crm
    status          text not null default 'pending', -- pending | sent | failed
    payload         jsonb,                      -- gönderilen mesajın içeriği
    error           text,
    created_at      timestamptz not null default now(),
    sent_at         timestamptz
);
create index if not exists idx_actions_lead on actions(lead_id);
create index if not exists idx_actions_org_time on actions(org_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 10) LEAD_EMBEDDINGS — Vektör veritabanı (benzer lead / RAG için)
-- ----------------------------------------------------------------------------
-- "Bu lead, geçmişte kapattığımız müşterilere ne kadar benziyor?" sorusunu
-- yanıtlamak için davranış özetinin vektörünü tutarız.
-- Boyut 1536 = OpenAI text-embedding-3-small varsayımı. Kullandığın embedding
-- modeline göre boyutu değiştir (ör. Voyage 1024).
create table if not exists lead_embeddings (
    id              uuid primary key default uuid_generate_v4(),
    org_id          uuid not null references organizations(id) on delete cascade,
    lead_id         uuid not null references leads(id) on delete cascade,
    content         text,                       -- vektörlenen metin özeti
    embedding       vector(1536),
    created_at      timestamptz not null default now()
);
-- Yaklaşık en yakın komşu araması için indeks (cosine benzerliği)
create index if not exists idx_embeddings_vector
    on lead_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_embeddings_lead on lead_embeddings(lead_id);


-- ----------------------------------------------------------------------------
-- Yardımcı fonksiyon: benzer lead araması (n8n'den RPC ile çağrılır)
-- ----------------------------------------------------------------------------
create or replace function match_leads (
    query_embedding vector(1536),
    match_org_id    uuid,
    match_count     int default 5
)
returns table (lead_id uuid, content text, similarity float)
language sql stable
as $$
    select
        e.lead_id,
        e.content,
        1 - (e.embedding <=> query_embedding) as similarity
    from lead_embeddings e
    where e.org_id = match_org_id
    order by e.embedding <=> query_embedding
    limit match_count;
$$;


-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) — Çok kiracılı veri izolasyonu (KVKK/güvenlik)
-- ----------------------------------------------------------------------------
-- Her tablo için RLS açıyoruz. n8n, "service_role" anahtarıyla bağlandığı için
-- RLS'i bypass eder (sunucu tarafı güvenli). Ama frontend/Auth ile erişimde
-- kullanıcı sadece kendi org'unun verisini görür.
alter table organizations  enable row level security;
alter table users          enable row level security;
alter table tracking_sites enable row level security;
alter table integrations   enable row level security;
alter table leads          enable row level security;
alter table sessions       enable row level security;
alter table events         enable row level security;
alter table lead_scores    enable row level security;
alter table actions        enable row level security;
alter table lead_embeddings enable row level security;

-- Örnek politika: giriş yapmış kullanıcı yalnızca kendi org'unun lead'lerini görür.
-- (Diğer tablolar için aynı kalıp tekrarlanır.)
drop policy if exists "org members read leads" on leads;
create policy "org members read leads" on leads
    for select
    using (
        org_id in (
            select org_id from users where auth_user_id = auth.uid()
        )
    );

-- ============================================================================
-- ŞEMA SONU
-- ============================================================================
