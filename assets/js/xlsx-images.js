/*
 * Lee las fotos pegadas en un Excel (.xlsx) y dice en qué fila está cada una.
 * Funciona sin librerías: abre el .xlsx (que es un ZIP), lee los dibujos de cada hoja
 * y devuelve, por hoja, un mapa  fila de Excel -> { data, mime }.
 * Si hay varias fotos en la misma fila, queda la última (la que se ve encima).
 */
(function () {
  const td = new TextDecoder("utf-8");

  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede leer las fotos del Excel. Use Chrome o Edge actualizados.");
    const ds = new DecompressionStream("deflate-raw");
    const out = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  function readZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("El archivo no es un Excel .xlsx válido.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { method, csize, lho });
      p += 46 + nlen + elen + clen;
    }
    async function get(name) {
      const e = entries.get(name.replace(/^\//, ""));
      if (!e) return null;
      const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
      const raw = u8.subarray(start, start + e.csize);
      return e.method === 0 ? raw.slice() : await inflate(raw);
    }
    return { get, has: (n) => entries.has(n.replace(/^\//, "")) };
  }

  function resolve(base, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/"); parts.pop();
    for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
    return parts.join("/");
  }
  const relsOf = (path) => { const i = path.lastIndexOf("/"); return path.slice(0, i) + "/_rels/" + path.slice(i + 1) + ".rels"; };
  async function xml(zip, path) { const b = await zip.get(path); return b ? new DOMParser().parseFromString(td.decode(b), "application/xml") : null; }
  async function rels(zip, path) {
    const d = await xml(zip, relsOf(path)), m = new Map();
    if (d) for (const r of d.getElementsByTagName("Relationship")) m.set(r.getAttribute("Id"), { target: resolve(path, r.getAttribute("Target")), type: r.getAttribute("Type") || "" });
    return m;
  }
  const byLocal = (el, name) => [...el.getElementsByTagName("*")].filter((x) => x.localName === name);
  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };

  /* Devuelve Map(nombreHoja -> Map(filaExcel -> {data, mime})) */
  async function imagesBySheet(arrayBuffer) {
    const zip = readZip(arrayBuffer), out = new Map();
    const wb = await xml(zip, "xl/workbook.xml"); if (!wb) return out;
    const wbRels = await rels(zip, "xl/workbook.xml");
    for (const sh of byLocal(wb, "sheet")) {
      const name = sh.getAttribute("name");
      const rid = [...sh.attributes].find((a) => a.localName === "id" && a.name !== "sheetId");
      const rel = rid && wbRels.get(rid.value); if (!rel) continue;
      const sRels = await rels(zip, rel.target);
      const rows = new Map();
      for (const r of sRels.values()) {
        if (!/\/drawing$/.test(r.type)) continue;
        const dr = await xml(zip, r.target); if (!dr) continue;
        const dRels = await rels(zip, r.target);
        for (const anc of [...dr.documentElement.children]) {
          if (!/Anchor$/.test(anc.localName)) continue;
          const from = byLocal(anc, "from")[0], blip = byLocal(anc, "blip")[0];
          if (!from || !blip) continue;
          const row = Number(byLocal(from, "row")[0].textContent) + 1;
          const emb = [...blip.attributes].find((a) => a.localName === "embed");
          const media = emb && dRels.get(emb.value); if (!media) continue;
          const ext = media.target.split(".").pop().toLowerCase();
          if (!MIME[ext]) continue;                         // emf/wmf no se pueden mostrar en la web
          rows.set(row, { path: media.target, mime: MIME[ext] });
        }
      }
      for (const [row, m] of rows) rows.set(row, { data: await zip.get(m.path), mime: m.mime });
      out.set(name, rows);
    }
    return out;
  }

  window.ColexXlsxImages = { imagesBySheet };
})();
