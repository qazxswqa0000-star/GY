(function () {
  const CFG = window.YEAXMI_CONFIG || {};
  const PIN_SESSION_KEY = "yeaxmi_admin_pin";
  const SCRIPT_OVERRIDE_KEY = "yeaxmi_script_url_override";

  let allProducts = [];
  let pendingDeleteSlug = null;

  const getScriptUrl = () => localStorage.getItem(SCRIPT_OVERRIDE_KEY) || CFG.APPS_SCRIPT_URL || "";
  const getPin = () => sessionStorage.getItem(PIN_SESSION_KEY) || "";
  const formatTaka = n => "৳ " + Number(n || 0).toLocaleString("en-US");

  function normalizeDriveImageUrl(url) {
    const trimmedUrl = String(url || "").trim();
    const match = trimmedUrl.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([a-zA-Z0-9_-]{20,})/);
    return match ? `https://lh3.googleusercontent.com/d/${match[1]}` : trimmedUrl;
  }

  function normalizeDriveGalleryUrls(value) {
    return String(value || "")
      .split(/[|,\r\n]+/)
      .map(url => normalizeDriveImageUrl(url))
      .filter(Boolean)
      .join(" | ");
  }

  function getProductImagePreviewUrl(image, gallery) {
    const normalizedImage = normalizeDriveImageUrl(image);
    if (normalizedImage) return normalizedImage;
    return normalizeDriveGalleryUrls(gallery).split("|")[0].trim();
  }

  function updateImagePreview() {
    const imageInput = document.getElementById("f-image");
    const galleryInput = document.getElementById("f-gallery");
    const preview = document.getElementById("f-image-preview");
    const previewUrl = getProductImagePreviewUrl(imageInput.value, galleryInput.value);

    if (!previewUrl) {
      preview.removeAttribute("src");
      preview.classList.add("hidden");
      return;
    }

    preview.onload = () => preview.classList.remove("hidden");
    preview.onerror = () => preview.classList.add("hidden");
    preview.src = previewUrl;
    preview.classList.remove("hidden");
  }

  function toast(msg) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // Send authenticated POST request to Google Apps Script
  async function apiPost(payload) {
    const url = getScriptUrl();
    if (!url) {
      throw new Error("Apps Script Web App URL is not configured. Go to Settings & Sync or Setup Guide.");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, pin: payload.pin || getPin() })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  // CSV Parser for reading live sheet state
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

  async function fetchAdminCatalog() {
    const tbody = document.getElementById("admin-product-tbody");
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">Loading Google Sheet data...</td></tr>`;

    try {
      if (!CFG.PRODUCTS_CSV_URL || !CFG.PLANS_CSV_URL) {
        throw new Error("Catalog CSV URLs are not configured.");
      }

      // Cache-bust CSV fetch so admin always sees freshest rows
      const bust = "&_t=" + Date.now();
      const [pRes, lRes] = await Promise.all([
        fetch(CFG.PRODUCTS_CSV_URL + bust),
        fetch(CFG.PLANS_CSV_URL + bust)
      ]);
      if (!pRes.ok || !lRes.ok) throw new Error("Failed to fetch Google Sheets.");
      const pRows = parseCSV(await pRes.text());
      const lRows = parseCSV(await lRes.text());

      const plansMap = {};
      lRows.forEach(r => {
        if (!r.slug) return;
        (plansMap[r.slug] = plansMap[r.slug] || []).push({
          plan: r.plan || "Standard",
          price: Number(r.price) || 0,
          old_price: r.old_price || "",
          stock: r.stock !== "" ? Number(r.stock) : ""
        });
      });

      allProducts = pRows.filter(r => r.slug && r.name).map(r => ({
        ...r,
        status: (r.status || "active").toLowerCase(),
        plans: plansMap[r.slug] || []
      }));

      updateStats();
      renderTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: var(--danger); padding: 20px;">Error loading CSV: ${err.message}</td></tr>`;
    }
  }

  function updateStats() {
    const total = allProducts.length;
    const active = allProducts.filter(p => p.status !== "hidden" && p.status !== "inactive").length;
    const hidden = total - active;

    let oosCount = 0;
    let totalValue = 0;

    allProducts.forEach(p => {
      p.plans.forEach(v => {
        if (v.stock === 0) oosCount++;
        if (typeof v.stock === "number" && v.stock > 0) {
          totalValue += v.price * v.stock;
        }
      });
    });

    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-active").textContent = `${active} / ${hidden}`;
    document.getElementById("stat-oos").textContent = oosCount;
    document.getElementById("stat-value").textContent = formatTaka(totalValue);
  }

  function renderTable() {
    const q = document.getElementById("admin-search").value.trim().toLowerCase();
    const tbody = document.getElementById("admin-product-tbody");
    const filtered = allProducts.filter(p =>
      !q || (p.name + " " + p.slug + " " + p.category).toLowerCase().includes(q)
    );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">No products found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(p => {
      const isHidden = p.status === "hidden" || p.status === "inactive";
      const variantsHtml = p.plans.map(v => `
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap;">
          <span style="min-width: 120px; font-weight: 500;">${v.plan}</span>
          <input type="number" class="input" style="width: 85px; height: 30px; font-size: 12px;" value="${v.price}" data-q-price="${p.slug}::${v.plan}" title="Price (BDT)" />
          <input type="number" class="input" style="width: 70px; height: 30px; font-size: 12px;" value="${v.stock}" placeholder="∞" data-q-stock="${p.slug}::${v.plan}" title="Stock" />
          <button type="button" class="btn btn-outline" style="height: 30px; padding: 0 8px; font-size: 11px;" data-quick-save="${p.slug}::${v.plan}">Update</button>
        </div>
      `).join("");

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${getProductImagePreviewUrl(p.image, p.gallery)}" alt="" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: var(--surface-alt);" />
              <div>
                <strong style="display: block;">${p.name}</strong>
                <span style="font-size: 11px; color: var(--text-muted);">${p.slug}</span>
              </div>
            </div>
          </td>
          <td>${p.category}</td>
          <td>
            <button type="button" class="status-tag ${isHidden ? "status-hidden" : "status-active"}" data-toggle-status="${p.slug}" data-current="${isHidden ? "hidden" : "active"}">
              ${isHidden ? "Hidden" : "Active"}
            </button>
          </td>
          <td>${variantsHtml || '<span style="color:var(--text-muted);">No variants</span>'}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button type="button" class="btn btn-outline" style="height: 32px; padding: 0 10px; font-size: 12px;" data-edit-slug="${p.slug}">Edit</button>
            <button type="button" class="btn btn-danger" style="height: 32px; padding: 0 10px; font-size: 12px;" data-del-slug="${p.slug}" data-del-name="${p.name}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");

    // Bind inline quick-save
    tbody.querySelectorAll("[data-quick-save]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.quickSave;
        const [slug, planName] = key.split("::");
        const price = tbody.querySelector(`[data-q-price="${key}"]`).value;
        const stock = tbody.querySelector(`[data-q-stock="${key}"]`).value;

        btn.disabled = true;
        btn.textContent = "...";
        try {
          await apiPost({ action: "quick_update", slug, planName, price, stock });
          toast("Updated price & stock in sheet");
          sessionStorage.removeItem("yeaxmi_catalog_cache");
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "Update";
        }
      });
    });

    // Bind inline status toggle
    tbody.querySelectorAll("[data-toggle-status]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const slug = btn.dataset.toggleStatus;
        const nextStatus = btn.dataset.current === "active" ? "hidden" : "active";
        btn.disabled = true;
        try {
          await apiPost({ action: "quick_update", slug, status: nextStatus });
          toast(`Product set to ${nextStatus}`);
          await fetchAdminCatalog();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });

    // Bind full edit
    tbody.querySelectorAll("[data-edit-slug]").forEach(btn => {
      btn.addEventListener("click", () => loadProductIntoForm(btn.dataset.editSlug));
    });

    // Bind delete modal
    tbody.querySelectorAll("[data-del-slug]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingDeleteSlug = btn.dataset.delSlug;
        document.getElementById("delete-modal-text").textContent =
          `Are you sure you want to permanently remove "${btn.dataset.delName}" and all its variants from Google Sheets?`;
        document.getElementById("delete-modal").classList.remove("hidden");
      });
    });
  }

  // Variant Form Builder
  function addVariantRow(data = { plan: "", price: "", old_price: "", stock: "" }) {
    const container = document.getElementById("variant-rows-container");
    const row = document.createElement("div");
    row.className = "variant-row-editor";
    row.innerHTML = `
      <input type="text" class="input v-plan" placeholder="Flavor / Nicotine (e.g. Mango 30mg)" value="${data.plan || ""}" required />
      <input type="number" class="input v-price" placeholder="Price (BDT)" value="${data.price !== "" ? data.price : ""}" required />
      <input type="number" class="input v-old" placeholder="Old Price" value="${data.old_price !== "" ? data.old_price : ""}" />
      <input type="number" class="input v-stock" placeholder="Stock" value="${data.stock !== "" ? data.stock : ""}" />
      <button type="button" class="btn btn-danger" style="height: 36px; padding: 0 10px;">&times;</button>
    `;
    row.querySelector("button").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function resetProductForm() {
    document.getElementById("form-heading").textContent = "Add New Product";
    document.getElementById("product-form").reset();
    document.getElementById("f-slug").readOnly = false;
    updateImagePreview();
    const container = document.getElementById("variant-rows-container");
    container.innerHTML = "";
    addVariantRow();
  }

  function loadProductIntoForm(slug) {
    const p = allProducts.find(item => item.slug === slug);
    if (!p) return;

    switchTab("add-product");
    document.getElementById("form-heading").textContent = `Edit Product: ${p.name}`;
    document.getElementById("f-name").value = p.name;
    document.getElementById("f-slug").value = p.slug;
    document.getElementById("f-category").value = p.category;
    document.getElementById("f-subtitle").value = p.subtitle || "";
    const imageUrlFromOtherField = [p.price_from, p.badge].find(value =>
      typeof value === "string" && /^https?:\/\//i.test(value.trim())
    );
    const badgeContainsImageUrl = typeof p.badge === "string" && /^https?:\/\//i.test(p.badge.trim());
    document.getElementById("f-image").value = normalizeDriveImageUrl(p.image || (imageUrlFromOtherField ? imageUrlFromOtherField.trim() : ""));
    document.getElementById("f-gallery").value = normalizeDriveGalleryUrls(p.gallery || "");
    updateImagePreview();
    document.getElementById("f-badge").value = badgeContainsImageUrl ? "" : p.badge || "";
    document.getElementById("f-status").value = (p.status || "active").toLowerCase() === "hidden" ? "hidden" : "active";
    document.getElementById("f-description").value = p.description || "";
    document.getElementById("f-specs").value = p.what_you_get || "";

    const container = document.getElementById("variant-rows-container");
    container.innerHTML = "";
    if (p.plans.length) p.plans.forEach(v => addVariantRow(v));
    else addVariantRow();
  }

  function switchTab(tabName) {
    document.querySelectorAll(".admin-nav button").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tabName);
    });
    ["overview", "add-product", "settings", "setup-guide"].forEach(id => {
      document.getElementById("tab-" + id).classList.toggle("hidden", id !== tabName);
    });
  }

  // Auto-slug generator
  function slugify(str) {
    return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Populate categories dropdown
    const catSelect = document.getElementById("f-category");
    const categories = Array.isArray(CFG.CATEGORIES) ? CFG.CATEGORIES : [];
    catSelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join("");

    // Theme
    document.documentElement.classList.toggle("dark", localStorage.getItem("yeaxmi_theme") === "dark");
    const themeToggle = document.getElementById("admin-theme-btn");
    const updateThemeIcon = isDark => {
      themeToggle.innerHTML = isDark
        ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      themeToggle.setAttribute("aria-pressed", String(isDark));
    };
    updateThemeIcon(document.documentElement.classList.contains("dark"));

    themeToggle.addEventListener("click", () => {
      const dark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("yeaxmi_theme", dark ? "dark" : "light");
      updateThemeIcon(dark);
    });

    // Check existing session
    if (getPin()) {
      document.getElementById("admin-login-screen").classList.add("hidden");
      document.getElementById("admin-app").classList.remove("hidden");
      fetchAdminCatalog();
    }

    // Login Handler
    document.getElementById("login-form").addEventListener("submit", async e => {
      e.preventDefault();
      const pin = document.getElementById("admin-pin-input").value.trim();
      const errEl = document.getElementById("login-error");
      const btn = document.getElementById("login-btn");

      errEl.classList.add("hidden");
      btn.disabled = true;
      btn.textContent = "Verifying...";

      try {
        if (getScriptUrl()) {
          await apiPost({ action: "auth", pin });
        }
        sessionStorage.setItem(PIN_SESSION_KEY, pin);
        document.getElementById("admin-login-screen").classList.add("hidden");
        document.getElementById("admin-app").classList.remove("hidden");
        resetProductForm();
        await fetchAdminCatalog();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      } finally {
        btn.disabled = false;
        btn.textContent = "Unlock Dashboard";
      }
    });

    document.getElementById("logout-btn").addEventListener("click", () => {
      sessionStorage.removeItem(PIN_SESSION_KEY);
      location.reload();
    });

    // Tab Navigation
    document.querySelectorAll(".admin-nav button").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("goto-add-btn").addEventListener("click", () => {
      resetProductForm();
      switchTab("add-product");
    });

    document.getElementById("refresh-data-btn").addEventListener("click", fetchAdminCatalog);
    document.getElementById("admin-search").addEventListener("input", renderTable);

    // Auto-fill slug from name
    document.getElementById("f-name").addEventListener("input", e => {
      const slugInput = document.getElementById("f-slug");
      if (!slugInput.dataset.touched) slugInput.value = slugify(e.target.value);
    });
    document.getElementById("f-slug").addEventListener("input", e => {
      e.target.dataset.touched = "true";
    });

    const imageInput = document.getElementById("f-image");
    const galleryInput = document.getElementById("f-gallery");
    imageInput.addEventListener("input", () => {
      imageInput.value = normalizeDriveImageUrl(imageInput.value);
      updateImagePreview();
    });
    galleryInput.addEventListener("input", () => {
      galleryInput.value = normalizeDriveGalleryUrls(galleryInput.value);
      updateImagePreview();
    });
    [imageInput, galleryInput].forEach(input => {
      ["change", "blur"].forEach(eventName => {
        input.addEventListener(eventName, () => {
          if (input === imageInput) {
            imageInput.value = normalizeDriveImageUrl(imageInput.value);
          } else {
            galleryInput.value = normalizeDriveGalleryUrls(galleryInput.value);
          }
          updateImagePreview();
        });
      });
    });
    updateImagePreview();

    document.getElementById("add-variant-row-btn").addEventListener("click", () => addVariantRow());
    document.getElementById("reset-form-btn").addEventListener("click", resetProductForm);

    // Submit Add/Edit Product Form
    document.getElementById("product-form").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("save-product-btn");
      btn.disabled = true;
      btn.textContent = "Saving to Google Sheet...";

      const variantRows = [...document.querySelectorAll(".variant-row-editor")].map(row => ({
        plan: row.querySelector(".v-plan").value.trim(),
        price: row.querySelector(".v-price").value,
        old_price: row.querySelector(".v-old").value,
        stock: row.querySelector(".v-stock").value
      }));

      const image = normalizeDriveImageUrl(document.getElementById("f-image").value);
      const gallery = normalizeDriveGalleryUrls(document.getElementById("f-gallery").value);
      document.getElementById("f-image").value = image;
      document.getElementById("f-gallery").value = gallery;
      updateImagePreview();

      const productPayload = {
        name: document.getElementById("f-name").value.trim(),
        slug: slugify(document.getElementById("f-slug").value),
        category: document.getElementById("f-category").value,
        subtitle: document.getElementById("f-subtitle").value.trim(),
        image,
        gallery,
        badge: document.getElementById("f-badge").value.trim(),
        status: document.getElementById("f-status").value,
        description: document.getElementById("f-description").value.trim(),
        what_you_get: document.getElementById("f-specs").value.trim(),
        plans: variantRows
      };

      try {
        await apiPost({ action: "save_product", product: productPayload });
        toast("Product saved! Refreshing catalog...");
        sessionStorage.removeItem("yeaxmi_catalog_cache");
        resetProductForm();
        switchTab("overview");
        setTimeout(fetchAdminCatalog, 1500);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Save Product to Google Sheet";
      }
    });

    // Delete Modal Actions
    document.getElementById("cancel-delete-btn").addEventListener("click", () => {
      pendingDeleteSlug = null;
      document.getElementById("delete-modal").classList.add("hidden");
    });

    document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
      if (!pendingDeleteSlug) return;
      const btn = document.getElementById("confirm-delete-btn");
      btn.disabled = true;
      btn.textContent = "Deleting...";

      try {
        await apiPost({ action: "delete_product", slug: pendingDeleteSlug });
        toast("Product deleted from Google Sheet");
        document.getElementById("delete-modal").classList.add("hidden");
        pendingDeleteSlug = null;
        setTimeout(fetchAdminCatalog, 1500);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Delete Permanently";
      }
    });

    // Settings Tab
    document.getElementById("s-script-url").value = getScriptUrl();
    document.getElementById("save-script-url-btn").addEventListener("click", async () => {
      const url = document.getElementById("s-script-url").value.trim();
      const statusEl = document.getElementById("connection-status");
      localStorage.setItem(SCRIPT_OVERRIDE_KEY, url);
      statusEl.textContent = "Testing connection...";
      statusEl.style.color = "var(--text-muted)";

      try {
        await apiPost({ action: "auth" });
        statusEl.textContent = "Connected! Your Admin PIN and Apps Script Web App are working.";
        statusEl.style.color = "var(--brand)";
      } catch (err) {
        statusEl.textContent = "Connection failed: " + err.message;
        statusEl.style.color = "var(--danger)";
      }
    });

    document.getElementById("clear-cache-btn").addEventListener("click", () => {
      sessionStorage.removeItem("yeaxmi_catalog_cache");
      localStorage.removeItem("yeaxmi_catalog_cache");
      toast("Browser cache cleared");
    });

    resetProductForm();
  });
})();