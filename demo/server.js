/*!
 * RevenuePulse — Self-contained DEMO server
 * ----------------------------------------------------------------------------
 * Tek komutla çalışan, SIFIR bağımlılıklı (saf Node.js) yatırımcı demosu.
 *
 *   node demo/server.js
 *
 * Sonra iki sekme aç (yan yana koy):
 *   • Müşteri görünümü   →  http://localhost:4500/           (sahte SaaS sitesi)
 *   • Satış ekibi ekranı →  http://localhost:4500/dashboard  (canlı 🔥 kartlar)
 *
 * Çift motor:
 *   • ANTHROPIC_API_KEY tanımlıysa  → gerçek Claude ile puanlar (authentic).
 *   • Tanımlı değilse               → akıllı kural-tabanlı yedek (her zaman çalışır).
 *
 * Bu demo, prod mimarisinin (pulse.js → n8n → Supabase → Claude → Slack)
 * tek-süreçlik, gösterime hazır bir taklididir. Veri bellekte tutulur.
 * ----------------------------------------------------------------------------
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4500;
const API_KEY = process.env.ANTHROPIC_API_KEY || null;
const MODEL = process.env.RP_MODEL || "claude-sonnet-4-6";
const HOT_THRESHOLD = 70;
const PUBLIC_DIR = path.join(__dirname, "public");

// --- Bellekteki "veritabanı" (demo için kalıcı depo yerine) ---------------
const leads = new Map(); // visitor_id -> { events:[], lastScore, profile }
const sseClients = new Set(); // satış ekibi ekranındaki canlı bağlantılar

// ============================================================================
// Yardımcılar
// ============================================================================
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

function getLead(visitorId) {
  if (!leads.has(visitorId)) {
    leads.set(visitorId, {
      visitor_id: visitorId,
      events: [],
      first_seen: Date.now(),
      lastScore: null,
      company: guessCompany(visitorId),
    });
  }
  return leads.get(visitorId);
}

// Demo zenginliği için anonim ziyaretçiye sahte ama tutarlı bir firma adı ata.
const FAKE_COMPANIES = [
  "Northwind Labs", "Acme Cloud", "Vertex Robotics", "BlueOcean SaaS",
  "Quantum Retail", "Helios Fintech", "Orbit Logistics", "Nimbus Health",
];
function guessCompany(visitorId) {
  let h = 0;
  for (let i = 0; i < visitorId.length; i++) h = (h * 31 + visitorId.charCodeAt(i)) >>> 0;
  return FAKE_COMPANIES[h % FAKE_COMPANIES.length];
}

// Lead'in davranışından insan-okunur bir özet çıkar (Claude'a ve mock'a girdi).
function summarize(lead) {
  const ev = lead.events;
  const pricingViews = ev.filter(
    (e) => e.event_type === "page_view" && /pricing|fiyat/i.test(e.page_url || "")
  ).length;
  const demoClicks = ev.filter(
    (e) => e.event_type === "click" && /demo|talk to sales|contact|satış/i.test(e.text || "")
  ).length;
  const formSubmits = ev.filter((e) => e.event_type === "form_submit").length;
  const formFocus = ev.filter((e) => e.event_type === "form_focus").length;
  const maxScroll = Math.max(0, ...ev.filter((e) => e.event_type === "scroll").map((e) => e.depth || 0));
  const totalTime = ev
    .filter((e) => e.event_type === "time_on_page")
    .reduce((s, e) => s + (e.seconds || 0), 0);
  const pageViews = ev.filter((e) => e.event_type === "page_view").length;
  const pricingTime = ev
    .filter((e) => e.event_type === "time_on_page" && /pricing|fiyat/i.test(e.page_url || ""))
    .reduce((s, e) => s + (e.seconds || 0), 0);

  return {
    pricingViews, demoClicks, formSubmits, formFocus,
    maxScroll, totalTime, pageViews, pricingTime,
    pages: [...new Set(ev.filter((e) => e.event_type === "page_view").map((e) => e.page_url))],
  };
}

// "Şimdi puanlamaya değer mi?" — gürültüyü engelleyen tetikleyici.
function isSignificant(eventType, summary) {
  if (eventType === "form_submit") return true;
  if (eventType === "click") return summary.demoClicks > 0;
  if (eventType === "page_view") return summary.pricingViews >= 2;
  if (eventType === "time_on_page") return summary.pricingTime >= 20;
  return false;
}

// ============================================================================
// PUANLAMA — Kural tabanlı yedek (internetsiz / API keysiz çalışır)
// ============================================================================
function scoreWithRules(lead, s) {
  let score = 0;
  const reasons = [];
  score += Math.min(s.pricingViews, 3) * 17;
  if (s.pricingViews >= 2) reasons.push(`fiyat sayfasını ${s.pricingViews} kez inceledi`);
  score += Math.min(s.demoClicks, 2) * 22;
  if (s.demoClicks > 0) reasons.push("demo/satış CTA'sına tıkladı");
  score += s.formSubmits * 30;
  if (s.formSubmits > 0) reasons.push("iletişim formunu gönderdi");
  score += Math.min(s.formFocus, 3) * 4;
  if (s.pricingTime >= 20) { score += 12; reasons.push(`fiyat sayfasında ${s.pricingTime}sn geçirdi`); }
  if (s.maxScroll >= 75) { score += 6; reasons.push("sayfanın sonuna kadar okudu"); }
  score += Math.min(s.pageViews, 4) * 3;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const temperature = score >= HOT_THRESHOLD ? "hot" : score >= 40 ? "warm" : "cold";
  const reasoning = reasons.length
    ? `Ziyaretçi yüksek satın alma niyeti gösteriyor: ${reasons.join(", ")}.`
    : "Henüz keşif aşamasında; güçlü bir satın alma sinyali yok.";

  let recommended_action, talking_script;
  if (temperature === "hot") {
    recommended_action = "5 dakika içinde telefonla ara";
    talking_script = s.demoClicks
      ? `Merhaba, ${lead.company}'den olduğunuzu varsayıyorum — demo seçeneğimize göz attığınızı fark ettik. 15 dakikada ekibinize özel canlı bir demo ayarlayalım mı?`
      : `Merhaba, fiyatlandırma planlarımızı detaylıca incelediğinizi gördük. Ekibinizin büyüklüğüne en uygun planı 5 dakikada birlikte netleştirelim mi?`;
  } else if (temperature === "warm") {
    recommended_action = "Bugün içinde kişisel bir e-posta gönder";
    talking_script = `Merhaba, RevenuePulse'ı incelediğinizi gördük. Sizin senaryonuza en uygun kullanım örneğini paylaşabilir miyim?`;
  } else {
    recommended_action = "Otomatik besleme (nurture) akışına ekle";
    talking_script = `Faydalı bulabileceğiniz bir vaka çalışması göndereyim — ilginizi çekerse görüşelim.`;
  }

  return { score, temperature, reasoning, recommended_action, talking_script, engine: "rules" };
}

// ============================================================================
// PUANLAMA — Gerçek Claude (API anahtarı varsa)
// ============================================================================
function scoreWithClaude(lead, s) {
  return new Promise((resolve) => {
    const behavior =
      `Firma (tahmini): ${lead.company}\n` +
      `Toplam sayfa görüntüleme: ${s.pageViews}\n` +
      `Ziyaret edilen sayfalar: ${s.pages.join(", ")}\n` +
      `Fiyat sayfası ziyareti: ${s.pricingViews} kez, toplam ${s.pricingTime}sn\n` +
      `Demo/satış CTA tıklaması: ${s.demoClicks}\n` +
      `Form gönderimi: ${s.formSubmits}, form alanına odaklanma: ${s.formFocus}\n` +
      `Maksimum scroll derinliği: %${s.maxScroll}\n` +
      `Sitede toplam süre: ${s.totalTime}sn`;

    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system:
        "Sen bir B2B satış skorlama ajanısın. Verilen web sitesi davranışını analiz et. " +
        "SADECE şu şemada geçerli JSON döndür, başka HİÇBİR metin yazma: " +
        '{"score": 0-100 tam sayı, "temperature": "cold|warm|hot", ' +
        '"reasoning": "kısa Türkçe gerekçe", "recommended_action": "net Türkçe aksiyon", ' +
        '"talking_script": "satış temsilcisinin kuracağı tek, doğal Türkçe açılış cümlesi"}',
      messages: [{ role: "user", content: "Lead davranış özeti:\n" + behavior }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (resp) => {
        let data = "";
        resp.on("data", (c) => (data += c));
        resp.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content[0].text.trim();
            const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
            json.engine = "claude:" + MODEL;
            resolve(json);
          } catch (e) {
            console.warn("[RevenuePulse] Claude yanıtı ayrıştırılamadı, kurala düşülüyor:", e.message);
            resolve(scoreWithRules(lead, s));
          }
        });
      }
    );
    req.on("error", (e) => {
      console.warn("[RevenuePulse] Claude isteği hatası, kurala düşülüyor:", e.message);
      resolve(scoreWithRules(lead, s));
    });
    req.on("timeout", () => { req.destroy(); resolve(scoreWithRules(lead, s)); });
    req.write(body);
    req.end();
  });
}

async function scoreLead(lead) {
  const s = summarize(lead);
  const result = API_KEY ? await scoreWithClaude(lead, s) : scoreWithRules(lead, s);
  lead.lastScore = result;
  return { ...result, signals: s };
}

// ============================================================================
// HTTP Sunucu
// ============================================================================
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "text/plain" });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- CORS (demo: her origin) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // --- Olay toplama (pulse.js buraya gönderir) ---
  if (req.method === "POST" && url.pathname === "/collect") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
      const lead = getLead(body.visitor_id || "anon");
      const ev = {
        event_type: body.event_type,
        page_url: body.page_url,
        text: body.properties && body.properties.text,
        depth: body.properties && body.properties.depth,
        seconds: body.properties && body.properties.seconds,
        at: Date.now(),
      };
      lead.events.push(ev);
      res.writeHead(204); res.end(); // pulse.js'i hızlı serbest bırak

      // Canlı ham akış (dashboard'daki "aktivite" şeridi için)
      broadcast("activity", { visitor_id: lead.visitor_id, company: lead.company, event: ev });

      // Anlamlı bir sinyalse → puanla ve kartı yayınla
      const s = summarize(lead);
      if (isSignificant(ev.event_type, s)) {
        const scored = await scoreLead(lead);
        broadcast("score", {
          visitor_id: lead.visitor_id,
          company: lead.company,
          ...scored,
          at: Date.now(),
        });
      }
    });
    return;
  }

  // --- Satış ekibi canlı akışı (Server-Sent Events) ---
  if (req.method === "GET" && url.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ engine: API_KEY ? "claude" : "rules" })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // --- Sağlık / durum ---
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, engine: API_KEY ? "claude:" + MODEL : "rules", leads: leads.size }));
    return;
  }

  // --- Statik dosyalar ---
  if (url.pathname === "/" || url.pathname === "/index.html") return serveStatic(res, "index.html");
  if (url.pathname === "/dashboard" || url.pathname === "/dashboard.html") return serveStatic(res, "dashboard.html");
  if (url.pathname === "/pulse.js") return serveStatic(res, "pulse.js");

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log("\n  ⚡ RevenuePulse DEMO çalışıyor");
  console.log("  ────────────────────────────────────────────");
  console.log(`  Puanlama motoru : ${API_KEY ? "Claude (" + MODEL + ")" : "Kural tabanlı yedek (API anahtarı yok)"}`);
  console.log(`  Müşteri görünümü: http://localhost:${PORT}/`);
  console.log(`  Satış ekranı    : http://localhost:${PORT}/dashboard`);
  console.log("  ────────────────────────────────────────────");
  console.log("  İpucu: İki sekmeyi yan yana aç. Müşteri sekmesinde");
  console.log("  'Pricing' sayfasına 2 kez gir → satış ekranına 🔥 kart düşer.\n");
});
