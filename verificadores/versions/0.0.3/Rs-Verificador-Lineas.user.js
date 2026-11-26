// ==UserScript==
// @name         Rs - Verificador de Lineas
// @namespace    noe/roversport/verificadores
// @version      0.0.3
// @description  Verifica Spread, Total y Moneyline FT pregame de NCAAB en Rover y exporta las líneas a Excel.
// @author       noeg
// @match        https://roversport.net/old.php*
// @match        https://www.roversport.net/old.php*
// @match        https://roversport.lol/old.php*
// @match        https://www.roversport.lol/old.php*
// @run-at       document-idle
// @grant        GM_getResourceText
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      site.api.espn.com
// @connect      global.flashscore.ninja
// @connect      global.ds.lsapp.eu
// @connect      api.foxsports.com
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js#sha256=cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41
// @resource     ncaabTeams https://raw.githubusercontent.com/Nox1do/rover-basketball/5ffea472544f17a2c832a9f589d5a28c002ed57d/CBB%20EF%20Score/data/cbb-rover-espn-fox-team-map.json#sha256=c7e597a1c9bb861b631eb9d75b239c77d1cac7738750626a5bf400ba06467434
// @updateURL    https://raw.githubusercontent.com/Nox1do/rover-central-mods/main/verificadores/Rs-Verificador-Lineas.user.js
// @downloadURL  https://raw.githubusercontent.com/Nox1do/rover-central-mods/main/verificadores/Rs-Verificador-Lineas.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const INTERVAL = 5 * MINUTE;
    const RETENTION = 30 * DAY;
    const MAX_START_DRIFT = 20;
    const ZONE = 'America/New_York';
    const FEED_SIGNATURE = 'SW9D1eZo';
    const FOX_WEB_KEY = 'jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq';
    const MARKETS = {
        spread: { label: 'Spread', threshold: 2 },
        total: { label: 'Total', threshold: 2 },
        money0: { label: 'ML equipo 1', threshold: 20 },
        money1: { label: 'ML equipo 2', threshold: 20 }
    };
    const SOURCES = {
        espn: 'ESPN / DraftKings',
        flash: 'FlashscoreUSA / bet365',
        fox: 'FOX Sports'
    };
    const FIELDS = Object.keys(MARKETS);
    const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
        timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const STAMP_FORMAT = new Intl.DateTimeFormat('sv-SE', {
        timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    let teamMap = {};
    try {
        teamMap = JSON.parse(GM_getResourceText('ncaabTeams'));
    } catch (error) {
        console.warn('[Verificador de Lineas] Mapa de equipos no disponible.', error);
    }

    const ncaab = {
        section: /^(?:COLLEGE BASKETBALL|NCAAB|NCAA(?: D-I)?)$/i,
        espn: loadEspn,
        flash: loadFlash,
        fox: loadFox
    };
    const sports = { BASKETBALL: [ncaab] };
    const state = {
        current: new Map(), running: false, lastStarted: 0, checkedAt: 0,
        database: openDatabase().catch(error => {
            console.warn('[Verificador de Lineas] IndexedDB no disponible.', error);
            return null;
        })
    };

    const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const signs = value => clean(value).replace(/[−–]/g, '-');
    const number = value => /^[-+]?\d+(?:\.\d+)?$/.test(signs(value)) ? Number(signs(value)) : null;
    const line = value => /^(?:pk|pick(?:[ ’‘'-]?em)?)$/i.test(clean(value)) ? 0 : number(value);
    const money = value => /^(?:ev|even)$/i.test(clean(value)) ? 100 : number(value);
    const validMoney = value => Number.isInteger(value) && Math.abs(value) >= 100 ? value : null;
    const isNumber = Number.isFinite;
    const within = (value, limit) => isNumber(value) && Math.abs(value) <= limit;
    const decimalToAmerican = value => {
        const decimal = number(value);
        if (decimal === null || decimal <= 1) return null;
        return Math.round(decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1));
    };
    const americanDistance = value => value - Math.sign(value) * 100;
    const isVisible = element => Boolean(element.getClientRects().length) &&
        getComputedStyle(element).visibility === 'visible';
    const visiblePrice = (row, index) =>
        [...(row.cells[index]?.querySelectorAll('xs') ?? [])]
            .filter(node => !node.querySelector('xs')).map(node => clean(node.textContent));
    const timeLabel = timestamp => timestamp ? STAMP_FORMAT.format(timestamp) : '';

    function normalized(value) {
        return clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
            .replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
            .replace(/\bst$/, 'state').replace(/^st /, 'saint ');
    }

    function aliases(...values) {
        return [...new Set(values.flat().map(normalized).filter(Boolean))];
    }

    function clockMinutes(value) {
        const match = clean(value).match(/\b(\d{1,2}):(\d\d)\s*([AP]M)?\b/i);
        if (!match) return null;
        const [, hour, minute, period] = match;
        if (Number(minute) > 59 || Number(hour) > (period ? 12 : 23) || (period && Number(hour) < 1)) return null;
        return (period ? (Number(hour) % 12 + (/PM/i.test(period) ? 12 : 0)) : Number(hour)) * 60 + Number(minute);
    }

    function easternDate(timestamp) {
        return DATE_FORMAT.format(timestamp);
    }

    function clockDistance(left, right) {
        const delta = Math.abs(left - right);
        return Math.min(delta, 1440 - delta);
    }

    function roverSide(node) {
        const pieces = clean(node.textContent).match(/^(\d+)\s*(.+)$/);
        const id = pieces?.[1] ?? '';
        const name = pieces?.[2] ?? clean(node.textContent);
        const mapped = teamMap[id];
        return {
            id, name, espnId: mapped?.espn_id || '',
            names: aliases(name, mapped?.rover_name, mapped?.espn_name, mapped?.fox_name)
        };
    }

    function roverSpread(values) {
        const totalSlots = values.map((value, index) => ({ index, value: number(value) }))
            .filter(({ index, value }) => value !== null && value >= 45 && !signs(values[index]).startsWith('+'));
        const spreadSlots = values.map((value, index) => ({ index, value: line(value) }))
            .filter(({ value }) => within(value, 80));
        const total = totalSlots.length === 1 ? totalSlots[0] : null;
        const candidate = total
            ? spreadSlots.find(item => item.index !== total.index)
            : spreadSlots.length === 1 ? spreadSlots[0] : null;
        return { total: total?.value ?? null, spread: candidate ? candidate.value * (candidate.index === 0 ? 1 : -1) : null };
    }

    function readRover(visibleOnly) {
        const events = [];
        for (const table of document.querySelectorAll('#logros table')) {
            if (visibleOnly && !isVisible(table)) continue;
            let sport = '', league = '', headers = [];
            for (const row of table.rows) {
                const values = [...row.cells].map(cell => clean(cell.textContent));
                if (row.cells[0]?.tagName === 'TH' && values.length === 1) {
                    sport = values[0].toUpperCase();
                    league = '';
                    headers = [];
                } else if (values.length === 1 && /\bactive events?\b/i.test(values[0])) {
                    league = values[0].replace(/\s*-\s*\d+\s+active events?.*$/i, '');
                } else if (normalized(values[0]) === 'date' && normalized(values[1]) === 'teams') {
                    headers = values;
                } else if (row.matches('tr.eventtr') && (!visibleOnly || isVisible(row))) {
                    const teams = [...row.querySelectorAll('div.equipo')].map(roverSide);
                    if (!teams.length || !headers.length) continue;
                    const time = clean(row.querySelector('td.fechaCss center')?.textContent);
                    const profile = (sports[sport] ?? []).find(adapter => adapter.section.test(league));
                    if (visibleOnly && (!profile || teams.length !== 2 || !row.matches('.main_event[event_id]'))) continue;
                    const odds = {
                        ...roverSpread(visiblePrice(row, headers.indexOf('Spread'))),
                        money0: validMoney(money(visiblePrice(row, headers.indexOf('ML'))[0])),
                        money1: validMoney(money(visiblePrice(row, headers.indexOf('ML'))[1]))
                    };
                    const raw = Object.fromEntries(headers.slice(2).flatMap((header, index) => {
                        const prices = visiblePrice(row, index + 2);
                        return prices.some(Boolean) ? [[header || `Columna ${index + 3}`, prices.join(' / ')]] : [];
                    }));
                    const id = row.getAttribute('event_id') ?? '';
                    const parentId = row.getAttribute('main_event') ?? '';
                    const label = row.getAttribute('event_name') ?? '';
                    events.push({ id, parentId, label, row, sport, league, profile, time,
                        minutes: clockMinutes(time), teams, odds, raw });
                }
            }
        }
        return events;
    }

    function request(url, { headers = {}, text = false } = {}) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET', url, headers, anonymous: true, timeout: 12_000,
            onload(response) {
                try {
                    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
                    resolve(text ? response.responseText : JSON.parse(response.responseText));
                } catch (error) {
                    reject(error);
                }
            },
            onerror: () => reject(new Error('Error de conexión')),
            ontimeout: () => reject(new Error('Tiempo de espera agotado'))
        }));
    }

    function settledValues(results) {
        const successful = results.filter(result => result.status === 'fulfilled');
        if (!successful.length) throw results[0]?.reason ?? new Error('Fuente no disponible');
        return successful.flatMap(result => result.value);
    }

    function espnLines(competition) {
        const odds = competition.odds?.find(entry =>
            ['100', '41'].includes(String(entry.provider?.id)) || normalized(entry.provider?.name) === 'draft kings'
            || normalized(entry.provider?.name) === 'draftkings');
        if (!odds) return {};
        return {
            spread: line(odds.pointSpread?.home?.close?.line),
            total: number(odds.overUnder ?? String(odds.total?.over?.close?.line ?? '').replace(/^[ou]/i, '')),
            money0: validMoney(money(odds.moneyline?.home?.close?.odds ?? odds.homeTeamOdds?.moneyLine)),
            money1: validMoney(money(odds.moneyline?.away?.close?.odds ?? odds.awayTeamOdds?.moneyLine))
        };
    }

    async function loadEspn(now) {
        const dates = [...new Set([now, now + DAY].map(ts => easternDate(ts).replace(/-/g, '')))];
        const lists = await Promise.allSettled(dates.map(async date => {
            const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
            const data = await request(`${url}?dates=${date}&groups=50&limit=300`);
            if (!Array.isArray(data.events)) throw new Error('Formato de calendario inesperado');
            return data.events.flatMap(event => (event.competitions ?? []).flatMap(competition => {
                const competitors = ['home', 'away'].map(side => competition.competitors?.find(item => item.homeAway === side));
                if (competitors.some(item => !item?.team)) return [];
                return [{
                    id: String(competition.id ?? event.id), start: Date.parse(competition.date ?? event.date),
                    pre: (competition.status ?? event.status)?.type?.state === 'pre',
                    teams: competitors.map(({ team }) => ({
                        id: String(team.id), names: aliases(team.location, team.shortDisplayName, team.displayName, team.abbreviation)
                    })),
                    odds: espnLines(competition)
                }];
            }));
        }));
        return deduplicate(settledValues(lists));
    }

    function parseFlashFeed(text) {
        if (!text.includes('ZA÷')) throw new Error('Formato de calendario inesperado');
        let league = '';
        const events = [];
        for (const block of text.split('~')) {
            const entries = block.split('¬').map(field => field.split('÷', 2)).filter(pair => pair.length === 2);
            const fields = Object.fromEntries(entries);
            if (fields.ZA) league = fields.ZA;
            if (!/^USA:\s*NCAA$/i.test(league) || !fields.AA || !fields.AD) continue;
            const team = (name, short, alternate, participant) => ({
                id: participant, names: aliases(name, short, alternate)
            });
            events.push({
                id: fields.AA, start: Number(fields.AD) * 1000, pre: fields.AB === '1',
                teams: [team(fields.AE, fields.WM, fields.CX, fields.JA || fields.AU),
                    team(fields.AF, fields.WN, fields.CY, fields.JB || fields.AV)]
            });
        }
        return events;
    }

    async function loadFlash() {
        const urls = [0, 1].map(day => `https://global.flashscore.ninja/2/x/feed/f_3_${day}_3_en_1`);
        const lists = await Promise.allSettled(urls.map(async url => parseFlashFeed(
            await request(url, { text: true, headers: { 'x-fsign': FEED_SIGNATURE } })
        )));
        return deduplicate(settledValues(lists));
    }

    function deduplicate(events) {
        return [...new Map(events.filter(event => isNumber(event.start)).map(event => [event.id, event])).values()];
    }

    function align(row, candidate, espnEvent, isEspn) {
        const ep = espnEvent?.order.map(index => espnEvent.event.teams[index]);
        const matches = (team, source, index) => {
            if (isEspn && team.espnId) return String(team.espnId) === source.id;
            const byName = aliases(team.names, ep?.[index]?.names);
            return source.names.some(name => byName.includes(name));
        };
        const orders = [[0, 1], [1, 0]].filter(order =>
            row.teams.every((team, index) => matches(team, candidate.teams[order[index]], index))
        );
        return orders.length === 1 ? orders[0] : null;
    }

    function matchEvent(row, candidates, now, espnEvent = null, isEspn = false) {
        if (row.minutes === null) return null;
        const matches = [];
        for (const event of candidates) {
            if (event.start < now - 6 * HOUR || event.start > now + 35 * HOUR) continue;
            if (espnEvent && Math.abs(event.start - espnEvent.event.start) > MAX_START_DRIFT * MINUTE) continue;
            const drift = clockDistance(row.minutes, clockMinutes(TIME_FORMAT.format(event.start)));
            if (drift > MAX_START_DRIFT) continue;
            const order = align(row, event, espnEvent, isEspn);
            if (order) matches.push({ event, order, drift });
        }
        matches.sort((a, b) => a.drift - b.drift);
        if (!matches.length || (matches[1] && matches[0].drift === matches[1].drift)) return null;
        return matches[0];
    }

    function flipOdds(odds, order) {
        return order[0] === 0 ? { ...odds } : {
            spread: isNumber(odds.spread) ? -odds.spread : null, total: odds.total,
            money0: odds.money1, money1: odds.money0
        };
    }

    function bestBalancedPair(first, second, inverse = false) {
        const pairs = first.flatMap(a => second.flatMap(b => {
            const x = number(a.handicap?.value);
            const y = number(b.handicap?.value);
            const p = number(a.value);
            const q = number(b.value);
            if (x === null || y === null || p === null || q === null || p <= 1 || q <= 1 || x !== (inverse ? -y : y)) return [];
            return [{ line: x, balance: Math.abs(1 / p - 1 / q) }];
        }));
        pairs.sort((a, b) => a.balance - b.balance || Math.abs(a.line) - Math.abs(b.line) || a.line - b.line);
        return pairs[0]?.line ?? null;
    }

    function parseFlashOdds(payload, participants) {
        const root = payload?.data?.findOddsByEventId;
        if (!root) throw new Error('Flashscore no devolvió el evento');
        if (participants.some(id => !id) || participants[0] === participants[1]) return {};
        const bet365 = root.settings?.bookmakers?.find(item => normalized(item.bookmaker?.name) === 'bet365')?.bookmaker?.id;
        if (bet365 == null) return {};
        const entries = (root.odds ?? []).filter(entry => entry.bookmakerId === bet365
            && entry.bettingScope === 'FULL_TIME_OVER_TIME');
        const active = type => entries.filter(entry => entry.bettingType === type)
            .flatMap(entry => entry.odds ?? []).filter(selection => selection.active === true);
        const byTeam = (items, side) => items.filter(item => item.eventParticipantId === participants[side]);
        const moneyline = active('HOME_AWAY');
        const spread = active('ASIAN_HANDICAP');
        const total = active('OVER_UNDER');
        const moneyFor = side => {
            const prices = [...new Set(byTeam(moneyline, side).map(item => decimalToAmerican(item.value)).filter(isNumber))];
            return prices.length === 1 ? prices[0] : null;
        };
        return {
            spread: bestBalancedPair(byTeam(spread, 0), byTeam(spread, 1), true),
            total: bestBalancedPair(total.filter(item => item.selection === 'OVER'), total.filter(item => item.selection === 'UNDER')),
            money0: moneyFor(0), money1: moneyFor(1)
        };
    }

    async function flashQuote(match) {
        const params = new URLSearchParams({
            _hash: 'oce', eventId: match.event.id, projectId: '130', geoIpCode: 'DO', geoIpSubdivisionCode: 'DO01'
        });
        const payload = await request(`https://global.ds.lsapp.eu/odds/pq_graphql?${params}`);
        const teams = match.order.map(index => match.event.teams[index].id);
        return parseFlashOdds(payload, teams);
    }

    async function loadFox() {
        const url = `https://api.foxsports.com/bifrost/v1/cbk/league/odds?api-version=1.1&apikey=${FOX_WEB_KEY}`;
        const payload = await request(url);
        if (!Array.isArray(payload.sectionList)) throw new Error('Formato de cuotas inesperado');
        return deduplicate(payload.sectionList.flatMap(section => (section.modules ?? []).flatMap(module => {
            if (module.type !== 'six-pack') return [];
            const model = module.model;
            const rows = model?.odds?.rows;
            if (rows?.length !== 2) return [];
            const columns = (model.odds.columnHeaders ?? []).map(normalized);
            const [spreadIndex, moneyIndex, totalIndex] = ['spread', 'to win', 'total'].map(key => columns.indexOf(key));
            const value = (row, index) => rows[row].values?.[index]?.odds;
            const total0 = number(String(value(0, totalIndex) ?? '').replace(/^[ou]\s*/i, ''));
            const total1 = number(String(value(1, totalIndex) ?? '').replace(/^[ou]\s*/i, ''));
            const spread0 = line(value(0, spreadIndex));
            const spread1 = line(value(1, spreadIndex));
            return [{
                id: String(model.contentUri ?? '').split('/').pop(), start: Date.parse(model.eventTime),
                pre: Number(model.eventStatus) === 2,
                teams: rows.map(row => ({ names: aliases(row.fullText, row.text) })),
                odds: { spread: isNumber(spread0) && isNumber(spread1) && spread0 === -spread1 ? spread0 : null,
                    total: total0 === total1 ? total0 : null,
                    money0: validMoney(money(value(0, moneyIndex))), money1: validMoney(money(value(1, moneyIndex))) }
            }];
        })));
    }

    function favorite(odds) {
        const values = [odds.money0, odds.money1];
        if (!values.every(isNumber)) return 0;
        return Math.sign(americanDistance(values[0]) - americanDistance(values[1]));
    }

    function assess(field, rover, sources) {
        const rv = rover[field];
        const market = MARKETS[field];
        const moneyline = field.startsWith('money');
        const entries = Object.entries(sources).flatMap(([source, { odds }]) => {
            const value = odds[field];
            if (!isNumber(rv) || !isNumber(value)) return [];
            const delta = moneyline ? americanDistance(value) - americanDistance(rv) : value - rv;
            const reversed = field === 'spread'
                ? Math.sign(value) * Math.sign(rv) === -1
                : moneyline && favorite(rover) * favorite(odds) === -1;
            return [{ source, value, delta, reversed, exceeds: reversed || Math.abs(delta) >= market.threshold }];
        });
        const outliers = entries.filter(entry => entry.exceeds);
        const confirmed = [-1, 1].map(direction => outliers.filter(entry => Math.sign(entry.delta) === direction))
            .find(group => group.length >= 2);
        return {
            field, rover: rv, entries,
            level: confirmed ? 'confirmed' : outliers.length ? 'review' : entries.length >= 2 ? 'ok' : 'missing',
            sign: confirmed ? Math.sign(confirmed[0].delta) : 0,
            reversed: Boolean(confirmed?.some(entry => entry.reversed) ?? outliers.some(entry => entry.reversed))
        };
    }

    function assessAll(row, quotes) {
        return FIELDS.map(field => assess(field, row.odds, quotes));
    }

    async function mapWithLimit(items, limit, task) {
        const results = new Array(items.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
            while (next < items.length) {
                const index = next++;
                results[index] = await task(items[index]);
            }
        }));
        return results;
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const open = indexedDB.open('rover-verificador-lineas', 1);
            open.onupgradeneeded = () => {
                const db = open.result;
                db.createObjectStore('latest', { keyPath: 'key' }).createIndex('observedAt', 'observedAt');
                db.createObjectStore('changes', { autoIncrement: true }).createIndex('observedAt', 'observedAt');
            };
            open.onsuccess = () => {
                open.result.onversionchange = () => open.result.close();
                resolve(open.result);
            };
            open.onerror = () => reject(open.error);
            open.onblocked = () => reject(new Error('IndexedDB bloqueado por otra pestaña'));
        });
    }

    function fingerprint(record) {
        return JSON.stringify([
            record.rover, Object.fromEntries(Object.entries(record.quotes).map(([key, source]) => [key, source.odds])),
            record.findings.map(item => [item.field, item.level, item.sign, item.reversed])
        ]);
    }

    function newAlerts(record, previous) {
        return record.findings.filter(item => {
            if (item.level !== 'confirmed') return false;
            const prior = previous?.incidents?.[item.field];
            return !prior?.confirmedAt || prior.resolvedAt || prior.direction !== item.sign
                || (item.reversed && !prior.reversed);
        });
    }

    function updateIncidents(record, previous) {
        return Object.fromEntries(record.findings.flatMap(item => {
            const now = record.observedAt;
            const old = previous?.incidents?.[item.field];
            if (item.level === 'missing') return old ? [[item.field, old]] : [];
            if (item.level === 'ok') {
                return old ? [[item.field, { ...old, resolvedAt: old.resolvedAt || now }]] : [];
            }
            const continuing = old && !old.resolvedAt && (!old.direction || !item.sign || old.direction === item.sign);
            return [[item.field, {
                startedAt: continuing ? old.startedAt : now,
                sources: continuing ? old.sources : item.entries.filter(entry => entry.exceeds).map(entry => entry.source),
                confirmedAt: (continuing && old.confirmedAt) || (item.level === 'confirmed' ? now : null),
                direction: item.sign || (continuing ? old.direction : 0),
                reversed: item.reversed || Boolean(continuing && old.reversed),
                resolvedAt: null
            }]];
        }));
    }

    function saveObservations(db, records, now) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['latest', 'changes'], 'readwrite');
            const latest = tx.objectStore('latest');
            const changes = tx.objectStore('changes');
            const alerts = [];
            for (const record of records) {
                const get = latest.get(record.key);
                get.onsuccess = () => {
                    const previous = get.result;
                    if (previous?.observedAt > record.observedAt) return;
                    const changed = !previous || previous.signature !== record.signature;
                    record.previous = changed ? previous?.rover ?? null : previous.previous;
                    record.changedAt = changed ? now : previous.changedAt;
                    record.incidents = updateIncidents(record, previous);
                    latest.put(record);
                    if (changed) changes.add(record);
                    alerts.push(...newAlerts(record, previous).map(item => ({ record, item })));
                };
            }
            for (const store of [latest, changes]) {
                const expired = store.index('observedAt').openCursor(IDBKeyRange.upperBound(now - RETENTION, true));
                expired.onsuccess = () => {
                    const cursor = expired.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
            }
            tx.oncomplete = () => resolve(alerts);
            tx.onabort = () => reject(tx.error);
        });
    }

    function history(db) {
        if (!db) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            const tx = db.transaction('changes', 'readonly');
            const range = IDBKeyRange.lowerBound(Date.now() - RETENTION);
            const query = tx.objectStore('changes').index('observedAt').getAll(range);
            query.onsuccess = () => resolve(query.result);
            query.onerror = () => reject(query.error);
        });
    }

    async function readSources(profile, now) {
        const catalogs = await Promise.allSettled([profile.espn(now), profile.flash(now)]);
        return {
            espn: catalogs[0].value ?? [], flash: catalogs[1].value ?? [],
            errors: catalogs.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? 'ESPN' : 'Flashscore'] : [])
        };
    }

    async function verify() {
        if (state.running) return;
        const rows = readRover(true);
        if (!rows.length) {
            status.textContent = 'Sin juegos de NCAAB en la tabla visible.';
            return;
        }
        state.running = true;
        state.lastStarted = Date.now();
        runButton.disabled = true;
        status.textContent = 'Verificando NCAAB…';
        runButton.setAttribute('aria-busy', 'true');
        const startedAt = Date.now();
        let foxUnavailable = false;
        try {
            const contexts = new Map(await Promise.all([...new Set(rows.map(row => row.profile))]
                .map(async profile => [profile, await readSources(profile, startedAt)])));
            const records = await mapWithLimit(rows, 4, async row => {
                const context = contexts.get(row.profile);
                const espn = matchEvent(row, context.espn, startedAt, null, true);
                const flash = matchEvent(row, context.flash, startedAt, espn);
                const matches = [espn, flash].filter(Boolean);
                if (matches.some(match => !match.event.pre || match.event.start <= startedAt)) return null;
                const quotes = {};
                if (espn) quotes.espn = { id: espn.event.id, odds: flipOdds(espn.event.odds, espn.order) };
                if (flash) {
                    try {
                        quotes.flash = { id: flash.event.id, odds: await flashQuote(flash) };
                    } catch (error) {
                        console.warn('[Verificador de Lineas] Flashscore', flash.event.id, error);
                    }
                }
                let findings = assessAll(row, quotes);
                if (findings.some(item => isNumber(item.rover) && ['review', 'missing'].includes(item.level))) {
                    context.fox ??= row.profile.fox().catch(error => {
                        foxUnavailable = true;
                        console.warn('[Verificador de Lineas] FOX', error);
                        return [];
                    });
                    const fox = matchEvent(row, await context.fox, startedAt, espn);
                    if (fox && !fox.event.pre) return null;
                    if (fox) {
                        matches.push(fox);
                        quotes.fox = { id: fox.event.id, odds: flipOdds(fox.event.odds, fox.order) };
                        findings = assessAll(row, quotes);
                    }
                }
                const start = matches[0]?.event.start ?? null;
                if (start && matches.some(match => match.event.start <= Date.now())) return null;
                const record = {
                    key: `${row.id}|${start ?? easternDate(startedAt)}`,
                    roverId: row.id, roverTime: row.time, teams: row.teams.map(({ id, name }) => ({ id, name })),
                    scheduledAt: start, observedAt: Date.now(), rover: row.odds, quotes, findings
                };
                record.signature = fingerprint(record);
                return record;
            });
            const latestRows = new Map(readRover(true).map(row => [row.id, row]));
            const current = records.filter(Boolean).flatMap(record => {
                const latest = latestRows.get(record.roverId);
                if (!latest || latest.time !== record.roverTime
                    || latest.teams.some((team, index) => team.name !== record.teams[index].name)
                    || (record.scheduledAt && record.scheduledAt <= Date.now())) return [];
                record.rover = latest.odds;
                record.findings = assessAll(latest, record.quotes);
                record.signature = fingerprint(record);
                return [record];
            });
            const db = await state.database;
            let storageError = !db;
            let alerts = current.flatMap(record => {
                const previous = state.current.get(record.roverId);
                record.incidents = updateIncidents(record, previous);
                return newAlerts(record, previous).map(item => ({ record, item }));
            });
            if (db) {
                try {
                    alerts = await saveObservations(db, current, startedAt);
                } catch (error) {
                    storageError = true;
                    console.warn('[Verificador de Lineas] Error guardando historial.', error);
                }
            }
            state.current = new Map(current.map(record => [record.roverId, record]));
            if (!document.hidden) notifyAlerts(alerts);
            const failed = [...new Set([...contexts.values()].flatMap(context => context.errors))];
            if (foxUnavailable) failed.push('FOX');
            state.checkedAt = Date.now();
            const warnings = [
                failed.length ? `Sin respuesta de ${failed.join(', ')}` : '',
                storageError ? 'Historial no disponible' : ''
            ].filter(Boolean);
            status.textContent = warnings.length ? warnings.join(' · ') : 'Verificación completada';
            render();
        } catch (error) {
            console.warn('[Verificador de Lineas]', error);
            status.textContent = 'No se pudo completar la verificación.';
        } finally {
            state.running = false;
            runButton.disabled = false;
            runButton.removeAttribute('aria-busy');
        }
    }

    function notifyAlerts(alerts) {
        if (!alerts.length) return;
        const first = alerts[0];
        const text = `${first.record.teams.map(team => team.name).join(' – ')} · ${MARKETS[first.item.field].label}`;
        try {
            GM_notification({
                title: 'Rover · Discrepancia confirmada',
                text: alerts.length > 1 ? `${text} y ${alerts.length - 1} alertas más` : text,
                timeout: 9000, onclick: () => { window.focus(); panel.open = true; }
            });
        } catch (error) {
            console.warn('[Verificador de Lineas] No se pudo mostrar la notificación.', error);
        }
    }

    function create(tag, text = '') {
        const node = document.createElement(tag);
        node.textContent = text;
        return node;
    }

    function ui(tag, classes, text = '') {
        const node = create(tag, text);
        node.className = classes;
        return node;
    }

    function displayValue(field, value) {
        if (!isNumber(value)) return '—';
        if (field === 'total') return String(value);
        return value > 0 ? '+' + value : String(value);
    }

    const tones = {
        confirmed: { label: 'Confirmada', pill: 'tw-bg-red-100 tw-text-red-800', line: 'tw-border-red-200', value: 'tw-text-red-700' },
        review: { label: 'Por revisar', pill: 'tw-bg-amber-100 tw-text-amber-900', line: 'tw-border-amber-200', value: 'tw-text-amber-800' },
        stale: { label: 'Línea cambió', pill: 'tw-bg-blue-100 tw-text-blue-800', line: 'tw-border-blue-200', value: 'tw-text-blue-700' }
    };

    function badge(level) {
        const tone = tones[level];
        return ui('span', 'tw-inline-flex tw-items-center tw-rounded-full tw-px-2 tw-py-0.5 tw-text-xs tw-font-semibold ' + tone.pill, tone.label);
    }

    function groupAlerts(rows) {
        const groups = [];
        for (const item of rows) {
            item.row.removeAttribute('data-rs-vl');
            const record = state.current.get(item.id);
            if (!record || (record.scheduledAt && record.scheduledAt <= Date.now())) continue;
            if (JSON.stringify(item.odds) !== JSON.stringify(record.rover)) {
                groups.push({ id: item.id, teams: item.teams, time: item.time, level: 'stale', flags: [] });
                continue;
            }
            const flags = record.findings.filter(f => ['confirmed', 'review'].includes(f.level));
            if (!flags.length) continue;
            const level = flags.some(f => f.level === 'confirmed') ? 'confirmed' : 'review';
            item.row.dataset.rsVl = level;
            const logos = [...item.row.querySelectorAll('div.equipo')].map(node => {
                const img = node.querySelector('img');
                try {
                    const raw = img?.getAttribute('src') || img?.currentSrc;
                    if (!raw) return '';
                    const url = new URL(raw, document.baseURI);
                    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
                } catch { return ''; }
            });
            groups.push({ id: item.id, teams: record.teams, time: item.time, level, flags, previous: record.previous,
                inversions: inversionViews(record), logos });
        }
        const rank = { confirmed: 0, review: 1, stale: 2 };
        return groups.sort((a, b) => rank[a.level] - rank[b.level]);
    }

    function marketLabel(field, teams) {
        if (field === 'money0' || field === 'money1') return 'ML · ' + teams[field === 'money0' ? 0 : 1].name;
        if (field === 'spread') return 'Spread · ' + teams[0].name;
        return 'Total FT';
    }

    // Presentation-only: a confirmed discrepancy need not mean a confirmed reversal.
    function inversionViews(record) {
        const views = [];
        for (const kind of ['spread', 'money']) {
            const flags = record.findings.filter(f => ['confirmed', 'review'].includes(f.level)
                && (kind === 'spread' ? f.field === 'spread' : f.field.startsWith('money')));
            const original = kind === 'spread'
                ? (isNumber(record.rover.spread) ? Math.sign(record.rover.spread) : 0)
                : favorite(record.rover);
            if (!original) continue;
            const before = original < 0 ? 0 : 1, after = 1 - before;
            const evidence = [];
            const confirmed = flags.some(f => f.level === 'confirmed' && f.sign &&
                new Set(f.entries.filter(e => e.reversed && e.exceeds && Math.sign(e.delta) === f.sign).map(e => e.source)).size >= 2);
            for (const source of Object.keys(SOURCES)) {
                const matching = flags.flatMap(f => f.entries.filter(e => e.source === source && e.reversed && e.exceeds));
                if (!matching.length) continue;
                const odds = record.quotes?.[source]?.odds;
                if (!odds) continue;
                const sign = kind === 'spread'
                    ? (isNumber(odds.spread) ? Math.sign(odds.spread) : 0)
                    : favorite(odds);
                if (sign !== -original) continue;
                const value = kind === 'spread' ? (after === 0 ? odds.spread : -odds.spread) : odds['money' + after];
                if (!isNumber(value)) continue;
                evidence.push({ source, value, reference: kind === 'spread' ? odds.spread : null,
                    delta: kind === 'spread' ? Math.abs(odds.spread - record.rover.spread) : null });
            }
            if (!evidence.length) continue;
            const value = kind === 'spread'
                ? (before === 0 ? record.rover.spread : -record.rover.spread)
                : record.rover['money' + before];
            if (!isNumber(value)) continue;
            views.push({ kind, before, after, value, reference: kind === 'spread' ? record.rover.spread : null,
                level: confirmed && evidence.length >= 2 ? 'confirmed' : 'review', evidence });
        }
        return views;
    }

    function teamLogo(team, url) {
        const holder = ui('div', 'tw-flex tw-items-center tw-justify-center tw-rounded-lg tw-bg-white tw-border tw-border-slate-200');
        holder.style.cssText = 'width:48px;height:48px;flex:none';
        const fallback = ui('span', 'tw-text-sm tw-font-bold tw-text-slate-600',
            team.name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase());
        holder.append(fallback);
        if (url) {
            const img = create('img');
            img.alt = '';
            img.width = img.height = 38;
            img.style.objectFit = 'contain';
            img.addEventListener('error', () => { img.remove(); fallback.hidden = false; }, { once: true });
            img.addEventListener('load', () => { fallback.hidden = true; }, { once: true });
            holder.append(img);
            fallback.hidden = true;
            img.src = url;
        }
        return holder;
    }

    function favoriteTile(team, logo, label, value, field, level) {
        const tile = ui('div', 'tw-rounded-lg tw-border tw-p-3 tw-flex tw-flex-col tw-gap-2 tw-items-center tw-text-center ' +
            (level ? tones[level].line + ' ' + tones[level].pill : 'tw-border-slate-200 tw-bg-slate-50 tw-text-slate-900'));
        tile.append(ui('div', 'tw-text-xs tw-font-medium', label), teamLogo(team, logo),
            ui('div', 'tw-text-sm tw-font-semibold tw-break-words', team.name),
            ui('div', 'tw-text-xl tw-font-bold tw-tabular-nums', displayValue(field, value)));
        return tile;
    }

    function spreadGraphic(view, teams) {
        const ns = 'http://www.w3.org/2000/svg', color = view.level === 'confirmed' ? '#b91c1c' : '#92400e';
        const svg = document.createElementNS(ns, 'svg');
        const add = (tag, attrs) => {
            const node = document.createElementNS(ns, tag);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
            svg.append(node); return node;
        };
        const values = view.evidence.map(e => e.reference), max = Math.max(1, Math.abs(view.reference), ...values.map(Math.abs));
        const x = v => 160 + v / max * 116;
        const start = x(view.reference), end = x(values[0]), dir = Math.sign(end - start);
        svg.setAttribute('viewBox', '0 0 320 52');
        svg.setAttribute('class', 'tw-w-full');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Spread de ' + teams[0].name + ': Rover ' + displayValue('spread', view.reference) +
            '; fuentes ' + values.map(v => displayValue('spread', v)).join(', '));
        add('line', { x1: 24, y1: 22, x2: 296, y2: 22, stroke: '#cbd5e1', 'stroke-width': 2 });
        add('line', { x1: 160, y1: 11, x2: 160, y2: 33, stroke: '#64748b', 'stroke-width': 1 });
        add('line', { x1: start, y1: 22, x2: end, y2: 22, stroke: color, 'stroke-width': 2.5 });
        add('path', { d: 'M' + (end-dir*9) + ' 15 L' + end + ' 22 L' + (end-dir*9) + ' 29', fill: 'none', stroke: color, 'stroke-width': 2.5 });
        add('circle', { cx: start, cy: 22, r: 5, fill: '#64748b' });
        for (const v of new Set(values)) add('circle', { cx: x(v), cy: 22, r: 4.5, fill: color });
        const text = (v, xx, yy, fill) => {
            const n = add('text', { x: xx, y: yy, fill, 'font-size': 11, 'text-anchor': 'middle', 'font-weight': 600 }); n.textContent = v;
        };
        text(displayValue('spread', view.reference), start, 12, '#475569');
        if (new Set(values).size === 1) text(displayValue('spread', values[0]), end, 12, color);
        text("Pick'em", 160, 46, '#64748b');
        return svg;
    }

    function makeInversion(group, view) {
        const tone = tones[view.level], field = view.kind === 'spread' ? 'spread' : 'money0';
        const block = ui('section', 'tw-m-0 tw-p-3 tw-border-b tw-border-slate-200 tw-bg-white');
        block.dataset.inversion = view.kind;
        block.dataset.level = view.level;
        const heading = ui('div', 'tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2');
        heading.append(ui('strong', 'tw-text-sm tw-font-bold ' + tone.value,
            'Favorito invertido · ' + (view.kind === 'spread' ? 'Spread FT' : 'Moneyline FT')), badge(view.level));
        block.append(heading);
        const pair = ui('div', 'tw-mt-2 tw-grid tw-grid-cols-2 tw-gap-2');
        const values = [...new Set(view.evidence.map(e => e.value))];
        const external = favoriteTile(group.teams[view.after], group.logos[view.after], 'Favorito en fuentes externas', values[0], field, view.level);
        if (values.length > 1) external.lastChild.textContent = values.map(v => displayValue(field, v)).join(' / ');
        pair.append(favoriteTile(group.teams[view.before], group.logos[view.before], 'Favorito en Rover', view.value, field), external);
        block.append(pair);
        if (view.kind === 'spread') {
            const chart = ui('div', 'tw-mt-2');
            chart.style.cssText = 'max-width:480px;margin-left:auto;margin-right:auto';
            chart.append(spreadGraphic(view, group.teams));
            const labels = ui('div', 'tw-flex tw-justify-between tw-gap-2 tw-text-xs tw-text-slate-500');
            labels.append(ui('span', 'tw-text-left', group.teams[0].name + ' favorito'), ui('span', 'tw-text-sm', group.teams[1].name + ' favorito'));
            chart.append(labels); block.append(chart);
            const distances = [...new Set(view.evidence.map(e => e.delta))].sort((a,b) => a-b);
            const value = distances.length === 1 ? String(distances[0]) : distances[0] + '–' + distances.at(-1);
            const distance = ui('div', 'tw-mt-2 tw-flex tw-items-center tw-justify-between tw-gap-2');
            distance.append(ui('span', 'tw-text-xs tw-text-slate-600', 'Diferencia de Spread'),
                ui('strong', 'tw-text-xl tw-font-bold ' + tone.value, value + ' puntos'));
            block.append(distance);
        }
        const evidence = ui('div', 'tw-mt-2 tw-flex tw-flex-wrap tw-gap-1');
        for (const e of view.evidence) evidence.append(ui('span', 'tw-rounded-md tw-bg-slate-100 tw-px-2 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-700',
            SOURCES[e.source] + ' ' + displayValue(field, e.value)));
        block.append(evidence, ui('p', 'tw-m-0 tw-mt-2 tw-text-xs tw-font-medium ' + tone.value,
            view.level === 'confirmed' ? 'Inversión confirmada por las fuentes indicadas.' : 'Inversión pendiente de confirmación; otras diferencias pueden estar confirmadas.'));
        return block;
    }

    function makeCard(group) {
        const card = ui('article', 'tw-rounded-lg tw-border tw-bg-white tw-overflow-hidden ' + tones[group.level].line);
        card.dataset.eventId = group.id;
        const title = ui('div', 'tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-2 tw-bg-slate-50');
        const names = ui('div', 'tw-min-w-0');
        names.append(ui('div', 'tw-font-semibold tw-text-sm tw-text-slate-900 tw-break-words', group.teams.map(t => t.name).join(' vs. ')),
            ui('div', 'tw-text-xs tw-text-slate-500', (group.time || 'Hora pendiente') + ' NY · ID ' + group.id));
        title.append(names, badge(group.level));
        card.append(title);
        if (!group.flags.length) {
            card.append(ui('p', 'tw-m-0 tw-px-3 tw-py-3 tw-text-sm tw-text-blue-800', 'La línea de Rover cambió después de la última consulta. Pendiente de verificar.'));
            return card;
        }
        for (const view of group.inversions || []) card.append(makeInversion(group, view));
        const scroll = ui('div', 'tw-overflow-x-auto');
        const table = ui('table', 'tw-w-full tw-border-collapse tw-text-xs tw-tabular-nums tw-text-left');
        table.setAttribute('aria-label', 'Mercados discrepantes de ' + group.teams.map(t => t.name).join(' vs. '));
        const head = ui('thead', 'tw-bg-white tw-text-slate-500');
        const hr = ui('tr', 'tw-border-b tw-border-slate-200');
        for (const [main, sub] of [['Mercado',''],['Rover','Actual'],['ESPN','DraftKings'],['Flashscore','bet365'],['FOX Sports','']]) {
            const th = ui('th', 'tw-px-3 tw-py-2 tw-font-semibold tw-whitespace-nowrap', main);
            th.scope = 'col';
            if (sub) th.append(ui('div', 'tw-font-normal tw-text-slate-500', sub));
            hr.append(th);
        }
        head.append(hr); table.append(head);
        const body = ui('tbody', 'tw-divide-y tw-divide-slate-100');
        for (const flag of group.flags) {
            const tr = ui('tr', 'tw-align-top');
            const market = ui('td', 'tw-px-3 tw-py-2 tw-min-w-36 tw-text-slate-800');
            market.append(ui('div', 'tw-font-medium', marketLabel(flag.field, group.teams)), badge(flag.level));
            if (flag.reversed) market.append(ui('div', 'tw-mt-1 tw-font-semibold tw-text-red-700', 'Favorito invertido'));
            const rv = ui('td', 'tw-px-3 tw-py-2 tw-whitespace-nowrap tw-font-semibold tw-text-slate-900', displayValue(flag.field, flag.rover));
            const prior = group.previous?.[flag.field];
            if (isNumber(prior) && prior !== flag.rover) rv.append(ui('div', 'tw-font-normal tw-text-slate-500', 'Antes: ' + displayValue(flag.field, prior)));
            tr.append(market, rv);
            for (const key of Object.keys(SOURCES)) {
                const entry = flag.entries.find(e => e.source === key);
                const cell = ui('td', 'tw-px-3 tw-py-2 tw-whitespace-nowrap ' + (entry?.exceeds ? 'tw-font-semibold ' + tones[flag.level].value : 'tw-text-slate-700'), displayValue(flag.field, entry?.value));
                if (entry?.exceeds) {
                    cell.append(ui('div', 'tw-text-xs tw-font-normal', 'Δ ' + (entry.delta > 0 ? '+' : '') + Number(entry.delta.toFixed(2))));
                    cell.title = 'Diferencia respecto a Rover';
                }
                tr.append(cell);
            }
            body.append(tr);
        }
        table.append(body); scroll.append(table); card.append(scroll);
        return card;
    }

    function render() {
        const rows = readRover(true);
        const groups = groupAlerts(rows);
        const counts = { linked: 0, unlinked: 0, confirmed: 0, review: 0, missing: 0 };
        for (const item of rows) {
            const record = state.current.get(item.id);
            if (!record || (record.scheduledAt && record.scheduledAt <= Date.now())) continue;
            counts[record.scheduledAt ? 'linked' : 'unlinked']++;
            for (const level of ['confirmed', 'review', 'missing']) {
                if (record.findings.some(f => f.level === level)) counts[level]++;
            }
        }
        for (const [key, value] of Object.entries(counts)) {
            metricValues[key].textContent = state.checkedAt ? String(value) : '—';
        }
        const total = groups.length;
        summaryCount.textContent = total + (total === 1 ? ' partido' : ' partidos');
        checkedLabel.textContent = state.checkedAt ? 'Última consulta: ' + timeLabel(state.checkedAt) + ' NY' : 'Aún sin verificar';
        for (const [key, button] of Object.entries(filterButtons)) {
            const n = key === 'all' ? total : groups.filter(g => g.level === key || (key === 'review' && g.flags.some(f => f.level === 'review'))).length;
            button.textContent = filterNames[key] + ' (' + n + ')';
            button.setAttribute('aria-pressed', String(activeFilter === key));
        }
        const signature = JSON.stringify([activeFilter, groups]);
        if (signature === lastView) return;
        lastView = signature;
        const shown = activeFilter === 'all' ? groups : groups.filter(g => g.level === activeFilter || (activeFilter === 'review' && g.flags.some(f => f.level === 'review')));
        alertList.replaceChildren(...shown.map(makeCard));
        if (!shown.length) alertList.append(ui('p', 'tw-m-0 tw-rounded-lg tw-border tw-border-dashed tw-border-slate-200 tw-p-4 tw-text-center tw-text-sm tw-text-slate-500', total ? 'No hay partidos para este filtro.' : 'Sin alertas visibles.'));
    }

    function appendSheet(workbook, name, rows) {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
        XLSX.utils.book_append_sheet(workbook, sheet, name);
    }

    async function download() {
        const captured = Date.now();
        const games = readRover(false);
        if (!games.length) {
            status.textContent = 'La tabla de Rover todavía no tiene líneas cargadas.';
            return;
        }
        downloadButton.disabled = true;
        try {
            const current = games.flatMap(game => {
                const record = state.current.get(game.id);
                return record && JSON.stringify(record.rover) === JSON.stringify(game.odds) ? [record] : [];
            });
            let log = [], historyAvailable = true;
            try {
                const db = await state.database;
                historyAvailable = Boolean(db);
                log = await history(db);
            } catch (error) {
                historyAvailable = false;
                console.warn('[Verificador de Lineas] Historial no exportado.', error);
            }
            const marketColumns = [...new Set(games.flatMap(game => Object.keys(game.raw)))];
            const book = XLSX.utils.book_new();
            appendSheet(book, 'Lineas actuales', [
                ['Captura NY', 'Deporte', 'Liga', 'Rover ID', 'Evento principal', 'Descripción', 'Hora NY', 'ID equipo 1', 'Equipo 1', 'ID equipo 2', 'Equipo 2', ...marketColumns],
                ...games.map(game => [timeLabel(captured), game.sport, game.league, game.id, game.parentId, game.label, game.time,
                    game.teams[0]?.id, game.teams[0]?.name, game.teams[1]?.id, game.teams[1]?.name,
                    ...marketColumns.map(field => game.raw[field] ?? '')])
            ]);
            appendSheet(book, 'Discrepancias', [
                ['Observación NY', 'Rover ID', 'Equipo 1', 'Equipo 2', 'Mercado', 'Rover', 'Estado', 'Inversión del favorito', ...Object.values(SOURCES)],
                ...current.flatMap(record => record.findings.filter(item => ['review', 'confirmed'].includes(item.level))
                    .map(item => [timeLabel(record.observedAt), record.roverId, ...record.teams.map(team => team.name),
                        MARKETS[item.field].label, item.rover, item.level === 'confirmed' ? 'Confirmada' : 'Por revisar',
                        item.reversed ? 'Sí' : '', ...Object.keys(SOURCES).map(source =>
                            item.entries.find(entry => entry.source === source)?.value ?? '')]))
            ]);
            appendSheet(book, 'Fuentes', [
                ['Observación NY', 'Rover ID', 'Equipo 1', 'Equipo 2', 'Fuente', 'ID fuente', 'Spread equipo 1', 'Total', 'ML equipo 1', 'ML equipo 2'],
                ...current.flatMap(record => Object.entries(record.quotes).map(([source, quote]) => [
                    timeLabel(record.observedAt), record.roverId, ...record.teams.map(team => team.name),
                    SOURCES[source], quote.id, ...FIELDS.map(field => quote.odds[field] ?? '')
                ]))
            ]);
            appendSheet(book, 'Historial 30 dias', [
                ['Observación NY', 'Inicio NY', 'Rover ID', 'Equipo 1', 'Equipo 2', 'Mercado', 'Rover anterior', 'Rover observado',
                    'Estado', 'Primera diferencia NY', 'Fuentes iniciales', 'Confirmación NY', 'Resolución NY', 'Minutos', ...Object.values(SOURCES)],
                ...log.flatMap(record => record.findings.map(item => {
                    const incident = record.incidents?.[item.field];
                    return [
                    timeLabel(record.observedAt), timeLabel(record.scheduledAt), record.roverId,
                    ...record.teams.map(team => team.name), MARKETS[item.field].label,
                    record.previous?.[item.field] ?? '', item.rover ?? '',
                    { confirmed: 'Confirmada', review: 'Por revisar', ok: 'Dentro del umbral', missing: 'Datos incompletos' }[item.level],
                    timeLabel(incident?.startedAt), incident?.sources.map(source => SOURCES[source]).join(' / ') ?? '',
                    timeLabel(incident?.confirmedAt), timeLabel(incident?.resolvedAt),
                    incident ? Math.round(((incident.resolvedAt || record.observedAt) - incident.startedAt) / MINUTE) : '',
                    ...Object.keys(SOURCES).map(source => record.quotes[source]?.odds[item.field] ?? '')
                    ];
                })),
                ...(!historyAvailable ? [['Historial no disponible en este navegador']] : [])
            ]);
            XLSX.writeFile(book, `Rover-Lineas-${timeLabel(captured).replace(/[: ]/g, '-')}-NY.xlsx`);
        } catch (error) {
            status.textContent = 'No se pudo generar el archivo Excel.';
            console.warn('[Verificador de Lineas] Error de exportación.', error);
        } finally {
            downloadButton.disabled = false;
        }
    }

    const grid = document.querySelector('#logros');
    if (!grid) return;
    const host = create('div');
    host.id = 'rs-vl-host';
    const root = host.attachShadow({ mode: 'open' });
    const toolbar = ui('section', 'tw-rounded-xl tw-border tw-border-slate-200 tw-bg-white tw-p-3 tw-shadow-sm tw-text-slate-800');
    toolbar.id = 'rs-vl-toolbar';
    toolbar.setAttribute('aria-label', 'Verificador de Lineas');
    const head = ui('div', 'tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3');
    const heading = ui('div', 'tw-min-w-0');
    const title = ui('div', 'tw-flex tw-flex-wrap tw-items-center tw-gap-2');
    title.append(ui('h2', 'tw-m-0 tw-text-base tw-font-bold tw-text-slate-900', 'Verificador de Lineas'),
        ui('span', 'tw-rounded-full tw-bg-slate-100 tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-text-slate-600', '0.0.3'));
    heading.append(title, ui('div', 'tw-mt-1 tw-text-xs tw-text-slate-500', 'NCAAB · FT · Pregame · Cada 5 min'));
    const actions = ui('div', 'tw-flex tw-flex-wrap tw-items-center tw-gap-2');
    const buttonBase = 'tw-inline-flex tw-items-center tw-justify-center tw-gap-2 tw-rounded-lg tw-border tw-px-3 tw-py-2 tw-text-sm tw-font-semibold tw-cursor-pointer tw-transition-colors disabled:tw-opacity-50 disabled:tw-cursor-not-allowed';
    const runButton = ui('button', buttonBase + ' tw-border-slate-900 tw-bg-slate-900 tw-text-white hover:tw-bg-slate-700', 'Verificar ahora');
    const downloadButton = ui('button', buttonBase + ' tw-border-emerald-700 tw-bg-white tw-text-emerald-800 hover:tw-bg-emerald-50', 'Descargar Lineas');
    runButton.type = downloadButton.type = 'button';
    function actionIcon(paths) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [name, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
        for (const d of paths) {
            const path = document.createElementNS(svg.namespaceURI, 'path');
            path.setAttribute('d', d);
            svg.append(path);
        }
        return svg;
    }
    runButton.prepend(actionIcon(['M20 11a8 8 0 1 0-2.3 5.7L20 14', 'M20 20v-6h-6']));
    downloadButton.prepend(actionIcon(['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v3h16v-3']));
    actions.append(runButton, downloadButton);
    head.append(heading, actions);
    const metricGrid = ui('div', 'tw-mt-3 tw-grid tw-grid-cols-2 sm:tw-grid-cols-5 tw-gap-2');
    const metricValues = {};
    for (const [key, label, color] of [
        ['linked','Vinculados','tw-text-emerald-700'], ['unlinked','Sin vincular','tw-text-slate-700'],
        ['confirmed','Confirmadas','tw-text-red-700'], ['review','Por revisar','tw-text-amber-800'],
        ['missing','Datos incompletos','tw-text-slate-600']
    ]) {
        const tile = ui('div','tw-rounded-lg tw-border tw-border-slate-200 tw-bg-slate-50 tw-px-3 tw-py-2');
        metricValues[key] = ui('div', 'tw-text-xl tw-font-bold tw-tabular-nums ' + color, '—');
        tile.append(ui('div','tw-text-xs tw-font-medium tw-text-slate-600',label), metricValues[key]);
        metricGrid.append(tile);
    }
    const info = ui('div', 'tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-1 tw-text-xs tw-text-slate-500');
    const status = ui('span', 'tw-font-medium tw-text-slate-700', 'Esperando las líneas de Rover…');
    status.setAttribute('role', 'status');
    const checkedLabel = ui('span','tw-tabular-nums','Aún sin verificar');
    info.append(status, checkedLabel);
    const panel = ui('details','tw-mt-3 tw-border-t tw-border-slate-200 tw-pt-3');
    panel.open = true;
    const summary = ui('summary','tw-cursor-pointer tw-font-semibold tw-text-sm tw-text-slate-800','Discrepancias ');
    const summaryCount = ui('span','tw-ml-1 tw-rounded-full tw-bg-slate-100 tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-text-slate-600','0 partidos');
    summary.append(summaryCount);
    const filters = ui('div','tw-mt-3 tw-flex tw-flex-wrap tw-gap-1');
    const filterNames = { all:'Todos', confirmed:'Confirmadas', review:'Por revisar', stale:'Cambios' };
    const filterButtons = {};
    let activeFilter = 'all', lastView = '';
    for (const [key, label] of Object.entries(filterNames)) {
        const b = ui('button','tw-rounded-md tw-border tw-border-slate-200 tw-bg-white tw-px-2 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-700 tw-cursor-pointer hover:tw-bg-slate-100',label);
        b.type = 'button'; b.setAttribute('aria-pressed',String(key === activeFilter));
        b.addEventListener('click', () => { activeFilter = key; render(); });
        filterButtons[key] = b; filters.append(b);
    }
    const alertList = ui('div','tw-mt-2 tw-flex tw-flex-col tw-gap-2 tw-max-h-96 tw-overflow-y-auto');
    panel.append(summary, filters, alertList);
    toolbar.append(head, metricGrid, info, panel);
    const tailwind = create('style', ".tw-m-0{margin:0}.tw-ml-1{margin-left:.25rem}.tw-mt-1{margin-top:.25rem}.tw-mt-2{margin-top:.5rem}.tw-mt-3{margin-top:.75rem}.tw-flex{display:flex}.tw-inline-flex{display:inline-flex}.tw-grid{display:grid}.tw-max-h-96{max-height:24rem}.tw-w-full{width:100%}.tw-min-w-0{min-width:0}.tw-min-w-36{min-width:9rem}.tw-border-collapse{border-collapse:collapse}.tw-cursor-pointer{cursor:pointer}.tw-grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.tw-flex-col{flex-direction:column}.tw-flex-wrap{flex-wrap:wrap}.tw-items-center{align-items:center}.tw-justify-center{justify-content:center}.tw-justify-between{justify-content:space-between}.tw-gap-1{gap:.25rem}.tw-gap-2{gap:.5rem}.tw-gap-3{gap:.75rem}.tw-divide-y>:not([hidden])~:not([hidden]){--tw-divide-y-reverse:0;border-top-width:calc(1px*(1 - var(--tw-divide-y-reverse)));border-bottom-width:calc(1px*var(--tw-divide-y-reverse))}.tw-divide-slate-100>:not([hidden])~:not([hidden]){--tw-divide-opacity:1;border-color:rgb(241 245 249/var(--tw-divide-opacity,1))}.tw-overflow-hidden{overflow:hidden}.tw-overflow-x-auto{overflow-x:auto}.tw-overflow-y-auto{overflow-y:auto}.tw-whitespace-nowrap{white-space:nowrap}.tw-break-words{overflow-wrap:break-word}.tw-rounded-full{border-radius:9999px}.tw-rounded-lg{border-radius:.5rem}.tw-rounded-md{border-radius:.375rem}.tw-rounded-xl{border-radius:.75rem}.tw-border{border-width:1px}.tw-border-b{border-bottom-width:1px}.tw-border-t{border-top-width:1px}.tw-border-dashed{border-style:dashed}.tw-border-amber-200{--tw-border-opacity:1;border-color:rgb(253 230 138/var(--tw-border-opacity,1))}.tw-border-blue-200{--tw-border-opacity:1;border-color:rgb(191 219 254/var(--tw-border-opacity,1))}.tw-border-emerald-700{--tw-border-opacity:1;border-color:rgb(4 120 87/var(--tw-border-opacity,1))}.tw-border-red-200{--tw-border-opacity:1;border-color:rgb(254 202 202/var(--tw-border-opacity,1))}.tw-border-slate-200{--tw-border-opacity:1;border-color:rgb(226 232 240/var(--tw-border-opacity,1))}.tw-border-slate-900{--tw-border-opacity:1;border-color:rgb(15 23 42/var(--tw-border-opacity,1))}.tw-bg-amber-100{--tw-bg-opacity:1;background-color:rgb(254 243 199/var(--tw-bg-opacity,1))}.tw-bg-blue-100{--tw-bg-opacity:1;background-color:rgb(219 234 254/var(--tw-bg-opacity,1))}.tw-bg-red-100{--tw-bg-opacity:1;background-color:rgb(254 226 226/var(--tw-bg-opacity,1))}.tw-bg-slate-100{--tw-bg-opacity:1;background-color:rgb(241 245 249/var(--tw-bg-opacity,1))}.tw-bg-slate-50{--tw-bg-opacity:1;background-color:rgb(248 250 252/var(--tw-bg-opacity,1))}.tw-bg-slate-900{--tw-bg-opacity:1;background-color:rgb(15 23 42/var(--tw-bg-opacity,1))}.tw-bg-white{--tw-bg-opacity:1;background-color:rgb(255 255 255/var(--tw-bg-opacity,1))}.tw-p-3{padding:.75rem}.tw-p-4{padding:1rem}.tw-px-2{padding-left:.5rem;padding-right:.5rem}.tw-px-3{padding-left:.75rem;padding-right:.75rem}.tw-py-0\\.5{padding-top:.125rem;padding-bottom:.125rem}.tw-py-1{padding-top:.25rem;padding-bottom:.25rem}.tw-py-2{padding-top:.5rem;padding-bottom:.5rem}.tw-py-3{padding-bottom:.75rem}.tw-pt-3,.tw-py-3{padding-top:.75rem}.tw-text-left{text-align:left}.tw-text-center{text-align:center}.tw-align-top{vertical-align:top}.tw-text-base{font-size:1rem;line-height:1.5rem}.tw-text-sm{font-size:.875rem;line-height:1.25rem}.tw-text-xl{font-size:1.25rem;line-height:1.75rem}.tw-text-xs{font-size:.75rem;line-height:1rem}.tw-font-bold{font-weight:700}.tw-font-medium{font-weight:500}.tw-font-normal{font-weight:400}.tw-font-semibold{font-weight:600}.tw-tabular-nums{--tw-numeric-spacing:tabular-nums;font-variant-numeric:var(--tw-ordinal) var(--tw-slashed-zero) var(--tw-numeric-figure) var(--tw-numeric-spacing) var(--tw-numeric-fraction)}.tw-text-amber-800{--tw-text-opacity:1;color:rgb(146 64 14/var(--tw-text-opacity,1))}.tw-text-amber-900{--tw-text-opacity:1;color:rgb(120 53 15/var(--tw-text-opacity,1))}.tw-text-blue-700{--tw-text-opacity:1;color:rgb(29 78 216/var(--tw-text-opacity,1))}.tw-text-blue-800{--tw-text-opacity:1;color:rgb(30 64 175/var(--tw-text-opacity,1))}.tw-text-emerald-700{--tw-text-opacity:1;color:rgb(4 120 87/var(--tw-text-opacity,1))}.tw-text-emerald-800{--tw-text-opacity:1;color:rgb(6 95 70/var(--tw-text-opacity,1))}.tw-text-red-700{--tw-text-opacity:1;color:rgb(185 28 28/var(--tw-text-opacity,1))}.tw-text-red-800{--tw-text-opacity:1;color:rgb(153 27 27/var(--tw-text-opacity,1))}.tw-text-slate-500{--tw-text-opacity:1;color:rgb(100 116 139/var(--tw-text-opacity,1))}.tw-text-slate-600{--tw-text-opacity:1;color:rgb(71 85 105/var(--tw-text-opacity,1))}.tw-text-slate-700{--tw-text-opacity:1;color:rgb(51 65 85/var(--tw-text-opacity,1))}.tw-text-slate-800{--tw-text-opacity:1;color:rgb(30 41 59/var(--tw-text-opacity,1))}.tw-text-slate-900{--tw-text-opacity:1;color:rgb(15 23 42/var(--tw-text-opacity,1))}.tw-text-white{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.tw-shadow-sm{--tw-shadow:0 1px 2px 0 rgba(0,0,0,.05);--tw-shadow-colored:0 1px 2px 0 var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.tw-transition-colors{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.hover\\:tw-bg-emerald-50:hover{--tw-bg-opacity:1;background-color:rgb(236 253 245/var(--tw-bg-opacity,1))}.hover\\:tw-bg-slate-100:hover{--tw-bg-opacity:1;background-color:rgb(241 245 249/var(--tw-bg-opacity,1))}.hover\\:tw-bg-slate-700:hover{--tw-bg-opacity:1;background-color:rgb(51 65 85/var(--tw-bg-opacity,1))}.disabled\\:tw-cursor-not-allowed:disabled{cursor:not-allowed}.disabled\\:tw-opacity-50:disabled{opacity:.5}@media (min-width:640px){.sm\\:tw-grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}}");
    const isolatedStyles = create('style', ':host{display:block;margin:8px 0;font:14px Arial,sans-serif;color:#1e293b;line-height:1.4}*,*::before,*::after{box-sizing:border-box;border-width:0;border-style:solid}button{font-family:inherit}button:focus-visible,summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}button[aria-pressed="true"]{background:#e2e8f0;border-color:#64748b;color:#0f172a}button[aria-busy="true"]{cursor:wait}table{font:inherit}th,td{vertical-align:top}summary{list-style-position:inside}');
    root.append(isolatedStyles, tailwind, toolbar);
    const styles = create('style', '#logros tr[data-rs-vl="confirmed"] > td:first-child { box-shadow: inset 4px 0 #b02030; background: #fff0f0; } #logros tr[data-rs-vl="review"] > td:first-child { box-shadow: inset 4px 0 #9c6100; background: #fff5db; }');
    document.head.append(styles);
    grid.before(host);
    runButton.addEventListener('click', verify);
    downloadButton.addEventListener('click', download);

    let renderScheduled = false;
    const visibleCheck = () => {
        if (!document.hidden && Date.now() - state.lastStarted >= INTERVAL && readRover(true).length) void verify();
    };
    const observer = new MutationObserver(records => {
        if (renderScheduled || !records.some(record => record.type !== 'attributes' || /^(?:id|style|hidden)$/.test(record.attributeName))) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            render();
            visibleCheck();
        });
    });
    observer.observe(grid, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden'] });
    document.addEventListener('visibilitychange', visibleCheck);
    setInterval(visibleCheck, 15_000);
    render();
    if (readRover(true).length) visibleCheck();
})();
