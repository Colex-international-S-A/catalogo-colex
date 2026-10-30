/* Panel administrativo COLEX: inventario, ventas, productos, imágenes, importación, solicitudes y QR. */
(function () {
  const store = window.ColexStore, X = window.ColexExport;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const fmt = (n) => Number(n || 0).toLocaleString("es-PA", { maximumFractionDigits: 3 });
  const unit = (u) => window.colexUnit(u, "es");
  const PAGE = 100;
  const SHOW = !!(window.COLEX_CONFIG || {}).MOSTRAR_EXISTENCIAS;      // ¿se trabaja con existencias?
  if (!SHOW) {
    document.body.classList.add("no-stock");
    ["stock", "zero", "soldToday"].forEach((v) => { const o = document.querySelector(`#invFilter option[value="${v}"]`); if (o) o.remove(); });
    document.querySelector('.tab[data-tab="inv"]').textContent = "Productos";
  }
  const EST = { nueva: "Nueva", cotizando: "En cotización", concretada: "Venta concretada", cancelada: "Cancelada" };
  const A = { data: null, bySap: new Map(), movs: [], reqs: [], tab: "inv", limit: PAGE, session: null };

  let toastT;
  function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
  function localDay(d) { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  const today = () => localDay(new Date());
  function fmtDT(iso) { return new Date(iso).toLocaleString("es-PA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function imgSrc(p) {
    if (!p || !p.imagen) return null;
    if (/^(https?:|data:)/.test(p.imagen)) return p.imagen;
    return p.imagen + (p.actualizado ? "?v=" + encodeURIComponent(String(p.actualizado).slice(0, 19)) : "");
  }
  function thumb(p) {
    const s = imgSrc(p);
    return s ? `<img class="thumb" src="${esc(s)}" alt="" loading="lazy">` : `<span class="thumb empty">Sin foto</span>`;
  }
  const catName = (k) => { const c = A.data.categorias.find((x) => x.clave === k); return c ? c.es : k || ""; };

  /* ================= ACCESO ================= */
  async function boot() {
    if (store.isDemo) {
      $("demoFlag").hidden = false; $("demoBox").hidden = false;
      $("lHint").hidden = false; $("lHint").textContent = "Modo demostración: los cambios se guardan solo en este navegador.";
    }
    try { A.session = await store.session(); } catch (e) { A.session = null; }
    if (A.session && !A.session.rol) A.session = Object.assign({ nombre: "Abraham Ríos", rol: "dueno" }, A.session); // sesión de la versión anterior
    if (A.session) { enter(); return; }
    $("loginView").hidden = false;
    if (store.isDemo) {
      A.team = (await store.listTeam()).filter((m) => m.activo !== false);
      const vs = await store.listVendors(true).catch(() => []);
      $("lWhoWrap").hidden = false; $("lEmailWrap").hidden = true; $("lEmail").required = false;
      $("lWho").innerHTML = `<option value="">Elija su nombre…</option>` +
        `<optgroup label="Administración">${A.team.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join("")}</optgroup>` +
        (vs.length ? `<optgroup label="Vendedores">${vs.map((v) => `<option value="v:${esc(v.slug)}">${esc(v.nombre)}</option>`).join("")}</optgroup>` : "");
      const upd = () => { const m = A.team.find((x) => x.id === $("lWho").value); const pw = !!m && m.rol === "dueno";
        $("lPassWrap").hidden = !pw; $("lPass").required = pw; if (pw) $("lPass").focus(); };
      $("lWho").addEventListener("change", upd); upd(); $("lWho").focus();
    } else $("lEmail").focus();
  }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("lBtn"); btn.disabled = true; $("lErr").hidden = true;
    try {
      if (store.isDemo) {
        if (!$("lWho").value) throw new Error("Elija su nombre de la lista.");
        A.session = await store.loginAs($("lWho").value, $("lPass").value);
      } else A.session = await store.login($("lEmail").value.trim(), $("lPass").value);
      $("loginView").hidden = true; enter();
    }
    catch (err) { $("lErr").textContent = err.message; $("lErr").hidden = false; }
    finally { btn.disabled = false; }
  });
  $("logout").addEventListener("click", async () => { await store.logout(); location.reload(); });

  /* ================= PERMISOS =================
     dueño: todo · administrador: productos e importar; borrar, vendedores y ajustes con autorización del dueño
     subadministrador: ve productos y gestiona solicitudes; no edita catálogo, vendedores ni ajustes. */
  const OWNER_NAME = () => ((A.team || []).find((m) => m.rol === "dueno") || {}).nombre || "Abraham Ríos";
  function can(action) {
    const r = (A.session || {}).rol;
    if (r === "dueno") return "yes";
    const M = {
      admin: { editProducts: "yes", importar: "yes", deleteProduct: "ask", vendors: "ask", config: "ask", team: "no" },
      subadmin: { editProducts: "no", importar: "no", deleteProduct: "no", vendors: "no", config: "no", team: "no" },
      vendedor: { editProducts: "no", importar: "no", deleteProduct: "no", vendors: "no", config: "no", team: "no" },
    };
    return (M[r] || M.subadmin)[action] || "no";
  }
  async function requestApproval(tipo, descripcion, datos) {
    await store.createApproval({ tipo, descripcion, datos, solicitado_por: A.session.nombre });
    toast(`Enviado a ${OWNER_NAME()} para autorización`);
    A.approvals = await store.listApprovals().catch(() => A.approvals || []);
    renderApprovals();
  }
  const isVendor = () => (A.session || {}).rol === "vendedor";
  const mine = (list) => (isVendor() ? list.filter((x) => x.vendedor && x.vendedor.slug === A.session.vendedor) : list);
  function applyRole() {
    const r = A.session.rol;
    $("who").textContent = ""; $("who").hidden = true;          // en la esquina va solo la marca COLEX
    $("logout").title = "Salir (" + (A.session.nombre || "") + ")";
    if (r === "vendedor") {
      ["inv", "mov", "imp", "apr", "cfg"].forEach((t) => { const b = document.querySelector(`.tab[data-tab="${t}"]`); if (b) b.hidden = true; });
      $("solVend").hidden = true; $("myLink").hidden = false; $("myLink").href = "vendedores.html?v=" + encodeURIComponent(A.session.vendedor);
      document.querySelector('.tab[data-tab="sol"]').click();
      return;
    }
    $("newProd").hidden = can("editProducts") === "no";
    document.querySelector('.tab[data-tab="imp"]').hidden = can("importar") === "no";
    $("cfgBox").hidden = can("config") === "no";
    $("vendBox").hidden = can("vendors") === "no";
    $("teamBox").hidden = can("team") !== "yes";
    if (store.isDemo) $("demoBox").hidden = r !== "dueno";
    document.querySelector('.tab[data-tab="apr"]').hidden = r === "subadmin";
    $("aprHelp").textContent = r === "dueno"
      ? "Aquí llegan los cambios que pide su equipo. Nada se aplica hasta que usted lo apruebe."
      : `Cambios que usted pidió. ${OWNER_NAME()} debe aprobarlos antes de que se apliquen.`;
    const askNote = (box, txt) => { let n = $(box).querySelector(".ask-note");
      if (can(box === "vendBox" ? "vendors" : "config") === "ask") { if (!n) { n = document.createElement("p"); n.className = "small ask-note"; n.style.margin = "0 0 10px";
        $(box).querySelector(".box-body").prepend(n); } n.textContent = txt; } else if (n) n.remove(); };
    askNote("vendBox", `Los cambios de vendedores se envían a ${OWNER_NAME()} para su autorización.`);
    askNote("cfgBox", `Los cambios de ajustes se envían a ${OWNER_NAME()} para su autorización.`);
  }

  async function enter() {
    $("appView").hidden = false;
    try { A.team = await store.listTeam(); } catch (e) { A.team = A.team || []; }
    applyRole();
    await reload();
    if (!store.isDemo) {
      try { if ((await store.countProducts()) === 0) $("seedBox").hidden = false; } catch (e) {}
    }
    initQr();
    startWatch();
  }
  async function reload() {
    try {
      A.data = await store.adminCatalog();
      A.bySap = new Map(A.data.productos.map((p) => [p.sap, p]));
      A.movs = await store.movements({ from: localDay(Date.now() - 31 * 864e5) });
      A.reqs = mine(await store.requests());
      A.vendors = await store.listVendors(false);
      A.approvals = isVendor() ? [] : await store.listApprovals().catch(() => []);
      if (can("team") === "yes") A.team = await store.listTeam();
    } catch (e) { console.error(e); toast(e.message); return; }
    fillCats(); fillCfg(); renderInv(); renderMov(); renderSol(); renderVendors(); renderApprovals(); renderTeam();
  }

  /* ================= PESTAÑAS ================= */
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    A.tab = b.dataset.tab;
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== A.tab));
    if (A.tab === "mov") renderMov(); if (A.tab === "sol") renderSol();
  }));

  /* ================= INVENTARIO ================= */
  function soldToday() {
    const t = today(), m = new Map();
    A.movs.forEach((x) => { if (x.tipo === "venta" && localDay(x.fecha) === t) m.set(Number(x.sap), (m.get(Number(x.sap)) || 0) + Number(x.cantidad)); });
    return m;
  }
  function fillCats() {
    const cur = $("invCat").value;
    $("invCat").innerHTML = `<option value="">Todas las categorías</option>` + A.data.categorias.map((c) => `<option value="${esc(c.clave)}">${esc(c.es)}</option>`).join("");
    $("invCat").value = cur;
  }
  function renderKpis(sold) {
    const ps = A.data.productos, act = ps.filter((p) => p.activo);
    const units = [...sold.values()].reduce((a, b) => a + b, 0);
    const k = !SHOW ? [
      ["Productos en el catálogo", fmt(act.length)],
      ["Sin imagen", fmt(act.filter((p) => !p.imagen).length), "warn"],
      ["Sin traducción al inglés", fmt(act.filter((p) => !p.descripcion_en || p.descripcion_en.trim() === p.descripcion_es.trim()).length)],
      ["Ocultos del catálogo", fmt(ps.length - act.length)],
      ["Solicitudes pendientes", fmt(A.reqs.filter((r) => r.estado === "nueva" || r.estado === "cotizando").length)]
    ] : [
      ["Productos en el catálogo", fmt(act.length)],
      ["Con existencia", fmt(act.filter((p) => p.existencia > 0).length)],
      ["Agotados", fmt(act.filter((p) => !(p.existencia > 0)).length), "warn"],
      ["Unidades vendidas hoy", fmt(units)],
      ["Sin imagen", fmt(act.filter((p) => !p.imagen).length)]
    ];
    $("kpis").innerHTML = k.map(([l, v, c]) => `<div class="kpi ${c || ""}"><span>${l}</span><b>${v}</b></div>`).join("");
  }
  function invFiltered(sold) {
    const toks = norm($("invQ").value).split(/\s+/).filter(Boolean), cat = $("invCat").value, f = $("invFilter").value;
    return A.data.productos.filter((p) => {
      if (cat && p.categoria !== cat) return false;
      if (f === "stock" && !(p.existencia > 0)) return false;
      if (f === "zero" && p.existencia > 0) return false;
      if (f === "soldToday" && !sold.has(p.sap)) return false;
      if (f === "noimg" && p.imagen) return false;
      if (f === "inactive" && p.activo) return false;
      if (f === "noen" && p.descripcion_en && p.descripcion_en.trim() !== p.descripcion_es.trim()) return false;
      if (!toks.length) return true;
      const h = norm(`${p.sap} ${p.descripcion_es} ${p.descripcion_en} ${p.subcategoria_es}`);
      return toks.every((t) => h.includes(t));
    });
  }
  function rowHtml(p, sold) {
    const s = sold.get(p.sap);
    return `<tr data-sap="${p.sap}">
      <td>${thumb(p)}</td>
      <td class="mono">${p.sap}${p.activo ? "" : ` <span class="pill inactivo">Oculto</span>`}</td>
      <td style="min-width:220px">${esc(p.descripcion_es)}<div class="small">${esc(p.subcategoria_es)}</div></td>
      <td class="hide-sm small">${esc(catName(p.categoria))}</td>
      ${SHOW ? `<td class="r">${s ? `<span class="sold">−${fmt(s)}</span>` : `<span class="small">—</span>`}</td>
      <td class="r"><span class="stockcell${p.existencia > 0 ? "" : " zero"}">${fmt(p.existencia)}</span> <span class="small">${esc(unit(p.unidad))}</span></td>` : ""}
      <td><div class="acts">${SHOW ? `<button class="btn btn-primary btn-sm" data-act="mov" type="button">Venta / entrada</button>` : ""}${can("editProducts") === "no" ? "" : `<button class="btn btn-ghost btn-sm" data-act="edit" type="button">Editar</button>`}</div></td></tr>`;
  }
  function renderInv() {
    const sold = soldToday(); renderKpis(sold);
    const list = invFiltered(sold), shown = list.slice(0, A.limit);
    $("invBody").innerHTML = shown.map((p) => rowHtml(p, sold)).join("") ||
      `<tr><td colspan="${SHOW ? 7 : 5}" class="c small" style="padding:30px">No hay productos con ese filtro.</td></tr>`;
    $("invCount").textContent = `${fmt(list.length)} productos` + (list.length > shown.length ? ` · mostrando ${fmt(shown.length)}` : "");
    $("invMore").hidden = list.length <= A.limit;
  }
  let invT;
  $("invQ").addEventListener("input", () => { clearTimeout(invT); invT = setTimeout(() => { A.limit = PAGE; renderInv(); }, 150); });
  ["invCat", "invFilter"].forEach((id) => $(id).addEventListener("change", () => { A.limit = PAGE; renderInv(); }));
  $("invMore").addEventListener("click", () => { A.limit += PAGE; renderInv(); });
  $("invBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const p = A.bySap.get(Number(b.closest("tr").dataset.sap));
    if (b.dataset.act === "mov") openMovement(p); else openProduct(p);
  });
  $("newProd").addEventListener("click", () => openProduct(null));

  /* ================= MODALES ================= */
  function openModal(html) {
    $("modal").innerHTML = html; $("modal").hidden = false; $("scrim").hidden = false;
    $("modal").querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    const f = $("modal").querySelector("input:not([readonly]):not([type=file]):not([type=checkbox]), textarea"); if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $("modal").hidden = true; $("scrim").hidden = true; $("modal").innerHTML = ""; }
  $("scrim").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  const head = (title) => `<div class="mh"><h3>${esc(title)}</h3><button type="button" class="x" data-close aria-label="Cerrar"><svg class="icon"><use href="#i-x"/></svg></button></div>`;

  /* ---- Venta / entrada / ajuste ---- */
  function openMovement(p) {
    let tipo = "venta";
    openModal(`${head("Registrar movimiento")}
      <div class="mb">
        <div style="display:flex;gap:12px;align-items:center">${thumb(p)}<div><div class="mono">${p.sap}</div><div style="font-weight:600">${esc(p.descripcion_es)}</div></div></div>
        <div class="seg" role="group" aria-label="Tipo">
          <button type="button" data-t="venta" aria-pressed="true">Venta (−)</button>
          <button type="button" data-t="entrada" aria-pressed="false">Entrada (+)</button>
          <button type="button" data-t="ajuste" aria-pressed="false">Ajustar a</button></div>
        <div class="two">
          <div class="field"><label for="mQty" id="mQtyL">Unidades vendidas</label><input id="mQty" type="number" min="0" step="any" inputmode="decimal"></div>
          <div class="field"><label for="mNote">Nota (opcional)</label><input id="mNote" maxlength="300" placeholder="Factura, cliente…"></div>
        </div>
        <div class="preview"><div class="c"><div class="small">Hay</div><b>${fmt(p.existencia)}</b></div><span class="arrow">→</span><div class="c"><div class="small">Queda</div><b id="mAfter">${fmt(p.existencia)}</b></div></div>
        <div class="alert" id="mErr" hidden></div>
      </div>
      <div class="mf"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="button" class="btn btn-primary" id="mSave">Guardar</button></div>`);
    const upd = () => {
      let after;
      try { after = store.applyMovement(p.existencia, tipo, Number($("mQty").value || 0)).despues; $("mErr").hidden = true; }
      catch (e) { after = null; if ($("mQty").value) { $("mErr").textContent = e.message; $("mErr").hidden = false; } }
      $("mAfter").textContent = after == null ? "—" : fmt(after);
      $("mSave").disabled = after == null;
    };
    $("modal").querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      tipo = b.dataset.t;
      $("modal").querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("mQtyL").textContent = { venta: "Unidades vendidas", entrada: "Unidades que entran", ajuste: "Existencia correcta" }[tipo];
      upd(); $("mQty").focus();
    }));
    $("mQty").addEventListener("input", upd);
    $("mQty").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("mSave").disabled) $("mSave").click(); });
    upd();
    $("mSave").addEventListener("click", async () => {
      $("mSave").disabled = true;
      try {
        const q = Number($("mQty").value || 0), nota = $("mNote").value.trim();
        const despues = await store.registerMovement(p.sap, tipo, q, nota);
        A.movs.unshift({ id: Date.now(), sap: p.sap, tipo, cantidad: q, existencia_antes: p.existencia, existencia_despues: despues, nota,
          usuario: A.session.nombre || A.session.email, fecha: new Date().toISOString() });
        p.existencia = despues; p.actualizado = new Date().toISOString();
        closeModal(); renderInv(); renderMov();
        toast(`${{ venta: "Venta registrada", entrada: "Entrada registrada", ajuste: "Existencia ajustada" }[tipo]}: ${p.sap} · quedan ${fmt(despues)}`);
      } catch (e) { $("mErr").textContent = e.message; $("mErr").hidden = false; $("mSave").disabled = false; }
    });
  }

  /* ---- Producto (nuevo / editar) ---- */
  function resizeImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error("El archivo no es una imagen."));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const max = maxSide || 900, r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen."))), "image/jpeg", 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
      img.src = url;
    });
  }
  function openProduct(p) {
    const isNew = !p;
    p = p || { sap: "", categoria: A.data.categorias[0].clave, subcategoria_es: "", subcategoria_en: "", descripcion_es: "", descripcion_en: "", unidad: "UN", existencia: 0, imagen: null, activo: true };
    let newBlob = null, removeImg = false;
    const subs = [...new Map(A.data.productos.map((x) => [x.subcategoria_es, x.subcategoria_en])).entries()];
    openModal(`${head(isNew ? "Nuevo producto" : "Editar producto")}
      <form class="mb" id="pForm" novalidate>
        <div class="imgedit"><div class="ph" id="pPh">${imgSrc(p) ? `<img src="${esc(imgSrc(p))}" alt="">` : `<span class="small">Sin imagen</span>`}</div>
          <div style="display:grid;gap:8px;justify-items:start">
            <label class="btn btn-ghost btn-sm" for="pFile">Subir o cambiar imagen</label><input type="file" id="pFile" accept="image/*" hidden>
            <button type="button" class="btn btn-danger btn-sm" id="pNoImg" ${p.imagen ? "" : "hidden"}>Quitar imagen</button>
            <span class="small">JPG o PNG. Se ajusta automáticamente.</span></div></div>
        <div class="two">
          <div class="field"><label for="pSap">Código SAP</label><input id="pSap" inputmode="numeric" maxlength="14" value="${esc(p.sap)}" ${isNew ? "" : "readonly"}></div>
          <div class="field"><label for="pCat">Categoría</label><select id="pCat">${A.data.categorias.map((c) => `<option value="${esc(c.clave)}"${c.clave === p.categoria ? " selected" : ""}>${esc(c.es)}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="pDes">Descripción en español</label><input id="pDes" maxlength="200" value="${esc(p.descripcion_es)}"></div>
        <div class="field"><label for="pDen">Descripción en inglés</label><input id="pDen" maxlength="200" value="${esc(p.descripcion_en)}"></div>
        <div class="two">
          <div class="field"><label for="pSes">Subcategoría (español)</label><input id="pSes" list="subsEs" maxlength="80" value="${esc(p.subcategoria_es)}"></div>
          <div class="field"><label for="pSen">Subcategoría (inglés)</label><input id="pSen" maxlength="80" value="${esc(p.subcategoria_en)}"></div>
        </div>
        <datalist id="subsEs">${subs.map(([es]) => `<option value="${esc(es)}">`).join("")}</datalist>
        <div class="two">
          <div class="field"><label for="pUm">Unidad de medida</label><input id="pUm" maxlength="10" value="${esc(p.unidad)}"></div>
          <div class="field stock-only"><label for="pStock">Existencia${isNew ? " inicial" : ""}</label><input id="pStock" type="number" min="0" step="any" value="${esc(p.existencia)}" ${isNew ? "" : "readonly title=\"Use Venta / entrada para cambiarla\""}></div>
        </div>
        <label class="toggle"><input type="checkbox" id="pAct" ${p.activo ? "checked" : ""}> Visible en el catálogo</label>
        <div class="alert" id="pErr" hidden></div>
        <div id="pDelBox"></div>
      </form>
      <div class="mf">${isNew || can("deleteProduct") === "no" ? "" : `<button type="button" class="btn btn-danger" id="pDel" style="margin-right:auto">${can("deleteProduct") === "ask" ? "Pedir eliminación" : "Eliminar"}</button>`}
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="button" class="btn btn-primary" id="pSave">Guardar</button></div>`);
    const subMap = new Map(subs);
    $("pSes").addEventListener("change", () => { if (!$("pSen").value && subMap.get($("pSes").value)) $("pSen").value = subMap.get($("pSes").value); });
    $("pFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { newBlob = await resizeImage(f); removeImg = false;
        $("pPh").innerHTML = `<img src="${URL.createObjectURL(newBlob)}" alt="">`; $("pNoImg").hidden = false; }
      catch (err) { $("pErr").textContent = err.message; $("pErr").hidden = false; }
    });
    $("pNoImg").addEventListener("click", () => { newBlob = null; removeImg = true; $("pPh").innerHTML = `<span class="small">Sin imagen</span>`; $("pNoImg").hidden = true; });
    if ($("pDel")) $("pDel").addEventListener("click", () => {
      if (can("deleteProduct") === "ask") {
        $("pDelBox").innerHTML = `<div class="confirm"><b>¿Pedir que se elimine ${p.sap}?</b><span>${esc(OWNER_NAME())} recibirá la solicitud y decidirá. Si solo quiere ocultarlo, desmarque «Visible en el catálogo».</span>
          <div class="bar"><button type="button" class="btn btn-danger btn-sm" id="pDelYes">Enviar solicitud</button><button type="button" class="btn btn-ghost btn-sm" id="pDelNo">No</button></div></div>`;
        $("pDelNo").onclick = () => ($("pDelBox").innerHTML = "");
        $("pDelYes").onclick = async () => {
          try { await requestApproval("product_delete", `Eliminar producto ${p.sap} — ${p.descripcion_es}`, { sap: p.sap, imagen: p.imagen || null }); closeModal(); }
          catch (e) { $("pErr").textContent = e.message; $("pErr").hidden = false; }
        };
        return;
      }
      $("pDelBox").innerHTML = `<div class="confirm"><b>¿Eliminar ${p.sap} definitivamente?</b><span>También se borra su historial de movimientos. Si solo quiere ocultarlo, desmarque «Visible en el catálogo».</span>
        <div class="bar"><button type="button" class="btn btn-danger btn-sm" id="pDelYes">Sí, eliminar</button><button type="button" class="btn btn-ghost btn-sm" id="pDelNo">No</button></div></div>`;
      $("pDelNo").onclick = () => ($("pDelBox").innerHTML = "");
      $("pDelYes").onclick = async () => {
        try { await store.deleteProduct(p.sap); if (p.imagen) await store.removeImage(p.imagen).catch(() => {});
          A.data.productos = A.data.productos.filter((x) => x.sap !== p.sap); A.bySap.delete(p.sap);
          closeModal(); renderInv(); toast(`Producto ${p.sap} eliminado`); }
        catch (e) { $("pErr").textContent = e.message; $("pErr").hidden = false; }
      };
    });
    $("pSave").addEventListener("click", async () => {
      const err = (m) => { $("pErr").textContent = m; $("pErr").hidden = false; };
      const sap = Number(String($("pSap").value).replace(/\D/g, ""));
      if (!sap || String(sap).length < 3) return err("Escriba un código SAP numérico válido.");
      if (isNew && A.bySap.has(sap)) return err(`El código ${sap} ya existe.`);
      if (!$("pDes").value.trim()) return err("Escriba la descripción en español.");
      const stock = Number($("pStock").value || 0);
      if (isNew && !(stock >= 0)) return err("La existencia debe ser un número igual o mayor que cero.");
      $("pSave").disabled = true;
      try {
        let imagen = p.imagen;
        if (newBlob) { imagen = await store.uploadImage(sap, newBlob); if (p.imagen) store.removeImage(p.imagen).catch(() => {}); }
        else if (removeImg) { if (p.imagen) store.removeImage(p.imagen).catch(() => {}); imagen = null; }
        const maxOrden = A.data.productos.reduce((a, b) => Math.max(a, b.orden || 0), 0);
        const saved = await store.saveProduct({
          sap, categoria: $("pCat").value, subcategoria_es: $("pSes").value.trim(), subcategoria_en: $("pSen").value.trim(),
          descripcion_es: $("pDes").value.trim(), descripcion_en: $("pDen").value.trim(), unidad: ($("pUm").value.trim() || "UN").toUpperCase(),
          existencia: isNew ? stock : p.existencia, imagen, activo: $("pAct").checked, orden: isNew ? maxOrden + 1 : p.orden
        });
        if (isNew) { A.data.productos.push(saved); } else { Object.assign(p, saved); }
        A.bySap.set(saved.sap, isNew ? saved : p);
        closeModal(); renderInv(); toast(isNew ? `Producto ${sap} creado` : `Producto ${sap} guardado`);
      } catch (e) { err(e.message); $("pSave").disabled = false; }
    });
  }

  /* ================= MOVIMIENTOS ================= */
  $("movFrom").value = today(); $("movTo").value = today();
  async function refetchMovs() {
    try { A.movs = await store.movements({ from: $("movFrom").value || localDay(Date.now() - 31 * 864e5), to: $("movTo").value || today() }); }
    catch (e) { toast(e.message); }
    renderMov();
  }
  ["movFrom", "movTo"].forEach((id) => $(id).addEventListener("change", refetchMovs));
  ["movQ", "movType"].forEach((id) => $(id).addEventListener("input", renderMov));
  function renderMov() {
    if (!A.data) return;
    const from = $("movFrom").value, to = $("movTo").value, type = $("movType").value, toks = norm($("movQ").value).split(/\s+/).filter(Boolean);
    const list = A.movs.filter((m) => {
      const d = localDay(m.fecha);
      if (from && d < from) return false; if (to && d > to) return false;
      if (type && m.tipo !== type) return false;
      if (!toks.length) return true;
      const p = A.bySap.get(Number(m.sap));
      const h = norm(`${m.sap} ${p ? p.descripcion_es : ""} ${m.nota}`);
      return toks.every((t) => h.includes(t));
    });
    const sum = (t) => list.filter((m) => m.tipo === t).reduce((a, b) => a + Number(b.cantidad), 0);
    $("movKpis").innerHTML = [["Unidades vendidas", fmt(sum("venta"))], ["Unidades que entraron", fmt(sum("entrada"))],
      ["Ajustes e importaciones", fmt(list.filter((m) => m.tipo === "ajuste" || m.tipo === "importacion").length)], ["Movimientos", fmt(list.length)]]
      .map(([l, v]) => `<div class="kpi"><span>${l}</span><b>${v}</b></div>`).join("");
    const label = { venta: "Venta", entrada: "Entrada", ajuste: "Ajuste", importacion: "Importación" };
    $("movBody").innerHTML = list.slice(0, 1500).map((m) => {
      const p = A.bySap.get(Number(m.sap));
      const sign = m.tipo === "venta" ? "−" : m.tipo === "entrada" ? "+" : "=";
      return `<tr><td class="small" style="white-space:nowrap">${esc(fmtDT(m.fecha))}</td><td class="mono">${m.sap}</td>
        <td>${esc(p ? p.descripcion_es : "")}</td><td><span class="pill ${m.tipo}">${label[m.tipo] || m.tipo}</span></td>
        <td class="r">${sign}${fmt(m.cantidad)}</td><td class="r">${fmt(m.existencia_antes)}</td><td class="r"><b>${fmt(m.existencia_despues)}</b></td>
        <td class="hide-sm small">${esc(m.nota)}</td><td class="hide-sm small">${esc(m.usuario)}</td></tr>`;
    }).join("") || `<tr><td colspan="9" class="c small" style="padding:30px">No hay movimientos en ese período.</td></tr>`;
  }

  /* ================= SOLICITUDES ================= */
  /* ---- Aviso automático de solicitudes nuevas ---- */
  const WATCH_MS = 30000;
  let watchTimer = null, audioCtx = null, freshIds = new Set();
  const seen = new Set();
  try { $("soundOn").checked = localStorage.getItem("colex_sound") !== "0"; } catch (e) {}
  $("soundOn").addEventListener("change", () => { try { localStorage.setItem("colex_sound", $("soundOn").checked ? "1" : "0"); } catch (e) {} if ($("soundOn").checked) chime(); });
  // Los navegadores solo permiten sonido después de que la persona toca la página
  document.addEventListener("pointerdown", () => {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {}
  }, { passive: true });
  function chime() {
    if (!$("soundOn").checked || !audioCtx) return;
    try {
      const t0 = audioCtx.currentTime;
      [[880, 0], [1320, 0.18]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.45); o.start(t0 + d); o.stop(t0 + d + 0.5);
      });
    } catch (e) {}
  }
  function updateTitle() {
    const n = A.reqs.filter((r) => r.estado === "nueva").length;
    document.title = (n ? `(${n}) ` : "") + "Panel COLEX";
  }
  function showAlert(nuevas) {
    const r = nuevas[0], c = r.cliente || {};
    const extra = nuevas.length > 1 ? ` y ${nuevas.length - 1} más` : "";
    const vend = r.vendedor && r.vendedor.nombre ? ` · vendedor ${r.vendedor.nombre}` : "";
    $("reqAlertText").textContent = `Nueva solicitud ${r.folio || ""} de ${c.nombre || "un cliente"}${c.empresa ? " (" + c.empresa + ")" : ""}: ${(r.items || []).length} productos${vend}${extra}.`;
    $("reqAlert").hidden = false; delete $("reqAlert").dataset.go;
  }
  async function checkRequests() {
    try {
      const fresh = mine(await store.requests());
      const nuevas = fresh.filter((r) => !seen.has(String(r.id)) && r.estado === "nueva");
      fresh.forEach((r) => seen.add(String(r.id)));
      A.reqs = fresh;
      if (nuevas.length) { nuevas.forEach((r) => freshIds.add(String(r.id))); showAlert(nuevas); chime(); toast(`Llegó ${nuevas.length === 1 ? "una solicitud nueva" : nuevas.length + " solicitudes nuevas"}`); }
      renderSol(); updateTitle();
      await checkApprovals();
      $("watchInfo").textContent = `Las solicitudes nuevas aparecen solas. Última revisión: ${new Date().toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`;
    } catch (e) { $("watchInfo").textContent = "No se pudo revisar si hay solicitudes nuevas. Se reintentará en 30 segundos."; }
  }
  const seenApr = new Set();
  async function checkApprovals() {
    if (A.session.rol === "subadmin" || isVendor()) return;
    const fresh = await store.listApprovals().catch(() => null); if (!fresh) return;
    const nuevas = fresh.filter((x) => x.estado === "pendiente" && !seenApr.has(String(x.id)));
    const changed = fresh.some((x) => { const o = (A.approvals || []).find((y) => String(y.id) === String(x.id)); return !o || o.estado !== x.estado; });
    fresh.forEach((x) => seenApr.add(String(x.id)));
    A.approvals = fresh;
    if (A.session.rol === "dueno" && nuevas.length) {
      $("reqAlertText").textContent = `${nuevas[0].solicitado_por} pide autorización: ${nuevas[0].descripcion}${nuevas.length > 1 ? ` (y ${nuevas.length - 1} más)` : ""}.`;
      $("reqAlert").hidden = false; $("reqAlert").dataset.go = "apr"; chime();
    }
    if (changed) { if (A.session.rol !== "dueno") await reload(); else renderApprovals(); }
  }
  function startWatch() {
    (A.approvals || []).forEach((x) => seenApr.add(String(x.id)));
    A.reqs.forEach((r) => seen.add(String(r.id)));
    updateTitle();
    clearInterval(watchTimer);
    watchTimer = setInterval(checkRequests, WATCH_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkRequests(); });
    window.addEventListener("storage", (e) => { if (store.isDemo && e.key === "colex_demo_v1") checkRequests(); }); // demostración: otra pestaña
  }
  $("reqAlertGo").addEventListener("click", () => {
    $("reqAlert").hidden = true;
    if ($("reqAlert").dataset.go === "apr") { delete $("reqAlert").dataset.go; document.querySelector('.tab[data-tab="apr"]').click(); return; }
    $("solState").value = "nueva";
    document.querySelector('.tab[data-tab="sol"]').click();
  });
  $("reqAlertX").addEventListener("click", () => ($("reqAlert").hidden = true));

  $("solState").addEventListener("change", renderSol);
  $("solVend").addEventListener("change", renderSol);
  function renderSol() {
    if (!A.data) return;
    const st = $("solState").value, vf = $("solVend").value;
    const byVend = A.reqs.filter((r) => !vf || (vf === "-" ? !r.vendedor : r.vendedor && r.vendedor.slug === vf));
    const list = byVend.filter((r) => !st || (st === "abiertas" ? (r.estado === "nueva" || r.estado === "cotizando") : r.estado === st));
    const n = (e) => byVend.filter((r) => r.estado === e).length, cerradas = n("concretada") + n("cancelada");
    $("solKpis").innerHTML = [["Nuevas", n("nueva"), n("nueva") ? "warn" : ""], ["En cotización", n("cotizando")], ["Ventas concretadas", n("concretada"), "ok"],
      ["Canceladas", n("cancelada")], ["Tasa de cierre", cerradas ? Math.round((n("concretada") / cerradas) * 100) + " %" : "—"]]
      .map(([l, v, c]) => `<div class="kpi ${c || ""}"><span>${l}</span><b>${v}</b></div>`).join("");
    const nuevas = A.reqs.filter((r) => r.estado === "nueva").length;
    $("newReqs").hidden = !nuevas; $("newReqs").textContent = nuevas;
    $("solBody").innerHTML = list.map((r) => {
      const c = r.cliente || {};
      return `<tr data-id="${esc(r.id)}"${freshIds.has(String(r.id)) ? ' class="is-new"' : ""}><td class="mono">${esc(r.folio)}</td><td class="small" style="white-space:nowrap">${esc(fmtDT(r.fecha))}</td>
        <td>${esc(c.nombre)}</td><td class="hide-sm">${esc(c.empresa)}</td><td class="hide-sm">${esc(c.telefono)}</td>
        <td>${r.vendedor && r.vendedor.nombre ? esc(r.vendedor.nombre) : `<span class="small">General</span>`}</td>
        <td class="r">${(r.items || []).length}</td><td><span class="pill ${esc(r.estado)}">${esc(EST[r.estado] || r.estado)}</span>${r.nota_estado || r.actualizado_por ? `<div class="status-note" title="${esc(r.nota_estado)}">${esc(r.nota_estado)}${r.actualizado_por ? `${r.nota_estado ? " · " : ""}por ${esc(r.actualizado_por)}` : ""}</div>` : ""}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-act="ver">Ver</button></td></tr>`;
    }).join("") || `<tr><td colspan="9" class="c small" style="padding:30px">No hay solicitudes.</td></tr>`;
  }
  function reqForExport(r) {
    return Object.assign({}, r, { config: A.data.config, items: (r.items || []).map((it) => {
      const p = A.bySap.get(Number(it.sap)); const s = imgSrc(p);
      return Object.assign({}, it, { imagen_url: s ? new URL(s, location.href).href : null });
    }) });
  }
  $("solBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const r = A.reqs.find((x) => String(x.id) === b.closest("tr").dataset.id); if (r) openRequest(r);
  });
  /* Teléfono del cliente -> número para WhatsApp (Panamá: 8 dígitos sin código de país) */
  function waNumber(t) { let d = String(t || "").replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.length === 7 || d.length === 8) d = "507" + d; return d.length >= 10 ? d : ""; }
  function clientWaLink(r) {
    const c = r.cliente || {}, n = waNumber(c.telefono); if (!n) return "";
    const v = A.session.nombre, en = r.idioma === "en", first = String(c.nombre || "").split(/\s+/)[0];
    const msg = en
      ? `Hello ${first}, this is ${v} from COLEX International. I am sending you your updated quotation request ${r.folio}. Please review it and let me know if everything is correct.`
      : `Hola ${first}, le saluda ${v} de COLEX International. Le envío su solicitud de cotización ${r.folio} actualizada. Por favor revísela y me confirma si todo está correcto.`;
    return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
  }
  function openRequest(r) {
    const c = r.cliente || {};
    const canAssign = !isVendor();
    const vSel = `<select id="rVend" aria-label="Vendedor responsable" style="min-height:34px;border:1px solid var(--line);border-radius:6px;padding:0 6px">
      <option value="">General (sin vendedor)</option>${(A.vendors || []).filter((v) => v.activo || (r.vendedor && r.vendedor.slug === v.slug))
        .map((v) => `<option value="${esc(v.slug)}"${r.vendedor && r.vendedor.slug === v.slug ? " selected" : ""}>${esc(v.nombre)}</option>`).join("")}</select>`;
    const wa = clientWaLink(r);
    openModal(`${head("Solicitud " + r.folio)}
      <div class="mb">
        <div class="small">${esc(fmtDT(r.fecha))} · Idioma: ${r.idioma === "en" ? "inglés" : "español"} · Vendedor responsable: ${canAssign ? vSel : `<b>${esc(r.vendedor && r.vendedor.nombre ? r.vendedor.nombre : "General (sin vendedor)")}</b>`}</div>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0">
          ${[["Cliente", c.nombre], ["Empresa", c.empresa], ["País", c.pais], ["Teléfono", c.telefono], ["Correo", c.correo], ["Comentarios", c.comentarios]]
            .filter((x) => x[1]).map(([k, v]) => `<dt class="small">${k}</dt><dd style="margin:0;font-weight:600">${esc(v)}</dd>`).join("")}</dl>
        <div id="rItems">
          ${r.modificado_fecha ? `<p class="small" style="margin:0 0 6px">Pedido modificado por <b>${esc(r.modificado_por)}</b> el ${esc(fmtDT(r.modificado_fecha))}${r.items_original ? ` · el cliente pidió originalmente ${r.items_original.length} ${r.items_original.length === 1 ? "producto" : "productos"}` : ""}.</p>` : ""}
          <div class="table-wrap"><table class="t"><thead><tr><th>Código SAP</th><th>Descripción</th><th class="r">Cantidad</th>${SHOW ? `<th class="r">Hay hoy</th>` : ""}</tr></thead>
          <tbody>${(r.items || []).map((it) => { const p = A.bySap.get(Number(it.sap));
            return `<tr><td class="mono">${esc(it.sap)}</td><td>${esc(it.descripcion_es)}</td><td class="r"><b>${fmt(it.cantidad)}</b></td>${SHOW ? `<td class="r">${p ? fmt(p.existencia) : "—"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
          <div class="bar" style="margin-top:8px"><button type="button" class="btn btn-navy btn-sm" id="rEdit">Modificar pedido</button>
            ${wa ? `<a class="btn btn-ok btn-sm" id="rWa" href="${esc(wa)}" target="_blank" rel="noopener">Enviar al cliente por WhatsApp</a>` : `<span class="small">El cliente no dejó un teléfono válido para WhatsApp.</span>`}</div>
          ${wa ? `<p class="small" style="margin:6px 0 0">Descargue el PDF actualizado y adjúntelo en el chat del cliente.</p>` : ""}
        </div>
        <div style="display:grid;gap:8px">
          <div><span class="small">Estado:</span> <span class="pill ${esc(r.estado)}" id="rPill">${esc(EST[r.estado] || r.estado)}</span>
            ${r.estado_fecha ? `<span class="small"> · ${esc(fmtDT(r.estado_fecha))}${r.actualizado_por ? " · por " + esc(r.actualizado_por) : ""}</span>` : ""}${r.nota_estado ? `<div class="small" style="margin-top:4px">Nota: ${esc(r.nota_estado)}</div>` : ""}</div>
          <div class="status-actions">
            ${r.estado !== "cotizando" ? `<button type="button" class="btn btn-ghost btn-sm" data-st="cotizando">En cotización</button>` : ""}
            ${r.estado !== "concretada" ? `<button type="button" class="btn btn-ok btn-sm" data-st="concretada">✓ Venta concretada</button>` : ""}
            ${r.estado !== "cancelada" ? `<button type="button" class="btn btn-danger btn-sm" data-st="cancelada">Cancelar solicitud</button>` : ""}
            ${r.estado !== "nueva" ? `<button type="button" class="btn btn-ghost btn-sm" data-st="nueva">Volver a nueva</button>` : ""}
          </div>
          <div id="rForm"></div>
        </div>
        <div class="alert" id="rErr" hidden></div>
      </div>
      <div class="mf"><button type="button" class="btn btn-ghost" id="rPdf">Descargar PDF</button><button type="button" class="btn btn-ghost" id="rXls">Descargar Excel</button><button type="button" class="btn btn-primary" data-close>Listo</button></div>`);
    const MOTIVOS = ["Sin existencia", "Precio", "El cliente no respondió", "Compró en otro lugar", "Solicitud duplicada", "Otro"];
    $("modal").querySelectorAll("[data-st]").forEach((btn) => btn.addEventListener("click", () => {
      const st = btn.dataset.st;
      const quick = st === "cotizando" || st === "nueva";
      $("rForm").innerHTML = `<div class="status-form">
        ${st === "cancelada" ? `<div class="field"><label for="rMot">Motivo de la cancelación</label><select id="rMot">${MOTIVOS.map((m) => `<option>${m}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="rNota">${st === "concretada" ? "N.º de factura o pedido SAP (opcional)" : st === "cancelada" ? "Comentario (opcional)" : "Nota (opcional)"}</label><input id="rNota" maxlength="200"></div>
        <div class="bar"><button type="button" class="btn ${st === "concretada" ? "btn-ok" : st === "cancelada" ? "btn-danger" : "btn-navy"} btn-sm" id="rOk">${st === "concretada" ? "Confirmar venta concretada" : st === "cancelada" ? "Confirmar cancelación" : "Guardar: " + EST[st]}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="rNo">Cancelar</button></div></div>`;
      $("rNo").onclick = () => ($("rForm").innerHTML = "");
      $("rOk").onclick = async () => {
        const nota = [st === "cancelada" ? $("rMot").value : "", $("rNota").value.trim()].filter(Boolean).join(" · ");
        try {
          await store.setRequestStatus(r.id, st, nota, A.session.nombre);
          Object.assign(r, { estado: st, nota_estado: nota, estado_fecha: new Date().toISOString(), actualizado_por: A.session.nombre });
          freshIds.delete(String(r.id)); renderSol(); updateTitle(); renderVendors(); closeModal();
          toast(`Solicitud ${r.folio}: ${EST[st]}`);
        } catch (err) { $("rErr").textContent = err.message; $("rErr").hidden = false; }
      };
      if (quick) $("rNota").focus();
    }));
    const dl = async (kind) => {
      try { const q = reqForExport(r); const blob = kind === "pdf" ? await X.buildPdf(q) : await X.buildXlsx(q); X.saveBlob(blob, `COLEX_${r.folio}.${kind}`); }
      catch (err) { $("rErr").textContent = err.message; $("rErr").hidden = false; }
    };
    $("rPdf").onclick = () => dl("pdf"); $("rXls").onclick = () => dl("xlsx");
    $("rEdit").onclick = () => editItems(r);
    if ($("rVend")) $("rVend").onchange = async () => {
      const v = (A.vendors || []).find((x) => x.slug === $("rVend").value);
      const snap = v ? { slug: v.slug, nombre: v.nombre, whatsapp: v.whatsapp || "", correo: v.correo || "" } : null;
      try { await store.assignRequestVendor(r.id, snap); r.vendedor = snap; renderSol(); renderVendors(); toast(`${r.folio}: ${v ? "asignada a " + v.nombre : "sin vendedor"}`); }
      catch (err) { $("rErr").textContent = err.message; $("rErr").hidden = false; }
    };
  }
  /* El vendedor ajusta el pedido (cantidades, quitar o agregar productos) para devolverlo al cliente */
  function editItems(r) {
    let items = (r.items || []).map((it) => Object.assign({}, it));
    const draw = () => {
      $("rItems").innerHTML = `<div class="status-form">
        <b>Modificar pedido</b>
        <div class="table-wrap"><table class="t"><thead><tr><th>Código SAP</th><th>Descripción</th><th class="r">Cantidad</th><th></th></tr></thead>
          <tbody>${items.map((it, i) => `<tr data-i="${i}"><td class="mono">${esc(it.sap)}</td><td>${esc(it.descripcion_es)}</td>
            <td class="r"><input type="number" min="0.001" step="any" inputmode="decimal" value="${esc(it.cantidad)}" data-q="${i}" aria-label="Cantidad ${esc(it.sap)}" style="width:90px;min-height:34px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:0 6px"></td>
            <td><button type="button" class="btn btn-danger btn-sm" data-rm="${i}">Quitar</button></td></tr>`).join("") || `<tr><td colspan="4" class="c small" style="padding:16px">El pedido quedó vacío. Agregue al menos un producto.</td></tr>`}</tbody></table></div>
        <div class="field" style="position:relative"><label for="rAdd">Agregar producto (código SAP o descripción)</label><input id="rAdd" autocomplete="off" placeholder="Ej.: 1000000575 o capacitor 45">
          <div id="rAddList" class="box" style="position:absolute;left:0;right:0;top:100%;z-index:5;max-height:240px;overflow:auto" hidden></div></div>
        <div class="bar"><button type="button" class="btn btn-primary btn-sm" id="rSaveItems">Guardar pedido modificado</button><button type="button" class="btn btn-ghost btn-sm" id="rCancelItems">Cancelar</button></div>
      </div>`;
      $("rItems").querySelectorAll("[data-q]").forEach((inp) => (inp.oninput = () => (items[Number(inp.dataset.q)].cantidad = Number(inp.value))));
      $("rItems").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { items.splice(Number(b.dataset.rm), 1); draw(); }));
      $("rCancelItems").onclick = () => openRequest(r);
      let tq;
      $("rAdd").oninput = () => { clearTimeout(tq); tq = setTimeout(() => {
        const q = $("rAdd").value.trim(), box = $("rAddList");
        if (q.length < 2) { box.hidden = true; return; }
        const toks = norm(q).split(/\s+/).filter(Boolean);
        const found = A.data.productos.filter((p) => p.activo && toks.every((t) => norm(`${p.sap} ${p.descripcion_es} ${p.descripcion_en}`).includes(t))).slice(0, 8);
        box.innerHTML = found.map((p) => `<button type="button" class="btn btn-ghost btn-sm" data-add="${p.sap}" style="display:flex;width:100%;justify-content:flex-start;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left"><span class="mono">${p.sap}</span>&nbsp; ${esc(p.descripcion_es)}</button>`).join("")
          || `<div class="small" style="padding:10px">No se encontró ese producto.</div>`;
        box.hidden = false;
        box.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
          const p = A.bySap.get(Number(b.dataset.add)); const ex = items.find((x) => Number(x.sap) === p.sap);
          if (ex) ex.cantidad = Number(ex.cantidad || 0) + 1;
          else items.push({ sap: p.sap, cantidad: 1, descripcion_es: p.descripcion_es, descripcion_en: p.descripcion_en, unidad: p.unidad });
          draw(); toast(`Agregado: ${p.sap}`);
        }));
      }, 120); };
      $("rSaveItems").onclick = async () => {
        if (!items.length) { $("rErr").textContent = "El pedido no puede quedar vacío. Si el cliente ya no quiere nada, use «Cancelar solicitud»."; $("rErr").hidden = false; return; }
        if (items.some((it) => !(Number(it.cantidad) > 0))) { $("rErr").textContent = "Revise las cantidades: todas deben ser mayores que cero."; $("rErr").hidden = false; return; }
        try {
          const u = await store.updateRequestItems(r.id, items.map((it) => Object.assign({}, it, { cantidad: Number(it.cantidad) })), A.session.nombre);
          Object.assign(r, u || {}); renderSol(); toast(`Pedido ${r.folio} modificado`); openRequest(r);
        } catch (err) { $("rErr").textContent = err.message; $("rErr").hidden = false; }
      };
    };
    $("rErr").hidden = true; draw(); $("rEdit") && ($("rEdit").hidden = true);
  }

  /* ================= IMPORTAR EXCEL ================= */
  const CODE_RX = /c[oó]d|sap|art[ií]culo|material|item|n[uú]mero/i;
  // Incluye los nombres de columna de la transacción MB52 de SAP ("Libre utilización", "Almacén", "Centro")
  const STOCK_RX = /libre\s*utiliz|utilizaci[oó]n\s*libre|unrestricted|exist|stock|dispon|en almac|on hand|qty|cantidad|inventario/i;
  const WH_RX = /almac[eé]n|whs|bodega|warehouse|dep[oó]sito|storage loc|centro|plant/i;
  let IMP = null;
  function parseNum(v, dec) {
    if (typeof v === "number") return v;
    let t = String(v == null ? "" : v).trim().replace(/\s/g, ""); if (!t) return NaN;
    t = dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    return Number(t);
  }
  // Detecta si la columna usa coma decimal (SAP en español: "1.250,000") o punto ("1,250.000")
  function detectDecimal(rows, col) {
    const v = rows.map((r) => r[col]).filter((x) => typeof x === "string" && /[.,]/.test(x)).map((x) => x.trim());
    if (v.some((x) => /,\d{1,2}$|,\d{4,}$|\.\d{3},/.test(x))) return ",";
    if (v.some((x) => /\.\d{1,2}$|\.\d{4,}$|,\d{3}\./.test(x))) return ".";
    if (v.some((x) => x.includes(",")) && !v.some((x) => x.includes("."))) return ",";
    return ".";
  }
  function parseCode(v) { const d = String(v == null ? "" : v).replace(/\.0+$/, "").replace(/\D/g, ""); return d.length >= 3 ? Number(d) : null; }
  async function readFile(file) {
    await X.loadScript(X.base + "vendor/xlsx.full.min.js");
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    let hr = 0;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i].map(String);
      if (r.some((c) => CODE_RX.test(c)) && r.some((c) => STOCK_RX.test(c))) { hr = i; break; }
    }
    const headers = rows[hr].map((h, i) => String(h).trim() || `Columna ${i + 1}`);
    const pick = (rx, avoid) => headers.findIndex((h, i) => rx.test(h) && i !== avoid);
    const ci = Math.max(0, pick(CODE_RX)), si = pick(STOCK_RX, ci);
    const data = rows.slice(hr + 1).filter((r) => r.some((c) => String(c).trim() !== ""));
    const colVals = (i) => [...new Set(data.map((r) => String(r[i]).trim().replace(/\.0+$/, "")).filter(Boolean))];
    // Columna de almacén/centro: se prefiere la que contiene el valor 1060
    const whCols = headers.map((h, i) => i).filter((i) => WH_RX.test(headers[i]) && i !== ci && i !== si);
    const wi = whCols.find((i) => colVals(i).includes("1060")) ?? (whCols.length ? whCols[0] : -1);
    IMP = { name: file.name, rows: data, headers, ci, si: si < 0 ? Math.min(1, headers.length - 1) : si, wi, wv: "" };
    if (wi >= 0) { const vals = colVals(wi); IMP.whVals = vals; IMP.wv = vals.includes("1060") ? "1060" : ""; }
    IMP.dec = detectDecimal(IMP.rows, IMP.si);
    renderMap(); computeImport();
  }
  function renderMap() {
    const opt = (sel) => IMP.headers.map((h, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(h)}</option>`).join("");
    $("impMap").hidden = false;
    $("impMap").innerHTML = `<div class="field"><label for="impCode">Columna del código SAP</label><select id="impCode">${opt(IMP.ci)}</select></div>
      <div class="field"><label for="impStock">Columna de la existencia</label><select id="impStock">${opt(IMP.si)}</select></div>
      ${IMP.wi >= 0 ? `<div class="field"><label for="impWh">Filtrar por ${esc(IMP.headers[IMP.wi])}</label><select id="impWh"><option value="">Todos</option>${IMP.whVals.map((v) => `<option${v === IMP.wv ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="impDec">Decimales en el archivo</label><select id="impDec"><option value=","${IMP.dec === "," ? " selected" : ""}>Coma: 1.250,5</option><option value="."${IMP.dec === "." ? " selected" : ""}>Punto: 1,250.5</option></select></div>
      <span class="small">Archivo: ${esc(IMP.name)} · ${fmt(IMP.rows.length)} filas</span>`;
    $("impCode").onchange = (e) => { IMP.ci = +e.target.value; computeImport(); };
    $("impStock").onchange = (e) => { IMP.si = +e.target.value; IMP.dec = detectDecimal(IMP.rows, IMP.si); renderMap(); computeImport(); };
    $("impDec").onchange = (e) => { IMP.dec = e.target.value; computeImport(); };
    if ($("impWh")) $("impWh").onchange = (e) => { IMP.wv = e.target.value; computeImport(); };
  }
  function computeImport() {
    const file = new Map(); let bad = 0, dup = 0;
    for (const r of IMP.rows) {
      if (IMP.wi >= 0 && IMP.wv && String(r[IMP.wi]).trim().replace(/\.0+$/, "") !== IMP.wv) continue;
      const code = parseCode(r[IMP.ci]); if (!code) continue;
      const n = parseNum(r[IMP.si], IMP.dec); if (!Number.isFinite(n)) { bad++; continue; }
      if (file.has(code)) { dup++; file.set(code, file.get(code) + n); } else file.set(code, n);
    }
    const changes = [], same = [], unknown = [];
    for (const [sap, n] of file) {
      const p = A.bySap.get(sap);
      if (!p) { unknown.push(sap); continue; }
      const v = Math.max(0, store.round3(n));
      (v === p.existencia ? same : changes).push({ p, nuevo: v });
    }
    const missing = A.data.productos.filter((p) => !file.has(p.sap) && p.existencia > 0);
    IMP.calc = { changes, same, unknown, missing, bad, dup };
    $("impResult").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Con cambios</span><b>${fmt(changes.length)}</b></div>
        <div class="kpi"><span>Sin cambios</span><b>${fmt(same.length)}</b></div>
        <div class="kpi ${unknown.length ? "warn" : ""}"><span>Códigos que no están en el catálogo</span><b>${fmt(unknown.length)}</b></div>
        <div class="kpi"><span>Productos con existencia que no vienen en el archivo</span><b>${fmt(missing.length)}</b></div>
      </div>
      ${dup ? `<div class="alert info">Hay ${fmt(dup)} códigos repetidos en el archivo; sus cantidades se sumaron.${IMP.wi >= 0 && !IMP.wv ? " Revise si debe elegir el almacén 1060." : ""}</div>` : ""}
      ${bad ? `<div class="alert info">${fmt(bad)} filas tienen una existencia que no es un número y se ignoraron.</div>` : ""}
      ${unknown.length ? `<details><summary class="small">Ver códigos que no están en el catálogo (se ignoran)</summary><p class="small mono">${unknown.slice(0, 300).join(", ")}${unknown.length > 300 ? "…" : ""}</p></details>` : ""}
      ${changes.length ? `<div class="table-wrap" style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="t"><thead><tr><th>Código SAP</th><th>Descripción</th><th class="r">Hay</th><th class="r">Nuevo</th><th class="r">Diferencia</th></tr></thead><tbody>
        ${changes.slice(0, 500).map(({ p, nuevo }) => { const d = store.round3(nuevo - p.existencia);
          return `<tr><td class="mono">${p.sap}</td><td>${esc(p.descripcion_es)}</td><td class="r">${fmt(p.existencia)}</td><td class="r"><b>${fmt(nuevo)}</b></td><td class="r ${d > 0 ? "diff-up" : "diff-down"}">${d > 0 ? "+" : ""}${fmt(d)}</td></tr>`; }).join("")}
        </tbody></table></div>` : ""}
      <label class="toggle"><input type="checkbox" id="impZero"> Poner en 0 los ${fmt(missing.length)} productos con existencia que no vienen en el archivo</label>
      <label class="toggle"><input type="checkbox" id="impDate" checked> Cambiar la fecha de existencias del catálogo a hoy</label>
      <div class="field"><label for="impNote">Nota</label><input id="impNote" maxlength="200" value="Importación ${esc(IMP.name)}"></div>
      <div class="bar"><button type="button" class="btn btn-primary" id="impApply">Aplicar cambios</button><span class="small" id="impMsg"></span></div>`;
    $("impApply").addEventListener("click", applyImport);
  }
  async function applyImport() {
    const c = IMP.calc, items = c.changes.map(({ p, nuevo }) => ({ sap: p.sap, existencia: nuevo }));
    if ($("impZero").checked) c.missing.forEach((p) => items.push({ sap: p.sap, existencia: 0 }));
    if (!items.length && !$("impDate").checked) { $("impMsg").textContent = "No hay cambios que aplicar."; return; }
    $("impApply").disabled = true; $("impMsg").textContent = "Aplicando…";
    try {
      const n = items.length ? await store.bulkSetStock(items, $("impNote").value.trim()) : 0;
      if ($("impDate").checked) await store.saveConfig({ fecha_existencias: today() });
      await reload();
      $("impResult").innerHTML = `<div class="alert info" style="background:var(--ok-bg);color:var(--ok)">Listo: se actualizaron ${fmt(n)} productos. El catálogo ya muestra las nuevas existencias.</div>`;
      $("impMap").hidden = true; IMP = null; $("impFile").value = "";
    } catch (e) { $("impMsg").textContent = e.message; $("impApply").disabled = false; }
  }
  $("impFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) readFile(f).catch((err) => toast(err.message)); });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f).catch((err) => toast(err.message)); });

  $("tplBtn").addEventListener("click", async () => {
    await X.loadScript(X.base + "vendor/exceljs.min.js");
    const wb = new window.ExcelJS.Workbook(), ws = wb.addWorksheet("Existencias 1060", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [{ header: "Código SAP", key: "sap", width: 16 }, { header: "Descripción", key: "d", width: 56 }, { header: "Categoría", key: "c", width: 24 },
      { header: "UM", key: "u", width: 8 }, { header: "Existencia", key: "e", width: 14 }];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).eachCell((cell, i) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 5 ? "FFF28C28" : "FF123C65" } }));
    A.data.productos.forEach((p) => ws.addRow({ sap: p.sap, d: p.descripcion_es, c: catName(p.categoria), u: p.unidad, e: p.existencia }));
    ws.getColumn(1).numFmt = "0"; ws.autoFilter = "A1:E1";
    X.saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `Existencias_COLEX_1060_${today()}.xlsx`);
  });
  $("seedBtn").addEventListener("click", async () => {
    $("seedBtn").disabled = true;
    try {
      const seed = await store.loadSeed();
      await store.seedCatalog(seed, (n, t) => ($("seedMsg").textContent = `Cargando ${fmt(n)} de ${fmt(t)}…`));
      $("seedMsg").textContent = "Catálogo cargado."; $("seedBox").hidden = true; await reload();
    } catch (e) { $("seedMsg").textContent = e.message; $("seedBtn").disabled = false; }
  });

  /* ================= VENDEDORES ================= */
  function vendorLink(v) { return new URL("./", location.href).href + "?v=" + encodeURIComponent(v.slug); }
  function renderVendors() {
    const vs = A.vendors || [];
    const count = (slug) => { const rs = A.reqs.filter((r) => r.vendedor && r.vendedor.slug === slug); const c = rs.filter((r) => r.estado === "concretada").length; return rs.length ? `${rs.length} · <span style="color:var(--ok)">${c} ✓</span>` : "0"; };
    $("vBody").innerHTML = vs.map((v) => `<tr data-slug="${esc(v.slug)}">
      <td><b>${esc(v.nombre)}</b>${v.activo ? "" : ` <span class="pill inactivo">Inactivo</span>`}</td>
      <td>${esc(v.whatsapp) || `<span class="small">—</span>`}</td><td class="hide-sm small">${esc(v.correo)}</td>
      <td class="small mono" style="word-break:break-all">?v=${esc(v.slug)}</td>
      <td class="r">${count(v.slug)}</td>
      <td><div class="acts"><button type="button" class="btn btn-ghost btn-sm" data-act="copy">Copiar enlace</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Editar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${v.activo ? "Desactivar" : "Activar"}</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="del">Eliminar</button></div></td></tr>`).join("")
      || `<tr><td colspan="6" class="c small" style="padding:20px">Todavía no hay vendedores. Agregue el primero arriba.</td></tr>`;
    const cur = $("solVend").value;
    $("solVend").innerHTML = `<option value="">Todos los vendedores</option><option value="-">General (sin vendedor)</option>` +
      vs.map((v) => `<option value="${esc(v.slug)}">${esc(v.nombre)}</option>`).join("");
    $("solVend").value = cur;
  }
  /* Guarda un vendedor, o pide autorización si el rol lo exige. Devuelve true si se aplicó. */
  async function vendorChange(tipo, v, descripcion) {
    if (can("vendors") === "ask") { await requestApproval(tipo, descripcion, v); return false; }
    await applyVendorChange(tipo, v); return true;
  }
  async function applyVendorChange(tipo, v) {
    if (tipo === "vendor_delete") { await store.deleteVendor(v.slug); A.vendors = (A.vendors || []).filter((x) => x.slug !== v.slug); }
    else {
      const n = await store.saveVendor(v);
      const i = (A.vendors || []).findIndex((x) => x.slug === n.slug);
      if (i >= 0) A.vendors[i] = n; else A.vendors = (A.vendors || []).concat(n);
      A.vendors.sort((x, y) => x.nombre.localeCompare(y.nombre));
    }
    renderVendors();
  }
  $("vForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("vNom").value.trim(); $("vErr").hidden = true;
    if (nombre.length < 3) { $("vErr").textContent = "Escriba el nombre del vendedor."; $("vErr").hidden = false; return; }
    let slug = store.slugify(nombre), i = 2; const base = slug;
    while ((A.vendors || []).some((x) => x.slug === slug)) slug = `${base}-${i++}`;
    try {
      const v = { slug, nombre, whatsapp: $("vWaIn").value.trim(), correo: $("vMail").value.trim(), activo: true };
      const done = await vendorChange("vendor_save", v, `Agregar vendedor: ${nombre}`);
      $("vForm").reset(); if (done) toast(`Vendedor agregado: ${nombre}`);
    } catch (err) { $("vErr").textContent = err.message; $("vErr").hidden = false; }
  });
  function openVendor(v) {
    openModal(`${head("Editar vendedor")}
      <div class="mb">
        <div class="field"><label for="veNom">Nombre</label><input id="veNom" maxlength="60" value="${esc(v.nombre)}"></div>
        <div class="field"><label for="veWa">WhatsApp</label><input id="veWa" maxlength="30" value="${esc(v.whatsapp)}" placeholder="+507 6000-0000"></div>
        <div class="field"><label for="veMail">Correo</label><input id="veMail" type="email" maxlength="120" value="${esc(v.correo)}"></div>
        <label class="check"><input type="checkbox" id="veAct"${v.activo ? " checked" : ""}> Activo (aparece en la página de vendedores)</label>
        <p class="small" style="margin:0">Su enlace no cambia: <span class="mono">?v=${esc(v.slug)}</span>. Los QR que ya repartió siguen funcionando.</p>
        ${can("vendors") === "ask" ? `<p class="small" style="margin:0">El cambio se enviará a ${esc(OWNER_NAME())} para su autorización.</p>` : ""}
        <div class="alert" id="veErr" hidden></div>
      </div>
      <div class="mf"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="button" class="btn btn-primary" id="veSave">${can("vendors") === "ask" ? "Pedir el cambio" : "Guardar"}</button></div>`);
    $("veSave").onclick = async () => {
      const nombre = $("veNom").value.trim();
      if (nombre.length < 3) { $("veErr").textContent = "Escriba el nombre del vendedor."; $("veErr").hidden = false; return; }
      const n = Object.assign({}, v, { nombre, whatsapp: $("veWa").value.trim(), correo: $("veMail").value.trim(), activo: $("veAct").checked });
      try { const done = await vendorChange("vendor_save", n, `Editar vendedor: ${v.nombre}${nombre !== v.nombre ? " → " + nombre : ""}`); closeModal(); if (done) toast("Vendedor actualizado"); }
      catch (err) { $("veErr").textContent = err.message; $("veErr").hidden = false; }
    };
  }
  $("vBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const v = (A.vendors || []).find((x) => x.slug === b.closest("tr").dataset.slug); if (!v) return;
    try {
      if (b.dataset.act === "copy") {
        const link = vendorLink(v), done = () => toast("Enlace copiado: " + link);
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, done); else done();
      } else if (b.dataset.act === "edit") openVendor(v);
      else if (b.dataset.act === "toggle") {
        await vendorChange("vendor_save", Object.assign({}, v, { activo: !v.activo }), `${v.activo ? "Desactivar" : "Activar"} vendedor: ${v.nombre}`);
      } else if (b.dataset.act === "del") {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro? Pulse otra vez"; return; }
        if (await vendorChange("vendor_delete", { slug: v.slug, nombre: v.nombre }, `Eliminar vendedor: ${v.nombre}`)) toast("Vendedor eliminado");
        else renderVendors();
      }
    } catch (err) { $("vErr").textContent = err.message; $("vErr").hidden = false; }
  });

  /* ================= AUTORIZACIONES ================= */
  const APR_EST = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };
  function renderApprovals() {
    const all = A.approvals || [], owner = A.session.rol === "dueno";
    const list = owner ? all : all.filter((a) => a.solicitado_por === A.session.nombre);
    const pend = all.filter((a) => a.estado === "pendiente").length;
    $("aprCount").hidden = !(owner && pend); $("aprCount").textContent = pend;
    $("aprBody").innerHTML = list.map((a) => `<tr data-id="${esc(a.id)}">
      <td class="small" style="white-space:nowrap">${esc(fmtDT(a.fecha))}</td><td>${esc(a.solicitado_por)}</td>
      <td>${esc(a.descripcion)}</td>
      <td><span class="pill ${a.estado === "aprobada" ? "concretada" : a.estado === "rechazada" ? "cancelada" : "nueva"}">${APR_EST[a.estado] || esc(a.estado)}</span>
        ${a.resuelto_por ? `<div class="status-note">por ${esc(a.resuelto_por)}</div>` : ""}</td>
      <td>${owner && a.estado === "pendiente" ? `<div class="acts"><button type="button" class="btn btn-ok btn-sm" data-ap="aprobada">Aprobar</button><button type="button" class="btn btn-danger btn-sm" data-ap="rechazada">Rechazar</button></div>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="5" class="c small" style="padding:30px">${owner ? "No hay pedidos de autorización." : "Usted no ha pedido cambios."}</td></tr>`;
  }
  async function executeApproval(a) {
    const d = a.datos || {};
    if (a.tipo === "vendor_save" || a.tipo === "vendor_delete") {
      if (a.tipo === "vendor_save" && !(A.vendors || []).some((x) => x.slug === d.slug)) {   // alta: evitar choque de enlace
        let slug = d.slug, i = 2; while ((A.vendors || []).some((x) => x.slug === slug)) slug = `${d.slug}-${i++}`; d.slug = slug;
      }
      await applyVendorChange(a.tipo, d);
    } else if (a.tipo === "product_delete") {
      await store.deleteProduct(d.sap); if (d.imagen) await store.removeImage(d.imagen).catch(() => {});
    } else if (a.tipo === "config_save") {
      await store.saveConfig(d);
    } else throw new Error("Tipo de cambio desconocido: " + a.tipo);
  }
  $("aprBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ap]"); if (!b) return;
    const a = (A.approvals || []).find((x) => String(x.id) === b.closest("tr").dataset.id); if (!a) return;
    b.disabled = true;
    try {
      if (b.dataset.ap === "aprobada") await executeApproval(a);
      await store.resolveApproval(a.id, b.dataset.ap, A.session.nombre);
      toast(b.dataset.ap === "aprobada" ? "Aprobado y aplicado" : "Rechazado");
      await reload();
    } catch (err) { b.disabled = false; toast(err.message); }
  });

  /* ================= EQUIPO (solo el dueño) ================= */
  function renderTeam() {
    if (can("team") !== "yes") return;
    $("tBody").innerHTML = (A.team || []).map((m) => {
      const own = m.rol === "dueno";
      return `<tr data-id="${esc(m.id)}"><td><b>${esc(m.nombre)}</b></td>
        <td>${own ? esc(store.ROLES.dueno) : `<select data-t="rol" aria-label="Rol de ${esc(m.nombre)}"><option value="admin"${m.rol === "admin" ? " selected" : ""}>Administrador</option><option value="subadmin"${m.rol === "subadmin" ? " selected" : ""}>Subadministrador</option></select>`}</td>
        <td class="hide-sm small">${esc(m.email)}</td>
        <td>${m.activo !== false ? `<span class="pill concretada">Activo</span>` : `<span class="pill inactivo">Sin acceso</span>`}</td>
        <td>${own ? `<span class="small">Entra con contraseña</span>` : `<div class="acts"><button type="button" class="btn btn-ghost btn-sm" data-t="toggle">${m.activo !== false ? "Quitar acceso" : "Dar acceso"}</button><button type="button" class="btn btn-danger btn-sm" data-t="del">Eliminar</button></div>`}</td></tr>`;
    }).join("");
  }
  $("tForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("tErr").hidden = true;
    const nombre = $("tNom").value.trim();
    try {
      if (nombre.length < 3) throw new Error("Escriba el nombre de la persona.");
      if ((A.team || []).some((m) => store.slugify(m.nombre) === store.slugify(nombre))) throw new Error("Esa persona ya está en el equipo.");
      await store.saveTeamMember({ nombre, rol: $("tRol").value, email: $("tMail").value.trim(), activo: true });
      A.team = await store.listTeam(); $("tForm").reset(); renderTeam(); toast(`${nombre} agregado al equipo`);
    } catch (err) { $("tErr").textContent = err.message; $("tErr").hidden = false; }
  });
  $("tBody").addEventListener("change", async (e) => {
    const sel = e.target.closest('[data-t="rol"]'); if (!sel) return;
    const m = (A.team || []).find((x) => x.id === sel.closest("tr").dataset.id); if (!m) return;
    try { await store.saveTeamMember(Object.assign({}, m, { rol: sel.value })); A.team = await store.listTeam(); renderTeam(); toast(`${m.nombre}: ${store.ROLES[sel.value]}`); }
    catch (err) { $("tErr").textContent = err.message; $("tErr").hidden = false; }
  });
  $("tBody").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-t]"); if (!b) return;
    const m = (A.team || []).find((x) => x.id === b.closest("tr").dataset.id); if (!m) return;
    try {
      if (b.dataset.t === "toggle") await store.saveTeamMember(Object.assign({}, m, { activo: m.activo === false }));
      else {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro? Pulse otra vez"; return; }
        await store.deleteTeamMember(m.id);
      }
      A.team = await store.listTeam(); renderTeam();
    } catch (err) { $("tErr").textContent = err.message; $("tErr").hidden = false; }
  });

  /* ================= CATÁLOGO NUEVO (Excel con fotos) ================= */
  const H_CODE = /referencia|reference|c[oó]digo|code|sap|material|art[ií]culo/i;
  const H_DESC = /producto|product|descripci|description|texto breve/i;
  const H_STOCK = /disponible|available|existencia|stock|cantidad|qty/i;
  const H_SUB = /subrubro|subcategor|rubro|familia|subgrupo/i;
  let CAT = null;
  const cellText = (v) => {
    if (v == null) return "";
    if (typeof v === "object") { if (v.richText) return v.richText.map((x) => x.text).join(""); if (v.text != null) return String(v.text); if (v.result != null) return String(v.result); }
    return String(v);
  };
  function titleCase(t) { return String(t).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()); }
  async function readCatalog(file) {
    $("catResult").innerHTML = `<p class="small">Leyendo ${esc(file.name)}…</p>`;
    await X.loadScript(X.base + "vendor/xlsx.full.min.js");
    const buf = await file.arrayBuffer();
    const book = window.XLSX.read(buf, { type: "array" });
    const pics = await window.ColexXlsxImages.imagesBySheet(buf);
    const sheets = [];
    for (const title of book.SheetNames) {
      const ws = book.Sheets[title]; if (!ws || !ws["!ref"]) continue;
      const r0 = window.XLSX.utils.decode_range(ws["!ref"]).s.r;          // fila donde empieza la hoja
      const data = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      let hr = -1, cols = null;
      for (let i = 0; i < Math.min(15, data.length); i++) {
        const vals = data[i].map((v) => String(v).trim());
        const find = (rx) => vals.findIndex((v) => v && rx.test(v));
        const ci = find(H_CODE), di = find(H_DESC);
        if (ci >= 0 && di >= 0 && ci !== di) { hr = i; cols = { code: ci, desc: di, stock: find(H_STOCK), sub: find(H_SUB), en: vals.some((v) => /^(reference|product|available)$/i.test(v)) }; break; }
      }
      if (!cols) continue;
      const imgs = pics.get(title) || new Map();
      const rows = [];
      for (let i = hr + 1; i < data.length; i++) {
        const row = data[i], g = (c) => (c >= 0 ? String(row[c] == null ? "" : row[c]).trim() : "");
        const desc = g(cols.desc), code = parseCode(row[cols.code]);
        if (!desc && !code) continue;
        const st = cols.stock >= 0 ? parseNum(row[cols.stock], ",") : 0;
        rows.push({ sap: code, desc, sub: g(cols.sub), stock: Number.isFinite(st) && st > 0 ? store.round3(st) : 0, img: imgs.get(r0 + i + 1) || null });
      }
      const match = A.data.categorias.find((c) => [c.es, c.en, c.clave].some((n) => n && store.slugify(n) === store.slugify(title)));
      sheets.push({ title, rows, lang: cols.en ? "en" : "es", cat: match ? match.clave : "__new", newEs: titleCase(title), newEn: "", update: false });
    }
    if (!sheets.length) { $("catResult").innerHTML = `<div class="alert">No encontré hojas con columnas de <b>Referencia</b> (código) y <b>Producto</b> (descripción).</div>`; return; }
    CAT = { sheets, name: file.name, urls: new Map() };
    renderCatalogImport();
  }
  function imgUrlFor(img) {
    if (!img) return null;
    if (!CAT.urls.has(img)) CAT.urls.set(img, URL.createObjectURL(new Blob([img.data], { type: img.mime })));
    return CAT.urls.get(img);
  }
  function renderCatalogImport() {
    const catOpts = (sel) => A.data.categorias.map((c) => `<option value="${esc(c.clave)}"${sel === c.clave ? " selected" : ""}>${esc(c.es)}</option>`).join("") +
      `<option value="__new"${sel === "__new" ? " selected" : ""}>+ Nueva categoría…</option>`;
    let totalNew = 0, totalUpd = 0;
    const html = CAT.sheets.map((sh, si) => {
      const nuevos = sh.rows.filter((r) => r.sap && !A.bySap.has(r.sap)).length;
      const existen = sh.rows.filter((r) => r.sap && A.bySap.has(r.sap)).length;
      const sinCod = sh.rows.filter((r) => !r.sap).length, fotos = sh.rows.filter((r) => r.img).length;
      totalNew += nuevos; if (sh.update) totalUpd += existen;
      return `<div class="box" style="box-shadow:none;border:1px solid var(--line)" data-si="${si}">
        <div class="box-head"><h2>Hoja: ${esc(sh.title)}</h2><span class="small">${fmt(sh.rows.length)} filas · ${fmt(fotos)} con foto</span></div>
        <div class="box-body">
          <div class="bar" style="align-items:flex-end">
            <div class="field"><label>Categoría en el catálogo</label><select data-k="cat">${catOpts(sh.cat)}</select></div>
            ${sh.cat === "__new" ? `<div class="field"><label>Nombre (español)</label><input data-k="newEs" value="${esc(sh.newEs)}" maxlength="60"></div>
              <div class="field"><label>Nombre (inglés)</label><input data-k="newEn" value="${esc(sh.newEn)}" maxlength="60" placeholder="Ej.: Refrigerant Gases"></div>` : ""}
            <div class="field"><label>Las descripciones están en</label><select data-k="lang"><option value="es"${sh.lang === "es" ? " selected" : ""}>Español</option><option value="en"${sh.lang === "en" ? " selected" : ""}>Inglés</option></select></div>
          </div>
          <div class="kpis">
            <div class="kpi"><span>Productos nuevos</span><b>${fmt(nuevos)}</b></div>
            <div class="kpi ${existen ? "warn" : ""}"><span>Ya están en el catálogo</span><b>${fmt(existen)}</b></div>
            <div class="kpi ${sinCod ? "warn" : ""}"><span>Sin código SAP (se omiten)</span><b>${fmt(sinCod)}</b></div>
          </div>
          ${existen ? `<label class="toggle"><input type="checkbox" data-k="update"${sh.update ? " checked" : ""}> ${existen === 1 ? "Actualizar también el que ya existe" : `Actualizar también los ${fmt(existen)} que ya existen`} (descripción, subcategoría, existencia y foto)</label>` : ""}
          <div class="table-wrap" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="t">
            <thead><tr><th></th><th>Código SAP</th><th>Descripción</th><th>Subcategoría</th><th class="r">Disponible</th><th>Estado</th></tr></thead>
            <tbody>${sh.rows.slice(0, 300).map((r) => {
              const u = imgUrlFor(r.img), st = !r.sap ? ["archivada", "Sin código"] : A.bySap.has(r.sap) ? ["venta", "Ya existe"] : ["entrada", "Nuevo"];
              return `<tr><td>${u ? `<img class="thumb" src="${u}" alt="">` : `<span class="thumb empty">Sin foto</span>`}</td><td class="mono">${r.sap || "—"}</td>
                <td>${esc(r.desc)}</td><td class="small">${esc(r.sub)}</td><td class="r">${fmt(r.stock)}</td><td><span class="pill ${st[0]}">${st[1]}</span></td></tr>`;
            }).join("")}</tbody></table></div>
        </div></div>`;
    }).join("");
    $("catResult").innerHTML = html + `<div class="bar"><button type="button" class="btn btn-primary" id="catApply" ${totalNew + totalUpd ? "" : "disabled"}>Agregar ${fmt(totalNew)} productos nuevos${totalUpd ? ` y actualizar ${fmt(totalUpd)}` : ""}</button>
      <button type="button" class="btn btn-ghost" id="catCancel">Cancelar</button><span class="small" id="catMsg"></span></div>`;
    $("catResult").querySelectorAll("[data-si]").forEach((box) => {
      const sh = CAT.sheets[+box.dataset.si];
      box.querySelectorAll("[data-k]").forEach((el) => el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", () => {
        const k = el.dataset.k; sh[k] = el.type === "checkbox" ? el.checked : el.value;
        if (k !== "newEs" && k !== "newEn") renderCatalogImport();
      }));
    });
    $("catApply").addEventListener("click", applyCatalogImport);
    $("catCancel").addEventListener("click", () => { CAT = null; $("catResult").innerHTML = ""; $("catFile").value = ""; });
  }
  async function applyCatalogImport() {
    const msg = (t) => ($("catMsg").textContent = t);
    for (const sh of CAT.sheets) if (sh.cat === "__new" && !sh.newEs.trim()) { msg(`Escriba el nombre de la categoría nueva para la hoja ${sh.title}.`); return; }
    $("catApply").disabled = true;
    const subEn = new Map(A.data.productos.map((p) => [p.subcategoria_es, p.subcategoria_en]));
    let orden = A.data.productos.reduce((a, b) => Math.max(a, b.orden || 0), 0);
    const list = [], jobs = [];
    try {
      for (const sh of CAT.sheets) {
        let clave = sh.cat;
        if (clave === "__new") {
          clave = store.slugify(sh.newEs);
          await store.saveCategory({ clave, es: sh.newEs.trim(), en: (sh.newEn || sh.newEs).trim(), orden: 100 + A.data.categorias.length });
        }
        for (const r of sh.rows) {
          if (!r.sap) continue;
          const old = A.bySap.get(r.sap);
          if (old && !sh.update) continue;
          const p = old ? Object.assign({}, old) : { sap: r.sap, unidad: "UN", activo: true, orden: ++orden, imagen: null, descripcion_es: "", descripcion_en: "" };
          p.categoria = clave;
          if (sh.lang === "en") { p.descripcion_en = r.desc; if (!p.descripcion_es) p.descripcion_es = r.desc; }
          else { p.descripcion_es = r.desc; if (!p.descripcion_en || !old) p.descripcion_en = r.desc; }
          if (r.sub) { p.subcategoria_es = r.sub; p.subcategoria_en = subEn.get(r.sub) || r.sub; }
          p.existencia = r.stock;
          list.push(p); if (r.img) jobs.push([p, r.img]);
        }
      }
      for (let i = 0; i < jobs.length; i++) {
        const [p, im] = jobs[i]; msg(`Subiendo fotos ${i + 1} de ${jobs.length}…`);
        const blob = await resizeImage(new Blob([im.data], { type: im.mime }), store.isDemo ? 320 : 900);
        p.imagen = await store.uploadImage(p.sap, blob);
      }
      await store.saveProducts(list, (n, t) => msg(`Guardando productos ${n} de ${t}…`));
      await reload();
      const sinEn = list.filter((p) => p.descripcion_en === p.descripcion_es).length;
      $("catResult").innerHTML = `<div class="alert info" style="background:var(--ok-bg);color:var(--ok)">Listo: se guardaron ${fmt(list.length)} productos (${fmt(jobs.length)} con foto). Ya aparecen en el catálogo.${sinEn ? ` ${fmt(sinEn)} tienen la descripción en inglés igual a la española: en la pestaña <b>${SHOW ? "Inventario" : "Productos"}</b> use el filtro <b>Sin traducción al inglés</b> para corregirlos con <b>Editar</b>.` : ""}</div>`;
      CAT = null; $("catFile").value = "";
    } catch (e) { console.error(e); msg(e.message); $("catApply").disabled = false; }
  }
  $("catFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) readCatalog(f).catch((err) => { console.error(err); $("catResult").innerHTML = `<div class="alert">${esc(err.message)}</div>`; }); });
  const cdrop = $("catDrop");
  ["dragenter", "dragover"].forEach((ev) => cdrop.addEventListener(ev, (e) => { e.preventDefault(); cdrop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => cdrop.addEventListener(ev, (e) => { e.preventDefault(); cdrop.classList.remove("over"); }));
  cdrop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readCatalog(f).catch((err) => toast(err.message)); });

  /* ================= AJUSTES Y QR ================= */
  function fillCfg() {
    const c = A.data.config || {};
    $("cfgFecha").value = c.fecha_existencias ? String(c.fecha_existencias).slice(0, 10) : "";
    $("cfgTel").value = c.telefono || ""; $("cfgWa").value = c.whatsapp || ""; $("cfgMail").value = c.correo || "";
    $("cfgDir").value = c.direccion || ""; $("cfgAvEs").value = c.aviso_es || ""; $("cfgAvEn").value = c.aviso_en || "";
  }
  $("cfgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cfg = { fecha_existencias: $("cfgFecha").value || null, telefono: $("cfgTel").value.trim(), whatsapp: $("cfgWa").value.trim(),
      correo: $("cfgMail").value.trim(), direccion: $("cfgDir").value.trim(), aviso_es: $("cfgAvEs").value.trim(), aviso_en: $("cfgAvEn").value.trim() };
    if (can("config") === "ask") {
      try { await requestApproval("config_save", "Cambiar los datos de contacto y avisos del catálogo", cfg); $("cfgMsg").textContent = `Enviado a ${OWNER_NAME()} para autorización.`; fillCfg(); }
      catch (err) { $("cfgMsg").textContent = err.message; }
      return;
    }
    try { await store.saveConfig(cfg); Object.assign(A.data.config, cfg); $("cfgMsg").textContent = "Ajustes guardados."; toast("Ajustes guardados"); }
    catch (err) { $("cfgMsg").textContent = err.message; }
  });
  function qrMatrix(text) { const q = window.qrcode(0, "M"); q.addData(text, "Byte"); q.make(); return q; }
  function qrSvg(q, scale) {
    const n = q.getModuleCount(), m = 4, size = (n + m * 2) * scale; let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(c + m) * scale} ${(r + m) * scale}h${scale}v${scale}h-${scale}z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#1a1a1a"/></svg>`;
  }
  function initQr() {
    let saved = ""; try { saved = localStorage.getItem("colex_qr_url") || ""; } catch (e) {}
    $("qrUrl").value = saved || new URL("./", location.href).href;
    drawQr();
  }
  function drawQr() {
    try { $("qr").innerHTML = qrSvg(qrMatrix($("qrUrl").value.trim()), 8); }
    catch (e) { $("qr").innerHTML = `<span class="small">Dirección no válida</span>`; }
  }
  $("qrUrl").addEventListener("input", () => { try { localStorage.setItem("colex_qr_url", $("qrUrl").value.trim()); } catch (e) {} drawQr(); });
  $("qrSvg").addEventListener("click", () => X.saveBlob(new Blob([qrSvg(qrMatrix($("qrUrl").value.trim()), 10)], { type: "image/svg+xml" }), "QR_catalogo_COLEX.svg"));
  $("qrPng").addEventListener("click", () => {
    const q = qrMatrix($("qrUrl").value.trim()), n = q.getModuleCount(), m = 4, s = 24, c = document.createElement("canvas");
    c.width = c.height = (n + m * 2) * s; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#1a1a1a";
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + m) * s, (r + m) * s, s, s);
    c.toBlob((b) => X.saveBlob(b, "QR_catalogo_COLEX.png"), "image/png");
  });
  $("resetDemo").addEventListener("click", async () => { await store.resetDemo(); location.reload(); });

  boot();
})();
