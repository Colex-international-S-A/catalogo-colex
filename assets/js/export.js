/*
 * Generación de la solicitud en PDF y Excel (en el navegador, sin precios).
 * Las librerías se cargan solo cuando se necesitan, para que el catálogo abra rápido.
 */
(function () {
  const BRAND = { navy: [36, 36, 36], blue: [11, 120, 180], orange: [254, 177, 1], ink: [31, 35, 40], line: [220, 223, 227], soft: [245, 246, 247] };
  const loaded = {};
  const SHOW = !!(window.COLEX_CONFIG || {}).MOSTRAR_EXISTENCIAS;
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src; s.async = true;
        s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src));
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  const base = (document.currentScript && document.currentScript.src.replace(/js\/export\.js.*$/, "")) || "assets/";

  function fmtDate(iso, lang) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString(lang === "en" ? "en-US" : "es-PA", { year: "numeric", month: "long", day: "numeric" });
  }
  function fmtStockDate(isoDate, lang) {
    if (!isoDate) return "";
    const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-US" : "es-PA", { year: "numeric", month: "long", day: "numeric" });
  }
  function fmtQty(n, lang) {
    return Number(n).toLocaleString(lang === "en" ? "en-US" : "es-PA", { maximumFractionDigits: 3 });
  }
  function desc(it, lang) { return (lang === "en" ? it.descripcion_en : it.descripcion_es) || it.descripcion_es || ""; }
  function clientRows(req, t) {
    const c = req.cliente || {};
    return [[t.name, c.nombre], [t.company, c.empresa], [t.country, c.pais], [t.phone, c.telefono], [t.email, c.correo], [t.notes, c.comentarios]]
      .filter((r) => r[1] && String(r[1]).trim());
  }
  function totals(req) {
    return { lines: req.items.length, units: req.items.reduce((a, b) => a + Number(b.cantidad || 0), 0) };
  }

  function imageToDataURL(src, maxSide) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const max = maxSide || 180, r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * r)); c.height = Math.max(1, Math.round(img.naturalHeight * r));
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          resolve({ data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  async function buildPdf(req) {
    await loadScript(base + "vendor/jspdf.umd.min.js");
    await loadScript(base + "vendor/jspdf.plugin.autotable.min.js");
    const lang = req.idioma === "en" ? "en" : "es";
    const t = window.COLEX_I18N[lang];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 14;
    const imgs = await Promise.all(req.items.map((it) => imageToDataURL(it.imagen_url)));
    const logo = await imageToDataURL(new URL(base + "img/logo-colex.jpg", location.href).href, 700);

    // Encabezado
    doc.setFillColor(...BRAND.navy); doc.rect(0, 0, W, 30, "F");
    doc.setFillColor(...BRAND.orange); doc.rect(0, 30, W, 1.4, "F");
    doc.setTextColor(255, 255, 255);
    if (logo && logo.data) {
      doc.addImage(logo.data, "JPEG", M - 2, 3.5, 62, 23);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`${t.brandSub} · ${t.warehouse}`, M + 64, 20.5);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text("COLEX INTERNATIONAL", M, 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`${t.brandSub} · ${t.warehouse}`, M, 20.5);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(t.docTitle, W - M, 13, { align: "right" });
    doc.setTextColor(...BRAND.orange); doc.setFontSize(13);
    doc.text(req.folio, W - M, 20.5, { align: "right" });

    // Datos generales
    doc.setTextColor(...BRAND.ink); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    let y = 39;
    doc.text(`${t.date}: ${fmtDate(req.fecha, lang)}` + (req.modificado_fecha ? `   ·   ${t.updatedOn}: ${fmtDate(req.modificado_fecha, lang)}` : ""), M, y);
    if (SHOW && req.config && req.config.fecha_existencias)
      doc.text(`${t.stockAsOf} ${fmtStockDate(req.config.fecha_existencias, lang)}`, W - M, y, { align: "right" });

    // Asesor de ventas
    if (req.vendedor && req.vendedor.nombre) {
      y += 5.5;
      const vv = req.vendedor, extra = [vv.whatsapp && `WhatsApp ${vv.whatsapp}`, vv.correo].filter(Boolean).join(" · ");
      doc.setFont("helvetica", "bold"); doc.text(`${t.advisorDoc}: ${vv.nombre}`, M, y);
      if (extra) { doc.setFont("helvetica", "normal"); doc.text(extra, W - M, y, { align: "right" }); }
      doc.setFont("helvetica", "normal");
    }
    // Cliente
    y += 6;
    const rows = clientRows(req, t);
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: "plain",
      head: [[{ content: t.docClient.toUpperCase(), colSpan: 2 }]],
      body: rows,
      headStyles: { fillColor: BRAND.soft, textColor: BRAND.blue, fontStyle: "bold", fontSize: 8.5 },
      bodyStyles: { fontSize: 9.5, textColor: BRAND.ink, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      columnStyles: { 0: { cellWidth: 42, textColor: [90, 108, 128] }, 1: { fontStyle: "bold" } },
      tableLineColor: BRAND.line, tableLineWidth: 0.2
    });
    y = doc.lastAutoTable.finalY + 6;

    // Productos
    const tot = totals(req);
    const body = req.items.map((it, i) => [
      i + 1, "", String(it.sap), desc(it, lang), window.colexUnit(it.unidad, lang), fmtQty(it.cantidad, lang)
    ]);
    doc.autoTable({
      startY: y, margin: { left: M, right: M, bottom: 20 },
      head: [["#", t.image, t.code, t.description, t.unit, t.qty]],
      body,
      foot: [["", "", "", `${t.docTotals}: ${tot.lines} ${tot.lines === 1 ? t.item : t.items}`, "", { content: fmtQty(tot.units, lang), styles: { halign: "right", fontSize: 10.5 } }]],
      theme: "grid", showFoot: "lastPage",
      headStyles: { fillColor: BRAND.navy, textColor: 255, fontStyle: "bold", fontSize: 8.5, halign: "center", valign: "middle" },
      footStyles: { fillColor: BRAND.soft, textColor: BRAND.ink, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: BRAND.ink, valign: "middle", minCellHeight: 19, lineColor: BRAND.line },
      alternateRowStyles: { fillColor: [250, 252, 254] },
      columnStyles: {
        0: { cellWidth: 8, halign: "center", textColor: [110, 125, 140] },
        1: { cellWidth: 21 },
        2: { cellWidth: 26, halign: "center", font: "courier", fontStyle: "bold" },
        3: { cellWidth: "auto" },
        4: { cellWidth: 16, halign: "center" },
        5: { cellWidth: 22, halign: "right", fontStyle: "bold", fontSize: 10.5 }
      },
      didDrawCell: (d) => {
        if (d.section === "body" && d.column.index === 1) {
          const im = imgs[d.row.index];
          if (!im) return;
          const box = 16, r = Math.min(box / im.w, box / im.h), w = im.w * r, h = im.h * r;
          doc.addImage(im.data, "JPEG", d.cell.x + (d.cell.width - w) / 2, d.cell.y + (d.cell.height - h) / 2, w, h);
        }
      }
    });

    // Pie de página
    const pages = doc.getNumberOfPages();
    const H = doc.internal.pageSize.getHeight();
    const cfg = req.config || {};
    const contact = [cfg.telefono, cfg.whatsapp && `WhatsApp ${cfg.whatsapp}`, cfg.correo].filter(Boolean).join(" · ");
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(...BRAND.line); doc.setLineWidth(0.3); doc.line(M, H - 15, W - M, H - 15);
      doc.setFontSize(7.5); doc.setTextColor(100, 115, 130); doc.setFont("helvetica", "normal");
      doc.text(t.noPrices, M, H - 10.5, { maxWidth: W - 2 * M - 30 });
      if (contact) doc.text(contact, M, H - 6.5);
      doc.text(`${t.page} ${p} / ${pages}`, W - M, H - 6.5, { align: "right" });
    }
    return doc.output("blob");
  }

  async function buildXlsx(req) {
    await loadScript(base + "vendor/exceljs.min.js");
    const lang = req.idioma === "en" ? "en" : "es";
    const t = window.COLEX_I18N[lang];
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "COLEX INTERNATIONAL"; wb.created = new Date();
    const navy = "FF242424", blue = "FF0B78B4", orange = "FFFEB101", soft = "FFF5F6F7", ink = "FF1F2328", dark = "FF1A1A1A";
    const thin = { style: "thin", color: { argb: "FFDCDFE3" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    // Hoja 1: solicitud completa
    const ws = wb.addWorksheet(t.docSheet, { views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 6 }, { width: 15 }, { width: 58 }, { width: 9 }, { width: 12 }].concat(SHOW ? [{ width: 14 }] : []);
    const LAST = SHOW ? 6 : 5, LASTC = SHOW ? "F" : "E";
    ws.mergeCells(`A1:${LASTC}1`);
    Object.assign(ws.getCell("A1"), { value: "COLEX INTERNATIONAL" });
    ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    ws.getCell("A1").alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(`A2:${LASTC}2`);
    ws.getCell("A2").value = `${t.docTitle}   ${req.folio}`;
    ws.getCell("A2").font = { bold: true, size: 12, color: { argb: dark } };
    ws.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: orange } };
    ws.getCell("A2").alignment = { vertical: "middle", indent: 1 };
    ws.getRow(2).height = 22;

    let r = 4;
    const info = [[t.folio, req.folio], [t.date, fmtDate(req.fecha, lang)]];
    if (req.modificado_fecha) info.push([t.updatedOn, fmtDate(req.modificado_fecha, lang)]);
    if (SHOW && req.config && req.config.fecha_existencias) info.push([t.stockAsOf, fmtStockDate(req.config.fecha_existencias, lang)]);
    if (req.vendedor && req.vendedor.nombre) info.push([t.advisorDoc, [req.vendedor.nombre, req.vendedor.whatsapp, req.vendedor.correo].filter(Boolean).join(" · ")]);
    for (const [k, v] of info.concat(clientRows(req, t))) {
      ws.getCell(r, 2).value = k; ws.getCell(r, 2).font = { color: { argb: "FF5D646D" } };
      ws.mergeCells(r, 3, r, LAST);
      ws.getCell(r, 3).value = String(v); ws.getCell(r, 3).font = { bold: true, color: { argb: ink } };
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: "top" };
      r++;
    }
    r++;
    const headRow = r;
    const heads = ["N°", t.code, t.description, t.unit, t.qty].concat(SHOW ? [t.docStockAt] : []);
    heads.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h; c.font = { bold: true, color: { argb: i === 4 ? dark : "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 4 ? orange : navy } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border;
    });
    ws.getRow(r).height = 30;
    req.items.forEach((it, i) => {
      r++;
      const vals = [i + 1, Number(it.sap), desc(it, lang), window.colexUnit(it.unidad, lang), Number(it.cantidad)].concat(SHOW ? [Number(it.existencia)] : []);
      vals.forEach((v, j) => {
        const c = ws.getCell(r, j + 1); c.value = v; c.border = border;
        c.font = { color: { argb: ink }, bold: j === 4 };
        c.alignment = { vertical: "middle", horizontal: j === 2 ? "left" : "center", wrapText: j === 2 };
        if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: soft } };
      });
      ws.getCell(r, 2).numFmt = "0";
      ws.getCell(r, 5).numFmt = "#,##0.###";
      if (SHOW) ws.getCell(r, 6).numFmt = "#,##0.###";
    });
    r++;
    const tot = totals(req);
    ws.getCell(r, 3).value = `${t.docTotals}: ${tot.lines} ${tot.lines === 1 ? t.item : t.items}`;
    ws.getCell(r, 5).value = { formula: `SUM(E${headRow + 1}:E${r - 1})`, result: tot.units };
    ws.getCell(r, 5).numFmt = "#,##0.###";
    [3, 5].forEach((j) => { ws.getCell(r, j).font = { bold: true, color: { argb: ink } }; ws.getCell(r, j).alignment = { horizontal: j === 5 ? "center" : "right" }; });
    r += 2;
    ws.mergeCells(r, 1, r, LAST);
    ws.getCell(r, 1).value = t.noPrices;
    ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: "FF5D646D" } };
    ws.getCell(r, 1).alignment = { wrapText: true };
    ws.getRow(r).height = 28;
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: headRow }];

    // Hoja 2: solo códigos y cantidades, sin filas vacías, para copiar y pegar
    const cp = wb.addWorksheet(t.docCopySheet, { views: [{ state: "frozen", ySplit: 1 }] });
    cp.columns = [{ width: 16 }, { width: 12 }, { width: 58 }, { width: 3 }, { width: 60 }];
    [t.code, t.qty, t.description].forEach((h, i) => {
      const c = cp.getCell(1, i + 1); c.value = h;
      c.font = { bold: true, color: { argb: i === 1 ? dark : "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 1 ? orange : blue } };
      c.alignment = { horizontal: "center" };
    });
    req.items.forEach((it, i) => {
      const a = cp.getCell(i + 2, 1); a.value = Number(it.sap); a.numFmt = "0";
      const b = cp.getCell(i + 2, 2); b.value = Number(it.cantidad); b.numFmt = "General";
      cp.getCell(i + 2, 3).value = desc(it, lang);
      cp.getCell(i + 2, 3).font = { color: { argb: "FF5D646D" } };
    });
    const last = req.items.length + 1;
    cp.getCell("E1").value = t.docCopyHelp;
    cp.getCell("E1").alignment = { wrapText: true, vertical: "top" };
    cp.getCell("E1").font = { italic: true, color: { argb: "FF5D646D" } };
    cp.getCell("E2").value = lang === "en" ? `Codes: A2:A${last}   ·   Quantities: B2:B${last}` : `Códigos: A2:A${last}   ·   Cantidades: B2:B${last}`;
    cp.getCell("E2").font = { bold: true, color: { argb: ink } };
    cp.getRow(1).height = 42;

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.ColexExport = { buildPdf, buildXlsx, saveBlob, loadScript, base };
})();
