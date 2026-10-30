/* Catálogo público COLEX: búsqueda, selección de productos y solicitud de cotización. */
(function () {
  const store = window.ColexStore;
  const I18N = window.COLEX_I18N;
  const PAGE = 48;
  const CART_KEY = "colex_cart_v1";
  const LANG_KEY = "colex_lang";
  const CLIENT_KEY = "colex_client_v1";
  const VENDOR_KEY = "colex_vendor_v1";
  const $ = (id) => document.getElementById(id);
  const SHOW = !!(window.COLEX_CONFIG || {}).MOSTRAR_EXISTENCIAS;   // ¿mostrar existencias al cliente?
  const cap = (p) => (SHOW ? p.existencia : 999999);

  const S = {
    lang: initialLang(), t: null, data: null, bySap: new Map(),
    q: "", cat: "", sub: "", onlyStock: SHOW, limit: PAGE, filtered: [],
    cart: loadCart(), step: "list", lastRequest: null, vendor: null
  };
  S.t = I18N[S.lang];

  /* ---------- utilidades ---------- */
  function initialLang() {
    const p = new URLSearchParams(location.search).get("lang");
    if (p === "en" || p === "es") return p;
    try { const v = localStorage.getItem(LANG_KEY); if (v === "en" || v === "es") return v; } catch (e) {}
    return (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
  }
  function loadCart() {
    try { const o = JSON.parse(localStorage.getItem(CART_KEY) || "{}"); return new Map(Object.entries(o).map(([k, v]) => [Number(k), Number(v)])); }
    catch (e) { return new Map(); }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(Object.fromEntries(S.cart))); } catch (e) {}
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const fmt = (n) => Number(n).toLocaleString(S.lang === "en" ? "en-US" : "es-PA", { maximumFractionDigits: 3 });
  const desc = (p) => (S.lang === "en" ? p.descripcion_en : p.descripcion_es) || p.descripcion_es;
  const subName = (p) => (S.lang === "en" ? p.subcategoria_en : p.subcategoria_es) || p.subcategoria_es;
  const isWhole = (p) => !p.unidad || p.unidad === "UN";
  function imgUrl(p) {
    if (!p.imagen) return null;
    if (/^(https?:|data:)/.test(p.imagen)) return p.imagen;
    return p.imagen + (p.actualizado ? "?v=" + encodeURIComponent(String(p.actualizado).slice(0, 19)) : "");
  }
  function absUrl(u) { return u ? new URL(u, location.href).href : null; }
  function noImg() { return `<span class="noimg"><svg><use href="#i-box"/></svg></span>`; }
  function clampQty(p, v) {
    let q = Number(String(v).replace(",", "."));
    if (!Number.isFinite(q) || q < 0) q = 0;
    q = isWhole(p) ? Math.floor(q) : Math.round(q * 1000) / 1000;
    return Math.min(q, cap(p));
  }
  let toastTimer;
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2400);
  }
  function stockDate() {
    const f = S.data && S.data.config && S.data.config.fecha_existencias;
    if (!f) return "";
    const [y, m, d] = String(f).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(S.lang === "en" ? "en-US" : "es-PA", { day: "numeric", month: "long", year: "numeric" });
  }

  /* ---------- textos ---------- */
  /* ---------- asesor (enlace personal ?v=) ---------- */
  function vendorSlugFromUrl() {
    const v = new URLSearchParams(location.search).get("v");
    if (v) { try { localStorage.setItem(VENDOR_KEY, v); } catch (e) {} return v; }
    try { return localStorage.getItem(VENDOR_KEY) || ""; } catch (e) { return ""; }
  }
  const digits = (t) => String(t || "").replace(/\D/g, "");
  function initials(n) { return String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(""); }
  function waLink(phone, text) { return `https://wa.me/${digits(phone)}${text ? "?text=" + encodeURIComponent(text) : ""}`; }
  function renderAdvisor() {
    const v = S.vendor;
    $("advisor").hidden = !v;
    if (!v) return;
    $("advLabel").textContent = S.t.advisor; $("advName").textContent = v.nombre; $("advAvatar").textContent = initials(v.nombre);
    $("advWa").hidden = !digits(v.whatsapp);
    if (digits(v.whatsapp)) $("advWa").href = waLink(v.whatsapp);
  }
  function renderDoneAdvisor() {
    const v = S.vendor, r = S.lastRequest, t = S.t;
    $("doneText").textContent = v ? t.readyTextAdvisor.replace(/\{n\}/g, v.nombre) : t.readyText;
    const ok = v && r && digits(v.whatsapp);
    $("waAdvisor").hidden = !ok;
    if (ok) {
      $("waAdvisor").textContent = t.sendAdvisor;
      $("waAdvisor").href = waLink(v.whatsapp, t.waMsg.replace("{n}", v.nombre.split(" ")[0]).replace("{c}", r.cliente.nombre).replace("{f}", r.folio));
    }
  }

  function applyTexts() {
    const t = S.t;
    document.documentElement.lang = S.lang;
    $("brandSub").textContent = `${t.brandSub} · ${t.warehouse}`;
    $("q").placeholder = t.searchPh; $("searchLbl").textContent = t.searchPh;
    $("onlyStockLbl").textContent = t.onlyStock;
    $("onlyStock").checked = S.onlyStock; $("onlyStock").closest("label").hidden = !SHOW;
    $("doneText").dataset.nostock = SHOW ? "" : "1";
    $("cartLabel").textContent = t.request;
    $("moreBtn").textContent = t.showMore;
    $("langEs").setAttribute("aria-pressed", S.lang === "es");
    $("langEn").setAttribute("aria-pressed", S.lang === "en");
    const labels = { nombre: [t.name, true], empresa: [t.company], pais: [t.country], telefono: [t.phone, true], correo: [t.email], comentarios: [t.notes] };
    for (const [k, [txt, req]] of Object.entries(labels))
      document.querySelector(`label[for="c-${k}"]`).innerHTML = esc(txt) + (req ? ` <small>(${esc(t.required)})</small>` : "");
    $("doneTitle").textContent = t.ready; $("folioLbl").textContent = t.folio; $("doneText").textContent = t.readyText;
    renderAdvisor(); renderDoneAdvisor();
    $("dlPdf").querySelector("span").textContent = t.downloadPdf;
    $("dlXlsx").querySelector("span").textContent = t.downloadXlsx;
    $("drawerTitle").textContent = t.myRequest;
    const st = $("steps").children; st[0].textContent = t.request; st[1].textContent = t.yourData; st[2].textContent = "PDF · Excel";
    if (store.isDemo) { $("demoFlag").hidden = false; $("demoFlag").textContent = t.demo; }
  }

  /* ---------- filtros y listado ---------- */
  function renderChips() {
    const t = S.t, prods = S.data.productos, q = window.ColexSearch.compile(S.q);
    const base = prods.filter((p) => (!S.onlyStock || p.existencia > 0) && (!q || window.ColexSearch.score(p, q) > 0));
    const counts = {}; base.forEach((p) => (counts[p.categoria] = (counts[p.categoria] || 0) + 1));
    const chips = [`<button type="button" class="chip" data-cat="" aria-pressed="${!S.cat}">${esc(t.all)} <small>${base.length}</small></button>`]
      .concat(S.data.categorias.filter((c) => counts[c.clave]).map((c) =>
        `<button type="button" class="chip" data-cat="${esc(c.clave)}" aria-pressed="${S.cat === c.clave}">${esc(S.lang === "en" ? c.en : c.es)} <small>${counts[c.clave]}</small></button>`));
    $("chips").innerHTML = chips.join("");
  }
  function renderSubs() {
    const subs = new Map();
    S.data.productos.forEach((p) => { if (!S.cat || p.categoria === S.cat) subs.set(p.subcategoria_es, subName(p)); });
    const opts = [...subs.entries()].filter(([k]) => k).sort((a, b) => a[1].localeCompare(b[1]));
    if (S.sub && !subs.has(S.sub)) S.sub = "";
    $("sub").innerHTML = `<option value="">${esc(S.t.allSubs)}</option>` +
      opts.map(([k, v]) => `<option value="${esc(k)}"${k === S.sub ? " selected" : ""}>${esc(v)}</option>`).join("");
    $("sub").hidden = opts.length < 2 && !S.sub;
  }
  function applyFilters() {
    const q = window.ColexSearch.compile(S.q);
    const scored = [];
    for (const p of S.data.productos) {
      if (S.onlyStock && !(p.existencia > 0)) continue;
      if (S.cat && p.categoria !== S.cat) continue;
      if (S.sub && p.subcategoria_es !== S.sub) continue;
      const sc = window.ColexSearch.score(p, q);
      if (sc > 0) scored.push([sc, p]);
    }
    if (q) scored.sort((a, b) => b[0] - a[0] || a[1].orden - b[1].orden);   // lo más parecido primero
    S.filtered = scored.map((x) => x[1]);
    renderSubchips(q);
  }
  // Atajos por subcategoría mientras se busca: "Capacitores 171 · Repuestos 3"
  function renderSubchips(q) {
    const box = $("subchips");
    if (!q || S.sub) { box.hidden = true; return; }
    const m = new Map();
    S.filtered.forEach((p) => { const k = p.subcategoria_es; if (k) m.set(k, { n: (m.get(k) ? m.get(k).n : 0) + 1, label: subName(p) }); });
    const list = [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
    if (list.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<span class="small">${esc(S.lang === "en" ? "Found in:" : "Encontrado en:")}</span>` +
      list.map(([k, v]) => `<button type="button" class="chip chip-sm" data-sub="${esc(k)}">${esc(v.label)} <small>${v.n}</small></button>`).join("");
  }
  function cardHtml(p) {
    const t = S.t, inCart = S.cart.get(p.sap), img = imgUrl(p), zero = SHOW && !(p.existencia > 0);
    const low = SHOW && !zero && p.existencia <= 5;
    const step = isWhole(p) ? 1 : 0.001;
    const q = inCart || (!SHOW ? 1 : zero ? 0 : Math.min(1, p.existencia) || p.existencia);
    return `<article class="card${inCart ? " in-cart" : ""}" data-sap="${p.sap}">
      <button type="button" class="card-img" data-act="zoom" aria-label="${esc(desc(p))}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : noImg()}</button>
      <div class="card-body">
        <div class="card-top"><span class="sap">${p.sap}</span>
          <button type="button" class="copy-sap" data-act="copy" title="${esc(t.code)}" aria-label="${esc(t.code)} ${p.sap}"><svg class="icon"><use href="#i-copy"/></svg></button></div>
        <span class="sub">${esc(subName(p))}</span>
        <h3>${esc(desc(p))}</h3>
        ${SHOW ? `<div class="stock${zero ? " zero" : low ? " low" : ""}"><span class="dot"></span>
          ${zero ? esc(t.outOfStock) : `${esc(t.available)}: <b>${fmt(p.existencia)}</b> ${esc(window.colexUnit(p.unidad, S.lang))}`}</div>` : `<div class="stock"><span class="small">${esc(t.unit)}: ${esc(window.colexUnit(p.unidad, S.lang))}</span></div>`}
        <div class="buy">
          <div class="stepper"><button type="button" data-act="dec" aria-label="−" ${zero ? "disabled" : ""}>−</button>
            <input type="number" inputmode="${step === 1 ? "numeric" : "decimal"}" min="0" step="${step}" max="${cap(p)}" value="${q}" aria-label="${esc(t.qty)}" ${zero ? "disabled" : ""}>
            <button type="button" data-act="inc" aria-label="+" ${zero ? "disabled" : ""}>+</button></div>
          <button type="button" class="btn ${inCart ? "btn-ghost" : "btn-primary"}" data-act="add" ${zero ? "disabled" : ""}>${esc(inCart ? t.update : t.add)}</button>
        </div>
      </div></article>`;
  }
  function renderGrid() {
    const t = S.t, total = S.data.productos.length, list = S.filtered.slice(0, S.limit);
    $("grid").innerHTML = list.map(cardHtml).join("");
    $("count").innerHTML = `<strong>${fmt(S.filtered.length)}</strong> ${esc(t.products)}` +
      (S.filtered.length > list.length ? ` · ${esc(t.shown)} ${fmt(list.length)}` : "") +
      (S.filtered.length !== total ? ` <span>(${esc(t.of)} ${fmt(total)})</span>` : "");
    $("moreBtn").hidden = S.filtered.length <= S.limit;
    const st = $("state");
    if (!S.filtered.length) {
      st.className = "empty"; st.hidden = false;
      st.innerHTML = `<span>${esc(t.noResults)}</span><button type="button" class="btn btn-ghost" id="clearBtn">${esc(t.clearFilters)}</button>`;
      $("clearBtn").onclick = () => { S.q = ""; $("q").value = ""; S.cat = ""; S.sub = ""; S.onlyStock = SHOW; $("onlyStock").checked = SHOW; refresh(); };
    } else st.hidden = true;
    const sd = stockDate();
    $("stamp").hidden = !sd || !SHOW; $("stamp").textContent = `${t.stockAsOf} ${sd} · ${t.warehouse}`;
  }
  function refresh(keepLimit) {
    if (!keepLimit) S.limit = PAGE;
    renderChips(); renderSubs(); applyFilters(); renderGrid();
  }
  function updateCard(sap) {
    const el = document.querySelector(`.card[data-sap="${sap}"]`);
    if (el) el.outerHTML = cardHtml(S.bySap.get(sap));
  }
  function updateCount() {
    $("cartCount").textContent = S.cart.size;
  }
  function renderFoot() {
    const c = (S.data && S.data.config) || {};
    const parts = [`<strong>COLEX INTERNATIONAL</strong>`];
    if (c.direccion) parts.push(`<span>${esc(c.direccion)}</span>`);
    if (c.telefono) parts.push(`<span>${esc(S.t.contact)}: <a style="color:#fff" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ""))}">${esc(c.telefono)}</a></span>`);
    if (c.whatsapp) parts.push(`<span>WhatsApp: <a style="color:#fff" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ""))}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a></span>`);
    if (c.correo) parts.push(`<span><a style="color:#fff" href="mailto:${esc(c.correo)}">${esc(c.correo)}</a></span>`);
    const aviso = S.lang === "en" ? c.aviso_en : c.aviso_es;
    if (aviso) parts.push(`<span style="white-space:normal;flex-basis:100%;opacity:.8">${esc(aviso)}</span>`);
    $("foot").innerHTML = parts.join("");
  }

  /* ---------- solicitud ---------- */
  function setStep(step) {
    S.step = step;
    $("stepList").hidden = step !== "list"; $("stepForm").hidden = step !== "form"; $("stepDone").hidden = step !== "done";
    [...$("steps").children].forEach((s, i) => s.classList.toggle("on", i <= ["list", "form", "done"].indexOf(step)));
    renderDrawer();
  }
  function cartItems() {
    return [...S.cart.entries()].map(([sap, q]) => ({ p: S.bySap.get(sap), q })).filter((x) => x.p);
  }
  function renderDrawer() {
    const t = S.t, items = cartItems(), foot = $("drawerFoot");
    if (S.step === "list") {
      $("stepList").innerHTML = items.length ? items.map(({ p, q }) => {
        const img = imgUrl(p);
        return `<div class="line" data-sap="${p.sap}">
          <div class="line-img">${img ? `<img src="${esc(img)}" alt="">` : noImg()}</div>
          <div class="line-main">
            <span class="sap">${p.sap}</span>
            <span class="line-desc">${esc(desc(p))}</span>
            <div class="line-row">
              <div class="stepper"><button type="button" data-act="dec" aria-label="−">−</button>
                <input type="number" min="0" step="${isWhole(p) ? 1 : 0.001}" max="${cap(p)}" value="${q}" aria-label="${esc(t.qty)}">
                <button type="button" data-act="inc" aria-label="+">+</button></div>
              <span class="line-stock">${SHOW ? `${esc(t.max)} ${fmt(p.existencia)} ` : ""}${esc(window.colexUnit(p.unidad, S.lang))}</span>
              <button type="button" class="link-btn" data-act="remove">${esc(t.remove)}</button>
            </div></div></div>`;
      }).join("") : `<div class="empty" style="box-shadow:none">${esc(t.emptyCart)}</div>`;
      const units = items.reduce((a, b) => a + b.q, 0);
      foot.innerHTML = `<div class="summary"><span>${items.length} ${esc(items.length === 1 ? t.item : t.items)}</span><span class="num">${fmt(units)} ${esc(t.units)}</span></div>
        <button type="button" class="btn btn-primary btn-block" id="toForm" ${items.length ? "" : "disabled"}>${esc(t.continue)}</button>`;
      $("toForm").onclick = () => setStep("form");
    } else if (S.step === "form") {
      foot.innerHTML = `<p class="notice" style="margin:0">${esc(t.noPrices)}</p>
        <div style="display:flex;gap:10px"><button type="button" class="btn btn-ghost" id="toList">${esc(t.back)}</button>
        <button type="button" class="btn btn-primary" style="flex:1" id="genBtn">${esc(t.generate)}</button></div>`;
      $("toList").onclick = () => setStep("list");
      $("genBtn").onclick = submit;
    } else {
      foot.innerHTML = `<button type="button" class="btn btn-ghost btn-block" id="newReq">${esc(t.newRequest)}</button>`;
      $("newReq").onclick = () => { S.cart.clear(); saveCart(); updateCount(); refresh(true); S.lastRequest = null; setStep("list"); };
    }
  }
  function openDrawer() {
    $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden"; document.body.classList.add("drawer-open");
    if (S.step === "done" && !S.lastRequest) S.step = "list";
    setStep(S.step);
    setTimeout(() => $("drawerClose").focus(), 30);
  }
  function closeDrawer() { $("drawer").hidden = true; $("scrim").hidden = true; document.body.style.overflow = ""; document.body.classList.remove("drawer-open"); }

  function validate() {
    const t = S.t, f = $("clientForm"), v = (n) => f.elements[n].value.trim();
    let ok = true;
    const setErr = (id, msg) => { const el = $(id); el.classList.toggle("err", !!msg); el.querySelector(".msg").textContent = msg || ""; if (msg) ok = false; };
    setErr("f-nombre", v("nombre") ? "" : t.errName);
    setErr("f-telefono", v("telefono").replace(/\D/g, "").length >= 6 ? "" : t.errPhone);
    setErr("f-correo", !v("correo") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("correo")) ? "" : t.errEmail);
    return ok;
  }
  async function submit() {
    if (!validate()) { const e = document.querySelector(".field.err input"); if (e) e.focus(); return; }
    const t = S.t, f = $("clientForm"), btn = $("genBtn");
    const cliente = {};
    ["nombre", "empresa", "pais", "telefono", "correo", "comentarios"].forEach((k) => (cliente[k] = f.elements[k].value.trim()));
    try { localStorage.setItem(CLIENT_KEY, JSON.stringify(cliente)); } catch (e) {}
    const items = cartItems().filter((x) => x.q > 0).map(({ p, q }) => ({
      sap: p.sap, cantidad: q, descripcion_es: p.descripcion_es, descripcion_en: p.descripcion_en,
      unidad: p.unidad, existencia: p.existencia, imagen_url: absUrl(imgUrl(p))
    }));
    btn.disabled = true; btn.textContent = t.generating; $("formErr").hidden = true;
    let folio;
    try {
      folio = await store.createRequest({ idioma: S.lang, cliente, items: items.map(({ imagen_url, ...rest }) => rest), vendedor: S.vendor });
    } catch (e) {
      console.error(e);
      $("formErr").textContent = t.errSave; $("formErr").hidden = false;
      btn.disabled = false; btn.textContent = t.generate; return;
    }
    S.lastRequest = { folio, fecha: new Date().toISOString(), idioma: S.lang, cliente, items, config: S.data.config, vendedor: S.vendor };
    $("folio").textContent = folio;
    renderDoneAdvisor();
    setStep("done");
  }
  async function download(kind) {
    const r = S.lastRequest; if (!r) return;
    const btn = kind === "pdf" ? $("dlPdf") : $("dlXlsx"), span = btn.querySelector("span"), label = span.textContent;
    btn.disabled = true; span.textContent = S.t.generating; $("dlErr").hidden = true;
    try {
      const blob = kind === "pdf" ? await window.ColexExport.buildPdf(r) : await window.ColexExport.buildXlsx(r);
      window.ColexExport.saveBlob(blob, `COLEX_${r.folio}.${kind === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      console.error(e); $("dlErr").textContent = e.message || String(e); $("dlErr").hidden = false;
    } finally { btn.disabled = false; span.textContent = label; }
  }

  /* ---------- ficha ampliada ---------- */
  function openModal(p) {
    const t = S.t, img = imgUrl(p), m = $("modal");
    const cat = S.data.categorias.find((c) => c.clave === p.categoria);
    m.innerHTML = `<button type="button" class="x" id="mClose" aria-label="${esc(t.close)}"><svg class="icon"><use href="#i-x"/></svg></button>
      <div class="detail">
        <div class="detail-img">${img ? `<img src="${esc(img)}" alt="">` : noImg()}</div>
        <div class="detail-info">
          <span class="sap" style="font-size:15px">${p.sap}</span>
          <h3>${esc(desc(p))}</h3>
          <dl>
            <dt>${esc(t.category)}</dt><dd>${esc(cat ? (S.lang === "en" ? cat.en : cat.es) : "")}</dd>
            <dt>${esc(t.subcategory)}</dt><dd>${esc(subName(p))}</dd>
            <dt>${esc(t.unit)}</dt><dd>${esc(window.colexUnit(p.unidad, S.lang))}</dd>
            ${SHOW ? `<dt>${esc(t.available)}</dt><dd class="num">${p.existencia > 0 ? fmt(p.existencia) : esc(t.outOfStock)}</dd>` : ""}
            <dt>${S.lang === "en" ? "Español" : "English"}</dt><dd style="font-weight:500">${esc(S.lang === "en" ? p.descripcion_es : p.descripcion_en)}</dd>
          </dl>
        </div></div>`;
    m.hidden = false; $("mScrim").hidden = false;
    $("mClose").onclick = closeModal; $("mClose").focus();
  }
  function closeModal() { $("modal").hidden = true; $("mScrim").hidden = true; }

  /* ---------- eventos ---------- */
  function readQty(container, p) {
    const inp = container.querySelector("input");
    return clampQty(p, inp.value);
  }
  function addToCart(p, q, silent) {
    if (q > 0) S.cart.set(p.sap, q); else S.cart.delete(p.sap);
    saveCart(); updateCount();
    if (!silent) toast(q > 0 ? `${S.t.added}: ${p.sap} × ${fmt(q)}` : `${S.t.remove}: ${p.sap}`);
  }
  function bump(inp, p, dir) {
    const step = isWhole(p) ? 1 : 1;
    let v = clampQty(p, (Number(String(inp.value).replace(",", ".")) || 0) + dir * step);
    if (dir > 0 && v === 0 && (!SHOW || p.existencia > 0)) v = SHOW ? Math.min(1, p.existencia) : 1;
    inp.value = v;
    return v;
  }

  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const card = b.closest(".card"), p = S.bySap.get(Number(card.dataset.sap)), inp = card.querySelector(".stepper input");
    const act = b.dataset.act;
    if (act === "zoom") return openModal(p);
    if (act === "copy") {
      const done = () => toast(`${S.t.code}: ${p.sap}`);
      if (navigator.clipboard) navigator.clipboard.writeText(String(p.sap)).then(done, done); else done();
      return;
    }
    if (act === "dec" || act === "inc") { bump(inp, p, act === "inc" ? 1 : -1); return; }
    if (act === "add") {
      const raw = Number(String(inp.value).replace(",", "."));
      const q = clampQty(p, inp.value);
      if (raw > cap(p)) toast(S.t.qtyCapped);
      addToCart(p, q, raw > cap(p)); updateCard(p.sap);
    }
  });
  $("grid").addEventListener("change", (e) => {
    if (!e.target.matches(".stepper input")) return;
    const card = e.target.closest(".card"), p = S.bySap.get(Number(card.dataset.sap));
    const raw = Number(String(e.target.value).replace(",", "."));
    e.target.value = clampQty(p, e.target.value);
    if (raw > cap(p)) toast(S.t.qtyCapped);
  });
  $("stepList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const line = b.closest(".line"), p = S.bySap.get(Number(line.dataset.sap)), inp = line.querySelector("input");
    if (b.dataset.act === "remove") { addToCart(p, 0, true); updateCard(p.sap); renderDrawer(); return; }
    const v = bump(inp, p, b.dataset.act === "inc" ? 1 : -1);
    if (v > 0) { addToCart(p, v, true); updateCard(p.sap); renderDrawer(); }
  });
  $("stepList").addEventListener("change", (e) => {
    if (!e.target.matches("input")) return;
    const line = e.target.closest(".line"), p = S.bySap.get(Number(line.dataset.sap));
    const raw = Number(String(e.target.value).replace(",", "."));
    const q = clampQty(p, e.target.value);
    if (raw > cap(p)) toast(S.t.qtyCapped);
    addToCart(p, q, true); updateCard(p.sap); renderDrawer();
  });
  $("chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    S.cat = c.dataset.cat; S.sub = ""; refresh();
  });
  $("sub").addEventListener("change", (e) => { S.sub = e.target.value; refresh(); });
  $("onlyStock").addEventListener("change", (e) => { S.onlyStock = e.target.checked; refresh(); });
  let qTimer;
  $("q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value; if (S.q.trim()) { S.cat = ""; S.sub = ""; } refresh(); }, 160);
  });
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
  $("subchips").addEventListener("click", (e) => { const c = e.target.closest("[data-sub]"); if (c) { S.sub = c.dataset.sub; refresh(); } });
  $("moreBtn").addEventListener("click", () => { S.limit += PAGE; applyFilters(); renderGrid(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((ents) => {
      if (ents[0].isIntersecting && !$("moreBtn").hidden && S.data) { S.limit += PAGE; renderGrid(); }
    }, { rootMargin: "600px" }).observe($("moreBtn"));
  }
  $("cartBtn").addEventListener("click", openDrawer);
  $("drawerClose").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  $("mScrim").addEventListener("click", closeModal);
  $("dlPdf").addEventListener("click", () => download("pdf"));
  $("dlXlsx").addEventListener("click", () => download("xlsx"));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("modal").hidden) closeModal(); else if (!$("drawer").hidden) closeDrawer();
  });
  function setLang(l) {
    if (l === S.lang) return;
    S.lang = l; S.t = I18N[l];
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    applyTexts(); renderFoot(); refresh(true);
    if (!$("drawer").hidden) renderDrawer();
  }
  $("langEs").addEventListener("click", () => setLang("es"));
  $("langEn").addEventListener("click", () => setLang("en"));

  /* ---------- inicio ---------- */
  async function start() {
    applyTexts();
    $("state").textContent = S.t.loading;
    try {
      const saved = JSON.parse(localStorage.getItem(CLIENT_KEY) || "null");
      if (saved) Object.entries(saved).forEach(([k, v]) => { const el = $("c-" + k); if (el) el.value = v || ""; });
    } catch (e) {}
    try {
      S.data = await store.loadCatalog();
    } catch (e) {
      console.error(e); $("state").className = "empty"; $("state").textContent = S.t.loadError; return;
    }
    S.data.productos.forEach((p) => S.bySap.set(p.sap, p));
    for (const [sap, q] of [...S.cart]) {           // limpia la solicitud guardada si cambió la existencia
      const p = S.bySap.get(sap);
      if (!p || (SHOW && !(p.existencia > 0))) S.cart.delete(sap); else if (q > cap(p)) S.cart.set(sap, cap(p));
    }
    const slug = vendorSlugFromUrl();
    if (slug) {
      try {
        const vs = await store.listVendors(true);
        S.vendor = vs.find((x) => x.slug === slug) || null;
        if (!S.vendor) { try { localStorage.removeItem(VENDOR_KEY); } catch (e) {} }
      } catch (e) { console.error(e); }
    }
    renderAdvisor();
    saveCart(); updateCount(); renderFoot(); refresh();
  }
  start();
})();
