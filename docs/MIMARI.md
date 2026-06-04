# RevenuePulse — MVP Yüksek Seviyeli Mimari

Bu doküman sistemin "kuş bakışı" nasıl çalıştığını anlatır. Teknik bilgin
olmasa da okuyup anlayabilmen için her katmanı günlük dille açıkladım.

---

## 1. Tek Cümlede Sistem

> Müşterinin sitesine koyduğumuz **küçük bir JavaScript** ziyaretçinin
> davranışını izler → bu davranış **n8n** denen otomasyon borusuna akar →
> **Claude** bu davranışı okuyup *"bu lead 87/100 sıcaklıkta, şimdi ara, şunu
> söyle"* der → n8n bu öneriyi **Slack'e** düşürür. Hepsi saniyeler içinde.

---

## 2. Katmanlar (5 Parça)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                         MÜŞTERİNİN WEB SİTESİ                               │
 │   <script src="pulse.js" data-key="SITE_KEY"></script>   ← TEK SATIR       │
 │   (Ziyaretçi gezinir: sayfa görüntüleme, scroll, tıklama, form...)         │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                  │  (1) Olayları gönderir (HTTPS, anonim)
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                      n8n  —  ORKESTRASYON KATMANI                           │
 │                                                                            │
 │   AKIŞ A: Veri Toplama (Ingestion)                                         │
 │     [Webhook] → [Doğrula/Anonimleştir] → [Supabase'e yaz]                  │
 │                                                                            │
 │   AKIŞ B: Puanlama Ajanı (Agent)  ← tetikleyici olay olunca               │
 │     [Lead geçmişini topla] → [Vektör: benzer leadler] → [Claude API]      │
 │                                  → [Skor + Aksiyon cümlesi üret]           │
 │                                                                            │
 │   AKIŞ C: Aksiyon (Action)                                                 │
 │     [Karar: skor > eşik?] → [Slack / E-posta / CRM'e gönder] → [Logla]    │
 └─────────┬───────────────────────────────┬───────────────────────┬────────┘
           │ (2) okur/yazar                │ (3) zekâ              │ (4) aksiyon
           ▼                                ▼                       ▼
 ┌───────────────────┐         ┌────────────────────┐   ┌──────────────────┐
 │   SUPABASE        │         │    CLAUDE API      │   │  SLACK / EMAIL /  │
 │ Postgres+pgvector │         │ (LLM — analiz &    │   │  CRM (HubSpot...) │
 │ Veri + Vektör DB  │         │  cümle üretimi)    │   │  Satış ekibi      │
 └───────────────────┘         └────────────────────┘   └──────────────────┘
```

### Katman 1 — Tracker (`pulse.js`)
- Müşteri sitesine **tek satır** kodla eklenir (Google Analytics gibi).
- Ziyaretçinin davranışını yakalar: hangi sayfada ne kadar kaldı, fiyat
  sayfasına kaç kez baktı, formu doldurdu mu, scroll derinliği, UTM vb.
- **KVKK koruması:** İsim/e-posta gibi kişisel veriyi düz göndermez. Anonim
  bir `visitor_id` üretir; tanımlı bilgi varsa **hash'ler**. Rıza (consent)
  yoksa hassas alan toplamaz.

### Katman 2 — n8n (Orkestrasyon = "Akış Borusu")
n8n, kod yazmadan kutuları oklarla bağladığın bir otomasyon aracı. Üç ayrı
akış (workflow) kuracağız (detayı KURULUM-REHBERI.md'de):
- **Akış A (Ingestion):** Gelen olayı alır, anonimleştirir, Supabase'e yazar.
- **Akış B (Scoring Agent):** "Sıcak" bir tetik olduğunda (ör. fiyat sayfasına
  2. kez girdi) lead'in geçmişini toplar, Claude'a sorar, skoru kaydeder.
- **Akış C (Action):** Skor eşiği geçtiyse aksiyonu doğru kanala gönderir.

### Katman 3 — Supabase (Hafıza)
- **PostgreSQL:** Tüm yapılandırılmış veri (organizations, leads, events,
  scores, actions). Şema → `db/schema.sql`.
- **pgvector:** "Bu lead geçmişte kazandığımız müşterilere benziyor mu?"
  sorusunu yanıtlayan vektör araması (RAG için temel).

### Katman 4 — Claude API (Zekâ / Ajan Beyni)
- Lead'in davranış özetini + benzer geçmiş leadleri girdi alır.
- **Yapılandırılmış JSON** çıktı üretir:
  `{ score, temperature, reasoning, recommended_action, talking_script }`.
- MVP için `claude-sonnet-4-6` (hız/maliyet dengesi). Kritik kararlarda
  `claude-opus-4-8`'e yükseltilebilir.

### Katman 5 — Aksiyon Kanalları
- **Slack** (MVP için en hızlı): `#satis` kanalına veya temsilciye DM.
- **E-posta**, **CRM** (HubSpot/Salesforce/Pipedrive) sonraki adım.

---

## 3. Veri Akışı — Uçtan Uca Örnek

> **Senaryo:** Bir ziyaretçi "Fiyatlandırma" sayfasına 2. kez girer ve
> "Demo Talep Et" formuna yaklaşır ama doldurmaz.

1. `pulse.js` bu olayları (`page_view`, `scroll`, `form_focus`) n8n'in
   webhook adresine **HTTPS** ile gönderir.
2. **Akış A** olayı alır, `visitor_id`'yi anonim tutar, `events` tablosuna
   yazar. Bu, bir "tetikleyici olay" (fiyat sayfası 2. ziyaret) olduğu için
   **Akış B**'yi uyandırır.
3. **Akış B** son 30 günün davranışını toplar → bir özet metni oluşturur →
   `pgvector` ile benzer geçmiş leadleri bulur → Claude'a şu soruyu sorar:
   *"Bu davranışa göre 0-100 sat puanı, sıcaklık, gerekçe, önerilen aksiyon
   ve temsilcinin kuracağı açılış cümlesini JSON ver."*
4. Claude döner: `{ "score": 87, "temperature": "hot",
   "recommended_action": "5 dk içinde telefonla ara",
   "talking_script": "Merhaba, fiyatlandırma sayfamızı incelediğinizi fark
   ettik. Ekibiniz için en uygun planı 5 dakikada netleştirelim mi?" }`.
   Bu `lead_scores` tablosuna yazılır.
5. **Akış C** skoru görür (87 > 70 eşiği) → Slack `#satis` kanalına kartı
   düşürür ve `actions` tablosuna "sent" olarak loglar.
6. Satış temsilcisi bildirimi görür, **30 saniye içinde** doğru cümleyle arar.

---

## 4. Neden "Agentic"?

Klasik analitik araç sadece **rapor** verir ("şu kadar ziyaretçi geldi").
RevenuePulse **karar verip aksiyon tetikler**:

| Klasik Analitik | RevenuePulse (Agentic) |
|-----------------|------------------------|
| "100 kişi fiyat sayfasına baktı" | "Bu 1 kişiyi şimdi ara, çünkü...; şunu söyle" |
| İnsan raporu yorumlar | Sistem yorumlar + kanala iletir |
| Pasif | Aktif (perceive → reason → act) |

MVP'de ajan döngüsü: **Algıla** (events) → **Düşün** (Claude + vektör hafıza)
→ **Aksiyon Al** (Slack/CRM). İleride **araç çağırma (tool use)** ekleyerek
ajanın CRM'de görev açması, takvim daveti göndermesi gibi yetenekler katılır.

---

## 5. Güvenlik & KVKK İlkeleri (MVP'den İtibaren)

- **Veri minimizasyonu:** Sadece gereken davranışsal sinyaller toplanır.
- **PII hash'leme:** E-posta vb. `sha256` ile hash'lenir; düz metin tutulmaz.
- **Rıza (consent):** `leads.consent` alanı; rıza yoksa hassas veri yok.
- **İzolasyon (RLS):** Her müşterinin verisi `org_id` ile ayrılır; Row Level
  Security ile bir müşteri diğerinin verisini asla göremez.
- **Veri saklama:** `data_retention_days` dolan ham olaylar otomatik silinir.
- **Sır yönetimi:** API anahtarları/token'lar n8n credentials + Supabase
  Vault'ta; repoya veya `pulse.js`'e ASLA gizli anahtar konmaz.

---

## 6. MVP Kapsamı (Ne Var / Ne Yok)

**MVP'de VAR:**
- Tek site, tek müşteri ile uçtan uca çalışan akış.
- pulse.js → n8n → Supabase → Claude → Slack.
- Basit kural tabanlı tetikleyici (ör. fiyat sayfası 2. ziyaret).

**MVP'de YOK (sonraki fazlar):**
- Çok kanallı CRM senkronizasyonu, gelişmiş dashboard.
- Self-servis müşteri paneli (onboarding otomasyonu).
- A/B testli script optimizasyonu, gelişmiş ajan tool-use.
