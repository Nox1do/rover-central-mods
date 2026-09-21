// ==UserScript==
// @name         Rs - Duplicados (v2.3)
// @namespace    noe/roversport/dups
// @version      2.3.0
// @description  Duplicados PPR por jugador, equipo y mercado; valida HOME contra API sin afectar Gallos ni TBA.
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
    .tm-dups-ppr-row,
    .tm-dups-ppr-row > td,
    .tm-dups-tba-row,
    .tm-dups-tba-row > td {
      background: ${CFG.highlightBg} !important;
    }
    .tm-dups-api-row,
    .tm-dups-api-row > td {
      background: rgba(220, 53, 69, 0.24) !important;
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
    clearTbaHighlights(document);

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
      entries.forEach(({ row }) => row.tr.classList.add("tm-dups-tba-row"));
    }

    // ── 2. Mismo equipo en ambos lados ──────────────────────────────────────────
    for (const row of tbaRows) {
      if (row.awayAbbrev && row.homeAbbrev && row.awayAbbrev === row.homeAbbrev) {
        errors.mismoEquipo.push({
          row,
          msg: `Ambos jugadores son del mismo equipo (${row.awayAbbrev}).`,
        });
        row.tr.classList.add("tm-dups-tba-row");
      }
    }

    // ── 3. Verificar EV PR, hora y equipos ──────────────────────────────────────
    for (const row of tbaRows) {
      // EV PR vacío
      if (!row.evPr) {
        errors.evPr.push({ row, msg: "EV PR está vacío." });
        row.tr.classList.add("tm-dups-tba-row");
        continue;
      }

      const mlb = mlbEvents.get(row.evPr);

      // EV PR no existe en MLB
      if (!mlb) {
        errors.evPr.push({ row, msg: `Serial "${row.evPr}" no existe en los eventos MLB del día.` });
        row.tr.classList.add("tm-dups-tba-row");
        continue;
      }

      // Hora vacía
      if (!row.hora) {
        errors.hora.push({
          row,
          msg: `Hora vacía. El evento ${row.evPr} (${mlb.awayName} vs ${mlb.homeName}) es a las ${mlb.hora}.`,
        });
        row.tr.classList.add("tm-dups-tba-row");
      } else if (row.hora !== mlb.hora) {
        // Hora incorrecta
        errors.hora.push({
          row,
          msg: `Hora "${row.hora}" incorrecta. El evento ${row.evPr} (${mlb.awayName} vs ${mlb.homeName}) es a las ${mlb.hora}.`,
        });
        row.tr.classList.add("tm-dups-tba-row");
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
          row.tr.classList.add("tm-dups-tba-row");
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
          row.tr.classList.add("tm-dups-tba-row");
          continue;
        }
        if (!allValidAbbrevs.includes(abbrev)) {
          errors.equipo.push({
            row,
            msg: "Equipo invalido: \"" + abbrev + "\" (" + side + ") no juega en el evento " + row.evPr + ". " +
                 "El partido es " + mlb.awayName + " (" + (mlb.awayAbbrevs[0] || "?") + ") vs " + mlb.homeName + " (" + (mlb.homeAbbrevs[0] || "?") + ").",
          });
          row.tr.classList.add("tm-dups-tba-row");
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

  // ─── PPR: duplicados por jugador + equipo + mercado HOME ──────────────────────

  function normalizeKeyText(value) {
    return norm(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[.'’`\-]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function stripLeadingCode(value) {
    return norm(value).replace(/^\s*#?\d+\s*/, "").trim();
  }

  function normalizePlayerKey(value) {
    return normalizeKeyText(value).replace(/\s+/g, "");
  }

  function parsePlayerCell(value) {
    const clean = stripLeadingCode(value);
    const match = clean.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const playerName = norm(match ? match[1] : clean);
    const team = norm(match ? match[2] : "").toUpperCase();
    return {
      playerName,
      team,
      playerKey: normalizePlayerKey(playerName),
      teamKey: normalizeKeyText(team),
    };
  }

  function parseMarketCell(value) {
    const marketName = stripLeadingCode(value);
    return { marketName, marketKey: canonicalMarket(marketName) };
  }

  function canonicalMarket(value) {
    const key = normalizeKeyText(value)
      .replace(/^total\s+/, "")
      .replace(/\byds?\b/g, "yards")
      .replace(/\byards?\b/g, "yards")
      .replace(/\btds?\b/g, "touchdowns");
    const aliases = {
      "rec yards": "receiving yards",
      "receiving yards": "receiving yards",
      "rush yards": "rushing yards",
      "rushing yards": "rushing yards",
      "pass yards": "passing yards",
      "passing yards": "passing yards",
      "receptions": "receptions",
      "rush attempts": "rushing attempts",
      "rushing attempts": "rushing attempts",
      "pass attempts": "passing attempts",
      "passing attempts": "passing attempts",
      "pass completions": "passing completions",
      "passing completions": "passing completions",
      "interceptions": "interceptions",
      "pass interceptions": "interceptions",
      "passing interceptions": "interceptions",
      "pass tds": "passing touchdowns",
      "passing tds": "passing touchdowns",
      "pass touchdowns": "passing touchdowns",
      "passing touchdowns": "passing touchdowns",
      "rec touchdowns": "receiving touchdowns",
      "receiving touchdowns": "receiving touchdowns",
      "rush touchdowns": "rushing touchdowns",
      "rushing touchdowns": "rushing touchdowns",
    };
    return aliases[key] || key;
  }

  function parseApiEvent(value) {
    const clean = norm(value);
    const separator = clean.lastIndexOf(" - ");
    if (separator <= 0 || separator >= clean.length - 3) return null;
    return {
      playerName: norm(clean.slice(0, separator)),
      marketName: norm(clean.slice(separator + 3)),
    };
  }

  function getPprHeaderTexts(table) {
    let cells = [...table.querySelectorAll("thead th")];
    if (!cells.length) {
      const headerRow = [...table.querySelectorAll("tr")]
        .find(tr => tr.querySelectorAll("th").length);
      cells = headerRow ? [...headerRow.querySelectorAll("th")] : [];
    }
    return cells.map(th => normalizeKeyText(th.textContent));
  }

  function findPprColumns(table) {
    const headers = getPprHeaderTexts(table);
    const find = label => headers.indexOf(normalizeKeyText(label));
    return {
      evPr: find("EV PR"),
      sn: find("SN"),
      away: find("AWAY"),
      home: find("HOME"),
      api: find(CFG.pprHeaderText),
    };
  }

  function findMatchingPprTables() {
    let tables = [...document.querySelectorAll("table")];
    if (CFG.onlyVisibleTables) tables = tables.filter(isVisible);
    return tables.filter(table => {
      const columns = findPprColumns(table);
      return columns.away >= 0 && columns.home >= 0 && columns.api >= 0 &&
        table.querySelectorAll("tbody tr td").length > 0;
    });
  }

  function getCellValue(td) {
    const inp = td.querySelector("input, textarea, select");
    if (inp) return norm(inp.value || inp.getAttribute("value") || "");
    const aTitle = td.querySelector("a[title]");
    if (aTitle) return norm(aTitle.getAttribute("title") || "");
    return norm(td.textContent);
  }

  function clearPprHighlights(scope) {
    (scope || document)
      .querySelectorAll(".tm-dups-ppr-row, .tm-dups-api-row")
      .forEach(tr => {
        tr.classList.remove("tm-dups-ppr-row");
        tr.classList.remove("tm-dups-api-row");
      });
  }

  function clearTbaHighlights(scope) {
    (scope || document)
      .querySelectorAll(".tm-dups-tba-row")
      .forEach(tr => tr.classList.remove("tm-dups-tba-row"));
  }

  function clearHighlights(scope) {
    clearPprHighlights(scope);
    clearTbaHighlights(scope);
  }

  function extractPprRecords(tables) {
    const records = [];
    for (const table of tables || []) {
      const columns = findPprColumns(table);
      if (columns.away < 0 || columns.home < 0 || columns.api < 0) continue;

      for (const tr of table.querySelectorAll("tbody tr")) {
        const tds = [...tr.querySelectorAll("td")];
        const maxRequired = Math.max(columns.away, columns.home, columns.api);
        if (tds.length <= maxRequired) continue;

        records.push({
          tr,
          sn: columns.sn >= 0 && tds[columns.sn] ? getCellValue(tds[columns.sn]) : norm(tr.id || ""),
          evPr: columns.evPr >= 0 && tds[columns.evPr] ? getCellValue(tds[columns.evPr]) : "",
          playerRaw: getCellValue(tds[columns.away]),
          marketRaw: getCellValue(tds[columns.home]),
          apiRaw: getCellValue(tds[columns.api]),
        });
      }
    }
    return records;
  }

  function analyzePprRecords(records) {
    const entries = (records || []).map((record, index) => {
      const player = parsePlayerCell(record.playerRaw);
      const market = parseMarketCell(record.marketRaw);
      const api = parseApiEvent(record.apiRaw);
      return {
        ...record,
        index,
        ...player,
        ...market,
        apiPlayerName: api?.playerName || "",
        apiMarketName: api?.marketName || "",
        apiParsed: !!api,
        apiPlayerKey: api ? normalizePlayerKey(api.playerName) : "",
        apiMarketKey: api ? canonicalMarket(api.marketName) : "",
      };
    });

    const incomplete = entries.filter(row => !row.playerKey || !row.teamKey || !row.marketKey);
    const apiUnparsed = entries.filter(row => !row.apiParsed);
    const valid = entries.filter(row => row.playerKey && row.teamKey && row.marketKey);
    const groups = new Map();

    for (const row of valid) {
      const key = `${row.playerKey}|${row.teamKey}|${row.marketKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const duplicateGroups = [...groups.values()]
      .filter(group => group.length > 1)
      .map(group => ({
        playerName: group[0].playerName,
        team: group[0].team,
        marketName: group[0].marketName,
        entries: group,
      }))
      .sort((a, b) => b.entries.length - a.entries.length ||
        `${a.playerName}|${a.marketName}`.localeCompare(`${b.playerName}|${b.marketName}`));

    const comparable = entries.filter(row => row.apiPlayerKey && row.apiMarketKey);
    const playerMismatches = comparable.filter(row => row.playerKey !== row.apiPlayerKey);
    const marketMismatches = comparable.filter(row => row.marketKey !== row.apiMarketKey);

    return { entries, duplicateGroups, playerMismatches, marketMismatches, incomplete, apiUnparsed };
  }

  function pprRowReference(row) {
    const refs = [];
    if (row.sn) refs.push(`SN ${row.sn}`);
    if (row.evPr) refs.push(`EV PR ${row.evPr}`);
    refs.push(`HOME: ${row.marketName || stripLeadingCode(row.marketRaw) || "?"}`);
    refs.push(`API: ${row.apiRaw || "vacío"}`);
    return refs.join(" · ");
  }

  function renderPprReport(analysis) {
    const html = [];
    const text = [];

    if (analysis.duplicateGroups.length) {
      const cards = analysis.duplicateGroups.map(group => {
        const title = `${group.playerName} (${group.team}) — ${group.marketName}`;
        text.push(`DUPLICADO: ${title} — ${group.entries.length} veces`);
        group.entries.forEach(row => text.push(`  ${pprRowReference(row)}`));
        return card("error",
          `<div class="tm-player">${escHtml(title)}</div>` +
          `<div class="tm-detail">Aparece ${group.entries.length} veces para el mismo jugador y equipo.</div>` +
          `<div class="tm-ref">${group.entries.map(row => escHtml(pprRowReference(row))).join("<br>")}</div>`
        );
      });
      html.push(section("🔁 Jugador y mercado repetidos", cards));
    }

    if (analysis.marketMismatches.length) {
      const cards = analysis.marketMismatches.map(row => {
        text.push(`MERCADO INCONSISTENTE: ${row.playerName} (${row.team}) · ${pprRowReference(row)}`);
        return card("warn",
          `<div class="tm-player">${escHtml(`${row.playerName} (${row.team})`)}</div>` +
          `<div class="tm-detail">HOME "${escHtml(row.marketName)}" no corresponde a API "${escHtml(row.apiMarketName)}".</div>` +
          `<div class="tm-ref">${escHtml(pprRowReference(row))}</div>`
        );
      });
      html.push(section("⚠️ Mercado HOME diferente a la API", cards));
    }

    if (analysis.playerMismatches.length) {
      const cards = analysis.playerMismatches.map(row => {
        text.push(`JUGADOR INCONSISTENTE: ${row.playerName} / API ${row.apiPlayerName} · ${pprRowReference(row)}`);
        return card("warn",
          `<div class="tm-player">${escHtml(`${row.playerName} (${row.team})`)}</div>` +
          `<div class="tm-detail">AWAY no corresponde al jugador de la API: "${escHtml(row.apiPlayerName)}".</div>` +
          `<div class="tm-ref">${escHtml(pprRowReference(row))}</div>`
        );
      });
      html.push(section("⚠️ Jugador AWAY diferente a la API", cards));
    }

    const incompleteRows = [...new Set([...analysis.incomplete, ...analysis.apiUnparsed])];
    if (incompleteRows.length) {
      const cards = incompleteRows.map(row => {
        text.push(`FILA INCOMPLETA: ${pprRowReference(row)}`);
        return card("warn",
          `<div class="tm-detail">No se pudo interpretar completamente jugador, equipo, mercado o Event Name (API).</div>` +
          `<div class="tm-ref">${escHtml(pprRowReference(row))}</div>`
        );
      });
      html.push(section("🧩 Filas incompletas", cards));
    }

    if (!html.length) {
      return {
        html: `<div class="tm-ok">✅ Sin duplicados ni inconsistencias PPR.</div>`,
        text: "Sin duplicados ni inconsistencias PPR.",
      };
    }
    return { html: html.join(""), text: text.join("\n") };
  }

  function scanPprDuplicates(scope, tables) {
    clearPprHighlights(scope);
    if (!tables || !tables.length) {
      const message = `No encontré tablas visibles con las columnas AWAY, HOME y "${CFG.pprHeaderText}".`;
      return { html: `<div class="tm-ok" style="background:#fef0f0;border-color:#e74c3c;color:#c0392b;">${escHtml(message)}</div>`, text: message };
    }

    const analysis = analyzePprRecords(extractPprRecords(tables));
    if (CFG.highlightDuplicates) {
      analysis.duplicateGroups.forEach(group =>
        group.entries.forEach(row => row.tr?.classList.add("tm-dups-ppr-row"))
      );
      [...analysis.marketMismatches, ...analysis.playerMismatches, ...analysis.incomplete, ...analysis.apiUnparsed]
        .forEach(row => row.tr?.classList.add("tm-dups-api-row"));
    }
    return { ...renderPprReport(analysis), analysis };
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
    const pprReport = scanPprDuplicates(pprScope, pprTables);
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
      `<h3>Verificación PPR</h3>` +
      galloHtml +
      pprReport.html;

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
        ? pprReport.text
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

    const { addBtn } = selected;

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
      const currentTables = findMatchingPprTables();
      const current = findScopeForAddButton(btn, currentTables) || {
        scope: document,
        tables: currentTables,
      };
      openModal(current.scope, current.tables);
    });

    addBtn.insertAdjacentElement("afterend", btn);
    log("Button attached.");
    return true;
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────────

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      analyzePprRecords,
      canonicalMarket,
      clearPprHighlights,
      clearTbaHighlights,
      extractPprRecords,
      parseApiEvent,
      parsePlayerCell,
      parseMarketCell,
      renderPprReport,
      scanGallos,
    };
    return;
  }

  ensureButtonNearAddEvent();

  let raf = 0;
  const mo = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; ensureButtonNearAddEvent(); });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

})();
