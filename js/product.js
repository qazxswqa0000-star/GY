(function () {
  const CFG = window.YEAXMI_CONFIG || {};
  const CART_KEY = "yeaxmi_vape_cart";
  const AGE_KEY = "yeaxmi_age_verified";
  const DELIVERY_RATES = CFG.DELIVERY_RATES || {
    inside: { label: "Inside Khulna / Dhaka", fee: 70 },
    outside: { label: "Outside Dhaka (Courier)", fee: 130 }
  };
  const PAYMENT_VERIFICATION_PLACEHOLDER = "Enter bKash/Nagad Send Money Number and Transaction ID (TrxID) *Required for verification*";
  const FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=600&q=80";

  let products = [];
  let product = null;
  let galleryImages = [];
  let selectedPlanIdx = 0;

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

  const toNum = value => {
    const number = parseFloat(String(value).replace(/[^\d.]/g, ""));
    return Number.isNaN(number) ? null : number;
  };

  const normalizeSlug = value => String(value || "").trim().toLowerCase();

  const formatTaka = value => "৳ " + Number(value || 0).toLocaleString("en-US");

  const escapeHTML = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  function getProductImageUrl(rawValue) {
    if (typeof rawValue !== "string" || !rawValue.trim()) return FALLBACK_IMAGE_URL;
    const cleanUrl = rawValue.trim().split(/[|,\r\n]+/)[0].trim();
    const match = cleanUrl.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([a-zA-Z0-9_-]{20,})/);
    return match ? `https://lh3.googleusercontent.com/d/${match[1]}` : cleanUrl;
  }

  function getProductImages(row) {
    const candidates = [row.image, row.gallery]
      .filter(value => typeof value === "string")
      .flatMap(value => value.split(/[|,\r\n]+/))
      .map(value => getProductImageUrl(value.trim()))
      .filter(Boolean);
    const uniqueImages = [...new Set(candidates.filter(url => url !== FALLBACK_IMAGE_URL))];
    return uniqueImages.length ? uniqueImages : [FALLBACK_IMAGE_URL];
  }

  async function loadCatalog() {
    if (!CFG.PRODUCTS_CSV_URL || !CFG.PLANS_CSV_URL) {
      throw new Error("Product catalog URLs are not configured.");
    }

    const bust = "&_t=" + Date.now();
    const [productsResponse, plansResponse] = await Promise.all([
      fetch(CFG.PRODUCTS_CSV_URL + bust),
      fetch(CFG.PLANS_CSV_URL + bust)
    ]);
    if (!productsResponse.ok || !plansResponse.ok) {
      throw new Error("Could not load product catalog data.");
    }

    const productRows = parseCSV(await productsResponse.text());
    const planRows = parseCSV(await plansResponse.text());
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

    products = productRows
      .filter(row => normalizeSlug(row.slug) && row.name && !/^(hidden|inactive|draft)$/i.test(row.status || ""))
      .map(row => {
        const slug = normalizeSlug(row.slug);
        const plans = plansBySlug[slug] && plansBySlug[slug].length
          ? plansBySlug[slug]
          : [{ plan: "Standard", price: toNum(row.price) || 0, old_price: toNum(row.old_price), stock: null, about: "" }];
        const prices = plans.map(planOption => planOption.price);
        const images = getProductImages(row);

        return {
          ...row,
          slug,
          category: row.category || "Disposable Vapes",
          plans,
          images,
          resolvedImage: images[0],
          min: Math.min(...prices),
          max: Math.max(...prices)
        };
      });
  }

  function showNotFound() {
    document.getElementById("pd-status").classList.add("hidden");
    document.getElementById("pd-content").classList.add("hidden");
    document.getElementById("pd-not-found").classList.remove("hidden");
  }

  function showLoadError(error) {
    console.error("Product page load failed:", error);
    document.getElementById("pd-content").classList.add("hidden");
    const status = document.getElementById("pd-status");
    status.textContent = "We couldn't load this product right now. Please try again later.";
    status.classList.remove("hidden");
  }

  function setImageFallback(image) {
    image.dataset.fallbackApplied = "false";
    image.onerror = () => {
      if (image.dataset.fallbackApplied === "true") {
        image.onerror = null;
        return;
      }
      image.dataset.fallbackApplied = "true";
      image.src = FALLBACK_IMAGE_URL;
    };
  }

  function renderBreadcrumb() {
    const categoryUrl = `index.html?category=${encodeURIComponent(product.category)}#catalog`;
    document.getElementById("pd-breadcrumb").innerHTML = `
      <a href="index.html">Home</a>
      <span aria-hidden="true">/</span>
      <a href="${categoryUrl}">${escapeHTML(product.category)}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${escapeHTML(product.name)}</span>
    `;
  }

  function setMainImage(index) {
    const image = document.getElementById("pd-main-img");
    const url = galleryImages[index] || FALLBACK_IMAGE_URL;
    setImageFallback(image);
    image.src = url;
    image.alt = `${product.name} image ${index + 1}`;

    document.querySelectorAll(".pd-thumb").forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderGallery() {
    galleryImages = product.images;
    const thumbnails = document.getElementById("pd-thumbs");
    thumbnails.innerHTML = galleryImages.map((url, index) => `
      <button type="button" class="pd-thumb ${index === 0 ? "active" : ""}" data-image-index="${index}" aria-label="Show product image ${index + 1}" aria-pressed="${index === 0}">
        <img src="${escapeHTML(url)}" alt="" loading="lazy" />
      </button>
    `).join("");

    thumbnails.querySelectorAll(".pd-thumb").forEach(button => {
      const image = button.querySelector("img");
      setImageFallback(image);
      button.addEventListener("click", () => setMainImage(Number(button.dataset.imageIndex)));
    });
    setMainImage(0);
  }

  function renderHighlights() {
    const highlights = (product.what_you_get || "").split("|").map(item => item.trim()).filter(Boolean);
    const wrap = document.getElementById("pd-highlights-wrap");
    const list = document.getElementById("pd-highlights");
    list.innerHTML = highlights.map(item => `<li>${escapeHTML(item)}</li>`).join("");
    wrap.classList.toggle("hidden", highlights.length === 0);
  }

  function getStockLabel(planOption) {
    if (planOption.stock === 0) return "Out of stock";
    if (planOption.stock == null) return "In stock";
    return `In stock (${planOption.stock} available)`;
  }

  function renderVariantSelection() {
    const container = document.getElementById("pd-variants");
    container.innerHTML = product.plans.map((planOption, index) => `
      <button type="button" class="pd-variant-btn ${index === selectedPlanIdx ? "selected" : ""}" data-plan-index="${index}" aria-pressed="${index === selectedPlanIdx}">
        <strong>${escapeHTML(planOption.plan)}</strong>
        <span>${formatTaka(planOption.price)}${planOption.stock === 0 ? " · Out of stock" : ""}</span>
      </button>
    `).join("");

    container.querySelectorAll("[data-plan-index]").forEach(button => {
      button.addEventListener("click", () => {
        selectedPlanIdx = Number(button.dataset.planIndex);
        renderVariantSelection();
      });
    });

    const planOption = product.plans[selectedPlanIdx];
    const stockLabel = getStockLabel(planOption);
    const outOfStock = planOption.stock === 0;
    document.getElementById("pd-price").textContent = formatTaka(planOption.price);

    const oldPrice = document.getElementById("pd-old-price");
    if (planOption.old_price > planOption.price) {
      oldPrice.textContent = formatTaka(planOption.old_price);
      oldPrice.classList.remove("hidden");
    } else {
      oldPrice.textContent = "";
      oldPrice.classList.add("hidden");
    }

    const stock = document.getElementById("pd-stock");
    stock.textContent = stockLabel;
    stock.classList.toggle("out-of-stock", outOfStock);
    document.getElementById("pd-meta-stock").textContent = stockLabel;
    document.getElementById("pd-info-stock").textContent = stockLabel;
    document.getElementById("pd-add-cart").disabled = outOfStock;
    document.getElementById("pd-buy-now").disabled = outOfStock;

    const quantity = document.getElementById("pd-qty");
    if (planOption.stock != null && planOption.stock > 0) {
      quantity.max = planOption.stock;
      if (Number(quantity.value) > planOption.stock) quantity.value = planOption.stock;
    } else {
      quantity.removeAttribute("max");
    }
  }

  function renderDescription() {
    const container = document.getElementById("pd-description");
    const lines = String(product.description || "").split(/\r?\n/);
    container.innerHTML = "";
    let activeList = null;
    const majorHeadingPattern = /price in bangladesh|\bfaq\b|specifications|features and|overview|flavours/i;
    const smallTitleWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "with"]);

    const appendTextElement = (tagName, text) => {
      const element = document.createElement(tagName);
      element.textContent = text;
      container.appendChild(element);
    };

    const isTitleCase = text => {
      const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
      return words.length > 0 &&
        words[0][0] === words[0][0].toUpperCase() &&
        words.slice(1).every(word =>
          smallTitleWords.has(word.toLowerCase()) || word[0] === word[0].toUpperCase()
        );
    };

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        activeList = null;
        return;
      }

      const markdownHeading = trimmed.match(/^(#{2,4})\s+(.+)$/);
      if (markdownHeading) {
        activeList = null;
        appendTextElement(`h${markdownHeading[1].length}`, markdownHeading[2]);
        return;
      }

      const numberedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);
      const bulletItem = trimmed.match(/^[-*•]\s+(.+)$/);
      if (numberedItem || bulletItem) {
        const listTag = numberedItem ? "ol" : "ul";
        if (!activeList || activeList.tagName.toLowerCase() !== listTag) {
          activeList = document.createElement(listTag);
          activeList.className = numberedItem ? "pd-description-ol" : "pd-description-list";
          container.appendChild(activeList);
        }
        const item = document.createElement("li");
        item.textContent = numberedItem ? numberedItem[1] : bulletItem[1];
        activeList.appendChild(item);
        return;
      }

      activeList = null;
      const hasQuestionPrefix = /^Q(?:\d+)?:/i.test(trimmed);
      if (trimmed.length < 110 && (hasQuestionPrefix || trimmed.endsWith("?"))) {
        appendTextElement("h4", trimmed);
        return;
      }

      const isStandaloneTitle = trimmed.length > 0 &&
        !trimmed.endsWith(".") &&
        !numberedItem &&
        !bulletItem;
      if (isStandaloneTitle && trimmed.length < 90 &&
        (majorHeadingPattern.test(trimmed) || /\([^)]*\)$/.test(trimmed))) {
        appendTextElement("h2", trimmed);
        return;
      }

      const hasLetters = /[A-Za-z]/.test(trimmed);
      const isAllCaps = hasLetters && !/[a-z]/.test(trimmed);
      if (isStandaloneTitle && trimmed.length < 65 && (isAllCaps || isTitleCase(trimmed))) {
        appendTextElement("h3", trimmed);
        return;
      }

      appendTextElement("p", trimmed);
    });

    if (!container.childElementCount) {
      appendTextElement("p", "No detailed description is available for this product.");
    }
  }

  function renderDetails() {
    document.getElementById("pd-category").textContent = product.category;
    document.getElementById("pd-title").textContent = product.name;
    document.getElementById("pd-subtitle").textContent = product.subtitle || "";
    document.getElementById("pd-meta-category").textContent = product.category;
    document.getElementById("pd-info-category").textContent = product.category;
    document.getElementById("pd-info-variants").textContent = product.plans.map(planOption => planOption.plan).join(", ");
    const storeName = CFG.STORE_NAME || "GY Puff & Cloud";
    const shareTitle = `${product.name} | ${storeName}`;
    const shareDescription = product.subtitle || product.name;
    const imgSrc = product.images[0] || "og-preview.jpg";
    const shareImage = new URL(imgSrc, window.location.origin).href;
    document.title = shareTitle;
    document.querySelector('meta[name="description"]').content = shareDescription;
    document.getElementById("og-title").content = shareTitle;
    document.getElementById("og-description").content = shareDescription;
    document.getElementById("og-image").content = shareImage;
    document.getElementById("twitter-title").content = shareTitle;
    document.getElementById("twitter-description").content = shareDescription;
    document.getElementById("twitter-image").content = shareImage;

    renderBreadcrumb();
    renderGallery();
    renderHighlights();
    renderVariantSelection();
    renderDescription();

    const reviewMessage = `Hello, I would like to share feedback about ${product.name}.`;
    document.getElementById("pd-review-link").href =
      `https://wa.me/${CFG.WHATSAPP_NUMBER || "8801410715713"}?text=${encodeURIComponent(reviewMessage)}`;

    document.getElementById("pd-status").classList.add("hidden");
    document.getElementById("pd-content").classList.remove("hidden");
  }

  function renderTabs() {
    document.querySelectorAll(".pd-tab").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".pd-tab").forEach(tab => {
          const active = tab === button;
          tab.classList.toggle("active", active);
          tab.setAttribute("aria-selected", String(active));
        });
        document.querySelectorAll(".pd-tab-panel").forEach(panel => {
          panel.classList.toggle("hidden", panel.id !== button.dataset.panel);
        });
      });
    });
  }

  function renderRelatedProducts() {
    const related = products
      .filter(candidate => candidate.slug !== product.slug)
      .sort((a, b) => Number(b.category === product.category) - Number(a.category === product.category))
      .slice(0, 8);
    const grid = document.getElementById("related-grid");

    if (!related.length) {
      grid.innerHTML = `<p class="pd-empty-related">No related products are available right now.</p>`;
      return;
    }

    grid.innerHTML = related.map(candidate => {
      const firstPlan = candidate.plans[0];
      const badge = typeof candidate.badge === "string" && !/^https?:\/\//i.test(candidate.badge.trim())
        ? candidate.badge.trim()
        : "";
      const discount = !badge && firstPlan && firstPlan.old_price > firstPlan.price
        ? `Save ${Math.round((1 - firstPlan.price / firstPlan.old_price) * 100)}%`
        : badge;
      const productUrl = `product.html?slug=${encodeURIComponent(candidate.slug)}`;

      return `
        <article class="product-card">
          <a class="card-media" href="${productUrl}" aria-label="View ${escapeHTML(candidate.name)}">
            <img src="${escapeHTML(candidate.resolvedImage)}" alt="${escapeHTML(candidate.name)}" loading="lazy" />
            ${discount ? `<span class="card-badge">${escapeHTML(discount)}</span>` : ""}
          </a>
          <div class="card-body">
            <span class="card-cat">${escapeHTML(candidate.category)}</span>
            <h3><a class="card-title" href="${productUrl}">${escapeHTML(candidate.name)}</a></h3>
            <p class="card-subtitle">${escapeHTML(candidate.subtitle || "")}</p>
            <div class="card-footer">
              <div class="card-price">${candidate.max > candidate.min ? "<small>From </small>" : ""}${formatTaka(candidate.min)}</div>
              <a href="${productUrl}" class="btn btn-outline product-card-select">View</a>
            </div>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".card-media img").forEach(image => setImageFallback(image));
  }

  const getCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
    catch (error) { return []; }
  };

  function updateCartBadge() {
    const badge = document.getElementById("cart-count");
    const total = getCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    badge.textContent = total;
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  function toast(message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 2200);
  }

  function addToCart() {
    const planOption = product.plans[selectedPlanIdx];
    const quantity = Math.max(1, Math.floor(Number(document.getElementById("pd-qty").value) || 1));
    if (planOption.stock === 0) {
      toast("This variant is out of stock.");
      return false;
    }

    const cart = getCart();
    const existing = cart.find(item => item.slug === product.slug && item.plan === planOption.plan);
    const currentQuantity = existing ? Number(existing.qty) || 0 : 0;
    if (planOption.stock != null && currentQuantity + quantity > planOption.stock) {
      toast(`Only ${Math.max(0, planOption.stock - currentQuantity)} more available.`);
      return false;
    }

    if (existing) {
      existing.qty = currentQuantity + quantity;
      existing.price = planOption.price;
      existing.image = product.resolvedImage;
    } else {
      cart.push({
        slug: product.slug,
        name: product.name,
        plan: planOption.plan,
        price: planOption.price,
        image: product.resolvedImage,
        qty: quantity
      });
    }
    saveCart(cart);
    return true;
  }

  function renderCart() {
    const cart = getCart();
    const list = document.getElementById("cart-items-list");
    const form = document.getElementById("checkout-form");
    const footer = document.getElementById("cart-footer");

    if (!cart.length) {
      list.innerHTML = `<p style="text-align: center; padding: 48px 0; color: var(--text-muted); font-size: 14px;">Your cart is empty.</p>`;
      form.classList.add("hidden");
      footer.classList.add("hidden");
      return;
    }

    form.classList.remove("hidden");
    footer.classList.remove("hidden");
    list.innerHTML = cart.map((item, index) => `
      <div class="cart-item">
        <img src="${escapeHTML(item.image || FALLBACK_IMAGE_URL)}" alt="${escapeHTML(item.name)}" />
        <div style="flex: 1; min-width: 0;">
          <strong style="font-size: 14px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.name)}</strong>
          <span style="font-size: 12px; color: var(--text-muted); display: block;">${escapeHTML(item.plan)}</span>
          <span style="font-size: 13px; font-weight: 600; display: block; margin-top: 2px;">${formatTaka(item.price * item.qty)}</span>
          <div class="qty-controls">
            <button type="button" data-qty-delta="-1" data-index="${index}">−</button>
            <span>${Number(item.qty) || 0}</span>
            <button type="button" data-qty-delta="1" data-index="${index}">+</button>
          </div>
        </div>
        <button type="button" data-remove-index="${index}" style="font-size: 12px; color: var(--danger); align-self: flex-start;">Remove</button>
      </div>
    `).join("");

    list.querySelectorAll("[data-qty-delta]").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        cart[index].qty = (Number(cart[index].qty) || 0) + Number(button.dataset.qtyDelta);
        if (cart[index].qty <= 0) cart.splice(index, 1);
        saveCart(cart);
        renderCart();
      });
    });

    list.querySelectorAll("[data-remove-index]").forEach(button => {
      button.addEventListener("click", () => {
        cart.splice(Number(button.dataset.removeIndex), 1);
        saveCart(cart);
        renderCart();
      });
    });

    updateCartTotals();
  }

  function updateCartTotals() {
    const cart = getCart();
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const zone = DELIVERY_RATES[document.getElementById("delivery-zone").value];
    const advancePercent = Number(document.getElementById("payment-method").value);
    const grandTotal = subtotal + zone.fee;
    const advanceRequired = grandTotal * advancePercent / 100;
    const remainingDue = grandTotal - advanceRequired;
    document.getElementById("cart-subtotal").textContent = formatTaka(subtotal);
    document.getElementById("cart-delivery").textContent = formatTaka(zone.fee);
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
    const zone = DELIVERY_RATES[document.getElementById("delivery-zone").value];
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
    const itemLines = cart.map(item => `• ${item.name} (${item.plan}) x${item.qty} = ${formatTaka(item.price * item.qty)}`);
    const message = [
      `*New Order — ${CFG.STORE_NAME || "GY Puff & Cloud"}*`,
      "------------------------",
      `*Customer:* ${name}`,
      `*Phone:* ${phone}`,
      `*Zone:* ${zone.label}`,
      `*Address:* ${address}`,
      `*Payment Selection:* ${payment}`,
      `*Transaction ID / Sender:* ${note}`,
      "",
      "*Items:*",
      ...itemLines,
      "",
      `Subtotal: ${formatTaka(subtotal)}`,
      `Delivery: ${formatTaka(zone.fee)}`,
      `*Grand Total:* BDT ${grandTotal.toLocaleString("en-US")}`,
      `*Advance Paid (bKash/Nagad):* BDT ${advancePaid.toLocaleString("en-US")}`,
      `*Due Amount (Pay on Delivery):* BDT ${dueAmount.toLocaleString("en-US")}`,
      "------------------------",
      "Terms & No Refund Policy: Agreed",
      "I confirm I am 18+ years old."
    ].join("\n");

    saveCart([]);
    renderCart();
    document.getElementById("cart-drawer").classList.add("hidden");
    window.open(`https://wa.me/${CFG.WHATSAPP_NUMBER || "8801410715713"}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  function initTheme() {
    document.documentElement.classList.toggle("dark", localStorage.getItem("yeaxmi_theme") === "dark");
    const themeToggle = document.getElementById("theme-toggle");
    const updateIcon = isDark => {
      themeToggle.innerHTML = isDark
        ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      themeToggle.setAttribute("aria-pressed", String(isDark));
    };
    updateIcon(document.documentElement.classList.contains("dark"));
    themeToggle.addEventListener("click", () => {
      const isDark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("yeaxmi_theme", isDark ? "dark" : "light");
      updateIcon(isDark);
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

  function initPage() {
    initTheme();
    initAgeGate();
    updateCartBadge();
    renderTabs();

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

    document.getElementById("pd-qty-minus").addEventListener("click", () => {
      const input = document.getElementById("pd-qty");
      input.value = Math.max(1, (Number(input.value) || 1) - 1);
    });
    document.getElementById("pd-qty-plus").addEventListener("click", () => {
      const input = document.getElementById("pd-qty");
      const max = Number(input.max) || Infinity;
      input.value = Math.min(max, (Number(input.value) || 1) + 1);
    });
    document.getElementById("pd-qty").addEventListener("change", event => {
      const input = event.currentTarget;
      const max = Number(input.max) || Infinity;
      input.value = Math.min(max, Math.max(1, Math.floor(Number(input.value) || 1)));
    });

    document.getElementById("pd-add-cart").addEventListener("click", () => {
      if (addToCart()) toast("Added to cart");
    });
    document.getElementById("pd-buy-now").addEventListener("click", () => {
      if (!addToCart()) return;
      renderCart();
      document.getElementById("cart-drawer").classList.remove("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    window.initSocialLinks();
    initPage();
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) {
      showNotFound();
      return;
    }

    try {
      await loadCatalog();
      product = products.find(candidate => normalizeSlug(candidate.slug) === normalizeSlug(slug));
      if (!product) {
        showNotFound();
        return;
      }

      selectedPlanIdx = 0;
      renderDetails();
      renderRelatedProducts();
    } catch (error) {
      showLoadError(error);
    }
  });
})();
