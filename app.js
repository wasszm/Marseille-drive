(()=>{
"use strict";

const PILOT={lat:43.2858,lon:5.4140};
const CFG={
  laneWidthM:3.2,
  maxRoadDistanceM:45,
  queryRadiusKm:1.25,
  reloadAfterM:700,
  overpass:[
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ],
  router:"https://router.project-osrm.org/route/v1/driving"
};

const S={
  map:null, roads:[], signals:[], gps:null, heading:0, gpsWatch:null,
  areaCenter:null, userMarker:null, accuracyCircle:null,
  destinationMarker:null, destination:null, route:null, routeLayer:null,
  view:"map", demo:false, demoT:0, demoTimer:null, visionStream:null,
  lastMatch:null, lastLane:null, lastNav:null
};

const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rad=x=>x*Math.PI/180;
const deg=x=>x*180/Math.PI;
const angleDiff=(a,b)=>Math.abs(((a-b+540)%360)-180);
const pipe=v=>typeof v==="string"?v.split("|").map(x=>x.trim()):[];
const positiveInt=v=>{const n=parseInt(v,10);return Number.isFinite(n)&&n>0?n:0};

function setStatus(text){$("status").textContent=text}
function roadName(road){
  const map={motorway:"Autoroute",trunk:"Voie rapide",primary:"Axe principal",secondary:"Route secondaire",tertiary:"Route tertiaire",residential:"Rue résidentielle",service:"Voie de service",unclassified:"Route",living_street:"Zone de rencontre"};
  return road?.tags?.name||road?.tags?.ref||map[road?.tags?.highway]||"Route sans nom";
}
function haversineM(a,b){
  const R=6371000,p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon);
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}
function bearing(a,b){
  const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon);
  const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (deg(Math.atan2(y,x))+360)%360;
}
function pointToSegment(p,a,b){
  const mx=111320*Math.cos(rad(p.lat)),my=110540;
  const px=(p.lon-a.lon)*mx,py=(p.lat-a.lat)*my,bx=(b.lon-a.lon)*mx,by=(b.lat-a.lat)*my;
  const len2=bx*bx+by*by,t=len2?clamp((px*bx+py*by)/len2,0,1):0;
  const x=bx*t,y=by*t;
  return {distance:Math.hypot(px-x,py-y),nearest:{lat:a.lat+y/my,lon:a.lon+x/mx}};
}
function bbox(lat,lon,km){
  const dLat=km/111,dLon=km/(111*Math.cos(rad(lat)));
  return `${(lat-dLat).toFixed(6)},${(lon-dLon).toFixed(6)},${(lat+dLat).toFixed(6)},${(lon+dLon).toFixed(6)}`;
}
function laneCount(tags,dir){
  const directional=dir==="forward"?tags["lanes:forward"]:tags["lanes:backward"];
  return positiveInt(directional||tags.lanes);
}
function laneTurns(tags,dir){
  const values=pipe(tags[`turn:lanes:${dir}`]||tags["turn:lanes"]);
  return values.length?values:Array.from({length:Math.max(1,laneCount(tags,dir))},()=>"through");
}
function laneChanges(tags,dir){
  return pipe(tags[`change:lanes:${dir}`]||tags["change:lanes"]);
}

function initMap(){
  S.map=L.map("map",{zoomControl:false,preferCanvas:true,inertia:true}).setView([PILOT.lat,PILOT.lon],15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors",crossOrigin:true}).addTo(S.map);
  S.map.on("click",e=>{
    if(!S.gps){setStatus("Active le GPS avant de choisir une destination.");return;}
    setDestination(e.latlng.lat,e.latlng.lng);
  });
}

async function fetchOverpass(query){
  let lastError=null;
  for(const endpoint of CFG.overpass){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),13000);
    try{
      const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query),signal:ctrl.signal});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }catch(e){lastError=e;}finally{clearTimeout(timer)}
  }
  throw lastError||new Error("Overpass indisponible");
}

async function loadRoadData(lat,lon){
  setStatus("Chargement des routes autour de toi…");
  const b=bbox(lat,lon,CFG.queryRadiusKm);
  const q=`[out:json][timeout:30];(
    way["highway"]["highway"!~"footway|path|steps|pedestrian|cycleway"](${b});
    node["highway"="traffic_signals"](${b});
  );out geom tags;`;
  try{
    const data=await fetchOverpass(q),roads=[],signals=[];
    for(const e of data.elements||[]){
      if(e.type==="way"&&e.tags?.highway&&e.geometry?.length>1){
        roads.push({id:String(e.id),tags:e.tags,coords:e.geometry.map(p=>({lat:p.lat,lon:p.lon}))});
      }else if(e.type==="node"&&e.tags?.highway==="traffic_signals"){
        signals.push({id:String(e.id),lat:e.lat,lon:e.lon,tags:e.tags});
      }
    }
    S.roads=roads;S.signals=signals;S.areaCenter={lat,lon};
    setStatus(`${roads.length} routes · ${signals.length} feux cartographiés`);
  }catch(e){setStatus("Données OSM indisponibles — GPS toujours actif");}
}

function nearestRoad(pos){
  let best=null;
  for(const road of S.roads){
    for(let i=0;i<road.coords.length-1;i++){
      const a=road.coords[i],b=road.coords[i+1],s=pointToSegment(pos,a,b);
      if(s.distance>CFG.maxRoadDistanceM)continue;
      const rb=bearing(a,b),headingPenalty=pos.speedMps>2&&Number.isFinite(pos.heading)?angleDiff(pos.heading,rb)/15:0;
      const score=s.distance+headingPenalty;
      if(!best||score<best.score)best={road,distance:s.distance,nearest:s.nearest,roadBearing:rb,score};
    }
  }
  return best;
}
function travelDirection(match,pos){
  if(match.road.tags.oneway==="yes"||match.road.tags.oneway==="1"||match.road.tags.oneway==="true")return "forward";
  if(pos.speedMps<1.5||!Number.isFinite(pos.heading))return "forward";
  return angleDiff(pos.heading,match.roadBearing)<=90?"forward":"backward";
}
function signedLateralM(pos,nearest,roadBearing){
  const d=haversineM(pos,nearest),b=bearing(nearest,pos);
  return Math.sin(rad(((b-roadBearing+540)%360)-180))*d;
}
function estimateLane(match,pos){
  const dir=travelDirection(match,pos),total=laneCount(match.road.tags,dir),activeBearing=dir==="forward"?match.roadBearing:(match.roadBearing+180)%360;
  const accuracy=Number.isFinite(pos.accuracy)?pos.accuracy:999,headingError=Number.isFinite(pos.heading)?angleDiff(pos.heading,activeBearing):90;
  const confidence=clamp(Math.round(100-Math.min(match.distance,40)*1.4-Math.min(accuracy,40)*2.4-Math.min(headingError,90)*.25),0,100);
  const base={dir,total,confidence,turns:laneTurns(match.road.tags,dir),changes:laneChanges(match.road.tags,dir)};
  if(!total)return {...base,index:null,reason:"Nombre de voies absent dans OSM"};
  if(accuracy>5.5||confidence<62)return {...base,index:null,reason:`GPS ±${Math.round(accuracy)} m : pas assez précis pour distinguer une voie`};
  const off=signedLateralM(pos,match.nearest,activeBearing),ratio=clamp(off/(total*CFG.laneWidthM),-.499,.499);
  const index=clamp(Math.floor((ratio+.5)*total)+1,1,total);
  return {...base,index,reason:"Estimation GPS + axe OSM"};
}
function nearestSignal(pos,maxM){
  let best=null;
  for(const s of S.signals){const d=haversineM(pos,s);if(d<=maxM&&(!best||d<best.distance))best={...s,distance:d};}
  return best;
}

function updateUserMarker(pos){
  const ll=[pos.lat,pos.lon];
  if(!S.userMarker){
    const icon=L.divIcon({className:"",html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
    S.userMarker=L.marker(ll,{icon,zIndexOffset:1000}).addTo(S.map);
    S.accuracyCircle=L.circle(ll,{radius:pos.accuracy||10,weight:1,color:"#1d79ff",fillColor:"#1d79ff",fillOpacity:.08}).addTo(S.map);
  }else{
    S.userMarker.setLatLng(ll);S.accuracyCircle.setLatLng(ll).setRadius(pos.accuracy||10);
  }
  if(S.view==="map")S.map.setView(ll,17,{animate:true});
}

function nextRouteInstruction(pos){
  const steps=S.route?.legs?.[0]?.steps||[];
  if(!steps.length)return {instruction:"Suivre l’itinéraire",detail:"",turn:"through",distance:null};
  let best=null;
  for(const st of steps){
    const loc=st.maneuver?.location;if(!loc)continue;
    const d=haversineM(pos,{lat:loc[1],lon:loc[0]});
    if(!best||d<best.distance)best={step:st,distance:d};
  }
  if(!best)return {instruction:"Suivre l’itinéraire",detail:"",turn:"through",distance:null};
  const modifier=best.step.maneuver?.modifier||"straight";
  let turn="through";
  if(modifier.includes("left"))turn="left";else if(modifier.includes("right"))turn="right";else if(modifier==="uturn")turn="uturn";
  const instruction={left:"Tourne à gauche",right:"Tourne à droite",uturn:"Demi-tour",through:"Continue tout droit"}[turn];
  return {instruction,detail:`Dans ~${Math.round(best.distance)} m · ${best.step.name||"prochaine voie"}`,turn,distance:best.distance};
}
function compatibleLaneIndices(lane,turn){
  if(!lane.total)return [];
  const desired=turn||"through",out=[];
  lane.turns.forEach((raw,i)=>{
    const vals=raw.split(";").map(v=>v.trim());
    if(vals.includes(desired)||(desired==="through"&&(vals.includes("through")||vals.includes("straight"))))out.push(i+1);
  });
  return out;
}
function recommendedLane(lane,turn){
  const c=compatibleLaneIndices(lane,turn);
  if(!c.length)return lane.index||null;
  if(!lane.index)return c[0];
  return c.reduce((a,b)=>Math.abs(b-lane.index)<Math.abs(a-lane.index)?b:a);
}

function updateUi(pos){
  $("speed").textContent=Math.round(pos.speedMps*3.6);
  const match=nearestRoad(pos);S.lastMatch=match;
  if(!match){
    $("road").textContent="—";$("lane").textContent="—";$("confidence").textContent="—";$("advice").textContent="Route à confirmer";$("source").textContent="SOURCE GPS";
    $("instruction").textContent="Position reçue";$("detail").textContent="Aucune route OSM suffisamment proche.";return;
  }
  const lane=estimateLane(match,pos),signal=nearestSignal(pos,450),nav=S.route?nextRouteInstruction(pos):null;
  S.lastLane=lane;S.lastNav=nav;
  $("road").textContent=roadName(match.road);
  $("lane").textContent=lane.index?`${lane.index}/${lane.total}`:(lane.total?`?/${lane.total}`:"—");
  $("confidence").textContent=`${lane.confidence}%`;
  $("signal").textContent=signal?`${Math.round(signal.distance)} m`:"—";
  $("source").textContent=lane.index?"ESTIMATION":"PAS ASSEZ PRÉCIS";
  if(nav){
    $("instruction").textContent=nav.instruction;$("detail").textContent=`${nav.detail} · ${lane.reason}`;
    const rec=recommendedLane(lane,nav.turn),compatible=compatibleLaneIndices(lane,nav.turn);
    if(lane.index&&rec){
      $("advice").textContent=rec===lane.index?`🟢 RESTE VOIE ${lane.index}/${lane.total}`:`➡️ REJOINS VOIE ${rec}/${lane.total}`;
    }else if(compatible.length){
      $("advice").textContent=`🟡 VOIE CONSEILLÉE ${compatible.join(" ou ")}/${lane.total}`;
    }else{
      $("advice").textContent=lane.total?`🟡 ${lane.total} VOIES · POSITION INCONNUE`:"Voies non renseignées";
    }
  }else{
    $("instruction").textContent=roadName(match.road);$("detail").textContent=lane.reason;
    $("advice").textContent=lane.index?`🟢 VOIE PROBABLE ${lane.index}/${lane.total}`:(lane.total?`🟡 ${lane.total} VOIES · POSITION INCONNUE`:"Voies non renseignées");
  }
  draw3D({lane:lane.index||2,total:lane.total||3,recommended:nav?recommendedLane(lane,nav.turn)||(lane.index||2):(lane.index||2),turn:nav?.turn||"through",distance:nav?.distance,signal});
}

async function startGps(){
  if(!window.isSecureContext){setStatus("GPS : utilise bien l’adresse HTTPS GitHub Pages.");return;}
  if(!navigator.geolocation){setStatus("GPS non disponible dans ce navigateur.");return;}
  $("permission")?.remove();$("gpsBtn").classList.add("active");$("gpsBtn").querySelector("span").textContent="Actif";
  if(S.gpsWatch!==null)navigator.geolocation.clearWatch(S.gpsWatch);
  S.gpsWatch=navigator.geolocation.watchPosition(async p=>{
    const c=p.coords,heading=Number.isFinite(c.heading)&&c.heading>=0?c.heading:S.heading;
    const pos={lat:c.latitude,lon:c.longitude,speedMps:Math.max(0,Number.isFinite(c.speed)?c.speed:0),heading:Number.isFinite(heading)?heading:0,accuracy:Number.isFinite(c.accuracy)?c.accuracy:999};
    S.gps=pos;S.heading=pos.heading;updateUserMarker(pos);
    if(!S.areaCenter||haversineM(pos,S.areaCenter)>CFG.reloadAfterM)await loadRoadData(pos.lat,pos.lon);
    updateUi(pos);setStatus(`GPS ±${Math.round(pos.accuracy)} m · ${S.roads.length} routes chargées`);
  },e=>setStatus("GPS : "+e.message),{enableHighAccuracy:true,maximumAge:500,timeout:15000});
}

async function setDestination(lat,lon){
  S.destination={lat,lon};
  $("routeTitle").textContent=`Destination ${lat.toFixed(5)}, ${lon.toFixed(5)}`;$("clearRoute").hidden=false;setStatus("Calcul de l’itinéraire…");
  if(S.destinationMarker)S.map.removeLayer(S.destinationMarker);
  const icon=L.divIcon({className:"",html:'<div class="destination-dot"></div>',iconSize:[16,16],iconAnchor:[8,16]});
  S.destinationMarker=L.marker([lat,lon],{icon}).addTo(S.map);
  try{
    const o=S.gps,url=`${CFG.router}/${o.lon},${o.lat};${lon},${lat}?overview=full&geometries=geojson&steps=true`;
    const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();
    if(d.code!=="Ok"||!d.routes?.length)throw new Error("Aucun itinéraire");
    S.route=d.routes[0];
    const latlng=S.route.geometry.coordinates.map(c=>[c[1],c[0]]);
    if(S.routeLayer)S.map.removeLayer(S.routeLayer);
    S.routeLayer=L.polyline(latlng,{color:"#fff",weight:7,opacity:.93,className:"route-line"}).addTo(S.map);
    S.map.fitBounds(S.routeLayer.getBounds(),{padding:[45,45]});
    $("routeMeta").textContent=`${(S.route.distance/1000).toFixed(1)} km · ~${Math.max(1,Math.round(S.route.duration/60))} min`;
    setStatus("Itinéraire chargé · passe en 3D quand tu veux");updateUi(S.gps);
  }catch(e){setStatus("Itinéraire indisponible : "+e.message);}
}
function clearRoute(){
  S.route=null;S.destination=null;
  if(S.routeLayer){S.map.removeLayer(S.routeLayer);S.routeLayer=null;}if(S.destinationMarker){S.map.removeLayer(S.destinationMarker);S.destinationMarker=null;}
  $("routeTitle").textContent="Touchez la carte pour choisir une destination";$("routeMeta").textContent="Active d’abord le GPS.";$("clearRoute").hidden=true;if(S.gps)updateUi(S.gps);
}

function setView(v){
  S.view=v;$("map").style.display=v==="map"?"block":"none";$("drive").style.display=v==="drive"?"block":"none";$("car").style.display=v==="drive"?"block":"none";
  $("mapBtn").classList.toggle("active",v==="map");$("driveBtn").classList.toggle("active",v==="drive");$("modeLabel").textContent=`BETA 3 · ${v==="map"?"CARTE RÉELLE":"NAVIGATION 3D"}`;
  if(v==="map")setTimeout(()=>S.map.invalidateSize(),80);else draw3D({lane:S.lastLane?.index||2,total:S.lastLane?.total||3,recommended:S.lastNav?recommendedLane(S.lastLane,S.lastNav.turn)||(S.lastLane?.index||2):(S.lastLane?.index||2),turn:S.lastNav?.turn||"through",distance:S.lastNav?.distance,signal:S.gps?nearestSignal(S.gps,450):null});
}

async function toggleVision(){
  if(S.visionStream){closeVision();return;}
  if(!navigator.mediaDevices?.getUserMedia){setStatus("Caméra non disponible.");return;}
  try{
    S.visionStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    $("camera").srcObject=S.visionStream;$("visionPanel").classList.remove("hidden");setStatus("Vision locale activée · aucune image envoyée");
  }catch(e){setStatus("Caméra : autorisation refusée ou indisponible.");}
}
function closeVision(){S.visionStream?.getTracks().forEach(t=>t.stop());S.visionStream=null;$("visionPanel").classList.add("hidden");}

function startDemo(){
  if(S.demo){S.demo=false;clearInterval(S.demoTimer);S.demoTimer=null;$("demoBtn").querySelector("span").textContent="Démo";setStatus(S.gps?"GPS réel":"Démo arrêtée");if(S.gps)updateUi(S.gps);return;}
  S.demo=true;S.demoT=0;setView("drive");$("demoBtn").querySelector("span").textContent="Pause";$("source").textContent="SIMULATION";setStatus("MODE DÉMO — données simulées");
  S.demoTimer=setInterval(()=>{
    S.demoT+=.1;if(S.demoT>22)S.demoT=0;
    const t=S.demoT,change=t>7&&t<15,lane=t>=15?3:2,recommended=change?3:lane,turn=t>7?"right":"through",signal=18-(t%18),distance=Math.max(0,420-t*15);
    $("speed").textContent=Math.round(48+Math.sin(t*.8)*2);$("lane").textContent=`${lane}/3`;$("confidence").textContent="96%";$("road").textContent="Avenue pilote";$("signal").textContent=`${Math.ceil(signal)} s*`;
    $("instruction").textContent=change?"Change de voie":turn==="right"?"Tourne à droite":"Continue tout droit";$("detail").textContent=`Dans ${Math.round(distance)} m · feu SIMULÉ`;$("advice").textContent=recommended===lane?`🟢 RESTE VOIE ${lane}/3`:`➡️ REJOINS VOIE ${recommended}/3`;
    draw3D({lane,total:3,recommended,turn,signal,distance,demo:true});
  },100);
}

function poly(c,p,f){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.closePath();c.fillStyle=f;c.fill();}
function line(c,p,col,w){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.strokeStyle=col;c.lineWidth=w;c.stroke();}
function arrow(c,x,y,on,turn){
  c.save();c.strokeStyle=on?"#fff":"#c5cdd1";c.lineWidth=on?5:3;c.lineCap="round";c.lineJoin="round";c.beginPath();c.moveTo(x,y+20);c.lineTo(x,y-16);
  if(on&&turn==="right"){c.quadraticCurveTo(x,y-27,x+18,y-28);c.moveTo(x+18,y-28);c.lineTo(x+10,y-35);c.moveTo(x+18,y-28);c.lineTo(x+10,y-21);}
  else if(on&&turn==="left"){c.quadraticCurveTo(x,y-27,x-18,y-28);c.moveTo(x-18,y-28);c.lineTo(x-10,y-35);c.moveTo(x-18,y-28);c.lineTo(x-10,y-21);}
  else{c.moveTo(x,y-16);c.lineTo(x-8,y-6);c.moveTo(x,y-16);c.lineTo(x+8,y-6);}c.stroke();c.restore();
}
function draw3D(d){
  const cv=$("drive"),r=cv.getBoundingClientRect(),D=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);cv.width=Math.round(w*D);cv.height=Math.round(h*D);const c=cv.getContext("2d");c.setTransform(D,0,0,D,0,0);
  const hz=h*.30,cx=w/2,bot=h*1.04,rt=w*.28,rb=w*.94,total=Math.max(1,d.total||3),rec=clamp(d.recommended||2,1,total);
  const g=c.createLinearGradient(0,0,0,hz);g.addColorStop(0,"#0f1c24");g.addColorStop(1,"#263640");c.fillStyle=g;c.fillRect(0,0,w,hz);c.fillStyle="#2a343a";c.fillRect(0,hz,w,h-hz);
  for(let i=0;i<18;i++){const bw=w*.05+(i%3)*5,bh=30+(i%6)*17,x=i*w/17-w*.025;c.fillStyle=i%2?"#344149":"#3d4a52";c.fillRect(x,hz-bh,bw,bh);}
  poly(c,[[cx-rt/2,hz],[cx+rt/2,hz],[cx+rb/2,bot],[cx-rb/2,bot]],"#15191c");
  c.globalAlpha=.20;poly(c,[[cx-rt/2+rt*(rec-1)/total,hz],[cx-rt/2+rt*rec/total,hz],[cx-rb/2+rb*rec/total,bot],[cx-rb/2+rb*(rec-1)/total,bot]],"#38e88c");c.globalAlpha=1;
  for(let i=1;i<total;i++){const xt=cx-rt/2+rt*i/total,xb=cx-rb/2+rb*i/total;for(let j=0;j<8;j++){const a=j/8,b=(j+.45)/8,ya=hz+(bot-hz)*a*a,yb=hz+(bot-hz)*b*b;line(c,[[xt+(xb-xt)*a*a,ya],[xt+(xb-xt)*b*b,yb]],"#d9dfe2",2);}}
  for(let i=1;i<=total;i++)arrow(c,cx-rb/2+rb*(i-.5)/total,h*.66,i===rec,d.turn||"through");
  if(d.distance){c.fillStyle="#fff";c.font="900 12px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.round(d.distance)} m`,cx,h*.47);}
  if(d.demo){c.fillStyle="#090b0d";c.fillRect(cx-10,hz-50,20,52);c.fillStyle="#ef5050";c.beginPath();c.arc(cx,hz-39,6,0,Math.PI*2);c.fill();c.fillStyle="#fff";c.font="900 11px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.ceil(d.signal)}s*`,cx,hz+22);}
  else if(d.signal){c.fillStyle="#090b0d";c.fillRect(cx-8,hz-42,16,42);c.fillStyle="#59666d";for(let i=0;i<3;i++){c.beginPath();c.arc(cx,hz-33+i*13,4,0,Math.PI*2);c.fill();}}
}

function bind(){
  $("mapBtn").onclick=()=>setView("map");$("driveBtn").onclick=()=>setView("drive");$("gpsBtn").onclick=startGps;$("visionBtn").onclick=toggleVision;$("demoBtn").onclick=startDemo;
  $("allowGps").onclick=startGps;$("later").onclick=()=>$("permission")?.remove();$("closeVision").onclick=closeVision;$("clearRoute").onclick=clearRoute;
  window.addEventListener("resize",()=>{if(S.view==="drive")draw3D({lane:S.lastLane?.index||2,total:S.lastLane?.total||3,recommended:S.lastNav?recommendedLane(S.lastLane,S.lastNav.turn)||(S.lastLane?.index||2):(S.lastLane?.index||2),turn:S.lastNav?.turn||"through",distance:S.lastNav?.distance,signal:S.gps?nearestSignal(S.gps,450):null});});
}
async function boot(){
  bind();initMap();setView("map");setStatus("Carte prête · active le GPS");
  if("serviceWorker" in navigator)try{await navigator.serviceWorker.register("./sw.js?v=3.0.0");}catch(e){}
}
boot();
})();
