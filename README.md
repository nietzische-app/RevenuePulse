# RevenuePulse

> Şirketlerin satış süreçlerini **Agentic AI** ile otomatize eden, plug-and-play bir B2B SaaS platformu.

RevenuePulse; şirketlerin web sitelerine ve CRM'lerine entegre olur, potansiyel müşterilerin
(lead) davranışlarını anlık analiz eder, onları satış ekibi için **puanlar** ve satış
temsilcisine *"şu kişiyi şimdi ara ve şu cümleyi kur"* diye **anlık aksiyon** önerir.

## Temel Felsefe

| İlke | Açıklama |
|------|----------|
| **Agentic** | Sistem sadece rapor sunmaz; aksiyon **tetikler** (Slack/E-posta/CRM). |
| **Plug-and-play** | Müşteri tek satır JavaScript ekler (Google Analytics kurar gibi). |
| **Gizlilik öncelikli** | KVKK uyumlu. Kişisel veri site dışına çıkmadan anonimleştirilir/hash'lenir. |
| **Düşük maliyetli MVP** | n8n (orkestrasyon) + Supabase (veri/vektör) + Claude API (zeka). |

## Teknik Yığın (Stack)

- **n8n** — İş akışı orkestrasyonu (kod yazmadan otomasyon). Verinin akış borusu.
- **Supabase** — PostgreSQL + `pgvector` (ilişkisel veri + vektör veritabanı) + Auth.
- **Claude API** — Lead analizi, puanlama ve aksiyon cümlesi üretimi (LLM zekası).
- **pulse.js** — Müşteri sitesine gömülen ~3KB'lık takip kodu.

## Repo Yapısı

```
RevenuePulse/
├── README.md                 # Bu dosya
├── docs/
│   ├── MIMARI.md             # Yüksek seviyeli MVP mimarisi (şemalar)
│   └── KURULUM-REHBERI.md    # Adım adım n8n + AI kurulumu (0 teknik bilgi)
├── db/
│   └── schema.sql            # Supabase / PostgreSQL veritabanı şeması
└── tracker/
    └── pulse.js              # Web sitesine gömülen takip snippet'i (örnek)
```

## Hızlı Başlangıç

1. **Veritabanı** → `db/schema.sql` dosyasını Supabase SQL Editor'e yapıştır.
2. **Mimari** → `docs/MIMARI.md` ile sistemin nasıl çalıştığını anla.
3. **Kurulum** → `docs/KURULUM-REHBERI.md` ile n8n akışlarını adım adım kur.
4. **Tracker** → `tracker/pulse.js` içeriğini test sitende dene.

> MVP hedefi: **2 hafta içinde** bir test sitesinden gelen lead davranışını yakalayıp,
> Claude ile puanlayıp, Slack'e aksiyon önerisi düşürmek.
