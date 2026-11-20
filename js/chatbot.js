(function () {
  const CFG = window.YEAXMI_CONFIG || {};
  const CHAT_CFG = CFG.CHATBOT || {};
  const BOT_NAME = CHAT_CFG.NAME || "GY AI Assistant";
  const WHATSAPP_NUMBER = CFG.WHATSAPP_NUMBER || "8801410715713";
  const FALLBACK_IMG = "https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=600&q=80";

  const STORE_KNOWLEDGE = `
Store Name: ${CFG.STORE_NAME || "GY Puff & Cloud"}
Founder & CEO: Golden
Email: qazxswqa0000@gmail.com
WhatsApp Support & Order: +8801410715713 (https://wa.me/${WHATSAPP_NUMBER})
Location: Khulna, Bangladesh (ships nationwide)

Payment Policy:
- 50% Advance or 100% Full Advance Required. Cash on Delivery (COD) without advance is NOT available.
- Payment Method: bKash or Nagad Personal (Send Money Only) to 01719738303.
- Customer must provide Sender Number & Transaction ID (TrxID) at checkout for verification.

Delivery Policy:
- Inside Khulna / Dhaka: ৳ 70 (24–48 hours).
- Outside Dhaka (Courier): ৳ 130 (2–4 working days).
- Discreet plain packaging.

Store Policies & Terms:
- Age Restriction: Strictly 18+ adults only.
- Authenticity: 100% genuine, factory-sealed products.
- No Refund Policy: All sales are final. No refunds, returns, or cash-backs once confirmed/delivered.
- DOA (Dead on Arrival): An uncut unboxing video from start to finish is mandatory for any DOA claim.
- Unclaimed Parcels: If a customer refuses/fails to receive a confirmed parcel, advance payment is non-refundable.

Loyalty Program (GY Levels - 10 Tiers):
1. Starter (৳0): Base tier
2. Bronze (৳1,500+): 1% off every order, +5% points
3. Silver (৳3,000+): 2% off every order, +10% points
4. Gold (৳5,000+): 3% off every order, +15% points
5. Emerald (৳7,500+): 4% off every order, +20% points
6. Sapphire (৳10,000+): 5% off every order, +25% points
7. Amethyst (৳13,000+): 6% off every order, +30% points
8. Ruby (৳16,500+): 7% off every order, +40% points
9. Diamond (৳20,000+): 8% off every order, +50% points
10. Legend (৳25,000+): 10% off every order, +60% points

How to Order:
1. Browse products, select flavor/nicotine variant, and add to Cart (or click Buy Now).
2. Open Cart, fill in Name, Phone, Delivery Zone, and Full Address.
3. Send 50% or 100% advance via bKash/Nagad Send Money to 01719738303.
4. Enter Sender Number & TrxID, tick the Terms & No Refund agreement, and click "Confirm Order via WhatsApp".
`.trim();

  let catalog = [];
  let catalogLoaded = false;
  let isOpen = false;
  let isSending = false;
  const history = [];

  const escapeHTML = str =>
    String(str == null ? "" : str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));

  const formatTaka = n => "৳ " + Number(n || 0).toLocaleString("en-US");

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = "", inQuotes = false;
    text = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== "" || row.length) {
      row.push(cur);
      if (row.some(c => c.trim() !== "")) rows.push(row);
    }
    const headers = (rows.shift() || []).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return rows.map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] || "").trim()])));
  }

  const toNum = val => {
    const n = parseFloat(String(val || "").replace(/[^\d.]/g, ""));
    return Number.isNaN(n) ? null : n;
  };

  function resolveImg(raw) {
    if (!raw) return FALLBACK_IMG;
    const clean = String(raw).trim().split(/[|,\r\n]+/)[0].trim();
    const match = clean.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([a-zA-Z0-9_-]{20,})/);
    return match ? `https://lh3.googleusercontent.com/d/${match[1]}` : (clean || FALLBACK_IMG);
  }

  function buildCatalogFromCsv(productCsv, planCsv) {
    const pRows = parseCSV(productCsv);
    const lRows = parseCSV(planCsv);
    const plansBySlug = Object.create(null);

    lRows.forEach(r => {
      const slug = String(r.slug || "").trim().toLowerCase();
      if (!slug) return;
      (plansBySlug[slug] = plansBySlug[slug] || []).push({
        plan: r.plan || "Standard",
        price: toNum(r.price) || 0,
        stock: r.stock === "" ? null : toNum(r.stock)
      });
    });

    return pRows
      .filter(r => r.slug && r.name && !/^(hidden|inactive|draft)$/i.test(r.status || ""))
      .map(r => {
        const slug = r.slug.trim().toLowerCase();
        const plans = plansBySlug[slug] || [{ plan: "Standard", price: toNum(r.price) || 0, stock: null }];
        const prices = plans.map(p => p.price).filter(p => p > 0);
        return {
          slug,
          name: r.name,
          category: r.category || "Disposable Vapes",
          subtitle: r.subtitle || "",
          description: r.description || "",
          image: resolveImg(r.image || r.gallery),
          plans,
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0
        };
      });
  }

  async function ensureCatalogLoaded() {
    if (catalogLoaded) return;
    try {
      const cached = JSON.parse(localStorage.getItem("yeaxmi_catalog_cache") || "null");
      if (cached && cached.productCsv && cached.planCsv) {
        catalog = buildCatalogFromCsv(cached.productCsv, cached.planCsv);
        catalogLoaded = true;
        return;
      }
    } catch (_) {}

    if (CFG.PRODUCTS_CSV_URL && CFG.PLANS_CSV_URL) {
      try {
        const bust = "&_t=" + Date.now();
        const [pRes, lRes] = await Promise.all([
          fetch(CFG.PRODUCTS_CSV_URL + bust),
          fetch(CFG.PLANS_CSV_URL + bust)
        ]);
        if (pRes.ok && lRes.ok) {
          catalog = buildCatalogFromCsv(await pRes.text(), await lRes.text());
          catalogLoaded = true;
        }
      } catch (err) {
        console.warn("Chatbot catalog fetch failed:", err);
      }
    }
  }

  function buildCatalogSummaryForAI() {
    if (!catalog.length) return "Catalog currently unavailable.";
    return catalog.slice(0, 40).map(p => {
      const variants = p.plans.slice(0, 8).map(v => `${v.plan}: ৳${v.price}${v.stock === 0 ? " (OOS)" : ""}`).join(", ");
      return `- ${p.name} [${p.category}] | ${variants}`;
    }).join("\n");
  }

  function searchCatalog(query) {
    const q = query.toLowerCase();
    const budgetMatch = q.match(/(\d{3,5})\s*(?:tk|taka|bdt|৳|er\s*moddhe|under|below)?/);
    const maxBudget = budgetMatch ? Number(budgetMatch[1]) : null;
    const stopWords = new Set(["price", "dam", "koto", "ase", "ache", "ki", "want", "need", "show", "buy", "order", "tk", "taka", "bdt", "under", "below", "moddhe", "best", "good", "valo", "vape", "flavor", "flavour", "stock", "available", "product", "products"]);
    const tokens = q.split(/[\s,?.!]+/).filter(t => t.length >= 2 && !stopWords.has(t));

    let scored = catalog.map(p => {
      const hay = `${p.name} ${p.category} ${p.subtitle} ${p.description} ${p.plans.map(v => v.plan).join(" ")}`.toLowerCase();
      let score = 0;
      tokens.forEach(tok => {
        if (hay.includes(tok)) score += p.name.toLowerCase().includes(tok) ? 3 : 1;
      });
      if (maxBudget && p.minPrice > 0 && p.minPrice <= maxBudget) score += 2;
      return { product: p, score };
    });

    if (tokens.length || maxBudget) {
      scored = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    } else {
      scored = scored.slice(0, 4);
    }
    return scored.slice(0, 4).map(s => s.product);
  }

  function generateLocalReply(userMsg) {
    const q = userMsg.toLowerCase().trim();
    const isBn = /[\u0980-\u09FF]/.test(userMsg) || /\b(koto|kivabe|ase|ache|dam|taka|tk|vai|bhai|order|korbo|lagbe|ki|kemon|khulna|dhaka|bkash|nagad|cod|delivery|kothay|amar|ami)\b/i.test(q);

    // Greeting
    if (/^(hi|hello|hey|salam|assalamu|hlw|oi|kemon|kamon|kmn|ki khobor|ki obostha)/i.test(q)) {
      return {
        text: isBn
          ? `আসসালামু আলাইকুম! আমি **${BOT_NAME}**। GY Puff & Cloud-এ স্বাগতম! প্রোডাক্ট, দাম, ফ্লেভার, ডেলিভারি, পেমেন্ট বা অর্ডার সংক্রান্ত যেকোনো প্রশ্ন করতে পারেন।`
          : `Hello! I'm **${BOT_NAME}** for GY Puff & Cloud. Ask me anything about our vapes, pods, flavors, prices, delivery, payment, or how to order!`
      };
    }

    // Payment / bKash / Nagad / COD
    if (/(bkash|nagad|payment|pay|cod|cash on delivery|advance|trxid|send money|টাকা|বিকাশ|নগদ|পেমেন্ট|ক্যাশ অন)/i.test(q)) {
      return {
        text: isBn
          ? `**পেমেন্ট ও অ্যাডভান্স পলিসি:**\n• অর্ডার কনফার্ম করতে ন্যূনতম **৫০% অ্যাডভান্স** অথবা **১০০% ফুল পেমেন্ট** করতে হবে (সম্পূর্ণ ক্যাশ অন ডেলিভারি/COD প্রযোজ্য নয়)।\n• **bKash / Nagad Personal (Send Money Only):** \`01719738303\`\n• টাকা পাঠানোর পর চেকআউটে আপনার Sender Number ও Transaction ID (TrxID) দিন।`
          : `**Payment & Advance Policy:**\n• A minimum **50% advance** or **100% full payment** is required to confirm your order (Cash on Delivery without advance is not available).\n• **bKash / Nagad Personal (Send Money Only):** \`01719738303\`\n• Enter your Sender Number & Transaction ID (TrxID) at checkout for verification.`
      };
    }

    // Delivery / Shipping
    if (/(delivery|shipping|courier|khulna|dhaka|satkhira|charge|fee|time|koto din|ডেলিভারি|কুরিয়ার|খুলনা|ঢাকা|সময়|চার্জ)/i.test(q)) {
      return {
        text: isBn
          ? `**ডেলিভারি চার্জ ও সময়:**\n• **খুলনা ও ঢাকা সিটির ভেতরে:** ৳ ৭০ (২৪–৪৮ ঘণ্টার মধ্যে ডেলিভারি)\n• **ঢাকার বাইরে (কুরিয়ার):** ৳ ১৩০ (২–৪ কার্যদিবস)\n• প্রতিটি পার্সেল সম্পূর্ণ **ডিসক্রিট (গোপনীয়) প্যাকিংয়ে** পাঠানো হয়।`
          : `**Delivery Charges & Time:**\n• **Inside Khulna / Dhaka:** ৳ 70 (24–48 hours)\n• **Outside Dhaka (Courier):** ৳ 130 (2–4 working days)\n• All orders are shipped in **discreet plain packaging**.`
      };
    }

    // Refund / Return / DOA / Warranty / Authenticity
    if (/(refund|return|warranty|doa|fake|original|authentic|unboxing|রিফান্ড|রিটার্ন|অরিজিনাল|আসল|নকল)/i.test(q)) {
      return {
        text: isBn
          ? `**অথেনটিসিটি ও রিফান্ড পলিসি:**\n• আমাদের প্রতিটি প্রোডাক্ট **১০০% অরিজিনাল ও ফ্যাক্টরি-সিলড**।\n• **Strict No Refund Policy:** অর্ডার কনফার্ম বা ডেলিভারি হওয়ার পর কোনো রিফান্ড বা রিটার্ন গ্রহণ করা হয় না।\n• **DOA (Dead on Arrival):** ডেলিভারি পাওয়ার পর পার্সেল খোলার শুরু থেকে শেষ পর্যন্ত **আনকাট আনবক্সিং ভিডিও** অবশ্যই রাখতে হবে।`
          : `**Authenticity & Refund Policy:**\n• Every device and e-liquid is **100% genuine and factory-sealed**.\n• **Strict No Refund Policy:** All sales are final—no refunds or returns once confirmed or delivered.\n• **DOA Claims:** An **uncut unboxing video** is mandatory upon receiving the parcel.`
      };
    }

    // Loyalty Levels
    if (/(loyalty|level|tier|discount|point|legend|diamond|reward|ডিসকাউন্ট|লেভেল|পয়েন্ট)/i.test(q)) {
      return {
        text: isBn
          ? `**GY Loyalty Levels (১০টি লেভেল):**\nআপনি যত বেশি শপিং করবেন, তত বেশি ডিসকাউন্ট ও পয়েন্ট পাবেন:\n• **Bronze (৳১,৫০০+):** ১% ছাড়\n• **Silver (৳৩,০০০+):** ২% ছাড়\n• **Gold (৳৫,০০০+):** ৩% ছাড়\n• **Emerald (৳৭,৫০০+):** ৪% ছাড়\n• **Sapphire (৳১০,০০০+):** ৫% ছাড়\n• **Legend (৳২৫,০০০+):** ১০% ছাড় ও +৬০% পয়েন্ট!`
          : `**GY Loyalty Levels (10 Tiers):**\n• **Bronze (৳1,500+):** 1% off\n• **Silver (৳3,000+):** 2% off\n• **Gold (৳5,000+):** 3% off\n• **Emerald (৳7,500+):** 4% off\n• **Sapphire (৳10,000+):** 5% off\n• **Legend (৳25,000+):** 10% off & +60% points!`
      };
    }

    // How to order
    if (/(how to order|order|buy|cart|checkout|kivabe|অর্ডার|কিনবো|কিভাবে)/i.test(q)) {
      return {
        text: isBn
          ? `**অর্ডার করার নিয়ম:**\n১. পছন্দের প্রোডাক্ট ও ফ্লেভার সিলেক্ট করে **Add to Cart** বা **Buy Now** চাপুন।\n২. আপনার নাম, ফোন নম্বর, ডেলিভারি জোন ও ঠিকানা দিন।\n৩. \`01719738303\` নম্বরে bKash/Nagad Send Money করে ৫০% বা ১০০% অ্যাডভান্স পাঠান এবং TrxID দিন।\n৪. শর্তাবলীতে টিক দিয়ে **Confirm Order via WhatsApp** চাপুন।`
          : `**How to Order:**\n1. Pick your product & flavor, then click **Add to Cart** or **Buy Now**.\n2. Enter your Name, Phone, Delivery Zone, and Address.\n3. Send 50% or 100% advance via bKash/Nagad Send Money to \`01719738303\` and enter your TrxID.\n4. Agree to the terms and click **Confirm Order via WhatsApp**.`
      };
    }

    // Contact / Owner / Support
    if (/(contact|support|whatsapp|email|owner|ceo|golden|number|হোয়াটসঅ্যাপ|যোগাযোগ|নম্বর|ইমেইল)/i.test(q)) {
      return {
        text: isBn
          ? `**যোগাযোগ ও সাপোর্ট:**\n• **WhatsApp:** +8801410715713\n• **Email:** qazxswqa0000@gmail.com\n• **Founder & CEO:** Golden\n• **bKash / Nagad (Send Money):** \`01719738303\``
          : `**Contact & Support:**\n• **WhatsApp:** +8801410715713\n• **Email:** qazxswqa0000@gmail.com\n• **Founder & CEO:** Golden\n• **bKash / Nagad (Send Money):** \`01719738303\``
      };
    }

    // Age restriction
    if (/(18\+|age|minor|বয়স)/i.test(q)) {
      return {
        text: isBn
          ? `এই ওয়েবসাইটের সকল পণ্য শুধুমাত্র **১৮ বছর বা তার বেশি বয়সী** প্রাপ্তবয়স্কদের জন্য।`
          : `All products on GY Puff & Cloud are strictly for **adults aged 18 and older**.`
      };
    }

    // Product Search in live catalog
    const matches = searchCatalog(q);
    if (matches.length) {
      return {
        text: isBn
          ? `আপনার প্রশ্নের সাথে মিল থাকা প্রোডাক্টগুলো নিচে দেওয়া হলো (বিস্তারিত দেখতে ক্লিক করুন):`
          : `Here are the matching products from our live catalog:`,
        products: matches
      };
    }

    // General fallback
    return {
      text: isBn
        ? `দুঃখিত, এই বিষয়টি আমি পুরোপুরি বুঝতে পারিনি। আপনি প্রোডাক্টের নাম, বাজেট, ডেলিভারি, bKash/Nagad পেমেন্ট, বা অর্ডার করার নিয়ম সম্পর্কে জিজ্ঞাসা করতে পারেন—অথবা সরাসরি আমাদের WhatsApp-এ মেসেজ দিন!`
        : `I'm not sure I caught that! You can ask me about our products, prices, flavors, delivery charges, bKash/Nagad payment, loyalty levels, or message us directly on WhatsApp.`,
      showWhatsApp: true
    };
  }

  async function askAI(userMsg) {
    const apiUrl = CFG.CHAT_API_URL || CFG.APPS_SCRIPT_URL;
    if (!apiUrl) {
      return generateLocalReply(userMsg);
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 15000) : null;

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          action: "chat",
          message: userMsg,
          history: history.slice(-6),
          storeContext: STORE_KNOWLEDGE + "\n\nLive Catalog:\n" + buildCatalogSummaryForAI()
        })
      });
      if (timeoutId) clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.ok && data.reply) {
        const matched = searchCatalog(userMsg);
        return {
          text: data.reply,
          products: matched.length && /(price|dam|koto|show|buy|pod|vape|salt|coil|kit|flavor|stock|product|ase|ache)/i.test(userMsg) ? matched.slice(0, 3) : undefined
        };
      } else if (data && data.error) {
        console.warn("GY AI API error:", data.error);
      }
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn("AI API fallback to local engine:", err);
    }

    return generateLocalReply(userMsg);
  }

  function formatBotText(text) {
    return escapeHTML(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  function appendMessage(role, payload) {
    const body = document.getElementById("gy-chat-messages");
    const msgWrap = document.createElement("div");
    msgWrap.className = `gy-msg gy-msg-${role}`;

    const bubble = document.createElement("div");
    bubble.className = "gy-msg-bubble";
    bubble.innerHTML = role === "user" ? escapeHTML(payload.text) : formatBotText(payload.text);
    msgWrap.appendChild(bubble);

    if (payload.products && payload.products.length) {
      const cardsWrap = document.createElement("div");
      cardsWrap.className = "gy-chat-products";
      cardsWrap.innerHTML = payload.products.map(p => {
        const inStock = p.plans.some(v => v.stock !== 0);
        return `
          <a class="gy-chat-product-card" href="product.html?slug=${encodeURIComponent(p.slug)}">
            <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" onerror="this.src='${FALLBACK_IMG}'" />
            <div class="gy-chat-product-info">
              <strong>${escapeHTML(p.name)}</strong>
              <span>${escapeHTML(p.category)} · ${inStock ? "In Stock" : "Out of Stock"}</span>
              <em>${p.maxPrice > p.minPrice ? "From " : ""}${formatTaka(p.minPrice)}</em>
            </div>
          </a>
        `;
      }).join("");
      msgWrap.appendChild(cardsWrap);
    }

    if (payload.showWhatsApp) {
      const waBtn = document.createElement("a");
      waBtn.className = "gy-chat-wa-btn";
      waBtn.href = `https://wa.me/${WHATSAPP_NUMBER}`;
      waBtn.target = "_blank";
      waBtn.rel = "noopener";
      waBtn.textContent = "Chat on WhatsApp";
      msgWrap.appendChild(waBtn);
    }

    body.appendChild(msgWrap);
    body.scrollTop = body.scrollHeight;
  }

  function showTyping() {
    const body = document.getElementById("gy-chat-messages");
    const el = document.createElement("div");
    el.id = "gy-chat-typing";
    el.className = "gy-msg gy-msg-bot";
    el.innerHTML = `<div class="gy-msg-bubble gy-typing"><span></span><span></span><span></span></div>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById("gy-chat-typing");
    if (el) el.remove();
  }

  async function handleSend(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || isSending) return;

    isSending = true;
    const input = document.getElementById("gy-chat-input");
    const sendBtn = document.getElementById("gy-chat-send");
    input.value = "";
    sendBtn.disabled = true;

    appendMessage("user", { text: trimmed });
    history.push({ role: "user", text: trimmed });
    showTyping();

    await ensureCatalogLoaded();
    const reply = await askAI(trimmed);

    hideTyping();
    appendMessage("bot", reply);
    history.push({ role: "model", text: reply.text });

    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }

  function injectWidget() {
    if (document.getElementById("gy-chatbot-root")) return;

    const root = document.createElement("div");
    root.id = "gy-chatbot-root";
    root.innerHTML = `
      <button type="button" id="gy-chat-launcher" class="gy-chat-launcher" aria-label="Open AI Assistant" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Ask AI</span>
      </button>

      <section id="gy-chat-window" class="gy-chat-window hidden" role="dialog" aria-label="${escapeHTML(BOT_NAME)}">
        <header class="gy-chat-header">
          <div class="gy-chat-header-info">
            <span class="gy-chat-dot"></span>
            <div>
              <strong>${escapeHTML(BOT_NAME)}</strong>
              <small>Online · A to Z Store &amp; Vape Help</small>
            </div>
          </div>
          <button type="button" id="gy-chat-close" class="gy-chat-close" aria-label="Close chat">&times;</button>
        </header>

        <div id="gy-chat-messages" class="gy-chat-messages"></div>

        <div class="gy-chat-chips" id="gy-chat-chips">
          <button type="button" data-q="What products are in stock?">In Stock</button>
          <button type="button" data-q="Delivery charge and time?">Delivery</button>
          <button type="button" data-q="bKash/Nagad payment & COD policy?">Payment</button>
          <button type="button" data-q="How to order?">How to Order</button>
          <button type="button" data-q="Loyalty levels?">Loyalty</button>
        </div>

        <form id="gy-chat-form" class="gy-chat-form">
          <input type="text" id="gy-chat-input" class="gy-chat-input" placeholder="Ask anything (EN / বাংলা / Banglish)..." autocomplete="off" />
          <button type="submit" id="gy-chat-send" class="gy-chat-send" aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </form>
      </section>
    `;
    document.body.appendChild(root);

    const launcher = document.getElementById("gy-chat-launcher");
    const win = document.getElementById("gy-chat-window");
    const closeBtn = document.getElementById("gy-chat-close");
    const form = document.getElementById("gy-chat-form");
    const input = document.getElementById("gy-chat-input");

    const toggleChat = force => {
      isOpen = typeof force === "boolean" ? force : !isOpen;
      win.classList.toggle("hidden", !isOpen);
      launcher.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        ensureCatalogLoaded();
        input.focus();
      }
    };

    launcher.addEventListener("click", () => toggleChat());
    closeBtn.addEventListener("click", () => toggleChat(false));

    form.addEventListener("submit", e => {
      e.preventDefault();
      handleSend(input.value);
    });

    document.querySelectorAll("#gy-chat-chips button").forEach(btn => {
      btn.addEventListener("click", () => handleSend(btn.dataset.q));
    });

    appendMessage("bot", {
      text: CHAT_CFG.WELCOME_MESSAGE ||
        `আসসালামু আলাইকুম! আমি **${BOT_NAME}**। প্রোডাক্ট, দাম, ফ্লেভার, ডেলিভারি, bKash/Nagad পেমেন্ট বা অর্ডার সংক্রান্ত যেকোনো প্রশ্ন করুন (বাংলা, Banglish বা English-এ)।`
    });
  }

  document.addEventListener("DOMContentLoaded", injectWidget);
})();