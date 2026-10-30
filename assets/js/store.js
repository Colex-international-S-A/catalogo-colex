/*
 * Capa de datos del catálogo COLEX.
 * - Con SUPABASE_URL configurado: usa la base de datos en línea (Supabase).
 * - Sin configurar: MODO DEMOSTRACIÓN (data/productos.json + este navegador).
 * El catálogo público y el panel usan las mismas funciones.
 */
(function () {
  const CFG = window.COLEX_CONFIG || {};
  const DEMO = !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const DEMO_KEY = "colex_demo_v1";
  const PAGE = 1000;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round3 = (n) => Math.round(num(n) * 1000) / 1000;

  function normalizeProduct(p) {
    return {
      sap: Number(p.sap),
      categoria: p.categoria || "",
      subcategoria_es: p.subcategoria_es || "",
      subcategoria_en: p.subcategoria_en || "",
      descripcion_es: p.descripcion_es || "",
      descripcion_en: p.descripcion_en || "",
      unidad: (p.unidad || "UN").toUpperCase(),
      existencia: round3(p.existencia),
      imagen: p.imagen || null,
      activo: p.activo !== false,
      orden: num(p.orden),
      actualizado: p.actualizado || null
    };
  }

  function slugify(t) {
    return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }
  function normalizeVendor(v) {
    return { slug: v.slug || slugify(v.nombre), nombre: String(v.nombre || "").trim(), whatsapp: String(v.whatsapp || "").trim(),
      correo: String(v.correo || "").trim(), activo: v.activo !== false };
  }

  function todayISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function makeFolio(seq) {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `SC-${yy}${mm}${dd}-${String(seq).padStart(4, "0")}`;
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Respaldo en JavaScript puro
    const K = [], H = [];
    const isPrime = (n) => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    for (let n = 2, i = 0; i < 64; n++) if (isPrime(n)) { if (i < 8) H[i] = (Math.pow(n, 1 / 2) * 4294967296) | 0; K[i++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
    const l = bytes.length, words = [];
    const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6); padded.set(bytes); padded[l] = 0x80;
    const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 4, l * 8);
    for (let i = 0; i < padded.length; i += 4) words.push(dv.getUint32(i));
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16); let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        if (i >= 16) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  /* Equipo inicial del panel y vendedores iniciales (se pueden cambiar desde el panel) */
  const DEFAULT_TEAM = [
    { id: "abraham-rios", nombre: "Abraham Ríos", rol: "dueno", email: CFG.ADMIN_EMAIL || "", activo: true },
    { id: "dominique-ortega", nombre: "Dominique Ortega", rol: "admin", email: "", activo: true },
    { id: "jose-romero", nombre: "José Romero", rol: "admin", email: "", activo: true }
  ];
  const DEFAULT_VENDORS = ["Gina Ferrin", "Darvin Cordoba", "David Jurado", "Humberto Ferrufino", "Dominique Ortega", "Alexander Ortega", "Edwin"];
  const ROLES = { dueno: "Administrador principal", admin: "Administrador", subadmin: "Subadministrador", vendedor: "Vendedor" };

  /* ---------------- MODO DEMOSTRACIÓN ---------------- */
  let seedCache = null;
  async function loadSeed() {
    if (seedCache) return seedCache;
    try {
      const r = await fetch("data/productos.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("No se encontró data/productos.json");
      seedCache = await r.json();
    } catch (e) {
      // Abierto con doble clic desde la PC (file://): el navegador no deja leer el JSON,
      // así que se carga la misma información desde data/productos.js.
      await new Promise((res, rej) => {
        const sc = document.createElement("script");
        sc.src = "data/productos.js"; sc.onload = res; sc.onerror = () => rej(e);
        document.head.appendChild(sc);
      });
      if (!window.COLEX_SEED) throw e;
      seedCache = window.COLEX_SEED;
    }
    return seedCache;
  }
  function demoState() {
    try {
      const s = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
      if (s && typeof s === "object") return withDefaults(s);
    } catch (e) { /* almacenamiento no disponible */ }
    return withDefaults({ products: {}, deleted: [], movimientos: [], solicitudes: [], config: {}, seq: 0, session: null });
  }
  function withDefaults(s) {
    if (!Array.isArray(s.vendedores)) s.vendedores = DEFAULT_VENDORS.map((n) => normalizeVendor({ nombre: n }));
    if (!Array.isArray(s.equipo)) s.equipo = DEFAULT_TEAM.map((m) => Object.assign({}, m));
    if (!Array.isArray(s.aprobaciones)) s.aprobaciones = [];
    if (!s.mig_jose_admin) {            // José Romero pasa a administrador (mismo nivel que Dominique)
      s.equipo.forEach((m) => { if (m.id === "jose-romero" && m.rol === "subadmin") m.rol = "admin"; });
      s.mig_jose_admin = true;
    }
    return s;
  }
  function demoSave(s) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); return true; }
    catch (e) { throw new Error("El navegador no tiene espacio para guardar más cambios de demostración."); }
  }
  async function demoAll() {
    const seed = await loadSeed();
    const s = demoState();
    const map = new Map(seed.productos.map((p) => [p.sap, normalizeProduct(p)]));
    for (const [k, v] of Object.entries(s.products)) map.set(Number(k), normalizeProduct(v));
    for (const k of s.deleted) map.delete(Number(k));
    const productos = [...map.values()].sort((a, b) => a.orden - b.orden || a.sap - b.sap);
    const config = Object.assign({
      fecha_existencias: seed.fecha_existencias, telefono: "", whatsapp: "", correo: "",
      direccion: "", aviso_es: "", aviso_en: ""
    }, s.config);
    const extra = (s.categorias || []).filter((c) => !seed.categorias.some((k) => k.clave === c.clave));
    return { seed, s, productos, config, categorias: seed.categorias.concat(extra) };
  }

  const demo = {
    mode: "demo",
    async loadCatalog() {
      const d = await demoAll();
      return { config: d.config, categorias: d.categorias, productos: d.productos.filter((p) => p.activo) };
    },
    async createRequest(payload) {
      const s = demoState();
      s.seq = (s.seq || 0) + 1;
      const folio = makeFolio(s.seq);
      s.solicitudes.unshift({ id: s.seq, folio, fecha: new Date().toISOString(), idioma: payload.idioma,
        cliente: payload.cliente, items: payload.items, vendedor: payload.vendedor || null, estado: "nueva" });
      s.solicitudes = s.solicitudes.slice(0, 200);
      demoSave(s);
      return folio;
    },
    async listVendors(onlyActive) {
      const v = (demoState().vendedores || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
      return onlyActive ? v.filter((x) => x.activo !== false) : v;
    },
    async saveVendor(v) {
      const s = demoState(); s.vendedores = s.vendedores || [];
      const n = normalizeVendor(v);
      const i = s.vendedores.findIndex((x) => x.slug === n.slug);
      if (i >= 0) s.vendedores[i] = n; else s.vendedores.push(n);
      demoSave(s); return n;
    },
    async deleteVendor(slug) { const s = demoState(); s.vendedores = (s.vendedores || []).filter((x) => x.slug !== slug); demoSave(s); },
    async session() { const s = demoState(); return s.session; },
    async login(email, password) {   // dueño: correo + contraseña
      const okEmail = String(email || "").trim().toLowerCase() === String(CFG.ADMIN_EMAIL || "").trim().toLowerCase();
      const okPass = (await sha256Hex(String(password || ""))) === String(CFG.DEMO_PASSWORD_SHA256 || "").toLowerCase();
      if (!okEmail || !okPass) throw new Error("Correo o contraseña incorrectos.");
      const s = demoState(); const m = s.equipo.find((x) => x.rol === "dueno") || DEFAULT_TEAM[0];
      s.session = { id: m.id, nombre: m.nombre, rol: "dueno", email: CFG.ADMIN_EMAIL }; demoSave(s); return s.session;
    },
    async loginAs(id, password) {    // equipo y vendedores: por nombre (temporal); el dueño necesita su contraseña
      const s = demoState();
      if (String(id).startsWith("v:")) {
        const v = (s.vendedores || []).find((x) => x.slug === String(id).slice(2) && x.activo !== false);
        if (!v) throw new Error("Elija su nombre de la lista.");
        s.session = { id: "v:" + v.slug, nombre: v.nombre, rol: "vendedor", vendedor: v.slug, email: v.correo || "" }; demoSave(s); return s.session;
      }
      const m = s.equipo.find((x) => x.id === id && x.activo !== false);
      if (!m) throw new Error("Elija su nombre de la lista.");
      if (m.rol === "dueno") return this.login(CFG.ADMIN_EMAIL, password);
      s.session = { id: m.id, nombre: m.nombre, rol: m.rol, email: m.email || "" }; demoSave(s); return s.session;
    },
    async listTeam() { return demoState().equipo; },
    async saveTeamMember(m) {
      const s = demoState(); const n = { id: m.id || slugify(m.nombre), nombre: String(m.nombre || "").trim(), rol: m.rol, email: String(m.email || "").trim(), activo: m.activo !== false };
      const i = s.equipo.findIndex((x) => x.id === n.id); if (i >= 0) s.equipo[i] = n; else s.equipo.push(n);
      demoSave(s); return n;
    },
    async deleteTeamMember(id) { const s = demoState(); s.equipo = s.equipo.filter((x) => x.id !== id || x.rol === "dueno"); demoSave(s); },
    async listApprovals() { return demoState().aprobaciones.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); },
    async createApproval(a) {
      const s = demoState();
      const n = Object.assign({ id: Date.now(), fecha: new Date().toISOString(), estado: "pendiente" }, a);
      s.aprobaciones.unshift(n); s.aprobaciones = s.aprobaciones.slice(0, 300); demoSave(s); return n;
    },
    async resolveApproval(id, estado, por) {
      const s = demoState(); const a = s.aprobaciones.find((x) => x.id === id);
      if (a) Object.assign(a, { estado, resuelto_por: por, resuelto_fecha: new Date().toISOString() });
      demoSave(s);
    },
    async logout() { const s = demoState(); s.session = null; demoSave(s); },
    async adminCatalog() {
      const d = await demoAll();
      return { config: d.config, categorias: d.categorias, productos: d.productos };
    },
    async saveProduct(p) {
      const s = demoState();
      const n = normalizeProduct(p);
      n.actualizado = new Date().toISOString();
      s.products[n.sap] = n;
      s.deleted = s.deleted.filter((x) => Number(x) !== n.sap);
      demoSave(s);
      return n;
    },
    async deleteProduct(sap) {
      const s = demoState(); delete s.products[sap]; s.deleted.push(Number(sap)); demoSave(s);
    },
    async saveProducts(list, onProgress) {
      const s = demoState(), now = new Date().toISOString();
      list.forEach((p, i) => {
        const n = normalizeProduct(p); n.actualizado = now; s.products[n.sap] = n;
        s.deleted = s.deleted.filter((x) => Number(x) !== n.sap);
        if (onProgress) onProgress(i + 1, list.length);
      });
      demoSave(s); return list.length;
    },
    async saveCategory(c) {
      const s = demoState(); s.categorias = (s.categorias || []).filter((x) => x.clave !== c.clave).concat([{ clave: c.clave, es: c.es, en: c.en }]);
      demoSave(s); return c;
    },
    async registerMovement(sap, tipo, cantidad, nota) {
      const d = await demoAll();
      const p = d.productos.find((x) => x.sap === Number(sap));
      if (!p) throw new Error("Producto no encontrado.");
      const res = applyMovement(p.existencia, tipo, cantidad);
      const s = d.s;
      s.products[p.sap] = Object.assign({}, p, { existencia: res.despues, actualizado: new Date().toISOString() });
      s.movimientos.unshift({ id: Date.now() + Math.random(), sap: p.sap, tipo, cantidad: round3(cantidad),
        existencia_antes: res.antes, existencia_despues: res.despues, nota: nota || "",
        usuario: (s.session && s.session.email) || "demo", fecha: new Date().toISOString() });
      s.movimientos = s.movimientos.slice(0, 3000);
      demoSave(s);
      return res.despues;
    },
    async bulkSetStock(items, nota) {
      const d = await demoAll();
      const s = d.s; const bySap = new Map(d.productos.map((p) => [p.sap, p]));
      let n = 0;
      for (const it of items) {
        const p = bySap.get(Number(it.sap)); if (!p) continue;
        const nuevo = round3(it.existencia);
        if (nuevo < 0 || nuevo === p.existencia) continue;
        s.products[p.sap] = Object.assign({}, p, { existencia: nuevo, actualizado: new Date().toISOString() });
        s.movimientos.unshift({ id: Date.now() + n, sap: p.sap, tipo: "importacion", cantidad: nuevo,
          existencia_antes: p.existencia, existencia_despues: nuevo, nota: nota || "",
          usuario: (s.session && s.session.email) || "demo", fecha: new Date().toISOString() });
        n++;
      }
      s.movimientos = s.movimientos.slice(0, 3000);
      demoSave(s);
      return n;
    },
    async movements(opts) {
      const o = opts || {}, from = o.from ? new Date(o.from + "T00:00:00") : null, to = o.to ? new Date(o.to + "T23:59:59.999") : null;
      return demoState().movimientos.filter((m) => { const d = new Date(m.fecha); return (!from || d >= from) && (!to || d <= to); });
    },
    async requests() { return demoState().solicitudes; },
    async setRequestStatus(id, estado, nota, por) {
      const s = demoState(); const r = s.solicitudes.find((x) => x.id === id);
      if (r) { r.estado = estado; r.nota_estado = nota || ""; r.estado_fecha = new Date().toISOString(); r.actualizado_por = por || ""; }
      demoSave(s);
    },
    async updateRequestItems(id, items, por) {   // el vendedor ajusta el pedido para devolverlo al cliente
      const s = demoState(); const r = s.solicitudes.find((x) => x.id === id); if (!r) throw new Error("La solicitud ya no existe.");
      if (!r.items_original) r.items_original = r.items;
      Object.assign(r, { items, modificado_por: por || "", modificado_fecha: new Date().toISOString() });
      demoSave(s); return r;
    },
    async assignRequestVendor(id, vendedor) {
      const s = demoState(); const r = s.solicitudes.find((x) => x.id === id); if (r) r.vendedor = vendedor || null; demoSave(s);
    },
    async saveConfig(cfg) { const s = demoState(); s.config = Object.assign({}, s.config, cfg); demoSave(s); },
    async uploadImage(sap, blob) {
      return await new Promise((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob);
      });
    },
    async removeImage() { /* nada que borrar en demostración */ },
    async countProducts() { return (await demoAll()).productos.length; },
    async seedCatalog() { throw new Error("La carga inicial solo aplica con Supabase configurado."); },
    async resetDemo() { try { localStorage.removeItem(DEMO_KEY); } catch (e) {} }
  };

  /* Regla común de movimientos (igual a la función SQL registrar_movimiento). */
  function applyMovement(antes, tipo, cantidad) {
    const q = round3(cantidad);
    if (!(q >= 0)) throw new Error("La cantidad debe ser un número igual o mayor que cero.");
    let despues;
    if (tipo === "venta") {
      if (q <= 0) throw new Error("Indique cuántas unidades se vendieron.");
      despues = round3(antes - q);
      if (despues < 0) throw new Error(`La venta (${q}) supera la existencia actual (${antes}).`);
    } else if (tipo === "entrada") {
      if (q <= 0) throw new Error("Indique cuántas unidades entraron.");
      despues = round3(antes + q);
    } else if (tipo === "ajuste") {
      despues = q;
    } else throw new Error("Tipo de movimiento no válido.");
    return { antes: round3(antes), despues };
  }

  /* ---------------- SUPABASE ---------------- */
  let sb = null;
  function client() {
    if (!sb) {
      if (!window.supabase) throw new Error("No se cargó la librería de Supabase.");
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return sb;
  }
  function check(res) {
    if (res.error) throw new Error(friendly(res.error.message || String(res.error)));
    return res.data;
  }
  function friendly(msg) {
    if (/Invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
    if (/permission denied|row-level security|not authorized|No autorizado/i.test(msg))
      return "Su usuario no tiene permiso de administrador.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Sin conexión con la base de datos. Revise internet.";
    return msg;
  }
  async function fetchAll(builderFn) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = check(await builderFn().range(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }
  const PCOLS = "sap,categoria,subcategoria_es,subcategoria_en,descripcion_es,descripcion_en,unidad,existencia,imagen,activo,orden,actualizado";

  const remote = {
    mode: "supabase",
    async loadCatalog() {
      const c = client();
      const [config, categorias, productos] = await Promise.all([
        c.from("config").select("*").eq("id", 1).maybeSingle().then(check),
        c.from("categorias").select("*").order("orden").then(check),
        fetchAll(() => c.from("productos").select(PCOLS).eq("activo", true).order("orden").order("sap"))
      ]);
      return {
        config: config || {},
        categorias: categorias.map((k) => ({ clave: k.clave, es: k.nombre_es, en: k.nombre_en })),
        productos: productos.map(normalizeProduct)
      };
    },
    async createRequest(payload) {
      return check(await client().rpc("crear_solicitud", {
        p_idioma: payload.idioma, p_cliente: payload.cliente, p_items: payload.items, p_vendedor: payload.vendedor || null
      }));
    },
    async listVendors(onlyActive) {
      let q = client().from("vendedores").select("*").order("nombre");
      if (onlyActive) q = q.eq("activo", true);
      return check(await q).map(normalizeVendor);
    },
    async saveVendor(v) {
      return normalizeVendor(check(await client().from("vendedores").upsert(normalizeVendor(v), { onConflict: "slug" }).select("*").single()));
    },
    async deleteVendor(slug) { check(await client().from("vendedores").delete().eq("slug", slug)); },
    async session() {
      const { data } = await client().auth.getSession();
      if (!data.session) return null;
      return await this._me(data.session.user.email);
    },
    async _me(email) {
      const r = await client().from("administradores").select("*").ilike("email", email).maybeSingle();
      if (!r.error && r.data && r.data.activo !== false)
        return { id: r.data.email, nombre: r.data.nombre || email, rol: r.data.rol || "admin", email: r.data.email };
      const v = await client().from("vendedores").select("*").ilike("correo", email).eq("activo", true).maybeSingle();
      if (v.error || !v.data) return null;
      return { id: "v:" + v.data.slug, nombre: v.data.nombre, rol: "vendedor", vendedor: v.data.slug, email };
    },
    async login(email, password) {
      const d = check(await client().auth.signInWithPassword({ email, password }));
      const me = await this._me(d.user.email);
      if (!me) { await client().auth.signOut(); throw new Error("Este usuario no está autorizado en el panel."); }
      return me;
    },
    async loginAs() { throw new Error("Con la base de datos en línea, cada persona entra con su correo y contraseña."); },
    async listTeam() {
      return check(await client().from("administradores").select("*").order("nombre"))
        .map((m) => ({ id: m.email, nombre: m.nombre || m.email, rol: m.rol, email: m.email, activo: m.activo !== false }));
    },
    async saveTeamMember(m) {
      const row = { email: String(m.email || "").trim().toLowerCase(), nombre: String(m.nombre || "").trim(), rol: m.rol, activo: m.activo !== false };
      if (!row.email) throw new Error("Con la base de datos en línea, cada miembro del equipo necesita un correo.");
      if (m.id && m.id !== row.email) check(await client().from("administradores").delete().eq("email", m.id));
      check(await client().from("administradores").upsert(row, { onConflict: "email" }));
      return { id: row.email, nombre: row.nombre, rol: row.rol, email: row.email, activo: row.activo };
    },
    async deleteTeamMember(id) { check(await client().from("administradores").delete().eq("email", id).neq("rol", "dueno")); },
    async listApprovals() { return check(await client().from("aprobaciones").select("*").order("fecha", { ascending: false }).limit(300)); },
    async createApproval(a) { return check(await client().from("aprobaciones").insert(a).select("*").single()); },
    async resolveApproval(id, estado, por) {
      check(await client().from("aprobaciones").update({ estado, resuelto_por: por, resuelto_fecha: new Date().toISOString() }).eq("id", id));
    },
    async logout() { await client().auth.signOut(); },
    async adminCatalog() {
      const c = client();
      const [config, categorias, productos] = await Promise.all([
        c.from("config").select("*").eq("id", 1).maybeSingle().then(check),
        c.from("categorias").select("*").order("orden").then(check),
        fetchAll(() => c.from("productos").select(PCOLS).order("orden").order("sap"))
      ]);
      return {
        config: config || {},
        categorias: categorias.map((k) => ({ clave: k.clave, es: k.nombre_es, en: k.nombre_en })),
        productos: productos.map(normalizeProduct)
      };
    },
    async saveProduct(p) {
      const n = normalizeProduct(p);
      delete n.actualizado;
      const row = check(await client().from("productos").upsert(n, { onConflict: "sap" }).select(PCOLS).single());
      return normalizeProduct(row);
    },
    async deleteProduct(sap) { check(await client().from("productos").delete().eq("sap", sap)); },
    async saveProducts(list, onProgress) {
      const rows = list.map((p) => { const n = normalizeProduct(p); delete n.actualizado; return n; });
      for (let i = 0; i < rows.length; i += 300) {
        check(await client().from("productos").upsert(rows.slice(i, i + 300), { onConflict: "sap" }));
        if (onProgress) onProgress(Math.min(i + 300, rows.length), rows.length);
      }
      return rows.length;
    },
    async saveCategory(c) {
      check(await client().from("categorias").upsert({ clave: c.clave, nombre_es: c.es, nombre_en: c.en, orden: c.orden || 100 }, { onConflict: "clave" }));
      return c;
    },
    async registerMovement(sap, tipo, cantidad, nota) {
      return num(check(await client().rpc("registrar_movimiento", {
        p_sap: Number(sap), p_tipo: tipo, p_cantidad: round3(cantidad), p_nota: nota || ""
      })));
    },
    async bulkSetStock(items, nota) {
      let total = 0;
      for (let i = 0; i < items.length; i += 500) {
        const part = items.slice(i, i + 500).map((x) => ({ sap: Number(x.sap), existencia: round3(x.existencia) }));
        total += num(check(await client().rpc("ajustar_existencias", { p_items: part, p_nota: nota || "" })));
      }
      return total;
    },
    async movements(opts) {
      const o = opts || {};
      let q = client().from("movimientos").select("*").order("fecha", { ascending: false });
      if (o.from) q = q.gte("fecha", new Date(o.from + "T00:00:00").toISOString());
      if (o.to) q = q.lte("fecha", new Date(o.to + "T23:59:59.999").toISOString());
      return check(await q.limit(o.limit || 5000));
    },
    async requests() {
      return check(await client().from("solicitudes").select("*").order("fecha", { ascending: false }).limit(300));
    },
    async setRequestStatus(id, estado, nota, por) {
      check(await client().from("solicitudes").update({ estado, nota_estado: nota || "", estado_fecha: new Date().toISOString(), actualizado_por: por || "" }).eq("id", id));
    },
    async updateRequestItems(id, items, por) {
      const cur = check(await client().from("solicitudes").select("items, items_original").eq("id", id).single());
      const patch = { items, modificado_por: por || "", modificado_fecha: new Date().toISOString() };
      if (!cur.items_original) patch.items_original = cur.items;
      return check(await client().from("solicitudes").update(patch).eq("id", id).select("*").single());
    },
    async assignRequestVendor(id, vendedor) {
      check(await client().from("solicitudes").update({ vendedor: vendedor || null }).eq("id", id));
    },
    async saveConfig(cfg) {
      check(await client().from("config").upsert(Object.assign({ id: 1 }, cfg), { onConflict: "id" }));
    },
    async uploadImage(sap, blob) {
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${sap}-${Date.now()}.${ext}`;
      const st = client().storage.from(CFG.BUCKET_IMAGENES || "productos");
      check(await st.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: true }));
      return st.getPublicUrl(path).data.publicUrl;
    },
    async removeImage(url) {
      const b = CFG.BUCKET_IMAGENES || "productos";
      const marker = `/storage/v1/object/public/${b}/`;
      if (!url || url.indexOf(marker) < 0) return; // imágenes originales del sitio: no se borran
      const path = decodeURIComponent(url.split(marker)[1].split("?")[0]);
      await client().storage.from(b).remove([path]);
    },
    async countProducts() {
      const r = await client().from("productos").select("sap", { count: "exact", head: true });
      if (r.error) throw new Error(friendly(r.error.message));
      return r.count || 0;
    },
    async seedCatalog(data, onProgress) {
      const c = client();
      check(await c.from("categorias").upsert(data.categorias.map((k, i) => ({
        clave: k.clave, nombre_es: k.es, nombre_en: k.en, orden: i + 1 })), { onConflict: "clave" }));
      check(await c.from("config").upsert({ id: 1, fecha_existencias: data.fecha_existencias }, { onConflict: "id" }));
      const rows = data.productos.map((p) => { const n = normalizeProduct(p); delete n.actualizado; return n; });
      for (let i = 0; i < rows.length; i += 400) {
        check(await c.from("productos").upsert(rows.slice(i, i + 400), { onConflict: "sap" }));
        if (onProgress) onProgress(Math.min(i + 400, rows.length), rows.length);
      }
      return rows.length;
    },
    async resetDemo() {}
  };

  window.ColexStore = Object.assign(DEMO ? demo : remote, {
    isDemo: DEMO, ROLES, sha256Hex, slugify, normalizeVendor, applyMovement, normalizeProduct, todayISO, round3, loadSeed
  });
})();
