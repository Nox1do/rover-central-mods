// ==UserScript==
// @name         Rs - Duplicados (v2.2)
// @namespace    noe/roversport/dups
// @version      2.2.0
// @description  Agregado Gallos.
// @match        https://www.roversport.net/adm/es/index.php*
// @match        https://roversport.net/adm/es/index.php*
// @match        https://www.roversport.lol/adm/es/index.php*
// @match        https://roversport.lol/adm/es/index.php*
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  // ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

  const CFG = {
    // PPR
    pprHeaderText: "Event Name (API)",
    onlyVisibleTables: true,
    normalizeWhitespace: true,
    highlightDuplicates: true,
    highlightBg: "rgba(255, 165, 0, 0.35)",

    // Botón
    buttonId: "tm-dups-near-add-event",
    buttonText: "Repetidos",
    buttonIconHtml: '<span class="btn-label"><i class="fas fa-clone"></i></span>',

    // Modal
    modalId: "tm-dups-modal-backdrop",

    // Identificadores de sección en ge-table
    mlbLogoSrc:    "mlb-logo-1.png",
    tbaLogoSrc:    "players.png",

    // Mapa: nombre completo en MLB → abreviaturas válidas en TBA
        teamAbbrevMap: {
      // NL East
      "Atlanta":                ["ATL"], "Atlanta Braves":           ["ATL"],
      "Miami":                  ["MIA"], "Miami Marlins":             ["MIA"],
      "NY Mets":                ["NYM"], "New York Mets":             ["NYM"],
      "Philadelphia":           ["PHI"], "Philadelphia Phillies":     ["PHI"],
      "Washington":             ["WSH","WAS"], "Washington Nationals": ["WSH","WAS"],
      // NL Central
      "Chicago Cubs":           ["CHC"],
      "Cincinnati":             ["CIN"], "Cincinnati Reds":           ["CIN"],
      "Milwaukee":              ["MIL"], "Milwaukee Brewers":         ["MIL"],
      "Pittsburgh":             ["PIT"], "Pittsburgh Pirates":        ["PIT"],
      "Pittsburg":              ["PIT"],
      "St. Louis":              ["STL"], "St. Louis Cardinals":       ["STL"],
      // NL West
      "Arizona":                ["ARI"], "Arizona Diamondbacks":      ["ARI"],
      "Colorado":               ["COL"], "Colorado Rockies":          ["COL"],
      "LA Dodgers":             ["LAD"], "Los Angeles Dodgers":       ["LAD"],
      "San Diego":              ["SD","SDP"], "San Diego Padres":     ["SD","SDP"],
      "San Francisco":          ["SF","SFG"], "San Francisco Giants": ["SF","SFG"],
      // AL East
      "Baltimore":              ["BAL"], "Baltimore Orioles":         ["BAL"],
      "Boston":                 ["BOS"], "Boston Red Sox":            ["BOS"],
      "NY Yankees":             ["NYY"], "New York Yankees":          ["NYY"],
      "Tampa Bay":              ["TB","TBR"], "Tampa Bay Rays":       ["TB","TBR"],
      "Toronto":                ["TOR"], "Toronto Blue Jays":         ["TOR"],
      // AL Central
      "White Sox":              ["CWS","CHW"], "Chicago White Sox":   ["CWS","CHW"],
      "Cleveland":              ["CLE"], "Cleveland Guardians":       ["CLE"],
      "Detroit":                ["DET"], "Detroit Tigers":            ["DET"],
      "Kansas City":            ["KC","KCR"], "Kansas City Royals":   ["KC","KCR"],
      "Minnesota":              ["MIN"], "Minnesota Twins":           ["MIN"],
      // AL West
      "Houston":                ["HOU"], "Houston Astros":            ["HOU"],
      "LA Angels":              ["LAA"], "Los Angeles Angels":        ["LAA"],
      "Oakland":                ["OAK"], "Oakland Athletics":         ["OAK"],
      "Seattle":                ["SEA"], "Seattle Mariners":          ["SEA"],
      "Texas":                  ["TEX"], "Texas Rangers":             ["TEX"],
    },

    debug: false,
  };

  // ─── UTILS ────────────────────────────────────────────────────────────────────

  const log = (...a) => CFG.debug && console.log("[tm-dups]", ...a);

  const norm = (s) => {
    s = s || "";
    if (CFG.normalizeWhitespace) {
      s = s.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
    } else {
      s = s.trim();
    }
    return s;
  };

  const isVisible = (el) => !!(el && el.offsetParent !== null);

  const escHtml = (str) => String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const addStyle = (css) => {
    try { GM_addStyle(css); }
    catch {
      const st = document.createElement("style");
      st.textContent = css;
      document.documentElement.appendChild(st);
    }
  };

  // ─── ESTILOS ──────────────────────────────────────────────────────────────────

  addStyle(`
    #${CFG.buttonId} {
      margin-left: 8px !important;
      display: inline-flex !important;
      align-items: center;
      gap: 6px;
    }
    .tm-dups-dup-row,
    .tm-dups-dup-row > td {
      background: ${CFG.highlightBg} !important;
    }

    #${CFG.modalId} {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.45);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    #tm-dups-modal {
      width: min(820px, 96vw);
      max-height: min(85vh, 960px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.35);
      border: 1px solid rgba(0,0,0,.15);
      font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    /* Tabs */
    #tm-dups-tabs {
      display: flex;
      border-bottom: 1px solid rgba(0,0,0,.12);
      background: #f4f5f7;
      border-radius: 14px 14px 0 0;
      overflow: hidden;
      flex-shrink: 0;
    }
    .tm-dups-tab {
      flex: 1;
      padding: 12px 16px;
      text-align: center;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      border: none;
      background: transparent;
      color: #666;
      transition: background .15s, color .15s;
    }
    .tm-dups-tab:hover { background: rgba(0,0,0,.05); }
    .tm-dups-tab.active {
      background: #fff;
      color: #222;
      border-bottom: 2px solid #0d6efd;
    }

    /* Cuerpo scrollable */
    #tm-dups-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* PPR: pre limpio */
    #tm-tab-ppr h3 { margin: 0 0 10px; font-size: 14px; color: #222; }
    #tm-tab-ppr pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #f6f7f9;
      border: 1px solid rgba(0,0,0,.08);
      border-radius: 10px;
      padding: 12px;
      margin: 0;
      font-size: 12.5px;
      line-height: 1.6;
    }

    /* TBA: encabezado */
    #tm-tab-tba h3 { margin: 0 0 14px; font-size: 14px; color: #222; }

    /* Sección de errores */
    .tm-section { margin-bottom: 18px; }
    .tm-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .6px;
      color: #555;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #eee;
    }

    /* Tarjeta de error */
    .tm-card {
      border-radius: 8px;
      padding: 9px 12px;
      margin-bottom: 6px;
      font-size: 12.5px;
      line-height: 1.5;
      border: 1px solid;
    }
    .tm-card.warn  { background: #fffbea; border-color: #f0c040; }
    .tm-card.error { background: #fef0f0; border-color: #e74c3c; }
    .tm-card .tm-player  { font-weight: 600; color: #111; }
    .tm-card .tm-detail  { color: #444; margin-top: 2px; }
    .tm-card .tm-ref     { color: #888; font-size: 11px; margin-top: 3px; font-style: italic; }

    /* Ok */
    .tm-ok {
      background: #edfaee;
      border: 1px solid #5cb85c;
      border-radius: 8px;
      padding: 10px 14px;
      color: #2e7d32;
      font-size: 13px;
      font-weight: 500;
    }

    /* Acciones */
    #tm-dups-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 10px 16px;
      border-top: 1px solid rgba(0,0,0,.08);
      flex-shrink: 0;
    }
    .tm-dups-action {
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,.18);
      background: white;
      cursor: pointer;
      font-size: 12px;
    }
    .tm-dups-action:hover { background: #f0f0f0; }

    /* Gallos */
    .tm-gallo-row > td { background-color: #ffeb3b !important; }
    .tm-gallo-row:hover > td { background-color: #ffe000 !important; }
  `);

  // ─── UTILIDADES DOM ───────────────────────────────────────────────────────────

  /**
   * Itera filas de una sección dentro de una ge-table.
   * logoSrc: fragmento del src de la imagen del ge-liga-row que abre la sección.
   * Retorna las <tr> de datos (excluye ge-liga-row).
   */
  function getRowsForSection(logoSrc) {
    const rows = [];
    const tables = [...document.querySelectorAll("table.ge-table")].filter(isVisible);

    for (const table of tables) {
      const allRows = [...table.querySelectorAll("tbody tr")];
      let inSection = false;

      for (const tr of allRows) {
        if (tr.classList.contains("ge-liga-row")) {
          const img = tr.querySelector("img");
          inSection = !!(img && img.src && img.src.includes(logoSrc));
          continue;
        }
        if (inSection) rows.push(tr);
      }
    }
    return rows;
  }

  /** Lee el valor de un input dentro de un td, o su textContent. */
  function tdValue(td) {
    if (!td) return "";
    const inp = td.querySelector("input");
    if (inp) return norm(inp.value || "");
    return norm(td.textContent);
  }

  /** Extrae la abreviatura entre paréntesis al final: "15764Austin Riley(ATL)" → "ATL" */
  function extractAbbrev(text) {
    const m = text.match(/\(([A-Z]{2,4})\)?\s*$/);
    return m ? m[1] : null;
  }

  /** Limpia el texto del jugador: elimina número inicial y retorna "Nombre(ABR)" */
  function cleanPlayer(text) {
    return text.replace(/^\d+/, "").trim();
  }

  /** Retorna abreviaturas válidas para un nombre de equipo MLB */
  function getAbbrevs(teamName) {
    for (const [key, abbrevs] of Object.entries(CFG.teamAbbrevMap)) {
      if (key.toLowerCase() === teamName.toLowerCase()) return abbrevs;
    }
    return [];
  }

  // ─── EXTRACCIÓN MLB ───────────────────────────────────────────────────────────

  /**
   * Retorna Map: serial → { serial, hora, awayName, homeName, awayAbbrevs, homeAbbrevs }
   */
  function extractMlbEvents() {
    const events = new Map();
    const mlbRows = getRowsForSection(CFG.mlbLogoSrc);

    for (const tr of mlbRows) {
      const serial = norm(tr.id || "");
      if (!serial) continue;

      const horaTd = tr.querySelector("td.ge-td-hora");
      const hora = horaTd ? norm(horaTd.textContent) : "";

      const teamLinks = [...tr.querySelectorAll("span.ge-team-link")];
      if (teamLinks.length < 2) continue;

      const awayName = extractMlbTeamName(teamLinks[0]);
      const homeName = extractMlbTeamName(teamLinks[1]);
      if (!awayName || !homeName) continue;

      events.set(serial, {
        serial, hora, awayName, homeName,
        awayAbbrevs: getAbbrevs(awayName),
        homeAbbrevs: getAbbrevs(homeName),
      });
    }

    log("MLB events:", events.size, [...events.values()]);
    return events;
  }

  function extractMlbTeamName(span) {
    const clone = span.cloneNode(true);
    clone.querySelector(".ge-team-cod")?.remove();
    clone.querySelector("img")?.remove();
    return norm(clone.textContent);
  }

  // ─── EXTRACCIÓN TBA ───────────────────────────────────────────────────────────

  /**
   * Retorna array de { tr, evPr, hora, awayRaw, homeRaw, awayAbbrev, homeAbbrev }
   * EV PR viene del input.ev-pr dentro del td[1]
   * Hora viene de td.ge-td-hora
   * Away/Home vienen de span.ge-team-link (primero y segundo)
   */
  function extractTbaRows() {
    const result = [];
    const tbaRows = getRowsForSection(CFG.tbaLogoSrc);

    for (const tr of tbaRows) {
      // EV PR: input con clase ev-pr
      const evPrInput = tr.querySelector("input.ev-pr");
      const evPr = evPrInput ? norm(evPrInput.value) : "";

      // Hora: td con clase ge-td-hora
      const horaTd = tr.querySelector("td.ge-td-hora");
      const hora = horaTd ? norm(horaTd.textContent) : "";

      // Away y Home: span.ge-team-link
      const teamLinks = [...tr.querySelectorAll("span.ge-team-link")];
      if (teamLinks.length < 2) continue;

      const awayRaw = norm(teamLinks[0].textContent); // ej: "15764Austin Riley(ATL)"
      const homeRaw = norm(teamLinks[1].textContent);

      const awayAbbrev = extractAbbrev(awayRaw);
      const homeAbbrev = extractAbbrev(homeRaw);

      result.push({ tr, evPr, hora, awayRaw, homeRaw, awayAbbrev, homeAbbrev });
    }

    log("TBA rows:", result.length, result);
    return result;
  }

  // ─── SCAN TBA ─────────────────────────────────────────────────────────────────

  function scanTba() {
    clearHighlights(document);

    const mlbEvents = extractMlbEvents();
    if (!mlbEvents.size) {
      return `<div class="tm-ok" style="background:#fef0f0;border-color:#e74c3c;color:#c0392b;">
        No encontré eventos MLB visibles en la página.
      </div>`;
    }

    const tbaRows = extractTbaRows();
    if (!tbaRows.length) {
      return `<div class="tm-ok">La tabla TBA está vacía o no es visible.</div>`;
    }

    const errors = { duplicados: [], mismoEquipo: [], evPr: [], hora: [], equipo: [] };

    // ── 1. Duplicados de bateadores ──────────────────────────────────────────────
    // Clave: "NombreJugador(ABR)" — sin número de ID
    const playerMap = new Map(); // clave → [{ idx, row }]
    tbaRows.forEach((row, idx) => {
      for (const raw of [row.awayRaw, row.homeRaw]) {
        const key = cleanPlayer(raw);
        if (!key) continue;
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key).push({ idx, row });
      }
    });

    for (const [player, entries] of playerMap) {
      if (entries.length < 2) continue;
      errors.duplicados.push({ player, entries });
      entries.forEach(({ row }) => row.tr.classList.add("tm-dups-dup-row"));
    }

    // ── 2. Mismo equipo en ambos lados ──────────────────────────────────────────
    for (const row of tbaRows) {
      if (row.awayAbbrev && row.homeAbbrev && row.awayAbbrev === row.homeAbbrev) {
        errors.mismoEquipo.push({
          row,
          msg: `Ambos jugadores son del mismo equipo (${row.awayAbbrev}).`,
        });
        row.tr.classList.add("tm-dups-dup-row");
      }
    }

    // ── 3. Verificar EV PR, hora y equipos ──────────────────────────────────────
    for (const row of tbaRows) {
      // EV PR vacío
      if (!row.evPr) {
        errors.evPr.push({ row, msg: "EV PR está vacío." });
        row.tr.classList.add("tm-dups-dup-row");
        continue;
      }

      const mlb = mlbEvents.get(row.evPr);

      // EV PR no existe en MLB
      if (!mlb) {
        errors.evPr.push({ row, msg: `Serial "${row.evPr}" no existe en los eventos MLB del día.` });
        row.tr.classList.add("tm-dups-dup-row");
        continue;
      }

      // Hora vacía
      if (!row.hora) {
        errors.hora.push({
          row,
          msg: `Hora vacía. El evento ${row.evPr} (${mlb.awayName} vs ${mlb.homeName}) es a las ${mlb.hora}.`,
        });
        row.tr.classList.add("tm-dups-dup-row");
      } else if (row.hora !== mlb.hora) {
        // Hora incorrecta
        errors.hora.push({
          row,
          msg: `Hora "${row.hora}" incorrecta. El evento ${row.evPr} (${mlb.awayName} vs ${mlb.homeName}) es a las ${mlb.hora}.`,
        });
        row.tr.classList.add("tm-dups-dup-row");
      }

      // Equipos: el abbrev del jugador debe pertenecer a uno de los dos equipos del evento.
      // Si la abbrev no esta en el mapa global → no podemos verificar → skip (evita falsos positivos).
      const allValidAbbrevs = [...mlb.awayAbbrevs, ...mlb.homeAbbrevs];
      if (!allValidAbbrevs.length) {
        log("Sin mapa para ningun equipo: " + mlb.awayName + " / " + mlb.homeName);
        continue;
      }

      for (const [side, abbrev, raw] of [["Away", row.awayAbbrev, row.awayRaw], ["Home", row.homeAbbrev, row.homeRaw]]) {
        if (!abbrev) {
          errors.equipo.push({
            row,
            msg: "Sin abreviatura de equipo en " + side + ": \"" + cleanPlayer(raw) + "\". " +
                 "El evento " + row.evPr + " es " + mlb.awayName + " (" + (mlb.awayAbbrevs[0] || "?") + ") vs " + mlb.homeName + " (" + (mlb.homeAbbrevs[0] || "?") + ").",
          });
          row.tr.classList.add("tm-dups-dup-row");
          continue;
        }
        const abbrevKnown = Object.values(CFG.teamAbbrevMap).some(arr => arr.includes(abbrev));
        if (!abbrevKnown) {
          // Abreviatura desconocida: no es válida en ningún equipo MLB conocido
          errors.equipo.push({
            row,
            msg: "Abreviatura desconocida: \"" + abbrev + "\" (" + side + ") no es una abreviatura MLB válida. " +
                 "El evento " + row.evPr + " es " + mlb.awayName + " (" + (mlb.awayAbbrevs[0] || "?") + ") vs " + mlb.homeName + " (" + (mlb.homeAbbrevs[0] || "?") + ").",
          });
          row.tr.classList.add("tm-dups-dup-row");
          continue;
        }
        if (!allValidAbbrevs.includes(abbrev)) {
          errors.equipo.push({
            row,
            msg: "Equipo invalido: \"" + abbrev + "\" (" + side + ") no juega en el evento " + row.evPr + ". " +
                 "El partido es " + mlb.awayName + " (" + (mlb.awayAbbrevs[0] || "?") + ") vs " + mlb.homeName + " (" + (mlb.homeAbbrevs[0] || "?") + ").",
          });
          row.tr.classList.add("tm-dups-dup-row");
        }
      }
    }

    // ── Render ───────────────────────────────────────────────────────────────────
    const total = errors.duplicados.length + errors.mismoEquipo.length + errors.evPr.length + errors.hora.length + errors.equipo.length;

    if (!total) {
      return `<div class="tm-ok">✅ Sin errores. Todos los matchups se ven correctos.</div>`;
    }

    let html = "";

    if (errors.duplicados.length) {
      html += section("🔁 Bateadores repetidos", errors.duplicados.map(e => {
        const rows = e.entries.map(({ row }) =>
          `${cleanPlayer(row.awayRaw)} vs ${cleanPlayer(row.homeRaw)}`
        ).join(" | ");
        return card("error",
          `<div class="tm-player">${escHtml(e.player)}</div>` +
          `<div class="tm-detail">Aparece ${e.entries.length} veces</div>` +
          `<div class="tm-ref">${escHtml(rows)}</div>`
        );
      }));
    }

    if (errors.mismoEquipo.length) {
      html += section("🚫 Mismo equipo en ambos lados", errors.mismoEquipo.map(e =>
        card("error",
          `<div class="tm-detail">${escHtml(e.msg)}</div>` +
          `<div class="tm-ref">${escHtml(cleanPlayer(e.row.awayRaw))} vs ${escHtml(cleanPlayer(e.row.homeRaw))}</div>`
        )
      ));
    }

    if (errors.evPr.length) {
      html += section("❌ EV PR inválido", errors.evPr.map(e =>
        card("error",
          `<div class="tm-detail">${escHtml(e.msg)}</div>` +
          `<div class="tm-ref">${escHtml(cleanPlayer(e.row.awayRaw))} vs ${escHtml(cleanPlayer(e.row.homeRaw))}</div>`
        )
      ));
    }

    if (errors.hora.length) {
      html += section("🕐 Hora incorrecta", errors.hora.map(e =>
        card("warn",
          `<div class="tm-detail">${escHtml(e.msg)}</div>` +
          `<div class="tm-ref">${escHtml(cleanPlayer(e.row.awayRaw))} vs ${escHtml(cleanPlayer(e.row.homeRaw))}</div>`
        )
      ));
    }

    if (errors.equipo.length) {
      html += section("⚾ Equipo inválido", errors.equipo.map(e =>
        card("error",
          `<div class="tm-detail">${escHtml(e.msg)}</div>` +
          `<div class="tm-ref">${escHtml(cleanPlayer(e.row.awayRaw))} vs ${escHtml(cleanPlayer(e.row.homeRaw))}</div>`
        )
      ));
    }

    return html;
  }

  function section(title, cards) {
    return `<div class="tm-section">
      <div class="tm-section-title">${title}</div>
      ${cards.join("")}
    </div>`;
  }

  function card(type, inner) {
    return `<div class="tm-card ${type}">${inner}</div>`;
  }

  // ─── PPR: gallos ─────────────────────────────────────────────────────────────

  function scanGallos(scope) {
    const root = scope || document;
    const rows = [...root.querySelectorAll("tbody tr")];

    // Limpiar marcas previas
    rows.forEach(tr => tr.classList.remove("tm-gallo-row"));

    const found = rows.filter(tr =>
      [...tr.querySelectorAll("img")].some(img => img.src.includes("/gallos.png"))
    );

    found.forEach(tr => tr.classList.add("tm-gallo-row"));
    return found;
  }

  // ─── PPR: lógica original ─────────────────────────────────────────────────────

  function findPprColIndex(table) {
    const ths = [...table.querySelectorAll("thead th")].map(th => norm(th.textContent));
    if (ths.length) {
      const idx = ths.findIndex(h => h === CFG.pprHeaderText);
      if (idx >= 0) return idx;
    }
    for (const tr of table.querySelectorAll("tr")) {
      const rowThs = [...tr.querySelectorAll("th")];
      if (!rowThs.length) continue;
      const texts = rowThs.map(th => norm(th.textContent));
      const idx = texts.findIndex(t => t === CFG.pprHeaderText);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function findMatchingPprTables() {
    let tables = [...document.querySelectorAll("table")];
    if (CFG.onlyVisibleTables) tables = tables.filter(isVisible);
    return tables.filter(t => {
      const idx = findPprColIndex(t);
      if (idx < 0) return false;
      return t.querySelectorAll("tbody tr td").length > 0;
    });
  }

  function getCellValue(td) {
    const inp = td.querySelector("input, textarea, select");
    if (inp) return norm(inp.value || inp.getAttribute("value") || "");
    const aTitle = td.querySelector("a[title]");
    if (aTitle) return norm(aTitle.getAttribute("title") || "");
    return norm(td.textContent);
  }

  function clearHighlights(scope) {
    (scope || document)
      .querySelectorAll(".tm-dups-dup-row")
      .forEach(tr => tr.classList.remove("tm-dups-dup-row"));
  }

  function scanPprDuplicates(scope, tables) {
    clearHighlights(scope);
    if (!tables || !tables.length) {
      return `No encontré tablas visibles con la columna "${CFG.pprHeaderText}".`;
    }
    const counts = new Map();
    const rows   = new Map();
    for (const table of tables) {
      const colIdx = findPprColIndex(table);
      if (colIdx < 0) continue;
      for (const tr of table.querySelectorAll("tbody tr")) {
        const tds = tr.querySelectorAll("td");
        if (tds.length <= colIdx) continue;
        const value = getCellValue(tds[colIdx]);
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
        if (!rows.has(value)) rows.set(value, []);
        rows.get(value).push(tr);
      }
    }
    const dups = [...counts.entries()].filter(([, c]) => c > 1);
    if (!dups.length) return "No hay duplicados en lo cargado actualmente.";
    if (CFG.highlightDuplicates) {
      for (const [value] of dups) {
        for (const tr of (rows.get(value) || [])) tr.classList.add("tm-dups-dup-row");
      }
    }
    dups.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return dups.map(([v, c]) => `${v} — ${c} veces`).join("\n");
  }

  // ─── MODAL ────────────────────────────────────────────────────────────────────

  function openModal(pprScope, pprTables) {
    document.getElementById(CFG.modalId)?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = CFG.modalId;
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    const modal = document.createElement("div");
    modal.id = "tm-dups-modal";
    modal.innerHTML = `
      <div id="tm-dups-tabs">
        <button class="tm-dups-tab active" data-tab="ppr">PPR — Duplicados</button>
        <button class="tm-dups-tab" data-tab="tba">TBA — Verificar</button>
      </div>
      <div id="tm-dups-body">
        <div id="tm-tab-ppr"></div>
        <div id="tm-tab-tba" style="display:none;"></div>
      </div>
      <div id="tm-dups-actions">
        <button class="tm-dups-action" id="tm-dups-copy">Copiar</button>
        <button class="tm-dups-action" id="tm-dups-clear">Quitar resaltado</button>
        <button class="tm-dups-action" id="tm-dups-close">Cerrar</button>
      </div>
    `;

    // PPR: renderizar inmediatamente
    const pprText = scanPprDuplicates(pprScope, pprTables);
    const galloRows = scanGallos(pprScope);

    let galloHtml = "";
    if (galloRows.length) {
      const lista = galloRows.map(tr => {
        const spans = [...tr.querySelectorAll("span.ge-team-link")];
        const away = spans[0] ? norm(spans[0].textContent) : "?";
        const home = spans[1] ? norm(spans[1].textContent) : "?";
        return `<li>${escHtml(cleanPlayer(away))} vs ${escHtml(cleanPlayer(home))}</li>`;
      }).join("");
      galloHtml = `
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#555;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eee;">
            🐓 Gallos detectados (${galloRows.length})
          </div>
          <div style="background:#fffde7;border:1px solid #f9c800;border-radius:8px;padding:10px 12px;">
            <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.8;">${lista}</ul>
          </div>
        </div>`;
    }

    modal.querySelector("#tm-tab-ppr").innerHTML =
      `<h3>Duplicados en "${CFG.pprHeaderText}"</h3>` +
      galloHtml +
      `<pre>${escHtml(pprText)}</pre>`;

    let activeTab = "ppr";
    let tbaRendered = false;

    // Tabs
    modal.querySelectorAll(".tm-dups-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".tm-dups-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        activeTab = tab.dataset.tab;

        modal.querySelector("#tm-tab-ppr").style.display = activeTab === "ppr" ? "" : "none";
        modal.querySelector("#tm-tab-tba").style.display = activeTab === "tba" ? "" : "none";

        if (activeTab === "tba" && !tbaRendered) {
          tbaRendered = true;
          const tbaHtml = scanTba();
          modal.querySelector("#tm-tab-tba").innerHTML =
            `<h3>Verificación TBA</h3>${tbaHtml}`;
        }
      });
    });

    modal.querySelector("#tm-dups-close").addEventListener("click", () => backdrop.remove());

    modal.querySelector("#tm-dups-clear").addEventListener("click", () => {
      clearHighlights(document);
      document.querySelectorAll(".tm-gallo-row").forEach(tr => tr.classList.remove("tm-gallo-row"));
    });

    modal.querySelector("#tm-dups-copy").addEventListener("click", async () => {
      const text = activeTab === "ppr"
        ? pprText
        : (modal.querySelector("#tm-tab-tba")?.innerText || "");
      try { await navigator.clipboard.writeText(text); }
      catch { window.prompt("Copia el texto:", text); }
    });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  // ─── BOTÓN ────────────────────────────────────────────────────────────────────

  function findAddEventButtons() {
    const icons = [...document.querySelectorAll("i.fas.fa-calendar-plus, i.fa-calendar-plus")];
    const btns = icons.map(i => i.closest("button,a")).filter(Boolean);
    return [...new Set(btns)];
  }

  function findScopeForAddButton(addBtn, matchingTables) {
    let el = addBtn;
    for (let i = 0; i < 25 && el; i++) {
      for (const t of matchingTables) {
        if (el.contains(t)) return { scope: el, tables: [t] };
      }
      el = el.parentElement;
    }
    if (matchingTables.length) return { scope: document, tables: matchingTables };
    return null;
  }

  function ensureButtonNearAddEvent() {
    if (document.getElementById(CFG.buttonId)) return true;

    const matchingTables = findMatchingPprTables();
    const addBtns = findAddEventButtons();
    if (!addBtns.length) { log("No Add Event buttons found."); return false; }

    let selected = null;
    for (const addBtn of addBtns) {
      const scoped = findScopeForAddButton(addBtn, matchingTables);
      if (scoped?.tables?.length) {
        selected = { addBtn, scope: scoped.scope, tables: scoped.tables };
        break;
      }
    }
    if (!selected) selected = { addBtn: addBtns[0], scope: document, tables: matchingTables };

    const { addBtn, scope, tables } = selected;

    const btn = document.createElement(addBtn.tagName.toLowerCase());
    btn.className = addBtn.className || "";
    if (btn.tagName === "A") {
      btn.href = "javascript:void(0)";
      btn.setAttribute("role", "button");
    } else {
      btn.type = "button";
    }
    btn.id = CFG.buttonId;
    btn.innerHTML = `${CFG.buttonIconHtml} ${CFG.buttonText}`;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal(scope, tables);
    });

    addBtn.insertAdjacentElement("afterend", btn);
    log("Button attached.");
    return true;
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────────

  ensureButtonNearAddEvent();

  let raf = 0;
  const mo = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; ensureButtonNearAddEvent(); });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

})();