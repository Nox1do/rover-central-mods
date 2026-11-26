import { test } from "node:test";
import assert from "node:assert/strict";
import { firefox } from "playwright";
import { readFileSync } from "node:fs";
import { coreFactory } from "../src/core.mjs";
const url="https://roversport.net/old.php";
const now=Date.parse("2026-11-26T16:27:40Z");
const row=(id,teams,ml,sp,time="12:00 PM")=>'<tr class="eventtr main_event" event_id="'+id+'"><td class="fechaCss"><center>'+time+'</center></td><td>'+teams.map(t=>'<div class="equipo"><span>'+t+'</span></div>').join("")+'</td><td>'+ml.map(v=>'<center><xs>'+v+'</xs></center>').join("")+'</td><td>'+sp.map(v=>'<center><xs>'+v+'</xs></center>').join("")+'</td></tr>';
const html='<html><body><div id="last_update">Thursday, November 26 2026 11:27:40 AM</div><table><tbody><tr><td colspan="13"><img src="/images/ncaab.png">COLLEGE BASKETBALL - 2 active events</td></tr><tr><td>Date</td><td>Teams</td><td>ML</td><td>Spread</td></tr>'+row("1231790",["730 Oklahoma","721 Purdue"],["+180","-220"],["140.5","-4.5"])+row("2",["646 Miami (FL)","715 Michigan"],["-135","+115"],["-2.5","159.5"],"03:30 PM")+'<tr><td colspan="13">FOOTBALL</td></tr>'+row("999",["1 NFL Team","2 NFL Team"],["",""],["",""])+'</tbody></table></body></html>';
const date="2026-11-26T17:00Z";
const espn={events:[{id:"401906807",date,status:{type:{state:"pre"}},competitions:[{timeValid:true,competitors:[{homeAway:"away",team:{id:"201",abbreviation:"OU",displayName:"Oklahoma Sooners"}},{homeAway:"home",team:{id:"2509",abbreviation:"PUR",displayName:"Purdue Boilermakers"}}],odds:[{provider:{name:"DraftKings"},overUnder:140.5,pointSpread:{away:{close:{line:"-4.5"}},home:{close:{line:"+4.5"}}},moneyline:{away:{close:{odds:"-220"}},home:{close:{odds:"+180"}}}}]}]}]};
const value=(id,market,odds)=>({odds,betSlip:{trackingData:{betEntityUri:"team:basketball/cbk/teams/"+id,betOutcomeTitle:market}}});
const fox={sectionList:[{modules:[{model:{contentUri:"basketball/cbk/events/264833",eventTime:date,eventStatus:2,odds:{rows:[{text:"OKLA",fullText:"Oklahoma Sooners",values:[value("48","spread","-4.5"),value("48","to win","-209"),value("48","total","O 140.5")]},{text:"PUR",fullText:"Purdue Boilermakers",values:[value("93","spread","+4.5"),value("93","to win","+170"),value("93","total","U 140.5")]}]}}}]}]};
const cell=(book,a,b)=>'<td data-book="'+book+'" data-game="390771" data-date="'+Math.floor(now/1000)+'"><div class="away-cell"><a class="odds-cta">'+a+'</a></div><div class="home-cell"><a class="odds-cta">'+b+'</a></div></td>';
const coversTable=(market,a,b)=>'<table id="'+market+'-table"><tbody><tr class="oddsGameRow"><td><div class="game-time">Today, 12:00</div><div class="teams-div"><div class="away-cell"><strong>OKLA</strong></div><div class="home-cell"><strong>PUR</strong></div></div></td>'+cell("FanDuel",a,b)+'</tr></tbody></table>';
const covers=coversTable("spread","-4.5 <span class='American'>-110</span>","+4.5 <span class='American'>-110</span>")+coversTable("moneyline","<span class='American'>-220</span>","<span class='American'>+180</span>")+coversTable("total","o 140.5 <span class='American'>-110</span>","u 140.5 <span class='American'>-110</span>");
const map={"730":{espn:"201",fox:"48"},"721":{espn:"2509",fox:"93"}};
test("Firefox: DOM realista, orientación, coincidencia Covers, flujo rojo, reconstrucción y exportación",async()=>{
 const browser=await firefox.launch({headless:true});
 try{
 const page=await browser.newPage();
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("https://roversport.net/**",route=>route.fulfill({status:200,contentType:"text/html",body:html}));
 await page.goto(url);
 const parsed=await page.evaluate(({src,now,espn,fox,covers,map})=>{
   const C=eval("("+src+")")();
   const rows=C.parseRover(document).map(C.cleanRow);
   const r=rows[0],e=C.matchEvent(r,C.espnEvents(espn),map,"espn","2026-11-26",now),f=C.matchEvent(r,C.foxEvents(fox),map,"fox","2026-11-26",now);
   const c=C.coversCandidates(new DOMParser().parseFromString(covers,"text/html"),r,e,f,"2026-11-26",now);
   return {rows,c,verdict:C.audit(r,[e,f,...c])};
 },{src:coreFactory.toString(),now,espn,fox,covers,map});
 assert.equal(parsed.rows.length,2);assert.equal(parsed.rows[0].spread,4.5);assert.equal(parsed.rows[1].spread,-2.5);
 assert.equal(parsed.c.length,1);assert.equal(parsed.c[0].provider,"fanduel");assert.equal(parsed.c[0].spread,-4.5);assert.equal(parsed.c[0].total,140.5);assert.equal(parsed.verdict.state,"red");
 await page.evaluate(({now,espn,fox,covers})=>{
   Date.now=()=>now;
   const values={};window._notices=[];window._sheets=[];
   window.GM_getValue=(k,v)=>values[k]??v;
   window.GM_setValue=(k,v)=>{values[k]=v};
   window.GM_addStyle=s=>{const el=document.createElement("style");el.textContent=s;document.head.append(el)};
   window.GM_notification=v=>window._notices.push(v);
   window.GM_xmlhttpRequest=o=>queueMicrotask(()=>o.onload({status:200,responseText:o.url.includes("espn")?JSON.stringify(espn):o.url.includes("foxsports")?JSON.stringify(fox):covers}));
   window.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>({"!ref":"A1:K3",rows}),book_append_sheet:(wb,ws,name)=>window._sheets.push({name,rows:ws.rows})},writeFile:()=>{}};
 },{now,espn,fox,covers});
 await page.addScriptTag({content:readFileSync(new URL("../dist/Verificador-de-Lineas.user.js",import.meta.url),"utf8")});
 await page.waitForSelector('tr[event_id="1231790"].vl-red',{timeout:15000});
 assert.equal(await page.evaluate(()=>window._notices.length),1);
 await page.evaluate(()=>{const x=document.querySelector('tr[event_id="1231790"]');const y=x.cloneNode(true);y.className="eventtr main_event";y.querySelector(".vl-note")?.remove();x.replaceWith(y)});
 await page.waitForSelector('tr[event_id="1231790"].vl-red',{timeout:4000});
 await page.getByRole("button",{name:"Descargar Lineas"}).click();
 const sheets=await page.evaluate(()=>window._sheets);
 assert.equal(sheets.length,4);assert.equal(sheets[0].rows.length,5);assert.equal(sheets[0].rows[1][5],4.5);
 assert.deepEqual(errors,[]);
 } finally{await browser.close()}
});