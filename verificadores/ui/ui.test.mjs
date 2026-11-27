import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { firefox } from 'playwright';

const src = readFileSync('verificadores/Rs-Verificador-Lineas.user.js','utf8');
const css = readFileSync(process.env.VL_CSS || '/tmp/rs-vl.css','utf8');
assert.ok(src.includes(JSON.stringify(css.trim())), 'El CSS compilado debe coincidir con el CSS incorporado');
const built = src.includes("'/* TAILWIND_COMPILED */'")
  ? src.replace("'/* TAILWIND_COMPILED */'", () => JSON.stringify(css))
  : src;
const fixture = '<div id="logros"><div class="goToButtons"><button class="goTo" goto="baloncesto">BASKETBALL</button><button class="goTo" goto="futbol">SOCCER</button></div><table><tbody><tr><th colspan="4">BASKETBALL</th></tr><tr><td colspan="4">COLLEGE BASKETBALL - 2 active events</td></tr><tr><td>Date</td><td>Teams</td><td>ML</td><td>Spread</td></tr><tr class="eventtr main_event" event_id="1"><td class="fechaCss"><center>12:00 PM</center></td><td><div class="equipo">730 Oklahoma</div><div class="equipo">721 Purdue</div></td><td><xs>+180</xs><xs>-220</xs></td><td><xs>140.5</xs><xs>-4.5</xs></td></tr><tr class="eventtr main_event" event_id="2"><td class="fechaCss"><center>1:00 PM</center></td><td><div class="equipo">646 Miami</div><div class="equipo">715 Michigan</div></td><td><xs>-135</xs><xs>+115</xs></td><td><xs>-2.5</xs><xs>159.5</xs></td></tr></tbody></table></div><button id="outside" style="background:rgb(1,2,3)">Outside</button>';
test('Firefox: grouped markets, current vs prior, filters, isolation and rebuilt row', async () => {
  const browser=await firefox.launch({headless:true});
  try {
    const page=await browser.newPage({ viewport:{width:1000,height:800} });
    await page.route('https://roversport.net/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
    await page.goto('https://roversport.net/old.php');
    await page.evaluate(()=>{window.GM_getResourceText=()=> '{}';window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('Unexpected network')};});
    const marker='    let renderScheduled = false;';
    assert.ok(built.includes(marker));
    const setup=built.replace(marker, 'window.testUI={state,render,readRover,assessAll}; state.lastStarted=Date.now();\n'+marker);
    await page.addScriptTag({content:setup});
    await page.evaluate(()=>{
      const {state,render,readRover}=window.testUI;
      const rows=readRover(true);
      if(rows.length!==2) throw Error('Bad fixture');
      const f=(field,rover,level,values)=>({field,rover,level,reversed:false,entries:values.map(([source,value,delta,exceeds])=>({source,value,delta,exceeds}))});
      const now=Date.now();
      state.checkedAt=now;
      state.current.set('1',{scheduledAt:now+3600000,teams:rows[0].teams,rover:rows[0].odds,previous:{money1:-205},findings:[
        f('money1',-220,'review',[['espn',-220,0,false],['flashUs',-261,-41,true]]),
        f('spread',4.5,'confirmed',[['espn',-4.5,-9,true],['flashUs',-4.5,-9,true]])]});
      state.current.set('2',{scheduledAt:now+7200000,teams:rows[1].teams,rover:{...rows[1].odds,total:160.5},findings:[]});
      render();
    });
    const host=page.locator('#rs-vl-host');
    assert.equal(await page.locator('button[goto="futbol"] + #rs-vl-launcher').count(),1);
    assert.equal(await host.locator('dialog').isVisible(),false);
    await page.locator('#rs-vl-launcher').click();
    assert.equal(await host.locator('dialog').isVisible(),true);
    assert.equal(await host.locator('details[data-event-id]').count(),2);
    assert.equal(await host.locator('article').count(),0);
    const expand=host.getByRole('button',{name:'Expandir todos los eventos visibles'});
    const collapse=host.getByRole('button',{name:'Contraer todos los eventos visibles'});
    assert.equal(await expand.innerText(),'');
    assert.equal(await collapse.innerText(),'');
    assert.equal(await expand.locator('svg').count(),1);
    assert.equal(await collapse.locator('svg').count(),1);
    assert.equal(await expand.isEnabled(),true);
    assert.equal(await collapse.isDisabled(),true);
    await expand.click();
    assert.equal(await host.locator('details[data-event-id][open]').count(),2);
    assert.equal(await expand.isDisabled(),true);
    assert.equal(await collapse.isEnabled(),true);
    await host.locator('article[data-event-id="1"] tbody tr').first().waitFor();
    assert.equal(await host.locator('article[data-event-id="1"] tbody tr').count(),2);
    assert.ok((await host.locator('article[data-event-id="1"]').innerText()).includes('ML · Purdue'));
    assert.ok((await host.locator('article[data-event-id="1"]').innerText()).includes('Antes: -205'));
    assert.ok((await host.locator('article[data-event-id="2"]').innerText()).includes('Pendiente de verificar'));
    assert.equal(await page.locator('#logros tr[event_id="1"]').getAttribute('data-rs-vl'),'confirmed');
    assert.equal(await host.locator('#rs-vl-toolbar').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'12px');
    assert.equal(await page.locator('#outside').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(1, 2, 3)');
    await host.getByRole('button',{name:'Cambios (1)'}).click();
    assert.equal(await host.locator('details[data-event-id]').count(),1);
    assert.equal(await host.locator('details[data-event-id]').getAttribute('data-event-id'),'2');
    await collapse.click();
    assert.equal(await host.locator('details[data-event-id][open]').count(),0);
    assert.equal(await collapse.isDisabled(),true);
    await host.getByRole('button',{name:'Todos (2)'}).click();
    assert.equal(await host.locator('details[data-event-id="1"][open]').count(),1);
    assert.equal(await host.locator('details[data-event-id="2"][open]').count(),0);
    await expand.click();
    assert.equal(await host.locator('details[data-event-id][open]').count(),2);
    await collapse.click();
    assert.equal(await host.locator('details[data-event-id][open]').count(),0);
    await host.locator('details[data-event-id="1"] > summary').click();
    await page.waitForFunction(()=>!document.querySelector('#rs-vl-host').shadowRoot.querySelector('[aria-label="Contraer todos los eventos visibles"]').disabled);
    assert.equal(await host.locator('details[data-event-id][open]').count(),1);
    await page.evaluate(()=>{const tr=document.querySelector('tr[event_id="1"]');const clone=tr.cloneNode(true);clone.removeAttribute('data-rs-vl');tr.replaceWith(clone)});
    await page.waitForFunction(()=>document.querySelector('tr[event_id="1"]').dataset.rsVl==='confirmed');
    await page.setViewportSize({width:420,height:800});
    assert.ok(await host.getByRole('button',{name:'Descargar Lineas'}).isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await host.locator('dialog').isVisible(),false);
    await page.evaluate(()=>{const menu=document.querySelector('.goToButtons');const clone=menu.cloneNode(true);clone.querySelector('#rs-vl-launcher')?.remove();menu.replaceWith(clone)});
    await page.waitForFunction(()=>!!document.querySelector('button[goto="futbol"] + #rs-vl-launcher'));
    assert.equal(await page.locator('#rs-vl-launcher').count(),1);
  } finally { await browser.close(); }
});


test('Firefox: inversiones de favorito, logos, evidencia, niveles y Moneyline sin duplicados', async () => {
  const browser=await firefox.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:900,height:800}});
    const fixtureWithLogos=fixture.replace('>730 Oklahoma</div>','><img src="/logo-ou.svg" alt="">730 Oklahoma</div>').replace('>721 Purdue</div>','><img src="/logo-pur.svg" alt="">721 Purdue</div>');
    await page.route('https://roversport.net/**',route=>route.request().url().includes('/logo-')
      ? route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#b91c1c"/></svg>'})
      : route.fulfill({contentType:'text/html',body:fixtureWithLogos}));
    await page.goto('https://roversport.net/old.php');
    await page.evaluate(()=>{window.GM_getResourceText=()=> '{}';window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('Unexpected network')};});
    const marker='    let renderScheduled = false;';
    const setup=built.replace(marker,'window.testUI={state,render,readRover,assessAll,inversionViews}; state.lastStarted=Date.now();\n'+marker);
    await page.addScriptTag({content:setup});
    const scenario=async (type)=>page.evaluate(type=>{
      const {state,render,readRover,assessAll,inversionViews}=window.testUI;
      const row=readRover(true)[0], now=Date.now(), rover=row.odds;
      let external;
      if(type==='both') external=[{...rover,spread:-4.5,money0:-220,money1:180},{...rover,spread:-4,money0:-200,money1:170}];
      else if(type==='mixed') external=[{...rover,spread:-4.5},{...rover,spread:1.5}];
      else if(type==='review') external=[{...rover,spread:-4.5},{...rover}];
      else if(type==='normal') external=[{...rover,spread:7.5},{...rover,spread:8}];
      else if(type==='bothnegative') {
        row.row.cells[2].innerHTML='<xs>-105</xs><xs>-115</xs>';
        Object.assign(rover,{money0:-105,money1:-115});
        external=[{...rover,money0:-115,money1:-105},{...rover,money0:-120,money1:-102}];
      }
      const quotes=Object.fromEntries(external.map((odds,i)=>[['espn','flashUs'][i],{odds}]));
      const record={scheduledAt:now+3600000,teams:row.teams,rover,quotes,findings:assessAll({odds:rover},quotes)};
      state.checkedAt=now;state.current.set(row.id,record);render();
      return inversionViews(record);
    },type);
    const host=page.locator('#rs-vl-host');
    const spread=host.locator('[data-inversion="spread"]'), money=host.locator('[data-inversion="money"]');
    await page.locator('#rs-vl-launcher').click();
    const both=await scenario('both');
    await host.locator('details[data-event-id="1"] > summary').click();
    await spread.waitFor();
    assert.equal(both.length,2);
    assert.equal(await spread.getAttribute('data-level'),'confirmed');
    assert.equal(await money.getAttribute('data-level'),'confirmed');
    assert.equal(await money.count(),1);
    assert.ok((await spread.innerText()).includes('Purdue'));
    assert.ok((await spread.innerText()).includes('Oklahoma'));
    assert.ok((await spread.innerText()).includes('8.5–9 puntos'));
    assert.ok((await spread.innerText()).includes('ESPN / DraftKings -4.5'));
    assert.equal(await spread.locator('svg[role=img]').count(),1);
    await spread.locator('img').first().evaluate(img=>img.decode());
    assert.equal(await spread.locator('img').count(),2);
    assert.equal(await money.locator('svg').count(),0);
    assert.ok(!(await money.innerText()).includes('puntos'));
    await page.setViewportSize({width:420,height:800});
    assert.ok(await spread.isVisible());
    const mixed=await scenario('mixed');
    assert.equal(mixed[0].level,'review');
    assert.equal(await spread.getAttribute('data-level'),'review');
    assert.equal(await host.locator('article[data-event-id="1"]').locator('[data-inversion]').count(),1);
    assert.equal(await page.locator('tr[event_id="1"]').getAttribute('data-rs-vl'),'confirmed');
    await scenario('review');
    assert.equal(await spread.getAttribute('data-level'),'review');
    assert.equal(await page.locator('tr[event_id="1"]').getAttribute('data-rs-vl'),'review');
    await scenario('normal');
    assert.equal(await host.locator('[data-inversion]').count(),0);
    assert.ok(await host.locator('article tbody tr').count()>0);
    const negative=await scenario('bothnegative');
    assert.equal(negative.length,1);
    assert.equal(negative[0].kind,'money');
    assert.equal(negative[0].level,'confirmed');
    assert.equal(await money.count(),1);
    await page.unroute('https://roversport.net/**');
    await page.route('**/broken.svg',route=>route.fulfill({status:404,body:''}));
    await page.evaluate(()=>{document.querySelector('tr[event_id="1"] .equipo img').src='/broken.svg';window.testUI.render()});
    await page.waitForFunction(()=>[...document.querySelector('#rs-vl-host').shadowRoot.querySelectorAll('[data-inversion="money"] img')].length<2);
    assert.ok((await money.innerText()).includes('Oklahoma'));
  } finally {await browser.close();}
});


test('Firefox: notificación amarilla sin repetición, escalamiento rojo, persistencia y apertura del evento', async () => {
  const browser=await firefox.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('https://roversport.net/**', route=>route.fulfill({contentType:'text/html',body:fixture}));
    await page.goto('https://roversport.net/old.php');
    await page.evaluate(()=>{
      window.GM_getResourceText=()=> '{}';
      window.notices=[];
      window.GM_notification=details=>window.notices.push(details);
      window.GM_xmlhttpRequest=()=>{throw Error('Unexpected network')};
    });
    const marker='    let renderScheduled = false;';
    const setup=built.replace(marker,'window.testUI={state,render,readRover,assessAll,newAlerts,updateIncidents,saveObservations,notifyAlerts}; state.lastStarted=Date.now();\n'+marker);
    await page.addScriptTag({content:setup});
    const counts=await page.evaluate(async()=>{
      const {state,render,readRover,assessAll,saveObservations,notifyAlerts}=window.testUI;
      const row=readRover(true)[0], rover=row.odds, now=Date.now(), db=await state.database;
      if(!db)throw Error('IndexedDB unavailable');
      const record=(mode,at)=>{
        const odds=mode==='ok'?rover:{...rover,spread:-4.5};
        const quotes={espn:{odds},flashUs:{odds:mode==='red'?odds:rover}};
        return {key:'qa-notify-1',roverId:row.id,roverTime:row.time,teams:row.teams,scheduledAt:now+3600000,observedAt:at,rover,quotes,findings:assessAll({odds:rover},quotes),signature:mode};
      };
      const process=async(mode,offset)=>{
        const r=record(mode,now+offset);
        const alerts=await saveObservations(db,[r],now+offset);
        state.current.set(row.id,r);state.checkedAt=now+offset;render();notifyAlerts(alerts);
        return alerts.map(a=>a.item.level);
      };
      const first=await process('yellow',0), repeat=await process('yellow',1000), red=await process('red',2000), redRepeat=await process('red',3000), ok=await process('ok',4000), again=await process('yellow',5000);
      return {first,repeat,red,redRepeat,ok,again,notices:window.notices.map(n=>({title:n.title,highlight:n.highlight,text:n.text}))};
    });
    assert.deepEqual(counts.first,['review']);
    assert.deepEqual(counts.repeat,[]);
    assert.deepEqual(counts.red,['confirmed']);
    assert.deepEqual(counts.redRepeat,[]);
    assert.deepEqual(counts.ok,[]);
    assert.deepEqual(counts.again,['review']);
    assert.equal(counts.notices.length,3);
    assert.ok(counts.notices[0].title.includes('amarillo'));
    assert.equal(counts.notices[0].highlight,true);
    assert.ok(counts.notices[0].text.includes('Oklahoma'));
    assert.ok(counts.notices[0].text.includes('Rover +4.5'));
    const host=page.locator('#rs-vl-host');
    assert.equal(await host.locator('dialog').isVisible(),false);
    await page.evaluate(()=>window.notices.at(-1).onclick());
    assert.equal(await host.locator('dialog').isVisible(),true);
    assert.equal(await host.locator('details[data-event-id="1"]').evaluate(x=>x.open),true);
    assert.equal(await host.getByRole('button',{name:'Por revisar (1)'}).getAttribute('aria-pressed'),'true');
    assert.ok(await host.locator('article[data-event-id="1"]').isVisible());
    await host.getByRole('button',{name:'Cerrar'}).click();
    assert.equal(await host.locator('dialog').isVisible(),false);
  }finally{await browser.close();}
});


test('Firefox: no launcher during loading; same size and alignment as native sports buttons across refresh', async () => {
  const browser=await firefox.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:900,height:800}});
    const initial='<style>.goToButtons{display:flex;justify-content:center;align-items:stretch;flex-wrap:wrap;margin:20px}.goTo{box-sizing:border-box;width:90px;height:34px;margin:4px;padding:5px 8px;border:1px solid #30363d;border-radius:3px;font:600 13px/20px Arial}</style><div id="logros"><p>Cargando líneas...</p></div>';
    await page.route('https://roversport.net/**',route=>route.fulfill({contentType:'text/html',body:initial}));
    await page.goto('https://roversport.net/old.php');
    await page.evaluate(()=>{window.GM_getResourceText=()=> '{}';window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('Unexpected network')};});
    const marker='    let renderScheduled = false;';
    const setup=built.replace(marker,'state.lastStarted=Date.now();\n'+marker);
    await page.addScriptTag({content:setup});
    assert.equal(await page.locator('#rs-vl-launcher').count(),0);
    const menu='<div class="goToButtons"><button class="goTo btn btn-dark" goto="baloncesto">BASKETBALL</button><button class="goTo btn btn-dark" goto="futbol">SOCCER</button></div>';
    await page.evaluate(html=>{document.querySelector('#logros').innerHTML=html},menu);
    await page.locator('button[goto="futbol"] + #rs-vl-launcher').waitFor();
    const measure=()=>page.evaluate(()=>{
      const a=document.querySelector('button[goto="futbol"]'),b=document.querySelector('#rs-vl-launcher');
      const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
      return {x:[x.width,x.height,x.top],y:[y.width,y.height,y.top],color:getComputedStyle(b).backgroundColor,margin:getComputedStyle(b).margin};
    });
    let dims=await measure();
    assert.deepEqual(dims.x,dims.y);
    assert.deepEqual(dims.y.slice(0,2),[90,34]);
    assert.equal(dims.color,'rgb(219, 234, 254)');
    assert.equal(dims.margin,'4px');
    await page.evaluate(()=>{document.querySelector('#logros').innerHTML='<p>Actualizando...</p>'});
    await page.waitForFunction(()=>!document.querySelector('#rs-vl-launcher'));
    await page.evaluate(html=>{document.querySelector('#logros').innerHTML=html},menu);
    await page.locator('button[goto="futbol"] + #rs-vl-launcher').waitFor();
    assert.equal(await page.locator('#rs-vl-launcher').count(),1);
    dims=await measure();assert.deepEqual(dims.x,dims.y);
    await page.evaluate(()=>{const style=document.createElement('style');style.textContent='.goTo{width:104px;height:38px}';document.head.append(style)});
    await page.waitForFunction(()=>document.querySelector('#rs-vl-launcher').getBoundingClientRect().height===38);
    dims=await measure();assert.deepEqual(dims.x,dims.y);
    await page.locator('#rs-vl-launcher').click();
    assert.equal(await page.locator('#rs-vl-host').locator('dialog').isVisible(),true);
  } finally {await browser.close();}
});


test('Firefox: límites de Moneyline, Spread y Total en FT y H1', async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://roversport.net/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto('https://roversport.net/old.php');
    await page.evaluate(() => { window.GM_getResourceText = () => '{}'; });
    const marker = '    let renderScheduled = false;';
    const setup = built.replace(marker, 'window.testAssess = assess; state.lastStarted = Date.now();\n' + marker);
    await page.addScriptTag({ content: setup });

    const levels = await page.evaluate(() => {
      const cases = {
        spread: [4.5, 5.5, 6],
        h1spread: [-2.5, -3.5, -4],
        money0: [180, 220, 221],
        money1: [-220, -260, -261],
        h1money0: [180, 220, 221],
        h1money1: [-220, -260, -261],
        total: [140.5, 142, 142.5],
        h1total: [65.5, 64.5, 64]
      };
      return Object.fromEntries(Object.entries(cases).map(([field, [rover, boundary, alert]]) => [
        field, [boundary, alert].map(value => {
          const odds = { [field]: value };
          const quotes = { flashUs: { odds }, mgm: { odds } };
          return window.testAssess(field, { [field]: rover }, quotes).level;
        })
      ]));
    });
    for (const [field, results] of Object.entries(levels)) {
      assert.deepEqual(results, ['ok', 'confirmed'], field);
    }
  } finally {
    await browser.close();
  }
});

test('Firefox: H1 isolated from FT, independent sources, tabs, missing Rover moneyline, notifications and threshold', async () => {
  const browser=await firefox.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:800}});
    const halfFixture=fixture.replace('<td>Spread</td></tr>','<td>Spread</td><td>H1</td></tr>')
      .replace('<xs>140.5</xs><xs>-4.5</xs></td></tr>','<xs>140.5</xs><xs>-4.5</xs></td><td><xs>65.5</xs><xs>-2.5</xs></td></tr>')
      .replace('<xs>-2.5</xs><xs>159.5</xs></td></tr>','<xs>-2.5</xs><xs>159.5</xs></td><td><xs>-0.5</xs><xs>74.5</xs></td></tr>');
    await page.route('https://roversport.net/**',route=>route.fulfill({contentType:'text/html',body:halfFixture}));
    await page.goto('https://roversport.net/old.php');
    const resource = src.match(/^\/\/ @resource\s+ncaabTeams .*\/main\/(verificadores\/[^#\s]+)#sha256=([a-f0-9]+)$/m);
    assert.ok(resource, 'El mapa debe ser un recurso versionado del repositorio');
    const teamMap = readFileSync(resource[1], 'utf8');
    assert.equal(createHash('sha256').update(teamMap).digest('hex'), resource[2]);
    const teamIds = Object.values(JSON.parse(teamMap)).map(team => team.flashscore_id);
    assert.ok(teamIds.length >= 365 && teamIds.every(id => /^[A-Za-z0-9]{8}$/.test(id)));
    assert.equal(new Set(teamIds).size, teamIds.length);
    await page.evaluate(resource=>{window.GM_getResourceText=()=>resource;window.notices=[];window.GM_notification=n=>window.notices.push(n);window.GM_xmlhttpRequest=()=>{throw Error('Unexpected network')};}, teamMap);
    const marker='    let renderScheduled = false;';
    const setup=built.replace(marker,'window.testUI={state,render,readRover,roverSide,assessAll,parseFlashFeed,matchEvent,flashQuote,parseFlashOdds,parseUsFlashQuotes,asHalf,flipOdds,inversionViews,notifyAlerts,roverHalfSpread}; state.lastStarted=Date.now();\n'+marker);
    await page.addScriptTag({content:setup});
    const flashMatches = await page.evaluate(async () => {
      const { roverSide, parseFlashFeed, matchEvent, flashQuote } = window.testUI;
      const events = parseFlashFeed([
        'ZA÷USA: NCAA¬',
        "AA÷291kzhDk¬AB÷1¬AD÷1795744800¬AE÷St. John's (N.Y.)¬AF÷Louisville¬PX÷Qak2iShE¬PY÷ruxvM3oE¬JA÷Wz6uMAjt¬JB÷vu8WUpID¬",
        'AA÷bZ1I0KEc¬AB÷1¬AD÷1795750200¬AE÷Nebraska O.¬AF÷Pacific¬PX÷GdHoX45h¬JA÷rNPjjHdT¬JB÷CxGMpeKj¬',
        'AA÷OpF8bsJc¬AB÷1¬AD÷1795744800¬AE÷Kansas State¬AF÷Alabama¬JA÷jNyDZAD7¬JB÷I9w5yXre¬'
      ].join('~'));
      const row = (minutes, ...teams) => ({ minutes, teams: teams.map(text => {
        const node = document.createElement('div');
        node.textContent = text;
        return roverSide(node);
      }) });
      const now = Date.parse('2026-11-27T01:13:00Z');
      const louisville = row(1260, '681 Nombre distinto A', '689 Nombre distinto B');
      const [event, omahaEvent, alabamaEvent] = events;
      const differentNames = { ...event, teams: event.teams.map((team, i) => ({ ...team, names: ['otro nombre ' + i] })) };
      const linked = matchEvent(louisville, [differentNames], now, 'flash');
      const names = row(1260, '681 Louisville', '689 St. Johns');
      const withoutIds = { ...event, id: 'aliasOnly', teams: event.teams.map(team => ({ ...team, flashId: undefined })) };
      const conflicting = { ...event, teams: [{ ...event.teams[0], flashId: 'jTsR15HR' }, event.teams[1]] };
      const unrelated = { ...alabamaEvent, id: 'other', start: alabamaEvent.start + 60_000 };
      let queried = '';
      window.GM_xmlhttpRequest = ({ url, onload }) => {
        queried = new URL(url).searchParams.get('eventId');
        const odds = [
          { active: true, eventParticipantId: 'Wz6uMAjt', value: '1.91', handicap: { value: '-0.5' } },
          { active: true, eventParticipantId: 'vu8WUpID', value: '1.91', handicap: { value: '0.5' } }
        ];
        onload({ status: 200, responseText: JSON.stringify({data:{findOddsByEventId:{
          settings: { bookmakers: [{ bookmaker: { id: 1, name: 'DraftKings' } }] },
          odds: [{ bookmakerId: 1, bettingScope: 'FIRST_HALF', bettingType: 'ASIAN_HANDICAP', odds }]
        }}}) });
      };
      const quotes = await flashQuote(linked);
      return {
        id: linked.event.id, participants: linked.order.map(i => linked.event.teams[i].participantId),
        queried, spread: quotes.dk.odds.h1spread,
        omaha: matchEvent(row(1350, 'Pacific', '979 Nombre distinto'), [{ ...omahaEvent, teams: [
          { ...omahaEvent.teams[0], names: ['nombre sin alias'] }, omahaEvent.teams[1]
        ] }], now, 'flash')?.event.id,
        alabama: matchEvent(row(1260, '899 Alabama', '727 Kansas State'), events, now, 'flash')?.event.id,
        betterEvidence: matchEvent(names, [withoutIds, event], now, 'flash')?.event.id,
        conflicting: matchEvent(names, [conflicting], now, 'flash'),
        ambiguous: matchEvent(row(1260, 'Alabama', 'Kansas State'), [alabamaEvent, unrelated], now, 'flash'),
        wrongTime: matchEvent(row(1230, '681 Louisville', '689 St. Johns'), [event], now, 'flash')
      };
    });
    assert.deepEqual(flashMatches, {
      id: '291kzhDk', participants: ['vu8WUpID', 'Wz6uMAjt'], queried: '291kzhDk', spread: 0.5,
      omaha: 'bZ1I0KEc', alabama: 'OpF8bsJc', betterEvidence: '291kzhDk',
      conflicting: null, ambiguous: null, wrongTime: null
    });
    const data=await page.evaluate(()=>{
      const {state,render,readRover,assessAll,parseFlashOdds,parseUsFlashQuotes,asHalf,flipOdds,inversionViews,roverHalfSpread}=window.testUI;
      const rows=readRover(true), row=rows[0], rover=row.odds, now=Date.now();
      const odds=(scope,spread,total,book=549,mlType='HOME_AWAY')=>[
        {bookmakerId:book,bettingScope:scope,bettingType:'ASIAN_HANDICAP',odds:[{active:true,value:'1.91',eventParticipantId:'A',handicap:{value:String(spread)}},{active:true,value:'1.91',eventParticipantId:'B',handicap:{value:String(-spread)}}]},
        {bookmakerId:book,bettingScope:scope,bettingType:'OVER_UNDER',odds:[{active:true,value:'1.91',selection:'OVER',handicap:{value:String(total)}},{active:true,value:'1.91',selection:'UNDER',handicap:{value:String(total)}}]},
        {bookmakerId:book,bettingScope:scope,bettingType:mlType,odds:[{active:true,value:scope==='FIRST_HALF'?'1.6':'2.8',eventParticipantId:'A'},{active:true,value:scope==='FIRST_HALF'?'2.4':'1.45454545',eventParticipantId:'B'}]}
      ];
      const payload={data:{findOddsByEventId:{settings:{bookmakers:[{bookmaker:{id:549,name:'bet365.us'}},{bookmaker:{id:1205,name:'DraftKings'}},{bookmaker:{id:851,name:'BetMGM.us'}},{bookmaker:{id:30,name:'William Hill'}}]},odds:[
        ...odds('FULL_TIME_OVER_TIME',4.5,140.5),
        ...odds('FIRST_HALF',-2.5,64),
        ...odds('FIRST_HALF',-2.5,64,1205),
        ...odds('FULL_TIME',-10,100,1205),
        ...odds('FULL_TIME_OVER_TIME',-10,100,1205).filter(o=>o.bettingType==='HOME_AWAY'),
        ...odds('FIRST_HALF',2.5,65.5,851),
        ...odds('FIRST_HALF',2.5,65.5,30,'HOME_DRAW_AWAY')
      ]}}};
      const ft=parseFlashOdds(payload,['A','B']), half=parseFlashOdds(payload,['A','B'],'FIRST_HALF');
      const dk=parseFlashOdds(payload,['A','B'],'FIRST_HALF','DraftKings'), mgm=parseFlashOdds(payload,['A','B'],'FIRST_HALF','BetMGM.us');
      const wh=parseFlashOdds(payload,['A','B'],'FIRST_HALF','William Hill');
      const quotes={espn:{odds:{spread:4.5,total:140.5,money0:180,money1:-220}},...parseUsFlashQuotes(payload,['A','B'],'fixture')};
      const dup=assessAll(row,{espn:{odds:{money0:250,money1:-300}},dk:{odds:{money0:250,money1:-300}}});
      const backup=assessAll(row,{dk:{odds:{money0:250,money1:-300}},flashUs:{odds:{money0:250,money1:-300}}});
      const foxOnly=assessAll(row,{espn:{odds:{spread:-4.5}},fox:{odds:{spread:-4.5}}});
      const conflict=assessAll(row,{espn:{odds:{money0:180,money1:-220}},dk:{odds:{money0:250,money1:-300}}});
      const record={scheduledAt:now+3600000,teams:row.teams,rover,quotes,findings:assessAll(row,quotes)};
      const unavailableML = assessAll({ odds: { ...rover, money0: null, money1: null } }, quotes)
        .filter(item => item.field === 'money0' || item.field === 'money1');
      const one=assessAll(row,{espn:quotes.espn,flashUs:quotes.flashUs});
      const normal=assessAll(row,{flashUs:{odds:{h1spread:2.5,h1total:65.9}},dk:{odds:{h1spread:2.5,h1total:65.9}}});
      state.current.set(row.id,record);state.checkedAt=now;render();
      return {rover,second:rows[1].odds,ft,half,dk,mgm,wh,quotes,dup,backup,foxOnly,conflict,unavailableML,findings:record.findings,inversions:inversionViews(record),one,normal,empty:roverHalfSpread(['',''])};
    });
    assert.equal(data.rover.h1spread,2.5);assert.equal(data.rover.h1total,65.5);
    assert.equal(data.rover.h1money0,null);assert.equal(data.second.h1spread,-0.5);
    assert.equal(data.ft.spread,4.5);assert.equal(data.half.spread,-2.5);
    assert.equal(data.half.total,64);assert.equal(data.wh.money0,null);assert.equal(data.wh.spread,2.5);assert.equal(data.dk.spread,-2.5);assert.equal(data.mgm.spread,2.5);
    assert.equal(data.quotes.dk.odds.spread,null);assert.equal(data.quotes.dk.odds.total,null);assert.equal(data.quotes.dk.odds.money0,180);
    assert.equal(data.dup.find(f=>f.field==='money0').level,'review');assert.equal(data.dup.find(f=>f.field==='money0').entries.find(e=>e.source==='dk').duplicate,true);
    assert.equal(data.backup.find(f=>f.field==='money0').level,'confirmed');assert.equal(data.foxOnly.find(f=>f.field==='spread').level,'review');assert.equal(data.conflict.find(f=>f.field==='money0').level,'missing');
    assert.equal(data.empty.spread,null);
    assert.equal(data.findings.find(f=>f.field==='spread').level,'ok');
    assert.equal(data.findings.find(f=>f.field==='h1spread').level,'confirmed');
    assert.equal(data.findings.find(f=>f.field==='h1total').level,'confirmed');
    assert.equal(data.findings.find(f=>f.field==='h1money0').level,'unavailable');
    assert.equal(data.findings.find(f=>f.field==='h1money0').entries.length,3);
    assert.deepEqual(data.unavailableML.map(item => item.level), ['unavailable', 'unavailable']);
    assert.deepEqual(data.unavailableML.map(item => item.entries[0].value), [180, -220]);
    assert.ok(data.unavailableML.every(item => item.entries.every(entry => entry.delta === null && !entry.exceeds)));
    assert.equal(data.one.find(f=>f.field==='h1spread').level,'review');
    assert.equal(data.normal.find(f=>f.field==='h1total').level,'ok');
    assert.equal(data.inversions.length,1);assert.equal(data.inversions[0].period,'h1');
    const host=page.locator('#rs-vl-host');
    await page.locator('#rs-vl-launcher').click();
    await host.locator('details[data-event-id="1"] > summary').click();
    const article=host.locator('article[data-event-id="1"]');
    await article.waitFor();
    assert.equal(await article.locator('[data-period-tab="h1"]').getAttribute('aria-pressed'),'true');
    assert.equal(await article.locator('[data-inversion="spread"][data-period="h1"]').count(),1);
    assert.ok((await article.innerText()).includes('Sin línea en Rover'));
    assert.ok((await article.innerText()).includes('BetMGM.us'));
    await article.locator('[data-period-tab="ft"]').click();
    assert.equal(await article.locator('[data-inversion]').count(),0);
    assert.ok((await article.innerText()).includes('FOX Sports'));
    assert.ok((await article.innerText()).includes('Misma casa · no cuenta'));
    await host.getByRole('button',{name:'Contraer todos los eventos visibles'}).click();
    await host.getByRole('button',{name:'Expandir todos los eventos visibles'}).click();
    assert.equal(await article.locator('[data-period-tab="ft"]').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{const {state,notifyAlerts}=window.testUI;const record=state.current.get('1');record.roverId='1';notifyAlerts([{record,item:record.findings.find(f=>f.field==='h1spread')}]);window.notices.at(-1).onclick()});
    assert.equal(await article.locator('[data-period-tab="h1"]').getAttribute('aria-pressed'),'true');
    assert.ok(await page.evaluate(()=>window.notices.at(-1).text.includes('Spread H1')));
  }finally{await browser.close();}
});
