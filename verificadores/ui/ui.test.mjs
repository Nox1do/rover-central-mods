import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firefox } from 'playwright';

const src = readFileSync('verificadores/Rs-Verificador-Lineas.user.js','utf8');
const css = readFileSync(process.env.VL_CSS || '/tmp/rs-vl.css','utf8');
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
