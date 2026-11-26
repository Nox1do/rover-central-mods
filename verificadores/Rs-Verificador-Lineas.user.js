// ==UserScript==
// @name         Rs - Verificador de Lineas
// @namespace    noe/roversport/verificadores
// @version      0.0.1
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
            const count = level => current.filter(record => record.findings.some(finding => finding.level === level)).length;
            const warnings = [
                failed.length ? `Sin respuesta de ${failed.join(', ')}` : '',
                storageError ? 'Historial no disponible' : ''
            ].filter(Boolean);
            status.textContent = [
                `${current.filter(record => record.scheduledAt).length} pregame vinculados`,
                `${current.filter(record => !record.scheduledAt).length} sin vincular`, `${count('confirmed')} con alerta`,
                `${count('review')} por revisar`, `${count('missing')} con datos incompletos`,
                `${timeLabel(state.checkedAt)} NY`, ...warnings
            ].join(' · ');
            render();
        } catch (error) {
            console.warn('[Verificador de Lineas]', error);
            status.textContent = 'No se pudo completar la verificación.';
        } finally {
            state.running = false;
            runButton.disabled = false;
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

    function render() {
        const rows = readRover(true);
        const messages = [];
        for (const item of rows) {
            item.row.removeAttribute('data-rs-vl');
            const record = state.current.get(item.id);
            if (!record || (record.scheduledAt && record.scheduledAt <= Date.now())) continue;
            if (JSON.stringify(item.odds) !== JSON.stringify(record.rover)) {
                messages.push(`${item.teams.map(team => team.name).join(' – ')} · Línea cambió, pendiente de verificar`);
                continue;
            }
            const flags = record.findings.filter(finding => ['confirmed', 'review'].includes(finding.level));
            if (flags.length) item.row.dataset.rsVl = flags.some(finding => finding.level === 'confirmed') ? 'confirmed' : 'review';
            for (const flag of flags) {
                const market = MARKETS[flag.field].label;
                const providers = flag.entries.map(entry => `${SOURCES[entry.source]} ${entry.value}`).join(' · ');
                const prior = record.previous?.[flag.field];
                const change = isNumber(prior) && prior !== flag.rover ? ` · Rover antes ${prior}` : '';
                const label = flag.level === 'confirmed' ? 'Confirmada' : 'Por revisar';
                messages.push(`${label} · ${record.teams.map(team => team.name).join(' – ')} · ${market} · Rover ${flag.rover}${change} · ${providers}`);
            }
        }
        alertList.replaceChildren(...messages.map(message => create('li', message)));
        if (!messages.length) alertList.append(create('li', 'Sin alertas visibles.'));
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
    const toolbar = create('section');
    toolbar.id = 'rs-vl-toolbar';
    toolbar.setAttribute('aria-label', 'Verificador de Lineas');
    const runButton = create('button', 'Verificar ahora');
    const downloadButton = create('button', 'Descargar Lineas');
    runButton.type = downloadButton.type = 'button';
    const status = create('span', 'Esperando las líneas de Rover…');
    status.setAttribute('role', 'status');
    const panel = create('details');
    const alertList = create('ul');
    panel.append(create('summary', 'Discrepancias'), alertList);
    toolbar.append(runButton, downloadButton, status, panel);
    const styles = create('style', `
        #rs-vl-toolbar { border: 1px solid #bbb; margin: 8px 0; padding: 8px 12px; font: 14px Arial,sans-serif; }
        #rs-vl-toolbar button { margin: 0 8px 4px 0; padding: 4px 8px; }
        #rs-vl-toolbar details { margin-top: 4px; }
        #rs-vl-toolbar ul { margin-bottom: 0; }
        #logros tr[data-rs-vl="confirmed"] > td:first-child { box-shadow: inset 4px 0 #b02030; background: #fff0f0; }
        #logros tr[data-rs-vl="review"] > td:first-child { box-shadow: inset 4px 0 #9c6100; background: #fff5db; }
    `);
    document.head.append(styles);
    grid.before(toolbar);
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
