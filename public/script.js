(function(){
"use strict";
var drops=[],restocks=[],updatedAt=null;
var $=function(s){return document.querySelector(s)};
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function pad(n){return String(n).padStart(2,"0")}
function parts(ms){ms=Math.max(0,ms);var s=Math.floor(ms/1000);return{d:Math.floor(s/86400),h:Math.floor(s%86400/3600),m:Math.floor(s%3600/60),s:s%60}}
function fmt(ms){if(ms<=0)return "LIVE NOW";var p=parts(ms);return (p.d?p.d+"d ":"")+pad(p.h)+"h "+pad(p.m)+"m "+pad(p.s)+"s"}
function ago(iso){var s=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(s<60)return "just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago"}
var DAY=new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"America/New_York"});
var LIVE_WINDOW=6*3600*1000;
var EMO={kicks:"👟",ye:"🧱",street:"🔴",collect:"🧸",games:"🎮",tix:"🎟"};
var LABEL={kicks:"kicks",ye:"ye",street:"street",collect:"collectible",games:"console",tix:"tickets"};
var filter="all",timers=[];
function has(d,f){return f==="all"||(d.tags||[d.kind]).indexOf(f)>=0}
function thumb(d){
  var t=el("div","thumb "+d.kind);
  var fallback=function(){t.textContent=d.emoji||EMO[d.kind]||"⚡";t.className="thumb emo "+d.kind;t.setAttribute("aria-hidden","true")};
  if(d.img){var im=el("img");im.src=d.img;im.alt=d.name;im.loading="lazy";im.referrerPolicy="no-referrer";im.width=120;im.height=120;im.onerror=fallback;t.appendChild(im)}else fallback();
  return t;
}
function acts(d){
  var a=el("div","acts");
  var buy=el("a","btn btn-hot btn-sm",d.kind==="tix"?"Tickets ↗":"Shop ↗");buy.href=d.shop||d.source;buy.target="_blank";buy.rel="noopener";a.appendChild(buy);
  var p=el("button","btn btn-ghost btn-sm","🔔 Ping me");p.type="button";p.addEventListener("click",function(){openPing({drop:d})});a.appendChild(p);
  var s=el("a","src","source");s.href=d.source;s.target="_blank";s.rel="noopener";a.appendChild(s);
  return a;
}
function render(){
  var list=$("#list");list.textContent="";timers=[];var lastDay="";var now=Date.now();
  var v=drops.filter(function(d){return Date.parse(d.at)+LIVE_WINDOW>now&&has(d,filter)});
  var r=restocks.filter(function(d){return has(d,filter)});
  $("#count").textContent=drops.filter(function(d){return Date.parse(d.at)+LIVE_WINDOW>now}).length+restocks.length;
  v.forEach(function(d){
    var day=DAY.format(new Date(d.at));
    if(day!==lastDay){var h=el("h3","day");var b=el("b",null,day.split(",")[0]);h.appendChild(b);h.appendChild(document.createTextNode(" · "+day.split(", ").slice(1).join(", ")));list.appendChild(h);lastDay=day}
    var c=el("article","card");c.appendChild(thumb(d));
    var m=el("div","meta");
    var nm=el("h4","name");nm.appendChild(el("span","tag",LABEL[d.kind]||d.kind));nm.appendChild(document.createTextNode(d.name));m.appendChild(nm);
    var info=el("p","info");info.appendChild(el("b",null,d.price));info.appendChild(document.createTextNode(" · "+d.store+" · "+d.time_note));m.appendChild(info);
    if(d.pre)m.appendChild(el("p","pre",d.pre));
    var cd=el("p","cd");cd.setAttribute("aria-label","countdown");m.appendChild(cd);timers.push([cd,Date.parse(d.at)]);
    m.appendChild(acts(d));c.appendChild(m);list.appendChild(c);
  });
  if(r.length){
    list.appendChild(el("h3","restock-h","🔄 Restock watch · live stock by store"));
    r.forEach(function(d){
      var c=el("article","card");c.appendChild(thumb(d));var m=el("div","meta");
      var nm=el("h4","name");nm.appendChild(el("span","tag",LABEL[d.kind]||d.kind));nm.appendChild(document.createTextNode(d.name));m.appendChild(nm);
      m.appendChild(el("span","chip "+(d.status==="in_stock"?"in":"out"),d.status==="in_stock"?"IN STOCK · "+d.store:"OUT · watching"));
      var info=el("p","info");info.appendChild(el("b",null,d.price));if(d.last_in_stock)info.appendChild(document.createTextNode(" · last seen in stock "+d.last_in_stock));m.appendChild(info);
      if(d.pre)m.appendChild(el("p","pre",d.pre));
      m.appendChild(acts(d));c.appendChild(m);list.appendChild(c);
    });
  }
  if(!v.length&&!r.length)list.appendChild(el("p","sub","Nothing upcoming in this filter right now — it refreshes on its own."));
  tick();
}
function tick(){
  var now=Date.now();
  timers.forEach(function(x){var ms=x[1]-now;x[0].textContent=ms>0?"⏱ "+fmt(ms):"🔥 LIVE NOW";x[0].classList.toggle("live",ms<=0)});
  var nx=drops.filter(function(d){return Date.parse(d.at)>now})[0];
  if(nx){$("#next-name").textContent=nx.name;var p=parts(Date.parse(nx.at)-now);var ck=$("#next-clock");
    if(!ck.firstChild){["d","h","m","s"].forEach(function(k){var u=el("div","u");u.appendChild(el("b"));u.appendChild(el("small",null,{d:"days",h:"hrs",m:"min",s:"sec"}[k]));ck.appendChild(u)})}
    var bs=ck.querySelectorAll("b");bs[0].textContent=p.d;bs[1].textContent=pad(p.h);bs[2].textContent=pad(p.m);bs[3].textContent=pad(p.s)}
  if(updatedAt){$("#ago").textContent="updated "+ago(updatedAt);$("#updated").textContent="last refresh "+ago(updatedAt)}
}
function apply(j){
  updatedAt=j.updated_at;
  drops=(j.drops||[]).filter(function(d){return !d.restock&&d.at}).sort(function(a,b){return Date.parse(a.at)-Date.parse(b.at)});
  restocks=(j.drops||[]).filter(function(d){return d.restock}).sort(function(a,b){return (a.status==="in_stock"?0:1)-(b.status==="in_stock"?0:1)});
  var s=j.sources||{};var names={niceKicks:"Nice Kicks",supreme:"drops.gg",pokemon:"pokemon.com",lego:"LEGO.com",consoles:"nowinstock",ticketmaster:"Ticketmaster"};
  $("#srcs").textContent="Sources this refresh: "+Object.keys(s).filter(function(k){return k!=="ticketmaster"||s[k].count}).map(function(k){return (names[k]||k)+(s[k].ok?" ✓":" ✗")}).join(" · ");
  render();
}
function load(){
  return fetch("/api/drops",{headers:{accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
    .catch(function(){return fetch("/seed.json").then(function(r){return r.json()})}).then(apply)
    .catch(function(){$("#list").textContent="Couldn't load drops. Pull to refresh."});
}
document.querySelectorAll(".tabs button").forEach(function(b){b.addEventListener("click",function(){
  document.querySelectorAll(".tabs button").forEach(function(x){x.setAttribute("aria-selected",String(x===b))});filter=b.dataset.f;render()})});
load();setInterval(tick,1000);setInterval(load,10*60*1000);

/* ---- watch a link (live check runs on the site's own backend: /api/check) ---- */
var VERDICT={live:["Live — go go go","v-live"],sold_out:["Sold out","v-sold"],not_live:["Not dropped yet","v-wait"],blocked:["Site blocked our check","v-unk"],unknown:["Couldn't tell","v-unk"]};
var watching=null,lastVerdict=null;
function showResult(r,url){
  var box=$("#watch-result");box.hidden=false;box.textContent="";
  var v=VERDICT[r.verdict]||VERDICT.unknown;box.appendChild(el("span","verdict "+v[1],v[0]));
  box.appendChild(el("h3",null,r.title||url));
  var ul=el("ul");
  (r.signals||[]).forEach(function(s){ul.appendChild(el("li",null,s))});
  ul.appendChild(el("li",null,"What we watch: page status, the store's own stock tag (schema.org availability), and buttons like “Add to Bag”, “Notify Me”, “Sold Out”, “Find Tickets”."));
  ul.appendChild(el("li",null,"Checked "+new Date(r.checked_at||Date.now()).toLocaleTimeString()+(watching?" · re-checking every 60s while this tab is open":"")));
  box.appendChild(ul);
  var row=el("div","acts row");
  var w=el("button","btn btn-ghost btn-sm",watching?"⏸ Stop watching":"👀 Keep watching (tab open)");w.type="button";
  w.addEventListener("click",function(){if(watching){clearInterval(watching);watching=null;showResult(r,url)}else{startWatch(url);showResult(r,url)}});
  var p=el("button","btn btn-hot btn-sm","🔔 Text me when it flips");p.type="button";p.addEventListener("click",function(){openPing({link:url,title:r.title||url})});
  row.appendChild(w);row.appendChild(p);box.appendChild(row);
}
function check(url){
  return fetch("/api/check?url="+encodeURIComponent(url),{headers:{accept:"application/json"}}).then(function(res){
    if(!res.ok&&res.status!==422)throw new Error("HTTP "+res.status);return res.json()});
}
function startWatch(url){
  if("Notification" in window&&Notification.permission==="default")Notification.requestPermission();
  watching=setInterval(function(){check(url).then(function(r){
    if(lastVerdict&&r.verdict!==lastVerdict){
      document.title="🔥 "+(VERDICT[r.verdict]||VERDICT.unknown)[0]+" — dropwatch";
      if(navigator.vibrate)navigator.vibrate([200,100,200]);
      if("Notification" in window&&Notification.permission==="granted")new Notification("dropwatch: "+(VERDICT[r.verdict]||VERDICT.unknown)[0],{body:r.title||url});
    }
    lastVerdict=r.verdict;showResult(r,url)}).catch(function(){})},60000);
}
$("#watch-form").addEventListener("submit",function(e){
  e.preventDefault();var url=$("#watch-url").value.trim();
  if(!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)){$("#watch-url").focus();var b=$("#watch-result");b.hidden=false;b.textContent="Paste a full link that starts with https://";return}
  if(watching){clearInterval(watching);watching=null}
  var box=$("#watch-result");box.hidden=false;box.textContent="Checking "+url+" …";
  check(url).then(function(r){lastVerdict=r.verdict;showResult(r,url)}).catch(function(){
    box.textContent="Our checker couldn't be reached from here. Drop your number below and we'll watch it for you.";
    var p=el("button","btn btn-hot btn-sm","🔔 Text me when it drops");p.type="button";p.style.marginTop="10px";p.addEventListener("click",function(){openPing({link:url,title:url})});box.appendChild(document.createElement("br"));box.appendChild(p)});
});

/* ---- alerts signup sheet (saved on the site's backend: /api/signup; sent by /api/cron) ---- */
var dlg=$("#ping"),pingCtx={},alertsOn=null,NTFY="https://ntfy.sh";
/* free push via ntfy: one private, unguessable topic per device, kept in localStorage */
function makeTopic(){var a="abcdefghijkmnpqrstuvwxyz23456789",b=new Uint8Array(14),s="";try{crypto.getRandomValues(b)}catch(_){for(var i=0;i<b.length;i++)b[i]=Math.floor(Math.random()*256)}for(var j=0;j<b.length;j++)s+=a[b[j]%a.length];return "dropwatch-"+s}
function lsGet(k){try{return localStorage.getItem(k)}catch(_){return null}}
function lsSet(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(_){}}
var topic=lsGet("dw_topic");if(!/^[A-Za-z0-9_-]{12,64}$/.test(topic||"")){topic=makeTopic();lsSet("dw_topic",topic)}
function showTopic(){$("#push-topic").value=topic;var l=$("#push-link");l.href=NTFY+"/"+topic;l.textContent="Open "+NTFY.replace(/^https:\/\//,"")+"/"+topic+" →";$("#push-stop").hidden=!lsGet("dw_push_on")}
function syncChans(){$("#push-box").hidden=!$("#via-push").checked;$("#sms-box").hidden=!$("#via-sms").checked;$("#email-box").hidden=!$("#via-email").checked}
["#via-push","#via-sms","#via-email"].forEach(function(id){$(id).addEventListener("change",function(){syncChans();var f={"#via-sms":"#ping-phone","#via-email":"#ping-email"}[id];if(f&&$(id).checked)setTimeout(function(){$(f).focus()},30)})});
$("#push-copy").addEventListener("click",function(){var i=$("#push-topic"),b=$("#push-copy");function ok(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1500)}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(topic).then(ok,function(){i.select();try{document.execCommand("copy");ok()}catch(_){}});else{i.select();try{document.execCommand("copy");ok()}catch(_){}}});
$("#push-topic").addEventListener("focus",function(){this.select()});
$("#push-stop").addEventListener("click",function(){var msg=$("#ping-msg");msg.textContent="Stopping…";
  fetch("/api/unsubscribe?topic="+encodeURIComponent(topic),{method:"POST",headers:{accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error(r.status);
    lsSet("dw_push_on",null);var old=topic;topic=makeTopic();lsSet("dw_topic",topic);showTopic();msg.textContent="Push alerts to "+old+" are stopped. You can delete that topic in the ntfy app."})
  .catch(function(){msg.textContent="Couldn't stop that right now. Try again in a sec."})});
showTopic();syncChans();
function openPing(ctx){
  pingCtx=ctx||{};var wrap=$("#ping-one-wrap");$("#ping-msg").textContent="";
  document.querySelectorAll('input[name=cat]').forEach(function(x){x.checked=false});
  if(pingCtx.drop){var d=pingCtx.drop;wrap.hidden=false;$("#ping-one").checked=true;$("#ping-one-label").textContent=(d.restock?"Restocks of “":"Just “")+d.name+"”";
    $("#ping-what").textContent=d.restock?"We'll ping you the moment it flips to in stock at a store.":"We'll remind you before it drops. Add whole tabs too if you want.";}
  else if(pingCtx.link){wrap.hidden=false;$("#ping-one").checked=true;$("#ping-one-label").textContent="Watch this link: "+String(pingCtx.title).slice(0,70);
    $("#ping-what").textContent="We re-check it every 15 min and ping you when it goes live.";}
  else{wrap.hidden=true;$("#ping-one").checked=false;$("#ping-what").textContent="Pick your tabs. We ping you before drops, the moment a console restocks, and when new drops show up.";
    var f=document.querySelector('input[name=cat][value="'+filter+'"]');if(f)f.checked=true;}
  showTopic();syncChans();
  if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");
}
$("#ping-cancel").addEventListener("click",function(){dlg.close?dlg.close():dlg.removeAttribute("open")});
$("#open-alerts").addEventListener("click",function(){openPing({})});
$("#alerts-cta").addEventListener("click",function(){openPing({})});
$("#ping-form").addEventListener("submit",function(e){
  e.preventDefault();var msg=$("#ping-msg");
  var usePush=$("#via-push").checked,phone=$("#via-sms").checked?$("#ping-phone").value.trim():"",email=$("#via-email").checked?$("#ping-email").value.trim():"",pd=phone.replace(/\D/g,"");
  if($("#via-sms").checked&&!phone&&!usePush&&!email){msg.textContent="Add your phone number for texts.";$("#ping-phone").focus();return}
  if(phone&&(pd.length<10||pd.length>15)){msg.textContent="That phone number doesn't look right.";$("#ping-phone").focus();return}
  if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){msg.textContent="That email doesn't look right.";$("#ping-email").focus();return}
  if(!usePush&&!phone&&!email){msg.textContent=$("#via-email").checked?"Add your email.":$("#via-sms").checked?"Add your phone number.":"Pick Push (free), Text or Email.";var ff=$("#via-email").checked?"#ping-email":$("#via-sms").checked?"#ping-phone":null;if(ff)$(ff).focus();return}
  var cats=[].slice.call(document.querySelectorAll('input[name=cat]:checked')).map(function(x){return x.value});
  var one=$("#ping-one").checked&&!$("#ping-one-wrap").hidden;
  if(!cats.length&&!one){msg.textContent="Pick at least one tab or drop to watch.";return}
  var body={ntfy:usePush?topic:null,phone:phone||null,email:email||null,cats:cats,remind:{before1h:$("#r-1h").checked,morning:$("#r-am").checked}};
  try{body.tz=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(_){}
  if(one&&pingCtx.drop){var d=pingCtx.drop;body.drop={id:d.id,name:d.name,url:d.shop||d.source,at:d.at||null}}
  if(one&&pingCtx.link)body.link=pingCtx.link;
  $("#ping-go").disabled=true;msg.textContent="Saving…";try{msg.scrollIntoView({block:"nearest"})}catch(_){}
  fetch("/api/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"failed");return j})})
    .then(function(j){msg.textContent=(j.alerts_active?"🔥 ":"✓ ")+(j.message||"Saved.");
      if(usePush){lsSet("dw_push_on","1");$("#push-stop").hidden=false;msg.textContent+=" Last step: subscribe to your topic in the ntfy app (steps above), or alerts have nowhere to land.";return}
      setTimeout(function(){dlg.close&&dlg.close()},j.alerts_active?1800:3200)})
    .catch(function(err){msg.textContent="Couldn't save that ("+err.message+"). Try again in a sec."})
    .finally(function(){$("#ping-go").disabled=false});
});
fetch("/api/health").then(function(r){return r.json()}).then(function(h){
  var a=h.alerts||{};alertsOn=!!a.active;if(a.push_server&&/^https:\/\//.test(a.push_server)){NTFY=a.push_server;showTopic()}
  var ch=[a.push?"free push":null,a.sms?"text":null,a.email?"email":null].filter(Boolean).join(" + ");
  $("#alerts-text").textContent=alertsOn?"Alerts are live by "+ch+".":"Alerts aren't active yet. Sign up now and you'll get them once they're switched on.";
  $("#alerts-line").classList.toggle("on",alertsOn);
  $("#ping-status").textContent=alertsOn?"Alerts are live by "+ch+".":"Heads up: alerts aren't active yet. You'll be saved and start getting them once they're switched on.";
}).catch(function(){});
})();
