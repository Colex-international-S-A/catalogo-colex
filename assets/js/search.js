/*
 * Búsqueda del catálogo COLEX.
 * Entiende plurales (compresores → compresor), abreviaturas usadas en SAP
 * (Comp., Cap., Evap., Lav., Nev., Tarj., Valv.…), palabras en inglés y
 * algunos sinónimos de uso diario (aire acondicionado = A/A, nevera = refrigerador).
 * Para agregar sinónimos, añada una línea al diccionario SYN (todo en minúsculas y sin tildes).
 */
(function () {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // palabra buscada (raíz) -> otras formas que aparecen en las descripciones
  const SYN = {
    compresor: ["comp.", "com.", "compressor"],
    compressor: ["compresor", "comp."],
    capacitor: ["cap.", "condesador de arranque", "capacitores"],
    condensador: ["cond.", "condesador", "condensadora", "condenser"],
    condensadora: ["cond.", "condenser", "condensing"],
    evaporador: ["evap.", "evaporadora", "evaporator"],
    evaporadora: ["evap.", "evaporator"],
    lavadora: ["lav.", "lav ", "washer", "washing"],
    secadora: ["sec.", "dryer"],
    licuadora: ["lic.", "licua", "blender"],
    nevera: ["nev.", "nev ", "refrigerador", "refrigerator"],
    refrigerador: ["nevera", "nev.", "refrigerator"],
    congelador: ["cong.", "freezer"],
    termostato: ["termost", "thermostat"],
    tarjeta: ["tarj.", "tarj ", "board", "pcb"],
    valvula: ["valv.", "valv ", "valve"],
    ventilador: ["vent.", "vent ", "fan"],
    motor: ["micromotor"],
    aire: ["a/a", "a.a", "split", "air"],
    acondicionado: ["a/a", "a.a", "split", "conditioning"],
    split: ["mini split", "a/a"],
    gas: ["refrigerante", "refrigerant"],
    refrigerante: ["gas ref", "gas refrig", "refrigerant"],
    tubo: ["tuberia", "tube", "pipe"],
    tuberia: ["tubo", "pipe", "tubing"],
    filtro: ["filter", "secador"],
    relay: ["rele", "relevador"],
    rele: ["relay"],
    resistencia: ["resist.", "resist ", "heater"],
    protector: ["prot.", "protec"],
    transformador: ["transfor", "transformer"],
    rodamiento: ["bearing"],
    correa: ["belt"],
    bomba: ["pump"],
    aspa: ["blade"],
    turbina: ["blower", "wheel"],
    manometro: ["manom", "gauge"],
    soldadura: ["brazing", "solder"],
    cobre: ["copper"]
  };

  // Plural -> singular (español e inglés): compresores→compresor, valvulas→valvula, fans→fan
  function stem(t) {
    if (t.length > 4 && /(r|l|n|d|z)es$/.test(t)) return t.slice(0, -2);
    if (t.length > 4 && /ces$/.test(t)) return t.slice(0, -3) + "z";
    if (t.length > 3 && /[aeiou]s$/.test(t)) return t.slice(0, -1);
    if (t.length > 3 && /[^s]s$/.test(t) && !/[aeiou]s$/.test(t)) return t.slice(0, -1);
    return t;
  }

  function compile(query) {
    const raw = norm(query).replace(/[,;]+/g, " ").trim();
    if (!raw) return null;
    const words = raw.split(/\s+/).filter(Boolean);
    const terms = words.map((w) => {
      const s = stem(w);
      const variants = new Set([w, s]);
      (SYN[s] || SYN[w] || []).forEach((v) => variants.add(v));
      return [...variants];
    });
    const digits = raw.replace(/\s/g, "");
    return { raw, terms, code: /^\d{3,}$/.test(digits) ? digits : null };
  }

  function haystack(p) {
    if (!p._hay) {
      const text = norm(`${p.descripcion_es} ${p.descripcion_en} ${p.subcategoria_es} ${p.subcategoria_en}`);
      p._hay = ` ${p.sap} ${text} ${text.replace(/[./\-()]+/g, " ")} `;
      p._desc = norm(`${p.descripcion_es} ${p.descripcion_en}`);
    }
    return p._hay;
  }

  /* Devuelve un puntaje (0 = no coincide). Mayor puntaje = más arriba en la lista. */
  function score(p, q) {
    if (!q) return 1;
    const hay = haystack(p);
    if (q.code) {
      const sap = String(p.sap);
      if (sap === q.code) return 1000;
      if (sap.includes(q.code)) return 500;
    }
    let sc = 0;
    for (const variants of q.terms) {
      let best = 0;
      for (const v of variants) {
        if (!hay.includes(v)) continue;
        let s = 10;
        if (p._desc.startsWith(v)) s = 40;                 // la descripción empieza con la palabra
        else if (p._desc.includes(" " + v) ) s = 20;       // palabra completa dentro de la descripción
        best = Math.max(best, s);
      }
      if (!best) return 0;                                 // todas las palabras deben aparecer
      sc += best;
    }
    return sc;
  }

  window.ColexSearch = { compile, score, norm, stem };
})();
