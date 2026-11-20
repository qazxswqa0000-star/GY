(function () {
  const CFG = window.YEAXMI_CONFIG || {};
  const CART_KEY = "yeaxmi_vape_cart";
  const AGE_KEY = "yeaxmi_age_verified";
  const CATEGORIES = Array.isArray(CFG.CATEGORIES) ? CFG.CATEGORIES : [];
  const DELIVERY_RATES = CFG.DELIVERY_RATES || {
    inside: { label: "Inside Khulna / Dhaka", fee: 70 },
    outside: { label: "Outside Dhaka (Courier)", fee: 130 }
  };
  const PAYMENT_VERIFICATION_PLACEHOLDER = "Enter bKash/Nagad Send Money Number and Transaction ID (TrxID) *Required for verification*";
  const FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=600&q=80";

  function normalizeDriveImageUrl(url) {
    const trimmedUrl = String(url || "").trim();
    const match = trimmedUrl.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([a-zA-Z0-9_-]{20,})/);
    return match ? `https://lh3.googleusercontent.com/d/${match[1]}` : trimmedUrl;
  }

  // Safe image extractor supporting Google Drive, Unsplash, or direct URLs
  function getProductImageUrl(product) {
    const rawImg = product.image || product.gallery || product.badge || product.price_from || "";
    if (typeof rawImg !== "string" || !rawImg.trim()) return FALLBACK_IMAGE_URL;

    const cleanUrl = rawImg.trim().split(/[|,\r\n]+/)[0].trim();
    return normalizeDriveImageUrl(cleanUrl);
  }

  let products = [];
  let activeCategory = "All";
  let searchQuery = "";
  let sortMode = "recommended";

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = "", inQuotes = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur); cur = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
    if (cur !== "" || row.length) {
      row.push(cur);
      if (row.some(c => c.trim() !== "")) rows.push(row);
    }
    const headers = (rows.shift() || []).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return rows.map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] || "").trim()])));
  }

  const toNum = val => {
    const n = parseFloat(String(val).replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  };

  const normalizeSlug = value => String(value || "").trim().toLowerCase();

  function getProductStartingPrice(product) {
    const price = toNum(product.price);
    if (price > 0) return price;

    const subtitlePrice = String(product.subtitle || "").match(/(?:BDT\s*|৳\s*)([\d,]+(?:\.\d+)?)/i);
    return subtitlePrice ? toNum(subtitlePrice[1]) || 0 : 0;
  }

  const formatTaka = n => "৳ " + Number(n || 0).toLocaleString("en-US");

  function toast(msg) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  const CATALOG_CACHE_KEY = "yeaxmi_catalog_cache";

  function buildCatalog(productCsv, planCsv) {
    const productRows = parseCSV(productCsv);
    const planRows = parseCSV(planCsv);
    const plansBySlug = Object.create(null);

    planRows.forEach(row => {
      const slug = normalizeSlug(row.slug);
      if (!slug) return;
      (plansBySlug[slug] = plansBySlug[slug] || []).push({
        plan: row.plan || "Standard",
        price: toNum(row.price) || 0,
        old_price: toNum(row.old_price),
        stock: row.stock === "" ? null : toNum(row.stock),
        about: row.about || ""
      });
    });

    return productRows
      .filter(row => normalizeSlug(row.slug) && row.name && !/^(hidden|inactive|draft)$/i.test(row.status || ""))
      .map((row, idx) => {
        const slug = normalizeSlug(row.slug);
        const matchedPlans = plansBySlug[slug] || [];
        const itemPlans = matchedPlans.length
          ? matchedPlans
          : [{ plan: "Standard", price: toNum(row.price) || 0, old_price: null, stock: null, about: "" }];
        const activePrices = itemPlans.map(plan => plan.price).filter(price => price > 0);
        const fallbackPrice = getProductStartingPrice(row);
        const startingPrice = activePrices.length ? Math.min(...activePrices) : fallbackPrice;
        const maxPrice = activePrices.length ? Math.max(...activePrices) : fallbackPrice;
        const resolvedImage = getProductImageUrl(row);

        return {
          ...row,
          slug,
          order: toNum(row.sort_order) ?? idx + 1,
          category: row.category || "Disposable Vapes",
          resolvedImage,
          images: [resolvedImage],
          plans: itemPlans,
          min: startingPrice,
          max: maxPrice
        };
      });
  }

  function loadCachedCatalog() {
    try {
      const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null");
      if (!cached || typeof cached.productCsv !== "string" || typeof cached.planCsv !== "string") {
        return false;
      }
      products = buildCatalog(cached.productCsv, cached.planCsv);
      return true;
    } catch (error) {
      console.warn("Could not load cached storefront catalog:", error);
      return false;
    }
  }

  async function refreshCatalog() {
    if (!CFG.PRODUCTS_CSV_URL || !CFG.PLANS_CSV_URL) {
      throw new Error("Catalog CSV URLs are not configured");
    }

    const addCacheBust = url => `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    const [productResponse, planResponse] = await Promise.all([
      fetch(addCacheBust(CFG.PRODUCTS_CSV_URL), { cache: "no-store" }),
      fetch(addCacheBust(CFG.PLANS_CSV_URL), { cache: "no-store" })
    ]);
    if (!productResponse.ok || !planResponse.ok) throw new Error("Failed to fetch Google Sheets");

    const [productCsv, planCsv] = await Promise.all([
      productResponse.text(),
      planResponse.text()
    ]);
    const updatedProducts = buildCatalog(productCsv, planCsv);
    products = updatedProducts;

    try {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
        productCsv,
        planCsv,
        updatedAt: Date.now()
      }));
    } catch (error) {
      console.warn("Could not update storefront catalog cache:", error);
    }
  }

  function updateStoreStructuredData() {
    const schemaElement = document.getElementById("store-structured-data");
    const storeData = JSON.parse(schemaElement.textContent);
    const productItems = products.map(item => ({
      "@type": "Product",
      name: item.name,
      image: item.images[0],
      url: `https://gypuff.asf.sale/product.html?slug=${encodeURIComponent(item.slug)}`,
      category: item.category,
      description: item.subtitle || item.description || undefined,
      offers: item.min > 0 ? {
        "@type": "AggregateOffer",
        priceCurrency: "BDT",
        lowPrice: item.min,
        highPrice: item.max,
        offerCount: item.plans.length
      } : undefined
    }));

    const categories = storeData.hasOfferCatalog.itemListElement.filter(item => item["@type"] !== "Product");
    storeData.hasOfferCatalog.itemListElement = [...categories, ...productItems];
    schemaElement.textContent = JSON.stringify(storeData).replace(/</g, "\\u003c");
  }

  function renderCategories() {
    const container = document.getElementById("category-pills");
    const sheetCats = [...new Set(products.map(p => p.category))];
    const cats = ["All", ...new Set([...CATEGORIES, ...sheetCats])];

    container.innerHTML = cats.map(cat => `
      <button type="button" class="pill ${activeCategory === cat ? "active" : ""}" data-cat="${cat}">
        ${cat}
      </button>
    `).join("");

    container.querySelectorAll(".pill").forEach(btn => {
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.cat;
        renderCategories();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    const grid = document.getElementById("product-grid");
    const status = document.getElementById("catalog-status");
    const q = searchQuery.trim().toLowerCase();

    let list = products.filter(p => {
      const matchCat = activeCategory === "All" || p.category === activeCategory;
      const matchQ = !q || (p.name + " " + (p.subtitle || "") + " " + p.category).toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (sortMode === "price-asc") list.sort((a, b) => a.min - b.min);
    else if (sortMode === "price-desc") list.sort((a, b) => b.min - a.min);
    else if (sortMode === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => a.order - b.order);

    status.textContent = `Showing ${list.length} product${list.length === 1 ? "" : "s"}`;

    if (!list.length) {
      grid.innerHTML = `<p style="grid-column: 1/-1; padding: 40px 0; text-align: center; color: var(--text-muted);">No products match your filter.</p>`;
      return;
    }

    grid.innerHTML = list.map(p => {
      const firstPlan = p.plans[0];
      const badge = typeof p.badge === "string" && !/^https?:\/\//i.test(p.badge.trim()) ? p.badge.trim() : "";
      const discount = !badge && firstPlan && firstPlan.old_price > firstPlan.price
        ? `Save ${Math.round((1 - firstPlan.price / firstPlan.old_price) * 100)}%`
        : badge;
      const productUrl = `product.html?slug=${encodeURIComponent(p.slug)}`;

      return `
        <article class="product-card">
          <a class="card-media" href="${productUrl}" aria-label="View ${p.name}">
            <img src="${p.resolvedImage}" alt="${p.name}" loading="lazy" />
            ${discount ? `<span class="card-badge">${discount}</span>` : ""}
          </a>
          <div class="card-body">
            <span class="card-cat">${p.category}</span>
            <h3><a class="card-title" href="${productUrl}">${p.name}</a></h3>
            <p class="card-subtitle">${p.subtitle || ""}</p>
            <div class="card-footer">
              <div class="card-price">
                ${p.max > p.min ? "<small>From </small>" : ""}${formatTaka(p.min)}
              </div>
              <a href="${productUrl}" class="btn btn-outline product-card-select">Select</a>
            </div>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".card-media img").forEach(img => {
      img.addEventListener("error", () => {
        img.src = FALLBACK_IMAGE_URL;
      }, { once: true });
    });
  }

  function renderMarquee() {
    const track = document.getElementById("marquee-track");
    const section = document.getElementById("featured-marquee");
    if (!track || !section) return;

    const featured = [...products].sort((a, b) => a.order - b.order).slice(0, 12);
    if (!featured.length) {
      section.classList.add("hidden");
      return;
    }

    const buildGroup = (isDuplicate = false) => {
      const group = document.createElement("div");
      group.className = "marquee-group";

      if (isDuplicate) group.setAttribute("aria-hidden", "true");

      featured.forEach(product => {
        const card = document.createElement("a");
        card.className = "marquee-card";
        card.href = `product.html?slug=${encodeURIComponent(product.slug)}`;
        card.setAttribute("aria-label", product.name);

        if (isDuplicate) card.tabIndex = -1;

        const imageFrame = document.createElement("div");
        imageFrame.className = "marquee-card-img";
        const image = document.createElement("img");
        image.src = product.resolvedImage;
        image.alt = product.name;
        image.loading = "lazy";
        image.addEventListener("error", () => {
          image.src = FALLBACK_IMAGE_URL;
        }, { once: true });
        imageFrame.appendChild(image);

        const body = document.createElement("div");
        body.className = "marquee-card-body";

        const category = document.createElement("span");
        category.className = "marquee-card-cat";
        category.textContent = product.category;

        const title = document.createElement("strong");
        title.className = "marquee-card-title";
        title.textContent = product.name;

        const price = document.createElement("span");
        price.className = "marquee-card-price";
        price.textContent = `${product.max > product.min ? "From " : ""}${formatTaka(product.min)}`;

        body.append(category, title, price);
        card.append(imageFrame, body);
        group.appendChild(card);
      });

      return group;
    };

    track.textContent = "";
    track.append(buildGroup(), buildGroup(true));
    section.classList.remove("hidden");
  }

  const getCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
    catch (e) { return []; }
  };

  const saveCart = cart => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  };

  function updateCartBadge() {
    const totalQty = getCart().reduce((sum, item) => sum + item.qty, 0);
    document.getElementById("cart-count").textContent = totalQty;
  }

  function addToCart(product, planObj) {
    const cart = getCart();
    const existing = cart.find(i => i.slug === product.slug && i.plan === planObj.plan);
    if (existing) existing.qty += 1;
    else {
      cart.push({
        slug: product.slug,
        name: product.name,
        plan: planObj.plan,
        price: planObj.price,
        image: product.resolvedImage,
        qty: 1
      });
    }
    saveCart(cart);
  }

  function renderCart() {
    const cart = getCart();
    const listEl = document.getElementById("cart-items-list");
    const formEl = document.getElementById("checkout-form");
    const footerEl = document.getElementById("cart-footer");

    if (!cart.length) {
      listEl.innerHTML = `<p style="text-align: center; padding: 48px 0; color: var(--text-muted); font-size: 14px;">Your cart is empty.</p>`;
      formEl.classList.add("hidden");
      footerEl.classList.add("hidden");
      return;
    }

    formEl.classList.remove("hidden");
    footerEl.classList.remove("hidden");

    listEl.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.name}" />
        <div style="flex: 1; min-width: 0;">
          <strong style="font-size: 14px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</strong>
          <span style="font-size: 12px; color: var(--text-muted); display: block;">${item.plan}</span>
          <span style="font-size: 13px; font-weight: 600; display: block; margin-top: 2px;">${formatTaka(item.price * item.qty)}</span>
          <div class="qty-controls">
            <button type="button" data-qty-delta="-1" data-idx="${idx}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-qty-delta="1" data-idx="${idx}">+</button>
          </div>
        </div>
        <button type="button" data-remove-idx="${idx}" style="font-size: 12px; color: var(--danger); align-self: flex-start;">Remove</button>
      </div>
    `).join("");

    listEl.querySelectorAll("[data-qty-delta]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const delta = Number(btn.dataset.qtyDelta);
        cart[idx].qty += delta;
        if (cart[idx].qty <= 0) cart.splice(idx, 1);
        saveCart(cart);
        renderCart();
      });
    });

    listEl.querySelectorAll("[data-remove-idx]").forEach(btn => {
      btn.addEventListener("click", () => {
        cart.splice(Number(btn.dataset.removeIdx), 1);
        saveCart(cart);
        renderCart();
      });
    });

    updateCartTotals();
  }

  function updateCartTotals() {
    const cart = getCart();
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const zoneKey = document.getElementById("delivery-zone").value;
    const deliveryFee = DELIVERY_RATES[zoneKey].fee;
    const advancePercent = Number(document.getElementById("payment-method").value);
    const grandTotal = subtotal + deliveryFee;
    const advanceRequired = grandTotal * advancePercent / 100;
    const remainingDue = grandTotal - advanceRequired;

    document.getElementById("cart-subtotal").textContent = formatTaka(subtotal);
    document.getElementById("cart-delivery").textContent = formatTaka(deliveryFee);
    document.getElementById("cart-total").textContent = formatTaka(grandTotal);
    document.getElementById("cart-advance-label").textContent = advancePercent === 100
      ? "100% Full Advance Paid / Required"
      : "50% Advance Paid / Required";
    document.getElementById("cart-advance").textContent = formatTaka(advanceRequired);
    document.getElementById("cart-due").textContent = formatTaka(remainingDue);
  }

  function updatePaymentSelection() {
    document.getElementById("cust-note").placeholder = PAYMENT_VERIFICATION_PLACEHOLDER;
    updateCartTotals();
  }

  function submitWhatsAppOrder() {
    const form = document.getElementById("checkout-form");
    const termsAgreement = document.getElementById("agree-terms");
    if (!termsAgreement.checked) {
      toast("Please agree to the Terms & Conditions and No Refund Policy before placing your order.");
      termsAgreement.focus();
      return;
    }
    if (!form.reportValidity()) return;

    const cart = getCart();
    if (!cart.length) return;

    const name = document.getElementById("cust-name").value.trim();
    const phone = document.getElementById("cust-phone").value.trim();
    const zoneKey = document.getElementById("delivery-zone").value;
    const zone = DELIVERY_RATES[zoneKey];
    const address = document.getElementById("cust-address").value.trim();
    const paymentSelect = document.getElementById("payment-method");
    const payment = paymentSelect.options[paymentSelect.selectedIndex].text;
    const advancePercent = Number(paymentSelect.value);
    const noteInput = document.getElementById("cust-note");
    const note = noteInput.value.trim();
    if (!note) {
      noteInput.setCustomValidity("Enter sender number and transaction ID for verification.");
      noteInput.reportValidity();
      return;
    }
    noteInput.setCustomValidity("");

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const grandTotal = subtotal + zone.fee;
    const advancePaid = grandTotal * advancePercent / 100;
    const dueAmount = grandTotal - advancePaid;

    const itemLines = cart.map(i => `• ${i.name} (${i.plan}) x${i.qty} = ${formatTaka(i.price * i.qty)}`);

    const message = [
      `*New Order — ${CFG.STORE_NAME || "GY Puff & Cloud"}*`,
      `------------------------`,
      `*Customer:* ${name}`,
      `*Phone:* ${phone}`,
      `*Zone:* ${zone.label}`,
      `*Address:* ${address}`,
      `*Payment Selection:* ${payment}`,
      `*Transaction ID / Sender:* ${note}`,
      ``,
      `*Items:*`,
      ...itemLines,
      ``,
      `Subtotal: ${formatTaka(subtotal)}`,
      `Delivery: ${formatTaka(zone.fee)}`,
      `*Grand Total:* BDT ${grandTotal.toLocaleString("en-US")}`,
      `*Advance Paid (bKash/Nagad):* BDT ${advancePaid.toLocaleString("en-US")}`,
      `*Due Amount (Pay on Delivery):* BDT ${dueAmount.toLocaleString("en-US")}`,
      `------------------------`,
      `Terms & No Refund Policy: Agreed`,
      `I confirm I am 18+ years old.`
    ].join("\n");

    saveCart([]);
    renderCart();
    document.getElementById("cart-drawer").classList.add("hidden");
    window.open(`https://wa.me/${CFG.WHATSAPP_NUMBER || "8801410715713"}?text=${encodeURIComponent(message)}`, "_blank");
  }

  function initTheme() {
    const saved = localStorage.getItem("yeaxmi_theme");
    document.documentElement.classList.toggle("dark", saved === "dark");
    const themeToggle = document.getElementById("theme-toggle");

    const updateThemeIcon = isDark => {
      themeToggle.innerHTML = isDark
        ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      themeToggle.setAttribute("aria-pressed", String(isDark));
    };

    updateThemeIcon(document.documentElement.classList.contains("dark"));

    themeToggle.addEventListener("click", () => {
      const isDark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("yeaxmi_theme", isDark ? "dark" : "light");
      updateThemeIcon(isDark);
    });
  }

  function initAgeGate() {
    if (localStorage.getItem(AGE_KEY) === "true") return;
    const gate = document.getElementById("age-gate");
    gate.classList.remove("hidden");

    document.getElementById("age-yes-btn").addEventListener("click", () => {
      localStorage.setItem(AGE_KEY, "true");
      gate.classList.add("hidden");
    });

    document.getElementById("age-no-btn").addEventListener("click", () => {
      window.location.href = "https://www.google.com";
    });
  }

  function initTestimonials() {
    const grid = document.getElementById("testimonials-grid");
    if (!grid) return;

    const reviews = [
      {
        name: "NURUDDIN K.",
        initials: "NK",
        product: "ElfBar BC10000 Disposable",
        badge: "Verified Buyer",
        since: "Customer since Oct 2026 · 3 orders",
        text: "Great Service. Highly recommended! ১০০% অরিজিনাল সিলড প্রোডাক্ট পেয়েছি এবং ডেলিভারিও খুব দ্রুত ছিল।"
      },
      {
        name: "MOIN U.",
        initials: "MU",
        product: "Vaporesso XROS 4 Pod Kit",
        badge: "Regular Customer",
        since: "Customer since Aug 2026 · 4 orders",
        text: "Ami pray 6 month dhore use korteci they are very nice guy and tader service one of the best. Packaging khub discreet chilo."
      },
      {
        name: "SHAHARUK J.",
        initials: "SJ",
        product: "Tokyo Iced Mango Nic Salt",
        badge: "Verified Buyer",
        since: "Customer since Oct 2026 · 2 orders",
        text: "GY Puff & Cloud থেকে পড এবং নিক সল্ট নিয়েছি। সার্ভিস নিয়ে আমি বেশ সন্তুষ্ট। পুরো প্রক্রিয়াটি সহজ ছিল এবং হোয়াটসঅ্যাপে ভালো সাপোর্ট পেয়েছি। ❤️"
      },
      {
        name: "TANVIR A.",
        initials: "TA",
        product: "Oxva Xlim Pro Kit",
        badge: "Khulna Express",
        since: "Customer since Sep 2026 · 5 orders",
        text: "সাতক্ষীরায় এমন বিশ্বস্ত ভ্যাপ শপ আগে ছিল না। সিকিউরিটি কোড স্ক্যান করে চেক করেছি, একদম অথেনটিক।"
      },
      {
        name: "RAKIBUL H.",
        initials: "RH",
        product: "Nasty Juice Cush Man",
        badge: "Verified Buyer",
        since: "Customer since Sep 2026 · 2 orders",
        text: "Dhaka theke order korsilam, 2 diner moddhei hate peye gesi. Best price in BD."
      },
      {
        name: "FAHIM M.",
        initials: "FM",
        product: "Caliburn G3 Replacement Pods",
        badge: "Regular Customer",
        since: "Customer since Jul 2026 · 6 orders",
        text: "Coil ar cartridge sob somoy stock e thake. Behavior khub e valo, kono jhamela charai order kora jay."
      }
    ];

    const createCardHTML = r => `
      <article class="review-card">
        <div class="review-stars">★★★★★</div>
        <p class="review-text">${r.text}</p>
        <div class="review-author">
          <div class="review-avatar">${r.initials}</div>
          <div class="review-meta">
            <strong>${r.name}</strong>
            <span>on ${r.product}</span>
            <span class="review-badge">${r.badge}</span>
            <span style="margin-top: 2px;">${r.since}</span>
          </div>
        </div>
      </article>
    `;

    const columns = [
      { items: [reviews[0], reviews[3]], dir: "review-col-up" },
      { items: [reviews[1], reviews[4]], dir: "review-col-down" },
      { items: [reviews[2], reviews[5]], dir: "review-col-up" }
    ];

    grid.innerHTML = columns.map(col => {
      const cards = col.items.map(createCardHTML).join("");
      return `<div class="review-col-track ${col.dir}">${cards}${cards}</div>`;
    }).join("");
  }

  function initLoyaltyLevels() {
    const grid = document.getElementById("loyalty-grid");
    if (!grid) return;

    const tiers = [
      {
        level: 1,
        name: "Starter",
        spend: "Everyone starts here",
        perks: ["Your frame begins here"],
        color: "var(--text)",
        ringBg: "#a1a1aa",
        badgeBg: "#52525b",
        glow: "transparent"
      },
      {
        level: 2,
        name: "Bronze",
        spend: "From ৳ 1,500 spent",
        perks: ["% 1% off every order", "✦ 5% more points"],
        color: "#b45309",
        ringBg: "linear-gradient(135deg, #d97706, #92400e)",
        badgeBg: "#b45309",
        glow: "rgba(217, 119, 6, 0.22)"
      },
      {
        level: 3,
        name: "Silver",
        spend: "From ৳ 3,000 spent",
        perks: ["% 2% off every order", "✦ 10% more points"],
        color: "#64748b",
        ringBg: "linear-gradient(135deg, #cbd5e1, #64748b)",
        badgeBg: "#64748b",
        glow: "rgba(148, 163, 184, 0.25)"
      },
      {
        level: 4,
        name: "Gold",
        spend: "From ৳ 5,000 spent",
        perks: ["% 3% off every order", "✦ 15% more points"],
        color: "#d97706",
        ringBg: "linear-gradient(135deg, #facc15, #ca8a04)",
        badgeBg: "#eab308",
        glow: "rgba(234, 179, 8, 0.28)"
      },
      {
        level: 5,
        name: "Emerald",
        spend: "From ৳ 7,500 spent",
        perks: ["% 4% off every order", "✦ 20% more points"],
        color: "#059669",
        ringBg: "linear-gradient(135deg, #34d399, #059669)",
        badgeBg: "#10b981",
        glow: "rgba(16, 185, 129, 0.28)"
      },
      {
        level: 6,
        name: "Sapphire",
        spend: "From ৳ 10,000 spent",
        perks: ["% 5% off every order", "✦ 25% more points"],
        color: "#2563eb",
        ringBg: "linear-gradient(135deg, #60a5fa, #1d4ed8)",
        badgeBg: "#2563eb",
        glow: "rgba(37, 99, 235, 0.30)"
      },
      {
        level: 7,
        name: "Amethyst",
        spend: "From ৳ 13,000 spent",
        perks: ["% 6% off every order", "✦ 30% more points"],
        color: "#7c3aed",
        ringBg: "linear-gradient(135deg, #c084fc, #7c3aed)",
        badgeBg: "#7c3aed",
        glow: "rgba(124, 58, 237, 0.30)"
      },
      {
        level: 8,
        name: "Ruby",
        spend: "From ৳ 16,500 spent",
        perks: ["% 7% off every order", "✦ 40% more points"],
        color: "#dc2626",
        ringBg: "linear-gradient(135deg, #f87171, #b91c1c)",
        badgeBg: "#dc2626",
        glow: "rgba(220, 38, 38, 0.30)"
      },
      {
        level: 9,
        name: "Diamond",
        spend: "From ৳ 20,000 spent",
        perks: ["% 8% off every order", "✦ 50% more points"],
        color: "#0284c7",
        ringBg: "linear-gradient(135deg, #7dd3fc, #0284c7)",
        badgeBg: "#0ea5e9",
        glow: "rgba(14, 165, 233, 0.34)"
      },
      {
        level: 10,
        name: "Legend",
        spend: "From ৳ 25,000 spent",
        perks: ["% 10% off every order", "✦ 60% more points"],
        color: "#ea580c",
        ringBg: "linear-gradient(135deg, #facc15, #f97316, #ec4899)",
        badgeBg: "#f97316",
        glow: "rgba(249, 115, 22, 0.38)",
        crown: true
      }
    ];

    const userSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M5 20a7 7 0 0 1 14 0"></path>
      </svg>
    `;

    grid.innerHTML = tiers.map(t => `
      <article class="level-card" style="--tier-color: ${t.color}; --ring-bg: ${t.ringBg}; --badge-bg: ${t.badgeBg}; --ring-glow: ${t.glow};">
        <div class="level-ring-wrap">
          ${t.crown ? `<span class="level-crown" role="img" aria-label="Legend tier"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 7 4.5 4L12 5l4.5 6L21 7l-2 12H5L3 7Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 22h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>` : ""}
          <div class="level-ring">
            <div class="level-avatar-inner">${userSvg}</div>
          </div>
          <span class="level-num-badge">${t.level}</span>
        </div>
        <h3 class="level-name">${t.name}</h3>
        <p class="level-spend">${t.spend}</p>
        <ul class="level-perks">
          ${t.perks.map(p => `<li>${p}</li>`).join("")}
        </ul>
      </article>
    `).join("");
  }

  function initOrbitCTA() {
    document.querySelectorAll("[data-quick-cat]").forEach(btn => {
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.quickCat;
        renderCategories();
        renderGrid();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const requestedCategory = new URLSearchParams(window.location.search).get("category");
    window.initSocialLinks();
    initTheme();
    initAgeGate();
    initLoyaltyLevels();
    initTestimonials();
    initOrbitCTA();
    updateCartBadge();

    document.getElementById("search-input").addEventListener("input", e => {
      searchQuery = e.target.value;
      renderGrid();
    });

    document.getElementById("sort-select").addEventListener("change", e => {
      sortMode = e.target.value;
      renderGrid();
    });

    document.getElementById("open-cart-btn").addEventListener("click", () => {
      renderCart();
      document.getElementById("cart-drawer").classList.remove("hidden");
    });

    document.getElementById("close-cart-btn").addEventListener("click", () => {
      document.getElementById("cart-drawer").classList.add("hidden");
    });

    document.getElementById("delivery-zone").addEventListener("change", updateCartTotals);
    document.getElementById("payment-method").addEventListener("change", updatePaymentSelection);
    document.getElementById("cust-note").addEventListener("input", event => event.currentTarget.setCustomValidity(""));
    const copyPaymentButton = document.getElementById("copy-payment-number");
    copyPaymentButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText("01719738303");
        copyPaymentButton.textContent = "Copied!";
        setTimeout(() => { copyPaymentButton.textContent = "Copy"; }, 1500);
      } catch (error) {
        console.error("Could not copy payment number:", error);
        toast("Could not copy the number. Please copy it manually.");
      }
    });
    updatePaymentSelection();
    document.getElementById("confirm-whatsapp-btn").addEventListener("click", submitWhatsAppOrder);

    let catalogHasRendered = false;
    const renderCatalog = () => {
      updateStoreStructuredData();
      const categories = [...CATEGORIES, ...products.map(product => product.category)];
      if (!catalogHasRendered) {
        activeCategory = requestedCategory && categories.includes(requestedCategory)
          ? requestedCategory
          : "All";
      } else if (activeCategory !== "All" && !categories.includes(activeCategory)) {
        activeCategory = "All";
      }
      renderCategories();
      renderGrid();
      renderMarquee();
      catalogHasRendered = true;
    };

    if (loadCachedCatalog()) {
      renderCatalog();
      refreshCatalog().then(renderCatalog).catch(error => {
        console.warn("Catalog refresh warning:", error);
      });
      return;
    }

    try {
      await refreshCatalog();
    } catch (error) {
      console.warn("Catalog load warning:", error);
    }
    renderCatalog();
  });
})();