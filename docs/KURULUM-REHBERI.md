# RevenuePulse — Adım Adım Kurulum Rehberi (0 Teknik Bilgi)

Bu rehber, hiç kod yazmadan RevenuePulse MVP'sini ayağa kaldırmanı sağlar.
Her adımı sırayla yap. Tahmini süre: **bir öğleden sonra**.

İhtiyacın olan 4 hesap (hepsinin ücretsiz başlangıç planı var):
1. **Supabase** — veritabanı (supabase.com)
2. **n8n** — otomasyon (n8n.io → "Cloud" en kolayı; veya kendi sunucuna kur)
3. **Anthropic** — Claude API anahtarı (console.anthropic.com)
4. **Slack** — bir test çalışma alanı + Incoming Webhook

---

## ADIM 0 — Kavramları 1 Dakikada Anla

- **Webhook:** "Bana veri gönderebileceğin internet adresi." n8n bize böyle
  bir adres verir; pulse.js bu adrese ziyaretçi davranışını yollar.
- **Workflow (Akış):** n8n'de kutuları (node) oklarla bağladığın otomasyon.
- **Node:** Akıştaki her kutu (ör. "Webhook", "Supabase", "Claude").
- **API Key:** Bir servise "ben yetkiliyim" demeni sağlayan gizli şifre.

---

## ADIM 1 — Veritabanını Kur (Supabase)

1. supabase.com → "Start your project" → ücretsiz proje oluştur.
2. Sol menü → **SQL Editor** → **New query**.
3. Repodaki `db/schema.sql` dosyasının **tamamını** kopyala, yapıştır, **Run**.
   - Tüm tablolar, vektör eklentisi ve güvenlik politikaları oluşur.
4. Sol menü → **Project Settings → API**. Şu 2 değeri bir yere not al:
   - **Project URL** (ör. `https://xxxx.supabase.co`)
   - **service_role key** (GİZLİ — sadece n8n'de kullanılacak, frontend'de asla).
5. **Test verisi ekle** (SQL Editor'de çalıştır):
   ```sql
   insert into organizations (name, domain) values ('Test Şirketi', 'test.com')
     returning id;
   -- Dönen id'yi kopyala, aşağıda <ORG_ID> yerine yaz:
   insert into tracking_sites (org_id, site_key, name, allowed_origins)
     values ('<ORG_ID>', 'demo_site_key_123', 'Test sitesi', array['*']);
   ```

---

## ADIM 2 — Claude API Anahtarı Al

1. console.anthropic.com → giriş yap → **API Keys** → **Create Key**.
2. Anahtarı kopyala (bir daha gösterilmez!). n8n'de kullanacağız.
3. Modeller: MVP'de `claude-sonnet-4-6` (hızlı + ekonomik). Kritik kararlar
   için `claude-opus-4-8`'e geçebilirsin.

---

## ADIM 3 — Slack Webhook'u Hazırla

1. api.slack.com/apps → **Create New App** → "From scratch".
2. **Incoming Webhooks** → aç → **Add New Webhook to Workspace**.
3. `#satis` kanalını seç → oluşan **Webhook URL**'i not al
   (ör. `https://hooks.slack.com/services/...`).

---

## ADIM 4 — n8n'i Aç ve 3 Akışı Kur

n8n Cloud'a giriş yap (veya kendi kurulumun). Şimdi üç akış kuracağız.

### AKIŞ A — Veri Toplama (Ingestion)

Amaç: pulse.js'ten gelen olayı al, anonimleştir, Supabase'e yaz.

1. **Yeni Workflow** → adını "A - Ingestion" koy.
2. **Webhook** node ekle:
   - Method: `POST`, Path: `pulse-collect`.
   - Üstteki **Production URL**'i kopyala → bu, pulse.js'e gireceğin adres.
3. **Function / Set** node (anonimleştirme):
   - Gelen veride e-posta varsa hash'le, ham PII'yi düşür. Örnek kod (Code
     node, JavaScript):
     ```js
     const crypto = require('crypto');
     const b = $json.body;
     const emailHash = b.email
       ? crypto.createHash('sha256').update(b.email.toLowerCase()).digest('hex')
       : null;
     return [{ json: {
       site_key: b.site_key,
       visitor_id: b.visitor_id,
       email_hash: emailHash,
       event_type: b.event_type,
       page_url: b.page_url,
       properties: b.properties || {},
       occurred_at: new Date().toISOString()
     }}];
     ```
4. **Supabase** node(ları):
   - Önce `tracking_sites` tablosundan `site_key` ile `org_id`'yi bul.
   - `leads` tablosunda `visitor_id` yoksa oluştur (upsert), varsa
     `last_seen_at`'i güncelle.
   - `events` tablosuna olayı **Insert** et.
   - Bağlantı için: Supabase node → credential → Project URL + service_role key.
5. **IF** node (tetikleyici kontrolü):
   - Koşul: `event_type == 'page_view'` ve `page_url` "pricing/fiyat" içeriyor
     ve bu lead için fiyat ziyareti sayısı ≥ 2.
   - Doğruysa → **HTTP Request** ile Akış B'nin webhook'unu tetikle
     (veya n8n "Execute Workflow" node ile çağır).
6. Kaydet ve **Active** yap.

### AKIŞ B — Puanlama Ajanı (Claude)

Amaç: Lead geçmişini topla → (opsiyonel) benzer leadleri bul → Claude'a sor →
skoru kaydet → Akış C'yi tetikle.

1. **Yeni Workflow** → "B - Scoring Agent". Başlangıç: **Webhook** (Akış A
   buraya `lead_id` gönderir) veya **Execute Workflow Trigger**.
2. **Supabase** node: bu lead'in son 30 günlük `events` kayıtlarını çek.
3. **(Opsiyonel) Vektör arama:** Davranış özetini embed et → Supabase RPC
   `match_leads` çağır → en benzer 5 geçmiş lead'i getir (RAG bağlamı).
4. **HTTP Request** node → Claude API:
   - URL: `https://api.anthropic.com/v1/messages`
   - Header: `x-api-key: <ANTHROPIC_KEY>`, `anthropic-version: 2023-06-01`,
     `content-type: application/json`.
   - Body (JSON):
     ```json
     {
       "model": "claude-sonnet-4-6",
       "max_tokens": 600,
       "system": "Sen bir B2B satış skorlama ajanısın. Verilen lead davranışını analiz et. SADECE şu JSON'u döndür: {\"score\": 0-100 tam sayı, \"temperature\": \"cold|warm|hot\", \"reasoning\": \"kısa gerekçe\", \"recommended_action\": \"net aksiyon\", \"talking_script\": \"temsilcinin kuracağı tek açılış cümlesi\"}. Başka metin yazma.",
       "messages": [
         { "role": "user", "content": "Lead davranış özeti:\n{{ $json.behavior_summary }}\n\nBenzer geçmiş leadler:\n{{ $json.similar_leads }}" }
       ]
     }
     ```
   > İpucu: Yapılandırılmış çıktı için system prompt'ta JSON şemasını net ver
   > ve `"Başka metin yazma"` de. n8n'de yanıtı `JSON.parse` ile ayrıştır.
5. **Code** node: Claude yanıtındaki JSON'u ayrıştır
   (`JSON.parse($json.content[0].text)`).
6. **Supabase** node: `lead_scores` tablosuna Insert (score, temperature,
   reasoning, recommended_action, talking_script, model, raw_response).
7. **IF** node: `score >= 70` ise → Akış C'yi tetikle.
8. Kaydet ve **Active** yap.

### AKIŞ C — Aksiyon (Slack)

Amaç: Yüksek skorlu lead için satış ekibine kart düşür ve logla.

1. **Yeni Workflow** → "C - Action".
2. Başlangıç: **Webhook** / Execute Workflow (Akış B `score_id`, `lead_id`
   gönderir).
3. **Supabase** node: skor detayını çek.
4. **HTTP Request** node → Slack Webhook URL:
   - Body örneği:
     ```json
     {
       "text": "🔥 Sıcak Lead! Puan: {{score}}/100\n*Aksiyon:* {{recommended_action}}\n*Önerilen cümle:* {{talking_script}}\n*Gerekçe:* {{reasoning}}"
     }
     ```
5. **Supabase** node: `actions` tablosuna `status='sent'` olarak Insert.
6. Kaydet ve **Active** yap.

---

## ADIM 5 — pulse.js'i Test Sitene Ekle

1. `tracker/pulse.js` dosyasını bir yere host et (Supabase Storage, Vercel,
   GitHub Pages veya CDN — hepsi olur).
2. İçindeki `ENDPOINT` değişkenini **Akış A'nın Webhook Production URL'i** yap.
3. Test HTML sayfana tek satır ekle:
   ```html
   <script src="https://CDN-ADRESIN/pulse.js" data-key="demo_site_key_123"></script>
   ```
4. Sayfayı aç, gez, "fiyat" sayfasına 2 kez gir.

---

## ADIM 6 — Uçtan Uca Doğrula

1. Supabase → **Table Editor** → `events` doluyor mu? ✅
2. Fiyat sayfası 2. ziyaretten sonra `lead_scores` satırı oluştu mu? ✅
3. Slack `#satis` kanalına 🔥 kart düştü mü? ✅
4. `actions` tablosunda `status='sent'` log var mı? ✅

Hepsi yeşilse MVP **çalışıyor** demektir. 🎉

---

## Sorun Giderme

| Belirti | Olası Sebep / Çözüm |
|---------|---------------------|
| events boş | pulse.js'teki ENDPOINT yanlış veya Webhook Active değil. |
| Supabase 401/403 | n8n'de service_role key yanlış girilmiş. |
| Claude hata | API anahtarı veya `anthropic-version` header eksik. |
| JSON parse hatası | Claude'a "SADECE JSON döndür" dediğinden emin ol. |
| Slack'e düşmüyor | Webhook URL yanlış veya skor eşiğin (70) altında. |

---

## Sonraki Adımlar (MVP Sonrası)

- Kural tabanlı tetik yerine **skor düşüş/yükseliş** dinamikleri.
- CRM entegrasyonu (HubSpot/Salesforce) — Akış C'ye ikinci kanal.
- Ajan **tool-use**: Claude'un doğrudan CRM'de görev açması, takvim daveti.
- Müşteri **onboarding paneli** (site_key üretimi self-servis).
- Veri saklama job'u (`data_retention_days` dolanı temizleyen zamanlı akış).
