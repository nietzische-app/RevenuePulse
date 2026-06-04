# RevenuePulse — Çalışan Demo (Yatırımcı Gösterimi)

> **30 saniyelik "wow" anı:** Müşteri sitede gezinir → satış ekibinin ekranına
> saniyeler içinde 🔥 sıcak lead kartı düşer (puan + "şimdi ara" + cümle).

Bu demo, prod mimarisinin (`pulse.js → n8n → Supabase → Claude → Slack`)
**tek süreçlik, gösterime hazır** bir taklididir. **Sıfır bağımlılık** — sadece
Node.js gerekir, `npm install` veya internet **gerekmez**.

---

## Çalıştırma (2 komut)

```bash
node demo/server.js
```

Sonra **iki sekme** aç (yatırımcı sunumunda yan yana koy):

| Ekran | Adres | Kim görür |
|-------|-------|-----------|
| 🛒 Müşteri görünümü | http://localhost:4500/ | Potansiyel müşteri (sahte SaaS sitesi "CloudFlow") |
| 📊 Satış ekranı | http://localhost:4500/dashboard | Senin satış ekibin (canlı 🔥 kartlar) |

---

## Demo Senaryosu (sunumda anlat)

1. Sağda **satış ekranını** aç — boş, "sinyal bekleniyor".
2. Solda **müşteri gibi gez:** Ana Sayfa → Özellikler → **Fiyatlandırma**.
3. **Fiyatlandırma**'ya **2. kez** gir → sağda anında kart belirir, skor tırmanır.
4. "**Demo Talep Et**" butonuna tıkla → skor **SICAK** (85+) olur, kart kırmızı yanıp
   söner: *"5 dakika içinde telefonla ara"* + hazır açılış cümlesi.
5. Mesajın özü: *"İşte sattığımız şey — trafiği, otomatik olarak, kapanmaya
   hazır bir satış aksiyonuna çeviriyoruz."*

> Yeniden göstermek için müşteri sekmesindeki üst şeritten **"Yeni ziyaretçi
> olarak başla"** linkine tıkla (kimliği sıfırlar).

---

## Çift Motor: Demo asla patlamaz

| Durum | Davranış |
|-------|----------|
| `ANTHROPIC_API_KEY` **tanımlı** | Gerçek **Claude** ile puanlar — en otantik gösterim. |
| Anahtar **yok** / internet yok | **Akıllı kural-tabanlı yedek** devreye girer — demo her koşulda çalışır. |

Gerçek Claude ile çalıştırmak için:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node demo/server.js
# Ekranda "Motor: Claude" yazar; kartların gerekçesi/cümlesi LLM üretimi olur.
```

İsteğe bağlı: `RP_MODEL=claude-opus-4-8 node demo/server.js` ile model değiştir.

---

## Mimari (demo eşlemesi)

```
 Müşteri sitesi (index.html)              Satış ekranı (dashboard.html)
   │  pulse.js olayları                        ▲  canlı 🔥 kartlar (SSE)
   ▼  POST /collect                            │  GET /stream
 ┌──────────────────────────────────────────────────────────────┐
 │                     server.js (saf Node.js)                    │
 │  Topla → tetikleyici? → Puanla (Claude|kural) → Yayınla        │
 │  (prod'da: n8n + Supabase + Claude API + Slack)                │
 └──────────────────────────────────────────────────────────────┘
```

| Demo parçası | Prod karşılığı |
|--------------|----------------|
| `public/pulse.js` | `tracker/pulse.js` (aynı mantık, farklı endpoint) |
| `server.js` toplama | n8n "Akış A" (Ingestion) + Supabase `events` |
| `server.js` puanlama | n8n "Akış B" + Claude API + `lead_scores` |
| `dashboard.html` kartı | n8n "Akış C" → Slack `#satis` kartı |
| Bellekteki `Map` | Supabase PostgreSQL (`db/schema.sql`) |

---

## Dosyalar

```
demo/
├── server.js              # Saf Node.js sunucu (sıfır bağımlılık)
├── README.md              # Bu dosya
└── public/
    ├── index.html         # Sahte SaaS müşteri sitesi (CloudFlow)
    ├── dashboard.html     # Satış ekibi canlı ekranı
    └── pulse.js           # Tracker (demo sürümü, /collect'e gönderir)
```

> Not: Demo verisi bellektedir; sunucu kapanınca sıfırlanır (gösterim için ideal).
