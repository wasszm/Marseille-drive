(() => {
"use strict";
const PILOT={lat:43.2858,lon:5.4140,radiusKm:5.5};
const CFG={overpass:"https://overpass-api.de/api/interpreter",router:"https://router.project-osrm.org/route/v1/driving",laneWidthM:3.2,maxRoadM:45,queryKm:1.5,reloadKm:.8};
const S={map:null,roads:[],signals:[],gps:null,watch:null,user:null,accuracy:null,route:null,routeLayer:null,destination:null,following:true,view:"map",heading:0,area:null,demo:false,demoT:0,demoTimer:null};
const $=id=>document.getElementById(id),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI;
const angle=(a,b)=>Math.abs(((a-b+540)%360)-180);
function status(t){$("statusChip").textContent=t}
function roadName(r){const h={motorway:"Autoroute",trunk:"Voie rapide",primary:"Axe principal",secondary:"Route secondaire",tertiary:"Route tertiaire",residential:"Rue résidentielle",service:"Voie de service",unclassified:"Route",living_street:"Zone de rencontre"};return r?.tags?.name||r?.tags?.ref||h[r?.tags?.highway]||"Route sans nom"}
function dist(a,b){const R=6371000,p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon),q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return (deg(Math.atan2(y,x))+360)%360}
function p2s(p,a,b){const lat0=rad(p.lat),mx=111320*Math.cos(lat0),my=110540,px=(p.lon-a.lon)*mx,py=(p.lat-a.lat)*my,bx=(b.lon-a.lon)*mx,by=(b.lat-a.lat)*my,l2=bx*bx+by*by,t=l2?clamp((px*bx+py*by)/l2,0,1):0,x=bx*t,y=by*t;return{d:Math.hypot(px-x,py-y),n:{lat:a.lat+y/my,lon:a.lon+x/mx}}}
function pipe(v){return typeof v==="string"?v.split("|").map(x=>x.trim()):[]}
function pint(v){const n=parseInt(v,10);return Number.isFinite(n)&&n>0?n:0}
function lanes(tags,dir="forward"){return pint((dir==="forward"?tags["lanes:forward"]:tags["lanes:backward"])||tags.lanes)}
function turns(tags,dir="forward"){const a=pipe(tags[`turn:lanes:${dir}`]||tags["turn:lanes"]),n=lanes(tags,dir);return a.length?a:Array.from({length:Math.max(1,n)},()=> "through")}
function bbox(lat,lon,km){const dlat=km/111,dlon=km/(111*Math.cos(rad(lat)));return`${(lat-dlat).toFixed(6)},${(lon-dlon).toFixed(6)},${(lat+dlat).toFixed(6)},${(lon+dlon).toFixed(6)}`}
function initMap(){
 S.map=L.map("map",{zoomControl:false,preferCanvas:true}).setView([PILOT.lat,PILOT.lon],15);
 const tiles=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors",crossOrigin:true});
 tiles.on("tileerror",()=>status("Une tuile carte n'a pas chargé — nouvelle tentative…"));tiles.addTo(S.map);
 S.map.on("click",e=>S.gps?setDestination(e.latlng.lat,e.latlng.lng):status("Active le GPS avant de choisir une destination."));
}
async function loadArea(lat,lon,why){
 status(`Chargement des routes ${why==="pilot"?"Marseille 10e":"autour de toi"}…`);
 const q=`[out:json][timeout:35];(way["highway"]["highway"!~"footway|path|steps|pedestrian|cycleway"](${bbox(lat,lon,CFG.queryKm)});node["highway"="traffic_signals"](${bbox(lat,lon,CFG.queryKm)}););out geom tags;`;
 try{
  const r=await fetch(CFG.overpass,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(q)});
  if(!r.ok)throw Error("HTTP "+r.status);const d=await r.json(),roads=[],signals=[];
  for(const e of d.elements||[]){if(e.type==="way"&&e.tags?.highway&&e.geometry?.length>1)roads.push({id:String(e.id),tags:e.tags,coords:e.geometry.map(p=>({lat:p.lat,lon:p.lon}))});else if(e.type==="node"&&e.tags?.highway==="traffic_signals")signals.push({id:String(e.id),lat:e.lat,lon:e.lon})}
  S.roads=roads;S.signals=signals;S.area={lat,lon};status(`${roads.length} routes · ${signals.length} feux cartographiés`);
 }catch(e){status("Données routières indisponibles — GPS toujours actif.");}
}
function nearestRoad(pos){
 let best=null;
 for(const r of S.roads){for(let i=0;i<r.coords.length-1;i++){const s=p2s(pos,r.coords[i],r.coords[i+1]);if(s.d>CFG.maxRoadM)continue;const rb=bearing(r.coords[i],r.coords[i+1]),score=s.d+(pos.speed>2?angle(pos.heading,rb)/18:0);if(!best||score<best.score)best={road:r,d:s.d,n:s.n,rb,score}}}return best
}
function laneEstimate(m,pos){
 const dir=(m.road.tags.oneway==="yes"||m.road.tags.oneway==="1"||pos.speed<1.5||angle(pos.heading,m.rb)<=90)?"forward":"backward",total=lanes(m.road.tags,dir),rb=dir==="forward"?m.rb:(m.rb+180)%360,acc=Number.isFinite(pos.accuracy)?pos.accuracy:999,hd=angle(pos.heading,rb),confidence=clamp(Math.round(100-Math.min(m.d,40)*1.6-Math.min(acc,40)*2.4-Math.min(hd,90)*.25),0,100);
 if(!total)return{index:null,total:null,dir,confidence:0,reason:"Nombre de voies absent dans OSM",turns:[]};
 if(acc>Math.max(6,CFG.laneWidthM*1.7)||confidence<58)return{index:null,total,dir,confidence,reason:`GPS ±${Math.round(acc)} m : impossible de distinguer une voie`,turns:turns(m.road.tags,dir)};
 const off=(()=>{const d=dist(pos,m.n),b=bearing(m.n,pos);return Math.sin(rad(((b-rb+540)%360)-180))*d})(),ratio=clamp(off/(total*CFG.laneWidthM),-.499,.499),index=clamp(Math.floor((ratio+.5)*total)+1,1,total);
 return{index,total,dir,confidence,reason:"Estimation GPS + axe OSM",turns:turns(m.road.tags,dir)}
}
function nearestSignal(pos){let b=null;for(const s of S.signals){const d=dist(pos,s);if(d<450&&(!b||d<b.d))b={...s,d}}return b}
function updateMarker(pos){
 const ll=[pos.lat,pos.lon];
 if(!S.user){const icon=L.divIcon({className:"",html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});S.user=L.marker(ll,{icon}).addTo(S.map);S.accuracy=L.circle(ll,{radius:pos.accuracy||10,weight:1,color:"#1d79ff",fillColor:"#1d79ff",fillOpacity:.08}).addTo(S.map)}
 else{S.user.setLatLng(ll);S.accuracy.setLatLng(ll).setRadius(pos.accuracy||10)}
 if(S.following&&S.view==="map")S.map.setView(ll,17,{animate:true})
}
function routeNav(pos){
 if(!S.route?.legs?.[0]?.steps?.length)return{instruction:"Suivre l'itinéraire",detail:"",turn:"through",distance:null};
 let best=null;for(const st of S.route.legs[0].steps){const l=st.maneuver?.location;if(!l)continue;const d=dist(pos,{lat:l[1],lon:l[0]});if(!best||d<best.d)best={st,d}}if(!best)return{instruction:"Suivre l'itinéraire",detail:"",turn:"through",distance:null};
 const mod=best.st.maneuver?.modifier||"straight",turn=mod.includes("left")?"left":mod.includes("right")?"right":mod==="uturn"?"uturn":"through",txt={left:"Tourne à gauche",right:"Tourne à droite",uturn:"Demi-tour",through:"Continue tout droit"}[turn];
 return{instruction:txt,detail:`Dans ~${Math.round(best.d)} m · ${best.st.name||"prochaine voie"}`,turn,distance:best.d}
}
function recommend(lane,turn){
 if(!lane?.turns?.length||!lane.total)return lane?.index||null;const c=[];lane.turns.forEach((v,i)=>{const a=v.split(";");if(a.includes(turn)||(turn==="through"&&(a.includes("straight")||a.includes("through"))))c.push(i+1)});if(!c.length)return lane.index;if(!lane.index)return c[0];return c.reduce((a,b)=>Math.abs(b-lane.index)<Math.abs(a-lane.index)?b:a)
}
function update(pos){
 $("speed").textContent=Math.round(pos.speed*3.6);const m=nearestRoad(pos);
 if(!m){$("road").textContent="—";$("lane").textContent="—";$("confidence").textContent="—";$("laneAdvice").textContent="Route à confirmer";$("sourceBadge").textContent="SOURCE GPS";return}
 const le=laneEstimate(m,pos),sig=nearestSignal(pos);$("road").textContent=roadName(m.road);$("lane").textContent=le.index?`${le.index}/${le.total}`:(le.total?`?/${le.total}`:"—");$("confidence").textContent=`${le.confidence}%`;$("signal").textContent=sig?`${Math.round(sig.d)} m`:"—";
 let nav=S.route?routeNav(pos):null;if(nav){$("instruction").textContent=nav.instruction;$("detail").textContent=nav.detail+" · "+le.reason;const rec=recommend(le,nav.turn);$("laneAdvice").textContent=rec&&le.index?(rec===le.index?`🟢 RESTE VOIE ${le.index}/${le.total}`:`➡️ REJOINS VOIE ${rec}/${le.total}`):(le.total?`🟡 ${le.total} VOIES · POSITION INCONNUE`:"Voies non renseignées")}
 else{$("instruction").textContent=roadName(m.road);$("detail").textContent=le.reason;$("laneAdvice").textContent=le.index?`🟢 VOIE PROBABLE ${le.index}/${le.total}`:(le.total?`🟡 ${le.total} VOIES · POSITION INCONNUE`:"Voies non renseignées")}
 $("sourceBadge").textContent=le.index?"ESTIMATION":"PAS ASSEZ PRÉCIS";draw3D({lane:le.index||2,total:le.total||3,recommended:le.index||2,signal:sig,turn:nav?.turn||"through",distance:nav?.distance})
}
async function gps(){
 if(!window.isSecureContext){status("GPS : ouvre l'adresse HTTPS GitHub Pages.");return}if(!navigator.geolocation){status("GPS non disponible.");return}$("permissionPanel")?.remove();$("gpsBtn").classList.add("active");$("gpsBtn").textContent="📍 GPS actif";
 if(S.watch!==null)navigator.geolocation.clearWatch(S.watch);
 S.watch=navigator.geolocation.watchPosition(async p=>{const c=p.coords,h=(Number.isFinite(c.heading)&&c.heading>=0)?c.heading:S.heading,pos={lat:c.latitude,lon:c.longitude,speed:Math.max(0,Number.isFinite(c.speed)?c.speed:0),heading:Number.isFinite(h)?h:0,accuracy:Number.isFinite(c.accuracy)?c.accuracy:999};S.gps=pos;S.heading=pos.heading;updateMarker(pos);const inPilot=dist(pos,PILOT)<PILOT.radiusKm*1000;if(!S.area||dist(pos,S.area)>CFG.reloadKm*1000)await loadArea(pos.lat,pos.lon,inPilot?"pilot":"local");update(pos);status(`${inPilot?"Pilote Marseille":"Test local"} · GPS ±${Math.round(pos.accuracy)} m`)},e=>status("GPS : "+e.message),{enableHighAccuracy:true,maximumAge:500,timeout:15000})
}
async function setDestination(lat,lon){
 if(!S.gps){status("Active le GPS d'abord.");return}S.destination={lat,lon};$("destinationText").textContent=`${lat.toFixed(5)}, ${lon.toFixed(5)}`;$("clearRouteBtn").hidden=false;status("Calcul de l'itinéraire…");
 try{const o=S.gps,r=await fetch(`${CFG.router}/${o.lon},${o.lat};${lon},${lat}?overview=full&geometries=geojson&steps=true`),d=await r.json();if(d.code!=="Ok"||!d.routes?.length)throw Error("Aucun itinéraire");S.route=d.routes[0];const ll=S.route.geometry.coordinates.map(c=>[c[1],c[0]]);if(S.routeLayer)S.map.removeLayer(S.routeLayer);S.routeLayer=L.polyline(ll,{color:"#fff",weight:7,opacity:.92,className:"route-line"}).addTo(S.map);S.map.fitBounds(S.routeLayer.getBounds(),{padding:[45,45]});$("routeMeta").textContent=`${(S.route.distance/1000).toFixed(1)} km · ~${Math.max(1,Math.round(S.route.duration/60))} min`;status("Itinéraire chargé.");update(S.gps)}catch(e){status("Itinéraire indisponible : "+e.message)}
}
function clearRoute(){S.route=null;S.destination=null;if(S.routeLayer){S.map.removeLayer(S.routeLayer);S.routeLayer=null}$("destinationText").textContent="Touchez la carte pour choisir";$("routeMeta").textContent="GPS requis pour calculer un itinéraire.";$("clearRouteBtn").hidden=true}
function view(name){S.view=name;$("mapView").classList.toggle("hidden",name!=="map");$("driveView").classList.toggle("hidden",name!=="drive");$("vehicle").style.display=name==="drive"?"block":"none";$("mapBtn").classList.toggle("active",name==="map");$("driveBtn").classList.toggle("active",name==="drive");$("modeLabel").textContent=`BETA 2 · ${name==="map"?"CARTE":"NAVIGATION 3D"}`;if(name==="map")setTimeout(()=>S.map.invalidateSize(),50);else draw3D()}
function demo(){
 if(S.demo){S.demo=false;clearInterval(S.demoTimer);$("demoBtn").textContent="▶ Démo";status(S.gps?"GPS réel":"Démo arrêtée");return}
 S.demo=true;S.demoT=0;view("drive");$("demoBtn").textContent="⏸ Démo";$("sourceBadge").textContent="SIMULATION";status("MODE DÉMO — données simulées");
 S.demoTimer=setInterval(()=>{S.demoT+=.1;if(S.demoT>22)S.demoT=0;const t=S.demoT,speed=48+Math.sin(t*.8)*2,signal=18-(t%18),distance=Math.max(0,420-t*15),change=t>7&&t<15,lane=t>=15?3:2,rec=change?3:lane,turn=t>7?"right":"through";$("speed").textContent=Math.round(speed);$("lane").textContent=`${lane}/3`;$("confidence").textContent="96%";$("road").textContent="Avenue pilote";$("signal").textContent=`${Math.ceil(signal)} s*`;$("instruction").textContent=change?"Change de voie":turn==="right"?"Tourne à droite":"Continue tout droit";$("detail").textContent=`Dans ${Math.round(distance)} m · compte à rebours SIMULÉ`;$("laneAdvice").textContent=rec===lane?`🟢 RESTE VOIE ${lane}/3`:`➡️ REJOINS VOIE ${rec}/3`;draw3D({lane,total:3,recommended:rec,turn,signal,distance,demo:true})},100)
}
function poly(c,p,fill){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.closePath();c.fillStyle=fill;c.fill()}
function line(c,p,col,w){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.strokeStyle=col;c.lineWidth=w;c.stroke()}
function arrow(c,x,y,on,turn){c.save();c.strokeStyle=on?"#fff":"#c4ccd0";c.lineWidth=on?5:3;c.lineCap="round";c.beginPath();c.moveTo(x,y+20);c.lineTo(x,y-16);if(on&&turn==="right"){c.quadraticCurveTo(x,y-26,x+18,y-27);c.moveTo(x+18,y-27);c.lineTo(x+10,y-34);c.moveTo(x+18,y-27);c.lineTo(x+10,y-20)}else{c.moveTo(x,y-16);c.lineTo(x-8,y-6);c.moveTo(x,y-16);c.lineTo(x+8,y-6)}c.stroke();c.restore()}
function draw3D(d={}){
 const cv=$("driveCanvas"),r=cv.getBoundingClientRect(),D=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);cv.width=Math.round(w*D);cv.height=Math.round(h*D);const c=cv.getContext("2d");c.setTransform(D,0,0,D,0,0);const hz=h*.29,cx=w/2,bot=h*1.04,rt=w*.28,rb=w*.94,total=d.total||3,lane=d.lane||2,rec=d.recommended||lane;
 const g=c.createLinearGradient(0,0,0,hz);g.addColorStop(0,"#101b23");g.addColorStop(1,"#26343d");c.fillStyle=g;c.fillRect(0,0,w,hz);c.fillStyle="#2a3339";c.fillRect(0,hz,w,h-hz);
 for(let i=0;i<18;i++){const bw=w*.05+(i%3)*5,bh=30+(i%6)*18,x=i*w/17-w*.025;c.fillStyle=i%2?"#344149":"#3b4850";c.fillRect(x,hz-bh,bw,bh)}
 poly(c,[[cx-rt/2,hz],[cx+rt/2,hz],[cx+rb/2,bot],[cx-rb/2,bot]],"#15191c");
 c.globalAlpha=.18;poly(c,[[cx-rt/2+rt*(rec-1)/total,hz],[cx-rt/2+rt*rec/total,hz],[cx-rb/2+rb*rec/total,bot],[cx-rb/2+rb*(rec-1)/total,bot]],"#32e884");c.globalAlpha=1;
 for(let i=1;i<total;i++){const xt=cx-rt/2+rt*i/total,xb=cx-rb/2+rb*i/total;for(let j=0;j<8;j++){const a=j/8,b=(j+.45)/8,ya=hz+(bot-hz)*a*a,yb=hz+(bot-hz)*b*b;line(c,[[xt+(xb-xt)*a*a,ya],[xt+(xb-xt)*b*b,yb]],"#d8dde0",2)}}
 for(let i=1;i<=total;i++)arrow(c,cx-rb/2+rb*(i-.5)/total,h*.66,i===rec,d.turn||"through");
 if(d.demo){c.fillStyle="#090b0d";c.fillRect(cx-9,hz-48,18,48);["#ec4e4e","#66552b","#294333"].forEach((q,i)=>{c.fillStyle=i===0?q:"#263037";c.beginPath();c.arc(cx,hz-39+i*14,5,0,Math.PI*2);c.fill()});c.font="900 11px -apple-system";c.textAlign="center";c.fillStyle="#fff";c.fillText(`${Math.ceil(d.signal||0)}s*`,cx,hz+18)}
 if(d.distance){c.font="900 12px -apple-system";c.textAlign="center";c.fillStyle="#fff";c.fillText(`${Math.round(d.distance)} m`,cx,h*.46)}
}
function bind(){
 $("mapBtn").onclick=()=>view("map");$("driveBtn").onclick=()=>view("drive");$("gpsBtn").onclick=gps;$("allowGpsBtn").onclick=gps;$("skipGpsBtn").onclick=()=>$("permissionPanel")?.remove();$("demoBtn").onclick=demo;$("clearRouteBtn").onclick=clearRoute;
 window.addEventListener("resize",()=>S.view==="drive"&&draw3D());
}
async function boot(){bind();initMap();view("map");status("Carte prête · active le GPS");await loadArea(PILOT.lat,PILOT.lon,"pilot");if("serviceWorker"in navigator)try{await navigator.serviceWorker.register("./sw.js?v=2.0.0")}catch{}}
boot();
})();