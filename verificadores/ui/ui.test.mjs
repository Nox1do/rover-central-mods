import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firefox } from 'playwright';

const src = readFileSync('verificadores/Rs-Verificador-Lineas.user.js','utf8');
const css = readFileSync(process.env.VL_CSS || '/tmp/rs-vl.css','utf8');
assert.ok(src.includes(JSON.stringify(css.trim())), 'El CSS compilado debe coincidir con el CSS incorporado');
const built = src.includes("'/* TAILWIND_COMPILED */'")
  ? src.replace("'/* TAILWIND_COMPILED */'", () => JSON.stringify(css))
  : src;
const fixture = '<div id="logros"><table><tbody><tr><th colspan="4">BASKETBALL</th></tr><tr><td colspan="4">COLLEGE BASKETBALL - 2 active events</td></tr><tr><td>Date</td><td>Teams</td><td>ML</td><td>Spread</td></tr><tr class="eventtr main_event" event_id="1"><td class="fechaCss"><center>12:00 PM</center></td><td><div class="equipo">730 Oklahoma</div><div class="equipo">721 Purdue</div></td><td><xs>+180</xs><xs>-220</xs></td><td><xs>140.5</xs><xs>-4.5</xs></td></tr><tr class="eventtr main_event" event_id="2"><td class="fechaCss"><center>1:00 PM</center></td><td><div class="equipo">646 Miami</div><div class="equipo">715 Michigan</div></td><td><xs>-135</xs><xs>+115</xs></td><td><xs>-2.5</xs><xs>159.5</xs></td></tr></tbody></table></div><button id="outside" style="background:rgb(1,2,3)">Outside</button>';
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
        f('money1',-220,'review',[['espn',-220,0,false],['flash',-250,-30,true]]),
        f('spread',4.5,'confirmed',[['espn',-4.5,-9,true],['flash',-4.5,-9,true]])]});
      state.current.set('2',{scheduledAt:now+7200000,teams:rows[1].teams,rover:{...rows[1].odds,total:160.5},findings:[]});
      render();
    });
    const host=page.locator('#rs-vl-host');
    assert.equal(await host.locator('article').count(),2);
    assert.equal(await host.locator('article[data-event-id="1"] tbody tr').count(),2);
    assert.ok((await host.locator('article[data-event-id="1"]').innerText()).includes('ML · Purdue'));
    assert.ok((await host.locator('article[data-event-id="1"]').innerText()).includes('Antes: -205'));
    assert.ok((await host.locator('article[data-event-id="2"]').innerText()).includes('Pendiente de verificar'));
    assert.equal(await page.locator('#logros tr[event_id="1"]').getAttribute('data-rs-vl'),'confirmed');
    assert.equal(await host.locator('section').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'12px');
    assert.equal(await page.locator('#outside').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(1, 2, 3)');
    await host.getByRole('button',{name:'Cambios (1)'}).click();
    assert.equal(await host.locator('article').count(),1);
    assert.equal(await host.locator('article').getAttribute('data-event-id'),'2');
    await host.getByRole('button',{name:'Todos (2)'}).click();
    await page.evaluate(()=>{const tr=document.querySelector('tr[event_id="1"]');const clone=tr.cloneNode(true);clone.removeAttribute('data-rs-vl');tr.replaceWith(clone)});
    await page.waitForFunction(()=>document.querySelector('tr[event_id="1"]').dataset.rsVl==='confirmed');
    await page.setViewportSize({width:420,height:800});
    assert.ok(await host.getByRole('button',{name:'Descargar Lineas'}).isVisible());
    await host.locator('summary').click();
    assert.equal(await host.locator('details').evaluate(x=>x.open),false);
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
      const quotes=Object.fromEntries(external.map((odds,i)=>[['espn','flash'][i],{odds}]));
      const record={scheduledAt:now+3600000,teams:row.teams,rover,quotes,findings:assessAll({odds:rover},quotes)};
      state.checkedAt=now;state.current.set(row.id,record);render();
      return inversionViews(record);
    },type);
    const host=page.locator('#rs-vl-host');
    const spread=host.locator('[data-inversion="spread"]'), money=host.locator('[data-inversion="money"]');
    const both=await scenario('both');
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
