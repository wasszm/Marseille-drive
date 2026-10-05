(()=>{
"use strict";
const PILOT={lat:43.2858,lon:5.4140};
const CFG={laneWidthM:3.2,maxRoadDistanceM:45,queryRadiusKm:1.25,reloadAfterM:700,offRouteM:42,rerouteCooldownMs:12000,overpass:["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.nchc.org.tw/api/interpreter"],router:"https://router.project-osrm.org/route/v1/driving"};
const S={map:null,roads:[],signals:[],junctions:[],environment:[],gps:null,rawGps:null,lastRawFix:null,lastAcceptedRaw:null,gpsRejected:0,visualGps:null,heading:0,gpsWatch:null,renderRaf:null,lastRenderAt:0,lastHudAt:0,visualTickAt:0,areaCenter:null,environmentCenter:null,roadLoading:false,environmentLoading:false,aheadPrefetch:{lastAt:0,center:null,loading:false,count:0},sceneEnvCache:null,userMarker:null,accuracyCircle:null,destinationMarker:null,destination:null,route:null,routeLoading:false,routeLayer:null,routeCoords:[],routeCum:[],routeLengthM:0,routeManeuvers:[],routeLaneHints:[],routeIntersections:[],lastRouteAlong:null,routeFilter:{along:null,index:null,quality:0,ambiguity:1,candidates:[],lastAt:0},view:"map",followMap:true,demo:false,demoT:0,demoTimer:null,visionStream:null,visionTimer:null,visionCue:null,visionStableFrames:0,compassHeading:null,compassActive:false,lastMatch:null,lastGoodMatch:null,lastGoodMatchAt:0,previousMatch:null,matchQuality:0,lastSignal:null,lastLane:null,lastNav:null,lastRerouteAt:0,lastRouteAttemptAt:0,offRouteHits:0,arrived:false,recording:false,track:[],lastTrackAt:0,truthEvents:[],currentTruth:null,replayActive:false,replayTimer:null,replayPoints:[],replayIndex:0,replayTruthByIndex:null,replayResults:[],searchMarker:null,destinationLabel:null,voiceEnabled:false,lastVoiceKey:"",statusTimer:null,
fusion:{position:null,along:null,lateralM:0,heading:0,speedMps:0,quality:0,mode:"GPS",lastGpsAt:0,lastPredictAt:0,roadId:null},sensorHealth:{gps:0,map:0,route:0,vision:0,compass:0,overall:0,label:"FAIBLE"},
laneBelief:{roadId:null,total:0,probs:[],index:null,confidence:0,lastVisionShift:0},
laneCalibration:{byRoad:{}},laneTransition:{state:"STABLE",direction:0,score:0,lastLateral:null,lastAt:0,startedAt:0,lateralSpeed:0},
laneFilter:{roadId:null,index:null,candidate:null,hits:0}};
const $=id=>document.getElementById(id),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI,angleDiff=(a,b)=>Math.abs(((a-b+540)%360)-180),pipe=v=>typeof v==="string"?v.split("|").map(x=>x.trim()):[],positiveInt=v=>{const n=parseInt(v,10);return Number.isFinite(n)&&n>0?n:0};
function setStatus(t,ms=3200){
  const el=$("status");el.textContent=t;el.classList.remove("quiet");clearTimeout(S.statusTimer);
  if(ms>0)S.statusTimer=setTimeout(()=>el.classList.add("quiet"),ms)
}
function turnHudGlyph(turn){
  return turn==="left"?"↰":turn==="right"?"↱":turn==="uturn"?"↶":turn==="roundabout"?"⟳":"↑"
}
function updateFusionBadge(pos=S.gps,m=effectiveMatch()){
  const f=S.fusion,h=S.sensorHealth,gps=pos?`±${Math.round(S.rawGps?.accuracy??pos.accuracy??0)}m`:"—",match=m?`M${m.quality??0}`:"M—",vision=S.visionCue?.stable?` · V${S.visionCue.confidence}`:"";
  $("fusionBadge").textContent=`${f.mode} ${Math.round(f.quality||0)} · SENS ${h.overall||0} · GPS ${gps} · ${match}${vision}`
}
function updateBeliefHud(lane=S.lastLane){
  const box=$("beliefHud");if(!box)return;box.replaceChildren();
  const probs=lane?.belief;if(!lane?.total||!Array.isArray(probs)||!probs.length){box.classList.add("hidden");return}
  box.classList.remove("hidden");let best=1,max=-1;probs.forEach((p,i)=>{if(p>max){max=p;best=i+1}});
  probs.forEach((p,i)=>{const n=i+1,el=document.createElement("div");el.className="belief-lane"+(n===lane.index?" best current":n===best?" candidate":"");const a=document.createElement("strong"),b=document.createElement("span");a.textContent=`V${n}`;b.textContent=`${Math.round(p*100)}%`;el.append(a,b);box.appendChild(el)})
}
function upcomingManeuvers(along=S.fusion.along??S.routeFilter.along??S.lastRouteAlong,limit=3){
  if(!Number.isFinite(along))return[];
  const out=[];
  for(const m of S.routeManeuvers){
    if(m.type==="depart"||m.type==="arrive")continue;
    const distance=m.along-along;if(distance<-12)continue;if(distance>1500)break;
    out.push({...m,distance:Math.max(0,distance),turn:maneuverTurn(m),instruction:maneuverInstruction(m,maneuverTurn(m))});if(out.length>=limit)break
  }
  return out
}
function updateHorizonHud(nav=S.lastNav,lane=S.lastLane){
  const panel=$("horizonHud");if(!panel)return;
  if(!S.routeCoords.length){panel.classList.add("hidden");$("horizonItems").replaceChildren();return}
  const along=S.fusion.along??S.routeFilter.along??S.lastRouteAlong,items=upcomingManeuvers(along,3),hint=upcomingRouteLaneHint(along,1000);
  panel.classList.remove("hidden");$("horizonQuality").textContent=`ROUTE Q${Math.round(S.routeFilter.quality||0)} · AMB ${Math.round((S.routeFilter.ambiguity||0)*100)}%`;
  const box=$("horizonItems");box.replaceChildren();
  items.forEach((m,i)=>{
    const el=document.createElement("div");el.className="horizon-item"+(i===0?" primary":"");
    const icon=document.createElement("strong"),dist=document.createElement("span"),name=document.createElement("em");
    icon.textContent=turnHudGlyph(m.turn);dist.textContent=m.distance>=1000?`${(m.distance/1000).toFixed(1)} km`:`${Math.round(m.distance)} m`;name.textContent=(m.step.name||m.instruction).slice(0,22);
    el.append(icon,dist,name);box.appendChild(el)
  });
  if(hint){
    const el=document.createElement("div");el.className="horizon-item lanes";const title=document.createElement("span"),row=document.createElement("div");title.textContent=`VOIES · ${Math.round(hint.distance)} m`;row.className="horizon-lanes";
    for(const l of hint.lanes){const x=document.createElement("i");x.textContent=turnGlyph((l.indications||[]).join(";"));if(l.valid)x.classList.add("ok");row.appendChild(x)}
    el.append(title,row);box.appendChild(el)
  }
}
function updateManeuverHud(nav){
  const after=$("maneuverAfter");
  if(!nav){$("maneuverText").textContent="Suivre la route";$("maneuverDistance").textContent="—";$("maneuverGlyph").textContent="↑";after.classList.add("hidden");after.textContent="";return}
  $("maneuverGlyph").textContent=turnHudGlyph(nav.turn);
  $("maneuverText").textContent=nav.arrived?"Destination atteinte":nav.instruction;
  $("maneuverDistance").textContent=nav.arrived?"ARRIVÉE":Number.isFinite(nav.distance)?(nav.distance>=1000?`${(nav.distance/1000).toFixed(1)} km`:`${Math.max(0,Math.round(nav.distance))} m`):"—";
  if(nav.after&&nav.distance<420){after.textContent=`Puis ${nav.after.instruction.toLowerCase()} · +${Math.round(nav.after.distance)} m`;after.classList.remove("hidden")}else{after.classList.add("hidden");after.textContent=""}
}
function roadName(r){const m={motorway:"Autoroute",trunk:"Voie rapide",primary:"Axe principal",secondary:"Route secondaire",tertiary:"Route tertiaire",residential:"Rue résidentielle",service:"Voie de service",unclassified:"Route",living_street:"Zone de rencontre"};return r?.tags?.name||r?.tags?.ref||m[r?.tags?.highway]||"Route sans nom"}
function haversineM(a,b){const R=6371000,p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon),q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360}
function destinationPoint(p,bearingDeg,meters){
  const R=6371000,d=meters/R,br=rad(bearingDeg),lat1=rad(p.lat),lon1=rad(p.lon);
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
  const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return{lat:deg(lat2),lon:deg(lon2)}
}
function lerpAngle(a,b,t){const d=((b-a+540)%360)-180;return(a+d*t+360)%360}
function pointToSegment(p,a,b){const mx=111320*Math.cos(rad(p.lat)),my=110540,px=(p.lon-a.lon)*mx,py=(p.lat-a.lat)*my,bx=(b.lon-a.lon)*mx,by=(b.lat-a.lat)*my,l2=bx*bx+by*by,t=l2?clamp((px*bx+py*by)/l2,0,1):0,x=bx*t,y=by*t;return{distance:Math.hypot(px-x,py-y),t,nearest:{lat:a.lat+y/my,lon:a.lon+x/mx}}}
function bbox(lat,lon,km){const dLat=km/111,dLon=km/(111*Math.cos(rad(lat)));return`${(lat-dLat).toFixed(6)},${(lon-dLon).toFixed(6)},${(lat+dLat).toFixed(6)},${(lon+dLon).toFixed(6)}`}
function laneCount(tags,dir){
  const direct=positiveInt(dir==="forward"?tags["lanes:forward"]:tags["lanes:backward"]);
  if(direct)return direct;
  const total=positiveInt(tags.lanes),oneway=String(tags.oneway||"").toLowerCase();
  if(["yes","1","true","-1"].includes(oneway))return total;
  const opposite=positiveInt(dir==="forward"?tags["lanes:backward"]:tags["lanes:forward"]);
  if(total&&opposite&&total>opposite)return total-opposite;
  if(total&&total%2===0)return total/2;
  return total===1?1:0;
}
function directionalLaneValue(tags,key,dir){
  const direct=tags[`${key}:${dir}`];if(typeof direct==="string")return direct;
  const oneway=String(tags.oneway||"").toLowerCase();
  if(["yes","1","true","-1"].includes(oneway)||dir==="forward")return tags[key]||"";
  return""
}
function laneTurns(tags,dir){const a=pipe(directionalLaneValue(tags,"turn:lanes",dir));return a.length?a:Array.from({length:Math.max(1,laneCount(tags,dir))},()=>"through")}
function laneChanges(tags,dir){return pipe(directionalLaneValue(tags,"change:lanes",dir))}
function laneAccess(tags,dir,total){
  if(!total)return[];
  const keys=["motor_vehicle:lanes","vehicle:lanes","access:lanes"],blocked=new Set(["no","private","customers","delivery","agricultural","forestry"]);
  for(const key of keys){
    const vals=pipe(directionalLaneValue(tags,key,dir));if(vals.length!==total)continue;
    return vals.map(v=>{const parts=String(v).toLowerCase().split(";").map(x=>x.trim());return!parts.some(x=>blocked.has(x))})
  }
  return Array.from({length:total},()=>true)
}
function laneRoutePlan(lane,turn){
  if(!lane?.total)return{target:null,next:null,compatible:[],accessible:[]};
  const accessible=lane.accessible?.length?lane.accessible:Array.from({length:lane.total},()=>true);
  let compatible=compatibleLanes(lane,turn).filter(i=>accessible[i-1]!==false);
  if(!compatible.length&&turn==="through")compatible=accessible.map((ok,i)=>ok?i+1:null).filter(Boolean);
  if(!compatible.length)return{target:null,next:null,compatible:[],accessible};
  const current=lane.index||null,target=current?compatible.reduce((a,b)=>Math.abs(b-current)<Math.abs(a-current)?b:a):compatible[0];
  if(!current||current===target)return{target,next:target,compatible,accessible};
  const step=current+(target>current?1:-1),legal=laneChangeAllowed(lane,current,step)&&accessible[step-1]!==false;
  return{target,next:legal?step:current,compatible,accessible,blocked:!legal}
}
function maxspeedKph(tags){const raw=String(tags?.maxspeed||"").trim().toLowerCase();if(!raw)return null;const n=parseFloat(raw);if(Number.isFinite(n))return Math.round(raw.includes("mph")?n*1.60934:n);return({"fr:urban":50,"fr:rural":80,"fr:trunk":110,"fr:motorway":130})[raw]||null}
function updateSpeedLimit(match,pos){const el=$("limitBadge"),limit=match?maxspeedKph(match.road.tags):null;if(!limit){el.classList.add("hidden");el.classList.remove("alert");return}el.textContent=String(limit);el.classList.remove("hidden");el.classList.toggle("alert",pos.speedMps*3.6>limit+5)}
function turnGlyph(raw){const vals=String(raw||"through").split(";").map(v=>v.trim());const glyph=v=>v.includes("uturn")||v.includes("reverse")?"↶":v.includes("left")?"↰":v.includes("right")?"↱":"↑";return [...new Set(vals.map(glyph))].join("")}
function updateJunctionAssist(lane,nav){
  const panel=$("junctionAssist");if(!nav||nav.arrived||!Number.isFinite(nav.distance)||nav.distance>650){panel.classList.add("hidden");return}
  panel.classList.remove("hidden");const plan=routeLaneStrategy(lane,nav),suffix=plan.source&&plan.source!=="OSM"?` · ${plan.source}`:"";
  $("junctionText").textContent=`${nav.instruction} · ${Math.max(0,Math.round(nav.distance))} m${suffix}`;
  const lanes=$("junctionLanes"),hint=plan.hint&&plan.hint.total===lane.total?plan.hint:null;
  if(lane.total&&(lane.hasTurnLanes||hint)){
    const good=plan.compatible||[];
    lanes.innerHTML=Array.from({length:lane.total},(_,i)=>{
      const idx=i+1,raw=lane.turns?.[i]||hint?.lanes?.[i]?.indications?.join(";")||"through",restricted=lane.accessible?.[i]===false;
      return `<span class="${good.includes(idx)?"recommended":""} ${restricted?"restricted":""}">${turnGlyph(raw)}</span>`
    }).join("")
  }else lanes.innerHTML='<small>Voies directionnelles non renseignées sur cette section</small>'
}
function envHeight(tags){const h=parseFloat(String(tags?.height||"").replace(",",".") );if(Number.isFinite(h)&&h>1)return clamp(h,3,60);const levels=parseFloat(tags?.["building:levels"]);return clamp(Number.isFinite(levels)&&levels>0?levels*3.1:10,3,45)}
function envKind(tags){
  if(tags?.building)return"building";
  if(tags?.natural==="tree")return"tree";
  if(tags?.highway==="street_lamp")return"lamp";
  if(tags?.highway==="crossing")return"crossing";
  if(tags?.highway==="bus_stop"||tags?.public_transport==="platform")return"transit";
  if(tags?.traffic_sign)return"sign";
  if(tags?.natural==="water"||tags?.water)return"water";
  if(tags?.leisure==="park"||["grass","forest","meadow","recreation_ground"].includes(tags?.landuse))return"green";
  if(tags?.shop||tags?.amenity)return"poi";
  return"other"
}
function environmentObject(e){
  const geom=(e.geometry||[]).map(p=>({lat:p.lat,lon:p.lon}));
  let loc=e.type==="node"?{lat:e.lat,lon:e.lon}:e.center;
  if((!loc||!Number.isFinite(loc.lat)||!Number.isFinite(loc.lon))&&geom.length){const sum=geom.reduce((a,p)=>({lat:a.lat+p.lat,lon:a.lon+p.lon}),{lat:0,lon:0});loc={lat:sum.lat/geom.length,lon:sum.lon/geom.length}}
  if(!loc||!Number.isFinite(loc.lat)||!Number.isFinite(loc.lon))return null;
  const tags=e.tags||{},kind=envKind(tags);
  let footprint=10;
  if(geom.length){let max=0;for(const p of geom)max=Math.max(max,haversineM(loc,p));footprint=clamp(max*1.7,5,55)}
  const keepGeom=["building","green","water"].includes(kind)&&geom.length>=3;
  let shape=keepGeom?geom:null;
  if(shape&&shape.length>22){const step=Math.ceil(shape.length/20);shape=shape.filter((_,i)=>i%step===0);if(shape.length<3)shape=geom.slice(0,20)}
  return{id:String(e.id),kind,lat:loc.lat,lon:loc.lon,height:envHeight(tags),footprint,geometry:shape,name:tags.name||tags.brand||tags.shop||tags.amenity||"",tags}
}
async function loadEnvironmentData(lat,lon){
  if(S.environmentLoading)return;S.environmentLoading=true;S.environmentCenter={lat,lon};
  const b=bbox(lat,lon,.48),q=`[out:json][timeout:25];(way["building"](${b});way["natural"="water"](${b});way["leisure"="park"](${b});way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${b});node["natural"="tree"](${b});node["highway"="street_lamp"](${b});node["highway"="crossing"](${b});node["highway"="bus_stop"](${b});node["public_transport"="platform"](${b});node["traffic_sign"](${b});node["amenity"](${b});node["shop"](${b}););out body geom;`;
  try{
    const data=await fetchOverpass(q),objects=[];
    for(const e of data.elements||[]){const o=environmentObject(e);if(o)objects.push(o)}
    objects.sort((a,b)=>haversineM({lat,lon},a)-haversineM({lat,lon},b));S.environment=objects.slice(0,650);S.sceneEnvCache=null;
    try{localStorage.setItem("mdEnvCacheV1",JSON.stringify({lat,lon,time:Date.now(),objects:S.environment}))}catch(_){}
    if($("envBadge"))$("envBadge").textContent=`URBAIN ${S.environment.length}`
  }catch(e){
    let used=false;
    try{const cache=JSON.parse(localStorage.getItem("mdEnvCacheV1")||"null");if(cache&&Date.now()-cache.time<86400000&&haversineM({lat,lon},cache)<2500){S.environment=cache.objects||[];S.sceneEnvCache=null;S.environmentCenter={lat:cache.lat,lon:cache.lon};used=true}}catch(_){}
    if($("envBadge"))$("envBadge").textContent=used?`CACHE ${S.environment.length}`:"URBAIN —"
  }finally{S.environmentLoading=false}
}
function signedAngle(from,to){return((to-from+540)%360)-180}
function visibleEnvironment(pos,heading,maxM=260){
  if(!pos||!S.environment.length)return[];
  const key=`${Math.round(pos.lat*1e5)}:${Math.round(pos.lon*1e5)}:${Math.round((heading||0)/4)}:${S.environment.length}`;
  let base=S.sceneEnvCache?.key===key?S.sceneEnvCache.list:null;
  if(!base){
    const out=[];
    for(const o of S.environment){
      const d=haversineM(pos,o);if(d<4||d>265)continue;const a=signedAngle(heading,bearing(pos,o)),forward=Math.cos(rad(a))*d,side=Math.sin(rad(a))*d;
      if(forward<4||forward>265||Math.abs(side)>135)continue;out.push({...o,distance:d,forward,side})
    }
    base=out.sort((a,b)=>b.forward-a.forward).slice(0,100);S.sceneEnvCache={key,list:base}
  }
  return maxM>=260?base:base.filter(o=>o.distance<=maxM&&o.forward<=maxM)
}
function openStreetReference(){if(!S.gps){setStatus("Active le GPS avant d’ouvrir la vue 360°.");return}const rb=S.lastMatch?(travelDirection(S.lastMatch,S.gps)==="forward"?S.lastMatch.roadBearing:(S.lastMatch.roadBearing+180)%360):0,heading=Math.round(S.gps.speedMps>1.5&&Number.isFinite(S.heading)?S.heading:rb),url=`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(S.gps.lat+","+S.gps.lon)}&heading=${heading}&pitch=0&fov=85`;window.open(url,"_blank","noopener")}
function initMap(){
  S.map=L.map("map",{zoomControl:false,preferCanvas:true,inertia:true}).setView([PILOT.lat,PILOT.lon],15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors",crossOrigin:true}).addTo(S.map);
  S.map.on("click",e=>{if(!S.gps){setStatus("Active le GPS avant de choisir une destination.");return}setDestination(e.latlng.lat,e.latlng.lng)});
  S.map.on("dragstart",()=>{S.followMap=false;document.body.classList.add("map-free")})
}
async function fetchOverpass(q){let last;for(const ep of CFG.overpass){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),13000);try{const r=await fetch(ep,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(q),signal:ctrl.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json()}catch(e){last=e}finally{clearTimeout(timer)}}throw last||Error("Overpass indisponible")}
function buildRoadJunctions(roads){
  const nodes=new Map();
  for(const road of roads){
    if(!road.nodeIds?.length||road.nodeIds.length!==road.coords.length)continue;
    road.nodeIds.forEach((id,i)=>{
      let n=nodes.get(String(id));if(!n){n={id:String(id),lat:road.coords[i].lat,lon:road.coords[i].lon,links:[]};nodes.set(String(id),n)}
      n.links.push({road,index:i})
    })
  }
  const out=[];
  for(const n of nodes.values()){
    const unique=[...new Set(n.links.map(x=>x.road.id))];if(unique.length<2)continue;
    const branches=[];
    for(const link of n.links){
      const c=link.road.coords,i=link.index;
      if(i>0)branches.push({bearing:bearing(n,c[i-1]),road:link.road});
      if(i<c.length-1)branches.push({bearing:bearing(n,c[i+1]),road:link.road})
    }
    out.push({id:n.id,lat:n.lat,lon:n.lon,ways:unique.length,branches})
  }
  return out
}
async function loadRoadData(lat,lon){
  if(S.roadLoading)return;S.roadLoading=true;setStatus("Chargement des routes autour de toi…");
  const b=bbox(lat,lon,CFG.queryRadiusKm),q=`[out:json][timeout:30];(way["highway"]["highway"!~"footway|path|steps|pedestrian|cycleway"](${b});node["highway"="traffic_signals"](${b}););out body geom;`;
  try{
    const data=await fetchOverpass(q),roads=[],signals=[];
    for(const e of data.elements||[]){
      if(e.type==="way"&&e.tags?.highway&&e.geometry?.length>1)roads.push({id:String(e.id),tags:e.tags,coords:e.geometry.map(p=>({lat:p.lat,lon:p.lon})),nodeIds:Array.isArray(e.nodes)?e.nodes.map(String):[]});
      else if(e.type==="node"&&e.tags?.highway==="traffic_signals")signals.push({id:String(e.id),lat:e.lat,lon:e.lon,tags:e.tags})
    }
    S.roads=roads;S.signals=signals;S.junctions=buildRoadJunctions(roads);S.areaCenter={lat,lon};
    try{localStorage.setItem("mdRoadCacheV1",JSON.stringify({lat,lon,time:Date.now(),roads,signals}))}catch(_){}
    loadEnvironmentData(lat,lon);setStatus(`${roads.length} routes · ${signals.length} feux cartographiés`)
  }catch(e){
    let used=false;
    try{const cache=JSON.parse(localStorage.getItem("mdRoadCacheV1")||"null");if(cache&&Date.now()-cache.time<86400000&&haversineM({lat,lon},cache)<3000){S.roads=cache.roads||[];S.signals=cache.signals||[];S.junctions=buildRoadJunctions(S.roads);S.areaCenter={lat:cache.lat,lon:cache.lon};used=true;setStatus(`Mode cache local · ${S.roads.length} routes`)}}catch(_){}
    if(!used)setStatus("Données OSM indisponibles — GPS toujours actif")
  }finally{S.roadLoading=false}
}
function mergeRoadPack(roads,signals,environment,center){
  const roadMap=new Map(S.roads.map(x=>[x.id,x]));for(const r of roads)roadMap.set(r.id,r);
  const sigMap=new Map(S.signals.map(x=>[x.id,x]));for(const x of signals)sigMap.set(x.id,x);
  const envMap=new Map(S.environment.map(x=>[`${x.kind}:${x.id}`,x]));for(const x of environment)envMap.set(`${x.kind}:${x.id}`,x);
  const origin=scenePosition()||S.gps||center;
  S.roads=[...roadMap.values()].sort((a,b)=>{const pa=a.coords?.[0]||origin,pb=b.coords?.[0]||origin;return haversineM(origin,pa)-haversineM(origin,pb)}).slice(0,1800);
  S.signals=[...sigMap.values()].sort((a,b)=>haversineM(origin,a)-haversineM(origin,b)).slice(0,260);
  S.environment=[...envMap.values()].sort((a,b)=>haversineM(origin,a)-haversineM(origin,b)).slice(0,900);
  S.junctions=buildRoadJunctions(S.roads);S.sceneEnvCache=null;
  if($("envBadge"))$("envBadge").textContent=`URBAIN ${S.environment.length}`
}
async function prefetchAheadPack(){
  const P=S.aheadPrefetch,now=Date.now(),along=S.fusion.along??S.routeFilter.along;
  if(P.loading||S.demo||S.replayActive||!S.routeCoords.length||!Number.isFinite(along)||(S.gps?.speedMps||0)<2.5||now-P.lastAt<45000)return;
  const ahead=clamp((S.gps?.speedMps||0)*24+330,350,650),target=routePointAtAlong(along+ahead);if(!target)return;
  if(P.center&&haversineM(P.center,target)<240){P.lastAt=now;return}
  P.loading=true;P.lastAt=now;
  const b=bbox(target.lat,target.lon,.32),q=`[out:json][timeout:25];(way["highway"]["highway"!~"footway|path|steps|pedestrian|cycleway"](${b});node["highway"="traffic_signals"](${b});way["building"](${b});way["natural"="water"](${b});way["leisure"="park"](${b});way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${b});node["natural"="tree"](${b});node["highway"="street_lamp"](${b});node["highway"="crossing"](${b});node["highway"="bus_stop"](${b});node["traffic_sign"](${b}););out body geom;`;
  try{
    const data=await fetchOverpass(q),roads=[],signals=[],env=[];
    for(const e of data.elements||[]){
      if(e.type==="way"&&e.tags?.highway&&e.geometry?.length>1)roads.push({id:String(e.id),tags:e.tags,coords:e.geometry.map(p=>({lat:p.lat,lon:p.lon})),nodeIds:Array.isArray(e.nodes)?e.nodes.map(String):[]});
      else if(e.type==="node"&&e.tags?.highway==="traffic_signals")signals.push({id:String(e.id),lat:e.lat,lon:e.lon,tags:e.tags});
      else{const o=environmentObject(e);if(o&&o.kind!=="other")env.push(o)}
    }
    mergeRoadPack(roads,signals,env,target);P.center={lat:target.lat,lon:target.lon};P.count++
  }catch(_){}
  finally{P.loading=false}
}
function roadsConnected(a,b){
  if(!a||!b||a.id===b.id)return a?.id===b?.id;
  const ae=[a.coords?.[0],a.coords?.[a.coords.length-1]].filter(Boolean),be=[b.coords?.[0],b.coords?.[b.coords.length-1]].filter(Boolean);
  for(const x of ae)for(const y of be)if(haversineM(x,y)<13)return true;
  return false
}
function roadClassPenalty(road){
  const h=road?.tags?.highway||"";
  return({motorway:0,trunk:0,primary:0,secondary:1,tertiary:2,residential:3,unclassified:4,service:7,living_street:6})[h]??5
}
function effectiveMatch(){
  if(S.lastMatch)return S.lastMatch;
  if(S.lastGoodMatch&&Date.now()-S.lastGoodMatchAt<6500&&S.fusion.quality>=25)return S.lastGoodMatch;
  return null
}
function nearestRoad(pos){
  const prev=S.lastMatch,maxD=Math.max(CFG.maxRoadDistanceM,Math.min(70,(pos.accuracy||20)*2.2)),candidates=[];
  for(const road of S.roads){
    let roadBest=null;
    for(let i=0;i<road.coords.length-1;i++){
      const a=road.coords[i],b=road.coords[i+1],seg=pointToSegment(pos,a,b);if(seg.distance>maxD)continue;
      const rb=bearing(a,b),oneway=String(road.tags.oneway||"").toLowerCase(),isOneWay=["yes","1","true","-1"].includes(oneway),dirHead=oneway==="-1"?(rb+180)%360:rb;
      const headingErr=pos.speedMps>1.2&&Number.isFinite(pos.heading)?(isOneWay?angleDiff(pos.heading,dirHead):Math.min(angleDiff(pos.heading,rb),angleDiff(pos.heading,(rb+180)%360))):0;
      let score=seg.distance+headingErr*(pos.speedMps>3?.18:.10)+roadClassPenalty(road);
      if(prev){
        if(prev.road.id===road.id)score-=9;
        else if(roadsConnected(prev.road,road))score-=3;
        else if(pos.speedMps>2.5)score+=8
      }
      const cand={road,distance:seg.distance,nearest:seg.nearest,roadBearing:rb,segmentIndex:i,segmentT:seg.t,headingError:headingErr,baseScore:score,score};
      if(!roadBest||score<roadBest.score)roadBest=cand
    }
    if(roadBest)candidates.push(roadBest)
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.baseScore-b.baseScore);
  const shortlist=candidates.slice(0,Math.min(16,candidates.length));
  if(S.routeCoords.length){
    for(const cand of shortlist){
      const rp=routeProjection(cand.nearest,S.lastRouteAlong);
      if(rp)cand.score=cand.baseScore+Math.min(30,rp.distance*.7)
    }
  }
  shortlist.sort((a,b)=>a.score-b.score);
  const best=shortlist[0],second=shortlist[1];
  const gap=second?second.score-best.score:25;
  best.quality=clamp(Math.round(100-best.distance*1.4-best.headingError*.35+Math.min(18,gap)),0,100);
  return best
}
function travelDirection(m,pos){
  const oneway=String(m.road.tags.oneway||"").toLowerCase();
  if(["yes","1","true"].includes(oneway))return"forward";
  if(oneway==="-1")return"backward";
  if(pos.speedMps<1.5){
    if(S.lastLane?.dir&&S.previousMatch?.road?.id===m.road.id)return S.lastLane.dir;
    if(Number.isFinite(pos.heading))return angleDiff(pos.heading,m.roadBearing)<=90?"forward":"backward";
    return"forward"
  }
  if(!Number.isFinite(pos.heading))return S.lastLane?.dir||"forward";
  return angleDiff(pos.heading,m.roadBearing)<=90?"forward":"backward"
}
function signedLateralM(pos,nearest,rb){const d=haversineM(pos,nearest),b=bearing(nearest,pos);return Math.sin(rad(((b-rb+540)%360)-180))*d}
function parseLaneWidths(tags,dir,total){
  const raw=directionalLaneValue(tags,"width:lanes",dir),vals=pipe(raw).map(v=>parseFloat(String(v).replace(",",".")));
  if(vals.length===total&&vals.every(v=>Number.isFinite(v)&&v>=2&&v<=5.5))return vals;
  return Array.from({length:total},()=>CFG.laneWidthM)
}
function laneGeometry(tags,dir,total){
  if(!total)return null;
  const widths=parseLaneWidths(tags,dir,total),sum=widths.reduce((a,b)=>a+b,0),oneway=["yes","1","true","-1"].includes(String(tags.oneway||"").toLowerCase());
  let start=-sum/2,quality="direct";
  if(!oneway){
    const full=positiveInt(tags.lanes),opp=positiveInt(dir==="forward"?tags["lanes:backward"]:tags["lanes:forward"]);
    let totalRoad=full;
    if(!totalRoad&&opp)totalRoad=total+opp;
    if(!totalRoad){totalRoad=total*2;quality="inferred"}
    const roadWidth=totalRoad*CFG.laneWidthM;
    start=roadWidth/2-sum;
    if(!positiveInt(dir==="forward"?tags["lanes:forward"]:tags["lanes:backward"]))quality="inferred"
  }
  const bounds=[start];let x=start;for(const w of widths){x+=w;bounds.push(x)}
  return{widths,bounds,start,end:x,quality,oneway}
}
function laneFromOffset(geom,off){
  if(!geom)return null;
  const margin=.75;
  if(off<geom.start-margin||off>geom.end+margin)return null;
  const x=clamp(off,geom.start+.01,geom.end-.01);
  for(let i=0;i<geom.widths.length;i++)if(x>=geom.bounds[i]&&x<geom.bounds[i+1])return i+1;
  return geom.widths.length
}
function median(values){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return null;
  const mid=Math.floor(a.length/2);return a.length%2?a[mid]:(a[mid-1]+a[mid])/2
}
function calibrationKey(m,dir){return m?.road?.id?`${m.road.id}:${dir}`:null}
function laneCalibrationBias(m,dir){
  const key=calibrationKey(m,dir),c=key?S.laneCalibration.byRoad[key]:null;
  if(!c||c.samples.length<4||Date.now()-c.updatedAt>45*60*1000||c.mad>1.25)return{bias:0,active:false,count:c?.samples?.length||0,mad:c?.mad??null};
  return{bias:clamp(c.bias,-1.6,1.6),active:true,count:c.samples.length,mad:c.mad}
}
function addLaneCalibrationSample(m,lane,truthIndex){
  if(!m||!lane?.geometry||!Number.isFinite(lane.lateralRawM??lane.lateralM)||!truthIndex)return;
  const centers=laneCenters(lane.geometry),expected=centers[truthIndex-1];if(!Number.isFinite(expected))return;
  const residual=(lane.lateralRawM??lane.lateralM)-expected;if(Math.abs(residual)>4.5)return;
  const key=calibrationKey(m,lane.dir);if(!key)return;
  const c=S.laneCalibration.byRoad[key]||(S.laneCalibration.byRoad[key]={samples:[],bias:0,mad:99,updatedAt:0});
  c.samples.push(residual);if(c.samples.length>28)c.samples.shift();
  const med=median(c.samples),dev=c.samples.map(x=>Math.abs(x-med)),mad=median(dev);
  c.bias=med??0;c.mad=mad??99;c.updatedAt=Date.now()
}
function estimateLane(m,pos){
  const dir=travelDirection(m,pos),total=laneCount(m.road.tags,dir),rb=dir==="forward"?m.roadBearing:(m.roadBearing+180)%360,acc=Number.isFinite(pos.accuracy)?pos.accuracy:999,headErr=Number.isFinite(pos.heading)?angleDiff(pos.heading,rb):90;
  const mapQ=Number.isFinite(m.quality)?m.quality:50,confidence=clamp(Math.round(92-Math.min(m.distance,40)*1.1-Math.min(acc,40)*2.25-Math.min(headErr,90)*.22+(mapQ-50)*.18),0,100);
  const hasTurnLanes=Boolean(directionalLaneValue(m.road.tags,"turn:lanes",dir)),geom=laneGeometry(m.road.tags,dir,total);
  const base={dir,total,confidence,hasTurnLanes,turns:laneTurns(m.road.tags,dir),changes:laneChanges(m.road.tags,dir),accessible:laneAccess(m.road.tags,dir,total),geometry:geom};
  if(!total)return{...base,index:null,candidateIndex:null,reason:"Nombre de voies absent dans OSM"};
  const offRaw=signedLateralM(pos,m.nearest,rb),cal=laneCalibrationBias(m,dir),off=offRaw-cal.bias,candidateIndex=laneFromOffset(geom,off);
  if(!candidateIndex)return{...base,index:null,candidateIndex:null,lateralM:off,lateralRawM:offRaw,calibration:cal,reason:"Position latérale incompatible avec la géométrie des voies"};
  const penalty=geom?.quality==="inferred"?8:0,finalConfidence=clamp(confidence-penalty,0,100),reliable=acc<=5.5&&finalConfidence>=62;
  return{...base,index:reliable?candidateIndex:null,candidateIndex,lateralM:off,lateralRawM:offRaw,calibration:cal,confidence:clamp(finalConfidence+(cal.active?4:0),0,100),reason:reliable?(geom?.quality==="inferred"?"Estimation GPS + axe OSM (géométrie inférée)":"Estimation GPS + géométrie OSM")+(cal.active?` · CAL ${cal.bias>=0?"+":""}${cal.bias.toFixed(1)}m`:""):`Mesure latérale disponible · GPS ±${Math.round(acc)} m${cal.active?` · CAL ${cal.bias>=0?"+":""}${cal.bias.toFixed(1)}m`:""}`}
}
function normalizeProb(v){
  const sum=v.reduce((a,b)=>a+(Number.isFinite(b)?Math.max(0,b):0),0);
  return sum>1e-9?v.map(x=>Math.max(0,x)/sum):v.map(()=>1/v.length)
}
function laneCenters(geom){return geom?.widths?.map((_,i)=>(geom.bounds[i]+geom.bounds[i+1])/2)||[]}
function updateLaneTransition(lane){
  const T=S.laneTransition,now=Date.now(),lat=lane?.lateralM;
  if(!Number.isFinite(lat)){T.score=Math.max(0,T.score-.25);T.state=T.score>.8?T.state:"STABLE";T.lastAt=now;return T}
  if(!Number.isFinite(T.lastLateral)||!T.lastAt){T.lastLateral=lat;T.lastAt=now;return T}
  const dt=clamp((now-T.lastAt)/1000,.08,3),speed=(lat-T.lastLateral)/dt;T.lateralSpeed=T.lateralSpeed*.55+speed*.45;T.lastLateral=lat;T.lastAt=now;
  const visionBoundary=Boolean(S.visionCue?.stable&&S.visionCue?.nearBoundary&&S.visionCue?.confidence>=66),candidateShift=lane?.candidateIndex&&S.laneBelief.index&&lane.candidateIndex!==S.laneBelief.index;
  const moving=Math.abs(T.lateralSpeed)>.28,direction=T.lateralSpeed>0?1:-1;
  if(moving&&(visionBoundary||candidateShift)){if(T.direction===direction)T.score=Math.min(3,T.score+.48);else{T.direction=direction;T.score=.55}if(T.score>=1.05&&T.state==="STABLE"){T.state="FRANCHISSEMENT";T.startedAt=now}}
  else T.score=Math.max(0,T.score-(visionBoundary?.12:.24));
  if(T.state==="FRANCHISSEMENT"&&now-T.startedAt>550&&Math.abs(T.lateralSpeed)<.22){T.state="STABILISATION";T.score=Math.max(T.score,1)}
  if(T.state==="STABILISATION"&&Math.abs(T.lateralSpeed)<.16&&now-T.startedAt>1250){T.state="STABLE";T.score=0;T.direction=0}
  if(T.score<.35&&T.state!=="STABILISATION"){T.state="STABLE";T.direction=0}
  return T
}
function updateLaneBelief(lane,m){
  const T=updateLaneTransition(lane),B=S.laneBelief,roadId=m?.road?.id||null,total=lane?.total||0;
  if(!total||!lane.geometry){B.roadId=roadId;B.total=total;B.probs=[];B.index=null;B.confidence=0;return lane}
  if(B.roadId!==roadId||B.total!==total||B.probs.length!==total){
    B.roadId=roadId;B.total=total;B.probs=Array.from({length:total},()=>1/total);B.index=null;B.confidence=0;B.lastVisionShift=0
  }
  const prior=Array(total).fill(0);
  for(let i=0;i<total;i++)for(let j=0;j<total;j++){
    const d=j-i;let t=Math.abs(d)===0?.82:Math.abs(d)===1?.085:Math.abs(d)===2?.008:.002;
    if(T.state==="FRANCHISSEMENT"&&T.direction){if(d===T.direction)t=.24;else if(d===0)t=.67;else if(Math.abs(d)===1)t=.045}
    else if(T.state==="STABILISATION"&&T.direction){if(d===T.direction)t=.16;else if(d===0)t=.76}
    prior[j]+=B.probs[i]*t
  }
  const centers=laneCenters(lane.geometry),acc=S.rawGps?.accuracy??S.gps?.accuracy??999,sigma=clamp(acc*.62,1.15,8.5);
  let likelihood=Array(total).fill(1);
  if(Number.isFinite(lane.lateralM)){
    likelihood=centers.map(c=>{
      const d=lane.lateralM-c,g=Math.exp(-(d*d)/(2*sigma*sigma));
      return .12+.88*g
    })
  }
  const v=S.visionCue;
  if(T.state==="FRANCHISSEMENT"&&T.direction&&B.index){const target=B.index-1+T.direction;if(target>=0&&target<total)likelihood[target]*=1.7}
  if(v?.stable&&v.valid&&v.confidence>=68&&B.index){
    const dir=v.offsetNorm>.22?1:v.offsetNorm<-.22?-1:0;
    if(dir&&v.nearBoundary){
      const target=B.index-1+dir;
      if(target>=0&&target<total){likelihood[target]*=1.45;likelihood[B.index-1]*=.82;B.lastVisionShift=dir}
    }else if(Math.abs(v.offsetNorm)<.14)likelihood[B.index-1]*=1.18
  }
  const gpsStrength=clamp((16-acc)/12,.08,1),mapStrength=clamp((m?.quality||45)/100,.25,1),strength=gpsStrength*mapStrength;
  const posterior=normalizeProb(prior.map((p,i)=>p*Math.pow(likelihood[i],.35+strength*.95)));
  B.probs=posterior;
  const ranked=posterior.map((p,i)=>({p,i:i+1})).sort((a,b)=>b.p-a.p),top=ranked[0],second=ranked[1]||{p:0},gap=top.p-second.p;
  const certainty=clamp((top.p-.34)/.5,0,1)*.7+clamp(gap/.32,0,1)*.3;
  B.confidence=Math.round(clamp((lane.confidence*.42+(m?.quality||0)*.23+certainty*100*.35),0,100));
  const fusedQ=Math.min(100,(S.fusion?.quality||gpsQuality(S.rawGps,m))*.72+(S.sensorHealth.overall||0)*.28),valid=top.p>=.47&&gap>=.08&&B.confidence>=58&&fusedQ>=36;
  B.index=valid?top.i:(B.index&&top.p>=.38?B.index:null);
  return{...lane,index:B.index,belief:[...posterior],beliefTop:+top.p.toFixed(3),beliefGap:+gap.toFixed(3),transition:{state:T.state,direction:T.direction,lateralSpeed:+T.lateralSpeed.toFixed(2),score:+T.score.toFixed(2)},confidence:B.confidence,reason:T.state==="FRANCHISSEMENT"?"Changement de voie détecté · fusion latérale":valid?"Fusion temporelle GPS + carte + vision":"Probabilités de voie en convergence"}
}
function stabilizeLane(lane,m){
  const f=S.laneFilter,roadId=m?.road?.id||null;
  if(f.roadId!==roadId){f.roadId=roadId;f.index=null;f.candidate=null;f.hits=0;S.currentTruth=null}
  if(!lane.index){f.candidate=null;f.hits=0;return lane}
  if(f.index===null){
    if(f.candidate===lane.index)f.hits++;else{f.candidate=lane.index;f.hits=1}
    if(f.hits>=2){f.index=lane.index;f.candidate=null;f.hits=0;return lane}
    return{...lane,index:null,reason:"Stabilisation de la voie…"}
  }
  if(lane.index===f.index){f.candidate=null;f.hits=0;return lane}
  if(f.candidate===lane.index)f.hits++;else{f.candidate=lane.index;f.hits=1}
  const visionCrossing=Boolean(S.visionCue?.stable&&S.visionCue.nearBoundary&&S.visionCue.confidence>=70),detected=S.laneTransition.state==="FRANCHISSEMENT"||S.laneTransition.state==="STABILISATION",needed=detected?2:visionCrossing?2:3;
  if(f.hits>=needed){f.index=lane.index;f.candidate=null;f.hits=0;return{...lane,reason:visionCrossing?"Changement confirmé GPS + vision":"Changement confirmé par plusieurs positions GPS"}}
  return{...lane,index:f.index,reason:visionCrossing?"Vision détecte un franchissement · confirmation GPS":"Changement de voie en cours de confirmation"}
}
function laneChangeAllowed(lane,from,to){
  if(!from||!to||from===to||!lane.changes?.length)return true;
  const raw=String(lane.changes[from-1]||"").toLowerCase();if(!raw)return true;
  const dir=to>from?"right":"left";
  if(raw==="no"||raw.includes("not_"+dir))return false;
  if(raw.includes("only_left")&&dir!=="left")return false;
  if(raw.includes("only_right")&&dir!=="right")return false;
  return true
}
function onDeviceOrientation(e){
  const h=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:(Number.isFinite(e.alpha)?(360-e.alpha)%360:null);
  if(Number.isFinite(h)){S.compassHeading=h;S.compassActive=true;if(!S.gps||S.gps.speedMps<1.5)S.heading=h}
}
async function enableCompass(){
  if(S.compassActive)return;
  const D=window.DeviceOrientationEvent;if(!D)return;
  try{
    if(typeof D.requestPermission==="function"){const p=await D.requestPermission();if(p!=="granted")return}
    window.addEventListener("deviceorientation",onDeviceOrientation,true)
  }catch(_){}
}
function sensorHealth(pos=S.gps,m=S.lastMatch){
  const acc=S.rawGps?.accuracy??pos?.accuracy??999,gps=clamp(Math.round(100-(acc-3)*3.6-(S.rawGps?.rejected?42:0)),0,100),map=m?clamp(Math.round(m.quality||0),0,100):0;
  const route=S.routeCoords.length?clamp(Math.round((S.routeFilter.quality||0)*(1-(S.routeFilter.ambiguity||0)*.55)),0,100):map;
  const vision=S.visionCue?.stable&&S.visionCue?.alignment?clamp(Math.round(S.visionCue.confidence||0),0,100):0;
  let compass=0;if(S.compassActive&&Number.isFinite(S.compassHeading)){compass=70;const ref=m&&pos?(travelDirection(m,pos)==="forward"?m.roadBearing:(m.roadBearing+180)%360):pos?.heading;if(Number.isFinite(ref))compass=clamp(Math.round(90-angleDiff(S.compassHeading,ref)*.7),15,95)}
  const navWeight=S.routeCoords.length?.18:.05,visionWeight=vision?0.10:0,compassWeight=compass?0.06:0,baseWeight=.58+.18+navWeight+visionWeight+compassWeight;
  const overall=Math.round((gps*.58+map*.18+route*navWeight+vision*visionWeight+compass*compassWeight)/baseWeight),label=overall>=78?"FORT":overall>=58?"BON":overall>=38?"MOYEN":"FAIBLE";
  S.sensorHealth={gps,map,route,vision,compass,overall,label};return S.sensorHealth
}
function gpsQuality(raw=S.rawGps,match=S.lastMatch){
  if(!raw)return 0;
  const acc=raw.accuracy||999,accQ=clamp(1-(acc-3)/27,0,1),matchQ=match?clamp((match.quality||0)/100,0,1):.35;
  const ageQ=clamp(1-(Date.now()-(raw.t||Date.now()))/7000,0,1),rejectPenalty=raw.rejected?.38:1,base=100*(accQ*.56+matchQ*.34+ageQ*.10)*rejectPenalty;
  return Math.round(clamp(base*.72+(S.sensorHealth.overall||base)*.28,0,100))
}
function acceptGpsInnovation(raw){
  const prev=S.lastAcceptedRaw;if(!prev){S.lastAcceptedRaw={...raw};return{...raw,rejected:false}}
  const dt=clamp(((raw.t||Date.now())-(prev.t||Date.now()))/1000,.1,10),d=haversineM(prev,raw),expected=Math.max(5,(prev.speedMps||0)*dt),gate=Math.max(22,(raw.accuracy||10)*2.6,(prev.accuracy||10)*1.8,expected+20);
  if(d>gate&&dt<6){
    S.gpsRejected++;
    const w=clamp(gate/d,.08,.45);
    return{...raw,lat:prev.lat+(raw.lat-prev.lat)*w,lon:prev.lon+(raw.lon-prev.lon)*w,accuracy:Math.max(raw.accuracy||999,d*.55),rejected:true}
  }
  S.gpsRejected=Math.max(0,S.gpsRejected-1);S.lastAcceptedRaw={...raw};return{...raw,rejected:false}
}
function updateFusionState(pos,m,lane,nav){
  const f=S.fusion,now=Date.now(),q=gpsQuality(S.rawGps,m),routeProj=S.routeCoords.length?routeFilterProjection(pos):null;
  let lateral=Number.isFinite(lane?.lateralM)?lane.lateralM:0;
  if(!f.position){
    f.position={lat:pos.lat,lon:pos.lon};f.along=routeProj?.along??null;f.lateralM=lateral;f.heading=pos.heading||0;f.speedMps=pos.speedMps||0;f.quality=q;f.mode="GPS";f.lastGpsAt=now;f.lastPredictAt=now;f.roadId=m?.road?.id||null;return f
  }
  const mapSupport=Boolean(m)||(routeProj&&routeProj.distance<=28);const strong=q>=58&&!S.rawGps?.rejected&&mapSupport;
  if(S.routeCoords.length&&routeProj){
    if(f.along===null)f.along=routeProj.along;
    const innovation=routeProj.along-f.along,allowBack=pos.speedMps<1?.5:8,plausibleForward=Math.max(35,(pos.speedMps||0)*6+25);
    if(strong&&innovation>=-allowBack&&innovation<=plausibleForward)f.along+=innovation*clamp(.28+q/160,.42,.85);
    else if(strong&&Math.abs(innovation)<18)f.along+=innovation*.35;
    f.lateralM=f.lateralM*.68+lateral*.32;
    const rp=fusedRoutePosition(f.along,f.lateralM);if(rp)f.position={lat:rp.lat,lon:rp.lon};
    f.heading=rp?.heading??lerpAngle(f.heading,pos.heading||f.heading,.3)
  }else if(m){
    const snapW=strong?clamp((m.quality||0)/125,.25,.75):.12;
    const target={lat:pos.lat+(m.nearest.lat-pos.lat)*snapW,lon:pos.lon+(m.nearest.lon-pos.lon)*snapW};
    f.position={lat:f.position.lat+(target.lat-f.position.lat)*.62,lon:f.position.lon+(target.lon-f.position.lon)*.62};
    f.heading=lerpAngle(f.heading,travelDirection(m,pos)==="forward"?m.roadBearing:(m.roadBearing+180)%360,.32)
  }else{
    f.position={lat:f.position.lat+(pos.lat-f.position.lat)*.35,lon:f.position.lon+(pos.lon-f.position.lon)*.35};
    f.heading=lerpAngle(f.heading,pos.heading||f.heading,.18)
  }
  f.speedMps=f.speedMps*.55+(pos.speedMps||0)*.45;f.quality=Math.round(f.quality*.35+q*.65);f.mode=strong?"FUSION":(f.quality>=35?"PRÉDICTIF":"GPS FAIBLE");f.lastGpsAt=now;f.lastPredictAt=now;f.roadId=m?.road?.id||f.roadId;return f
}
function advanceFusion(nowMs=Date.now()){
  const f=S.fusion;if(!f.position)return;
  const dt=clamp((nowMs-(f.lastPredictAt||nowMs))/1000,0,.2);f.lastPredictAt=nowMs;
  const age=nowMs-f.lastGpsAt;
  if(dt<=0||age<250)return;
  const predictWindow=age<6500&&f.quality>=28;
  if(!predictWindow){f.mode=age>6500?"GPS PERDU":f.mode;f.quality=Math.max(0,f.quality-dt*2);return}
  const ds=clamp(f.speedMps*dt,0,4);
  if(S.routeCoords.length&&Number.isFinite(f.along)){
    f.along=clamp(f.along+ds,0,S.routeLengthM||Infinity);const rp=fusedRoutePosition(f.along,f.lateralM);if(rp){f.position={lat:rp.lat,lon:rp.lon};f.heading=rp.heading}
  }else if(ds>.02){if(Number.isFinite(S.compassHeading)&&age>1200)f.heading=lerpAngle(f.heading,S.compassHeading,clamp(dt*.45,0,.07));f.position=destinationPoint(f.position,f.heading,ds)}
  if(age>1200)f.mode="PRÉDICTIF";
  f.quality=Math.max(18,f.quality-dt*(age>2500?3.5:1.2));
  if(age>1500&&S.laneBelief.confidence>0){
    S.laneBelief.confidence=Math.max(0,S.laneBelief.confidence-dt*(age>3500?6:2));
    if(S.lastLane)S.lastLane={...S.lastLane,confidence:Math.round(S.laneBelief.confidence),reason:"Confiance en décroissance · GPS non rafraîchi"}
  }
  if(age>5200){
    S.laneBelief.index=null;if(S.lastLane)S.lastLane={...S.lastLane,index:null,confidence:Math.min(S.lastLane.confidence,28),reason:"Voie non confirmée · GPS trop ancien"}
  }
}
function fusionPosition(){
  const f=S.fusion;if(!f.position)return S.gps;
  return{lat:f.position.lat,lon:f.position.lon,heading:f.heading,speedMps:f.speedMps,accuracy:S.gps?.accuracy??999,fusionQuality:f.quality,fusionMode:f.mode}
}
function gpsMeasurement(p){
  const c=p.coords,t=Number.isFinite(p.timestamp)?p.timestamp:Date.now(),point={lat:c.latitude,lon:c.longitude},accuracy=Number.isFinite(c.accuracy)?c.accuracy:999;
  let speed=Number.isFinite(c.speed)&&c.speed>=0?c.speed:null,heading=Number.isFinite(c.heading)&&c.heading>=0?c.heading:null;
  if(S.lastRawFix){
    const dt=(t-S.lastRawFix.t)/1000,d=haversineM(S.lastRawFix,point),noise=Math.max(2,Math.min(12,accuracy*.32));
    if(dt>.35&&dt<8&&d>noise){
      if(speed===null)speed=clamp(d/dt,0,55);
      if(heading===null)heading=bearing(S.lastRawFix,point)
    }
  }
  if(speed===null)speed=0;
  if(heading===null)heading=Number.isFinite(S.compassHeading)?S.compassHeading:S.heading;
  S.lastRawFix={...point,t,accuracy};
  return acceptGpsInnovation({...point,speedMps:speed,heading,accuracy,t})
}
function smoothGps(raw){if(!S.gps)return raw;const acc=clamp(raw.accuracy,3,40),alpha=raw.speedMps>8?.5:raw.speedMps>2?.35:.22,weight=clamp(alpha*(12/acc),.12,.65);const sm={...raw,lat:S.gps.lat+(raw.lat-S.gps.lat)*weight,lon:S.gps.lon+(raw.lon-S.gps.lon)*weight};if(Number.isFinite(raw.heading)&&raw.speedMps>1.5){const a=rad(S.gps.heading||raw.heading),b=rad(raw.heading),x=Math.cos(a)*.65+Math.cos(b)*.35,y=Math.sin(a)*.65+Math.sin(b)*.35;sm.heading=(deg(Math.atan2(y,x))+360)%360}else sm.heading=Number.isFinite(S.compassHeading)?S.compassHeading:(S.gps.heading||raw.heading||0);return sm}
function mapDisplayPosition(pos){
  const fused=fusionPosition(),m=effectiveMatch();
  if(fused&&S.fusion.quality>=38&&["FUSION","PRÉDICTIF"].includes(S.fusion.mode))return{lat:fused.lat,lon:fused.lon,snapped:true,predictive:S.fusion.mode==="PRÉDICTIF"};
  if(!m||S.matchQuality<62)return{lat:pos.lat,lon:pos.lon,snapped:false,predictive:false};
  const maxSnap=Math.max(10,Math.min(28,(pos.accuracy||10)*1.8));if(m.distance>maxSnap)return{lat:pos.lat,lon:pos.lon,snapped:false,predictive:false};
  const w=clamp((S.matchQuality-55)/42,.15,.88);
  return{lat:pos.lat+(m.nearest.lat-pos.lat)*w,lon:pos.lon+(m.nearest.lon-pos.lon)*w,snapped:true,predictive:false}
}
function updateUserMarker(pos){
  const actual=[pos.lat,pos.lon],display=mapDisplayPosition(pos),ll=[display.lat,display.lon];
  if(!S.userMarker){
    const icon=L.divIcon({className:"",html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
    S.userMarker=L.marker(ll,{icon,zIndexOffset:1000}).addTo(S.map);
    S.accuracyCircle=L.circle(actual,{radius:pos.accuracy||10,weight:1,color:"#1d79ff",fillColor:"#1d79ff",fillOpacity:.08}).addTo(S.map)
  }else{
    S.userMarker.setLatLng(ll);S.accuracyCircle.setLatLng(actual).setRadius(pos.accuracy||10)
  }
  const dot=S.userMarker.getElement()?.querySelector(".user-dot");if(dot){dot.style.transform=`rotate(${Math.round(pos.heading||S.heading||0)}deg)`;dot.classList.toggle("snapped",display.snapped);dot.classList.toggle("predictive",display.predictive)}
  if(S.view==="map"&&S.followMap)S.map.setView(ll,17,{animate:true})
}
function buildRouteCum(){
  S.routeCum=[0];let cum=0;
  for(let i=0;i<S.routeCoords.length-1;i++){cum+=haversineM(S.routeCoords[i],S.routeCoords[i+1]);S.routeCum.push(cum)}
  S.routeLengthM=cum||S.routeLengthM
}
function routePointAtAlong(along){
  if(!S.routeCoords.length)return null;
  const total=S.routeCum[S.routeCum.length-1]||0,a=clamp(along,0,total);
  let lo=0,hi=S.routeCum.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(S.routeCum[mid]<a)lo=mid+1;else hi=mid}
  const i=Math.max(0,lo-1),start=S.routeCum[i]||0,end=S.routeCum[i+1]??start,span=Math.max(.001,end-start),t=clamp((a-start)/span,0,1),p0=S.routeCoords[i],p1=S.routeCoords[Math.min(i+1,S.routeCoords.length-1)];
  return{lat:p0.lat+(p1.lat-p0.lat)*t,lon:p0.lon+(p1.lon-p0.lon)*t,index:i,t,bearing:bearing(p0,p1)}
}
function fusedRoutePosition(along,lateralM=0){
  const p=routePointAtAlong(along);if(!p)return null;
  return Math.abs(lateralM)>.05?{...destinationPoint(p,(p.bearing+90)%360,lateralM),heading:p.bearing}:{lat:p.lat,lon:p.lon,heading:p.bearing}
}
function routeObservationCandidates(pos,predictedAlong=null,maxCandidates=8){
  if(!S.routeCoords.length)return[];
  const out=[],n=S.routeCoords.length-1,F=S.routeFilter;
  let start=0,end=n;
  if(Number.isFinite(F.index)&&F.quality>=25){start=Math.max(0,F.index-140);end=Math.min(n,F.index+240)}
  const scan=(a,b)=>{
    for(let i=a;i<b;i++){
      const p0=S.routeCoords[i],p1=S.routeCoords[i+1],segLen=haversineM(p0,p1),p=pointToSegment(pos,p0,p1),along=(S.routeCum[i]||0)+segLen*p.t,rb=bearing(p0,p1);
      const headingErr=pos.speedMps>1.3&&Number.isFinite(pos.heading)?angleDiff(pos.heading,rb):0;
      let score=p.distance+headingErr*(pos.speedMps>5?.13:.07);
      if(Number.isFinite(predictedAlong)){
        const delta=along-predictedAlong;
        if(delta<-22)score+=Math.min(160,Math.abs(delta+22)*1.25);
        if(delta>Math.max(120,(pos.speedMps||0)*9+70))score+=Math.min(120,(delta-80)*.24)
      }
      out.push({distance:p.distance,index:i,t:p.t,along,nearest:p.nearest,roadBearing:rb,headingError,score})
    }
  };
  scan(start,end);
  out.sort((a,b)=>a.score-b.score);
  if(out[0]?.distance>45&&(start>0||end<n)){out.length=0;scan(0,n);out.sort((a,b)=>a.score-b.score)}
  return out.slice(0,maxCandidates)
}
function updateRouteFilter(pos){
  if(!S.routeCoords.length){S.routeFilter={along:null,index:null,quality:0,ambiguity:1,candidates:[],lastAt:0};return null}
  const F=S.routeFilter,now=Date.now(),dt=F.lastAt?clamp((now-F.lastAt)/1000,0,8):0,predicted=Number.isFinite(F.along)?F.along+(pos.speedMps||0)*dt:null,cands=routeObservationCandidates(pos,predicted,10);
  if(!cands.length)return null;
  const best=cands[0],cluster=cands.filter(c=>Math.abs(c.along-best.along)<95),min=best.score,weighted=cluster.map(c=>({...c,w:Math.exp(-(c.score-min)/11)})),sum=weighted.reduce((a,c)=>a+c.w,0)||1;
  const observedAlong=weighted.reduce((a,c)=>a+c.along*c.w,0)/sum;
  const correction=Number.isFinite(predicted)?clamp(observedAlong-predicted,-35,65):0,along=Number.isFinite(predicted)?predicted+correction*clamp(.42+(100-Math.min(100,best.distance*3))*.004,.42,.82):observedAlong;
  const alt=cands.find(c=>Math.abs(c.along-best.along)>95),gap=alt?alt.score-best.score:35,ambiguity=clamp(1-gap/28,0,1),quality=Math.round(clamp(100-best.distance*2.1-best.headingError*.18-ambiguity*28,0,100)),rp=routePointAtAlong(along);
  F.along=clamp(along,0,S.routeLengthM||along);F.index=rp?.index??best.index;F.quality=quality;F.ambiguity=ambiguity;F.candidates=cands.slice(0,5).map(c=>({along:+c.along.toFixed(1),distance:+c.distance.toFixed(1),score:+c.score.toFixed(1),index:c.index}));F.lastAt=now;
  if(quality>=28)S.lastRouteAlong=F.along;
  return{distance:best.distance,index:F.index,t:rp?.t??best.t,along:F.along,nearest:rp?{lat:rp.lat,lon:rp.lon}:best.nearest,score:best.score,quality,ambiguity,total:S.routeLengthM,remaining:Math.max(0,S.routeLengthM-F.along),progress:S.routeLengthM?F.along/S.routeLengthM:0}
}
function routeFilterProjection(pos){
  if(Number.isFinite(S.routeFilter.along)&&S.routeFilter.quality>=20){
    const rp=routePointAtAlong(S.routeFilter.along),raw=routeProjection(pos,S.routeFilter.along);
    if(rp&&raw)return{...raw,along:S.routeFilter.along,index:rp.index,t:rp.t,nearest:{lat:rp.lat,lon:rp.lon},quality:S.routeFilter.quality,ambiguity:S.routeFilter.ambiguity,remaining:Math.max(0,S.routeLengthM-S.routeFilter.along),progress:S.routeLengthM?S.routeFilter.along/S.routeLengthM:0,total:S.routeLengthM}
  }
  return routeProjection(pos,S.lastRouteAlong)
}
function routeProjection(pos,hintAlong=null){
  if(!S.routeCoords.length)return null;
  let best=null;
  for(let i=0;i<S.routeCoords.length-1;i++){
    const a=S.routeCoords[i],b=S.routeCoords[i+1],segLen=haversineM(a,b),p=pointToSegment(pos,a,b),along=(S.routeCum[i]||0)+segLen*p.t;
    let score=p.distance;
    if(Number.isFinite(hintAlong)){
      const delta=along-hintAlong;
      if(delta<-45)score+=Math.min(180,Math.abs(delta)*1.8);
      else if(delta>Math.max(180,(S.gps?.speedMps||0)*14+120))score+=Math.min(100,(delta-120)*.25)
    }
    if(!best||score<best.score)best={distance:p.distance,index:i,t:p.t,along,nearest:p.nearest,score}
  }
  if(best){const total=S.routeCum[S.routeCum.length-1]||S.routeLengthM||0;best.total=total;best.remaining=Math.max(0,total-best.along);best.progress=total?best.along/total:0}
  return best
}
function liveRouteProjection(pos){
  const p=routeProjection(pos,S.lastRouteAlong);
  if(p&&p.distance<80){
    if(S.lastRouteAlong===null||p.along>=S.lastRouteAlong-35||p.distance<12)S.lastRouteAlong=p.along;
  }
  return p
}
function normalizeIndication(v){
  const x=String(v||"").toLowerCase().replaceAll(" ","_");
  if(x.includes("uturn")||x.includes("reverse"))return"uturn";
  if(x.includes("slight_left"))return"slight_left";
  if(x.includes("sharp_left"))return"sharp_left";
  if(x.includes("left"))return"left";
  if(x.includes("slight_right"))return"slight_right";
  if(x.includes("sharp_right"))return"sharp_right";
  if(x.includes("right"))return"right";
  return"through"
}
function osrmLaneHint(intersection,step){
  const lanes=intersection?.lanes;if(!Array.isArray(lanes)||!lanes.length)return null;
  const parsed=lanes.map((l,i)=>({
    index:i+1,valid:l.valid!==false,
    indications:(Array.isArray(l.indications)?l.indications:[]).map(normalizeIndication),
    raw:l
  }));
  const loc=intersection.location;if(!Array.isArray(loc)||loc.length<2)return null;
  const point={lat:loc[1],lon:loc[0]},proj=routeProjection(point,null);if(!proj)return null;
  return{along:proj.along,point,lanes:parsed,total:parsed.length,bearings:intersection.bearings||[],entry:intersection.entry||[],in:intersection.in,out:intersection.out,road:step.name||""}
}
function routeIntersectionModel(intersection,step){
  const loc=intersection?.location;if(!Array.isArray(loc)||loc.length<2)return null;
  const point={lat:loc[1],lon:loc[0]},proj=routeProjection(point,null);if(!proj)return null;
  return{along:proj.along,point,bearings:Array.isArray(intersection.bearings)?intersection.bearings:[],entry:Array.isArray(intersection.entry)?intersection.entry:[],in:Number.isFinite(intersection.in)?intersection.in:null,out:Number.isFinite(intersection.out)?intersection.out:null,road:step.name||"",lanes:Array.isArray(intersection.lanes)?intersection.lanes:null}
}
function buildRouteManeuvers(){
  S.routeManeuvers=[];S.routeLaneHints=[];S.routeIntersections=[];
  const steps=S.route?.legs?.[0]?.steps||[];
  for(const step of steps){
    const loc=step.maneuver?.location;
    if(loc){
      const point={lat:loc[1],lon:loc[0]},proj=routeProjection(point,null);
      if(proj)S.routeManeuvers.push({step,along:proj.along,point,type:step.maneuver?.type||"",modifier:step.maneuver?.modifier||"straight"})
    }
    for(const inter of step.intersections||[]){
      const model=routeIntersectionModel(inter,step);if(model)S.routeIntersections.push(model);
      const hint=osrmLaneHint(inter,step);if(hint)S.routeLaneHints.push(hint)
    }
  }
  S.routeManeuvers.sort((a,b)=>a.along-b.along);S.routeLaneHints.sort((a,b)=>a.along-b.along);S.routeIntersections.sort((a,b)=>a.along-b.along);
  const dedup=[];for(const h of S.routeLaneHints){const prev=dedup[dedup.length-1];if(prev&&Math.abs(prev.along-h.along)<4&&prev.total===h.total)continue;dedup.push(h)}S.routeLaneHints=dedup;
  const ints=[];for(const it of S.routeIntersections){const prev=ints[ints.length-1];if(prev&&Math.abs(prev.along-it.along)<2&&prev.bearings.length===it.bearings.length)continue;ints.push(it)}S.routeIntersections=ints
}
function upcomingRouteLaneHint(along=S.fusion.along??S.lastRouteAlong,maxAhead=900){
  if(!Number.isFinite(along)||!S.routeLaneHints.length)return null;
  for(const h of S.routeLaneHints){const d=h.along-along;if(d>=-12&&d<=maxAhead)return{...h,distance:Math.max(0,d)}}
  return null
}
function maneuverTurn(m){
  const mod=m?.modifier||"straight",type=m?.type||"";
  if(type.includes("roundabout")||type==="rotary")return"roundabout";
  if(mod.includes("left"))return"left";
  if(mod.includes("right"))return"right";
  if(mod==="uturn")return"uturn";
  return"through"
}
function maneuverInstruction(m,turn){
  const type=m?.type||"",mod=m?.modifier||"",side=turn==="left"?"à gauche":turn==="right"?"à droite":"";
  if(type==="arrive")return"Tu arrives à destination";
  if(type==="merge")return side?`Insère-toi ${side}`:"Insère-toi sur la voie";
  if(type==="fork")return side?`À la bifurcation, reste ${side}`:"À la bifurcation, suis la route";
  if(type==="on ramp"||type==="ramp")return side?`Prends la bretelle ${side}`:"Prends la bretelle";
  if(type==="off ramp")return side?`Prends la sortie ${side}`:"Prends la sortie";
  if(type==="end of road")return side?`Au bout de la route, tourne ${side}`:"Au bout de la route, tourne";
  if(type.includes("roundabout")||type==="rotary"){const exit=m?.exit;return exit?`Au rond-point, prends la sortie ${exit}`:"Entre dans le rond-point"}
  if(turn==="left")return"Tourne à gauche";
  if(turn==="right")return"Tourne à droite";
  if(turn==="uturn")return"Fais demi-tour";
  return"Continue tout droit"
}
function nextInstruction(pos){
  const proj=liveRouteProjection(pos);if(!proj)return{instruction:"Suivre l’itinéraire",detail:"",turn:"through",distance:null};
  const dest=S.destination?haversineM(pos,S.destination):Infinity;
  if(proj.remaining<35||dest<35)return{instruction:"Destination atteinte",detail:"Tu es arrivé",turn:"through",distance:0,remaining:0,progress:1,offRoute:proj.distance,arrived:true,maneuverId:"arrive"};
  let candidate=null,candidateIndex=-1;
  for(let i=0;i<S.routeManeuvers.length;i++){const m=S.routeManeuvers[i];if(m.type==="depart")continue;if(m.along>=proj.along-12){candidate=m;candidateIndex=i;break}}
  if(!candidate)return{instruction:"Continue jusqu’à destination",detail:`${Math.round(proj.remaining)} m restants`,turn:"through",distance:proj.remaining,remaining:proj.remaining,progress:proj.progress,offRoute:proj.distance,maneuverId:"final"};
  const distance=Math.max(0,candidate.along-proj.along),turn=maneuverTurn(candidate),instruction=maneuverInstruction(candidate,turn);
  let after=null;
  for(let i=candidateIndex+1;i<S.routeManeuvers.length;i++){
    const m=S.routeManeuvers[i];if(m.type==="depart"||m.type==="arrive")continue;
    const delta=m.along-candidate.along;if(delta>650)break;
    if(delta>18){after={instruction:maneuverInstruction(m,maneuverTurn(m)),turn:maneuverTurn(m),distance:delta,road:m.step.name||""};break}
  }
  return{instruction,detail:`Dans ~${Math.round(distance)} m · ${candidate.step.name||"prochaine voie"}`,nextRoad:candidate.step.name||"",turn,distance,remaining:proj.remaining,progress:proj.progress,offRoute:proj.distance,arrived:false,after,maneuverId:`${candidate.type}:${Math.round(candidate.along)}`}
}
function compatibleLanes(lane,turn){
  if(!lane.total)return[];
  const desired=turn||"through",out=[],access=lane.accessible?.length?lane.accessible:Array.from({length:lane.total},()=>true);
  lane.turns.forEach((raw,i)=>{if(access[i]===false)return;const vals=raw.split(";").map(v=>v.trim());if(vals.includes(desired)||(desired==="through"&&(vals.includes("through")||vals.includes("straight"))))out.push(i+1)});
  return out
}
function indicationFitsTurn(indications,turn){
  const vals=indications?.length?indications:["through"];
  if(turn==="left")return vals.some(v=>v==="left"||v==="slight_left"||v==="sharp_left");
  if(turn==="right")return vals.some(v=>v==="right"||v==="slight_right"||v==="sharp_right");
  if(turn==="uturn")return vals.includes("uturn");
  if(turn==="roundabout")return true;
  return vals.some(v=>v==="through")
}
function osrmCompatibleLanes(hint,turn){
  if(!hint?.lanes?.length)return[];
  let out=hint.lanes.filter(l=>l.valid&&indicationFitsTurn(l.indications,turn)).map(l=>l.index);
  if(!out.length)out=hint.lanes.filter(l=>l.valid).map(l=>l.index);
  return out
}
function routeLaneStrategy(lane,nav){
  const base=laneRoutePlan(lane,nav?.turn||"through"),along=S.fusion.along??S.routeFilter.along??S.lastRouteAlong,hint=upcomingRouteLaneHint(along,900);
  let compatible=[...base.compatible],source="OSM",hintDistance=null;
  if(hint&&hint.total===lane?.total){
    const osrm=osrmCompatibleLanes(hint,nav?.turn||"through").filter(i=>lane.accessible?.[i-1]!==false),intersection=compatible.filter(i=>osrm.includes(i));
    if(intersection.length)compatible=intersection;
    else if(osrm.length)compatible=osrm;
    if(osrm.length){source=base.compatible.length?"OSM + OSRM":"OSRM";hintDistance=hint.distance}
  }
  if(!compatible.length)return{...base,compatible,source,hint,hintDistance,target:null,next:null};
  const current=lane?.index||null;
  let target=current?compatible.reduce((a,b)=>Math.abs(b-current)<Math.abs(a-current)?b:a):compatible[0],strategic=false;
  const after=nav?.after;
  if(after&&after.distance<360&&compatible.length>1){
    if(after.turn==="left"){target=Math.min(...compatible);strategic=true}
    else if(after.turn==="right"){target=Math.max(...compatible);strategic=true}
  }
  if(!current)return{...base,compatible,target,next:target,source,hint,hintDistance,strategic};
  if(current===target)return{...base,compatible,target,next:target,source,hint,hintDistance,strategic,blocked:false};
  const step=current+(target>current?1:-1),legal=laneChangeAllowed(lane,current,step)&&lane.accessible?.[step-1]!==false;
  return{...base,compatible,target,next:legal?step:current,source,hint,hintDistance,strategic,blocked:!legal}
}
function recommendedLane(lane,turn){
  if(turn&&turn!=="through"&&!lane.hasTurnLanes&&!upcomingRouteLaneHint())return null;
  return laneRoutePlan(lane,turn).target
}
function adviceText(lane,nav){
  if(lane?.index&&lane.accessible?.[lane.index-1]===false)return"⚠️ VOIE CARTOGRAPHIÉE COMME RESTREINTE AUX VOITURES";
  if(!nav)return lane.index?`🟢 VOIE PROBABLE ${lane.index}/${lane.total}`:(lane.total?`🟡 ${lane.total} VOIES · POSITION INCONNUE`:"Voies non renseignées");
  if(nav.arrived)return"🏁 DESTINATION ATTEINTE";
  const plan=routeLaneStrategy(lane,nav),target=plan.target,d=nav.distance??9999;
  if(nav.turn!=="through"&&!lane.hasTurnLanes&&plan.source==="OSM"&&!plan.hint){const dir=nav.turn==="left"?"À GAUCHE":nav.turn==="right"?"À DROITE":nav.turn==="roundabout"?"AU ROND-POINT":"POUR LA MANŒUVRE";return `↪ PRÉPARE-TOI ${dir} · VOIE NON CARTOGRAPHIÉE`}
  if(!target)return lane.total?`🟡 ${lane.total} VOIES · AUCUNE VOIE COMPATIBLE CONFIRMÉE`:"Voies non renseignées";
  if(lane.index&&target!==lane.index&&plan.blocked)return"⚠️ CHANGEMENT DE VOIE CARTOGRAPHIÉ COMME INTERDIT ICI";
  const urgency=d>350?"PRÉPARE":d>120?"REJOINS":"MAINTENANT",tag=plan.strategic?" · ANTICIPATION":"";
  if(lane.index&&target===lane.index)return d<120?`🟢 RESTE VOIE ${lane.index}/${lane.total}${tag}`:`🟢 BONNE VOIE ${lane.index}/${lane.total}${tag}`;
  if(lane.index&&plan.next&&plan.next!==target)return `➡️ ${urgency} D’ABORD VOIE ${plan.next}/${lane.total} · CIBLE ${target}/${lane.total}${tag}`;
  return lane.index?`➡️ ${urgency} VOIE ${target}/${lane.total}${tag}`:`➡️ VOIE CONSEILLÉE ${target}/${lane.total}${tag}`
}
function relevantSignal(pos,m){
  let best=null;
  if(S.routeCoords.length){
    const here=routeProjection(pos,S.lastRouteAlong);
    if(here){
      for(const sig of S.signals){
        const rp=routeProjection(sig,here.along);if(!rp||rp.distance>28)continue;
        const ahead=rp.along-here.along;if(ahead<-8||ahead>450)continue;
        const score=Math.max(0,ahead)+rp.distance*3;
        if(!best||score<best.score)best={...sig,distance:Math.max(0,ahead),routeDistance:rp.distance,score}
      }
      if(best)return best
    }
  }
  const heading=m?(travelDirection(m,pos)==="forward"?m.roadBearing:(m.roadBearing+180)%360):pos.heading;
  for(const sig of S.signals){
    const d=haversineM(pos,sig);if(d>450)continue;
    const a=angleDiff(heading,bearing(pos,sig));if(a>55)continue;
    const score=d+a*2.4;if(!best||score<best.score)best={...sig,distance:d,score}
  }
  return best
}
async function maybeReroute(pos,nav){if(!S.route||!S.destination||!nav)return;if((nav.offRoute||0)>CFG.offRouteM)S.offRouteHits++;else S.offRouteHits=0;if(S.offRouteHits<3)return;const now=Date.now();if(now-S.lastRerouteAt<CFG.rerouteCooldownMs)return;S.lastRerouteAt=now;S.offRouteHits=0;setStatus("Hors itinéraire · recalcul automatique…");await calculateRoute(S.destination.lat,S.destination.lon,true)}
function updateUi(pos){
  $("speed").textContent=Math.round(pos.speedMps*3.6);if(S.routeCoords.length)updateRouteFilter(pos);
  const observed=nearestRoad(pos);S.previousMatch=S.lastMatch;S.lastMatch=observed;S.matchQuality=observed?.quality||0;sensorHealth(pos,observed);
  if(observed&&observed.quality>=45){S.lastGoodMatch=observed;S.lastGoodMatchAt=Date.now()}
  const m=observed||effectiveMatch();
  if(!m){
    S.lastSignal=null;updateFusionState(pos,null,null,null);
    const navPos=fusionPosition()||pos,nav=S.route?nextInstruction(navPos):null;S.lastNav=nav;
    $("road").textContent="—";$("lane").textContent=S.lastLane?.index?`${S.lastLane.index}/${S.lastLane.total}`:"—";$("confidence").textContent=S.lastLane?`${Math.max(0,S.lastLane.confidence-15)}%`:"—";
    $("advice").textContent=S.fusion.mode==="PRÉDICTIF"?"Position prédite · voie non confirmée":"Route à confirmer";$("source").textContent=S.fusion.mode;
    updateSpeedLimit(null,pos);$("junctionAssist").classList.add("hidden");updateManeuverHud(nav);updateFusionBadge(navPos,null);updateBeliefHud(S.lastLane);updateHorizonHud(nav,S.lastLane);updateDiagnostics(navPos,null,S.lastLane,nav);
    draw3D(currentDrawState());return
  }
  if(!observed&&m){
    updateFusionState(pos,null,S.lastLane,null);
    const navPos=fusionPosition()||pos,nav=S.route?nextInstruction(navPos):null,sig=relevantSignal(navPos,m);S.lastNav=nav;S.lastSignal=sig;
    if(S.lastLane)S.lastLane={...S.lastLane,confidence:Math.max(0,S.lastLane.confidence-6),reason:"Voie maintenue par mémoire courte"};
    $("road").textContent=roadName(m.road);$("lane").textContent=S.lastLane?.index?`${S.lastLane.index}/${S.lastLane.total}`:"—";$("confidence").textContent=S.lastLane?`${S.lastLane.confidence}%`:"—";$("signal").textContent=sig?`${Math.round(sig.distance)} m`:"—";
    $("source").textContent="PRÉDICTIF";$("advice").textContent="Position et voie maintenues temporairement · attente GPS";
    updateSpeedLimit(m,pos);updateManeuverHud(nav);updateFusionBadge(navPos,m);updateBeliefHud(S.lastLane);updateHorizonHud(nav,S.lastLane);updateDiagnostics(navPos,m,S.lastLane,nav);draw3D(currentDrawState());return
  }
  const rawLane=fuseLaneWithVision(estimateLane(m,pos)),lane=stabilizeLane(updateLaneBelief(rawLane,m),m);S.lastLane=lane;
  updateFusionState(pos,observed||m,lane,null);
  const navPos=fusionPosition()||pos,nav=S.route?nextInstruction(navPos):null,sig=relevantSignal(navPos,m);S.lastNav=nav;S.lastSignal=sig;
  updateSpeedLimit(m,pos);updateJunctionAssist(lane,nav);updateManeuverHud(nav);updateFusionBadge(navPos,m);updateBeliefHud(lane);updateHorizonHud(nav,lane);voiceCue(nav);
  $("road").textContent=roadName(m.road);$("lane").textContent=lane.index?`${lane.index}/${lane.total}`:(lane.total?`?/${lane.total}`:"—");$("confidence").textContent=`${lane.confidence}%`;$("signal").textContent=sig?`${Math.round(sig.distance)} m`:"—";
  $("source").textContent=S.fusion.mode==="PRÉDICTIF"?"PRÉDICTIF":lane.index?(lane.visionAssist&&S.visionCue?.stable?"FUSION + VISION":"FUSION"):"PAS ASSEZ PRÉCIS";
  if(nav){
    $("instruction").textContent=nav.instruction;$("detail").textContent=`${nav.detail} · ${lane.reason}`;$("advice").textContent=adviceText(lane,nav);
    if(nav.arrived){S.arrived=true;$("progressWrap").classList.remove("hidden");$("progressBar").style.width="100%";$("routeMeta").textContent="Arrivée";setStatus("Destination atteinte")}
    else if(Number.isFinite(nav.progress)){S.arrived=false;$("progressWrap").classList.remove("hidden");$("progressBar").style.width=`${clamp(nav.progress*100,0,100)}%`;const rem=nav.remaining??S.route.distance,eta=S.route?.distance?S.route.duration*(rem/S.route.distance):rem/Math.max(6,pos.speedMps||10);$("routeMeta").textContent=`${(rem/1000).toFixed(1)} km restants · ~${Math.max(1,Math.round(eta/60))} min`}
  }else{$("instruction").textContent=roadName(m.road);$("detail").textContent=lane.reason;$("advice").textContent=adviceText(lane,null)}
  draw3D(currentDrawState());updateDiagnostics(navPos,m,lane,nav);maybeReroute(navPos,nav)
}
function startGps(){enableCompass();if(!window.isSecureContext){setStatus("GPS : ouvre bien l’adresse HTTPS GitHub Pages.");return}if(!navigator.geolocation){setStatus("GPS non disponible.");return}$("permission")?.remove();$("gpsBtn").classList.add("active");$("gpsBtn").querySelector("span").textContent="Actif";if(S.gpsWatch!==null)navigator.geolocation.clearWatch(S.gpsWatch);S.gpsWatch=navigator.geolocation.watchPosition(async p=>{const raw=gpsMeasurement(p);S.rawGps=raw;S.gps=smoothGps(raw);if(!S.visualGps)S.visualGps={...S.gps};S.heading=S.gps.heading;if(!S.areaCenter||haversineM(S.gps,S.areaCenter)>CFG.reloadAfterM)await loadRoadData(S.gps.lat,S.gps.lon);if(!S.environmentCenter||haversineM(S.gps,S.environmentCenter)>240)loadEnvironmentData(S.gps.lat,S.gps.lon);updateUi(S.gps);updateUserMarker(S.gps);recordSample();prefetchAheadPack();if(S.destination&&!S.route&&!S.routeLoading&&Date.now()-S.lastRouteAttemptAt>15000)calculateRoute(S.destination.lat,S.destination.lon,false);updateFusionBadge(S.gps,S.lastMatch)},e=>setStatus("GPS : "+e.message),{enableHighAccuracy:true,maximumAge:500,timeout:15000})}
async function calculateRoute(lat,lon,isReroute=false){
  if(!S.gps){S.destination={lat,lon};setStatus("Destination mémorisée · en attente du GPS.");return}
  if(S.routeLoading)return;S.routeLoading=true;S.lastRouteAttemptAt=Date.now();S.destination={lat,lon};
  $("routeTitle").textContent=S.destinationLabel||`Destination ${lat.toFixed(5)}, ${lon.toFixed(5)}`;$("clearRoute").hidden=false;
  if(!isReroute&&S.destinationMarker)S.map.removeLayer(S.destinationMarker);
  if(!isReroute){const icon=L.divIcon({className:"",html:'<div class="destination-dot"></div>',iconSize:[16,16],iconAnchor:[8,16]});S.destinationMarker=L.marker([lat,lon],{icon}).addTo(S.map)}
  setStatus(isReroute?"Recalcul en cours…":"Calcul de l’itinéraire…");
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
  try{
    const o=S.gps,url=`${CFG.router}/${o.lon},${o.lat};${lon},${lat}?overview=full&geometries=geojson&steps=true`,r=await fetch(url,{signal:ctrl.signal});
    if(!r.ok)throw Error(`HTTP ${r.status}`);const d=await r.json();if(d.code!=="Ok"||!d.routes?.length)throw Error("Aucun itinéraire");
    S.route=d.routes[0];S.routeCoords=S.route.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}));S.routeLengthM=S.route.distance;buildRouteCum();S.lastRouteAlong=null;S.routeFilter={along:null,index:null,quality:0,ambiguity:1,candidates:[],lastAt:0};S.aheadPrefetch={lastAt:0,center:null,loading:false,count:0};buildRouteManeuvers();S.arrived=false;S.lastVoiceKey="";
    if(S.routeLayer)S.map.removeLayer(S.routeLayer);S.routeLayer=L.polyline(S.routeCoords.map(p=>[p.lat,p.lon]),{color:"#fff",weight:7,opacity:.93,className:"route-line"}).addTo(S.map);
    if(!isReroute){S.followMap=false;document.body.classList.add("map-free");S.map.fitBounds(S.routeLayer.getBounds(),{padding:[45,45]})};
    $("routeMeta").textContent=`${(S.route.distance/1000).toFixed(1)} km · ~${Math.max(1,Math.round(S.route.duration/60))} min`;$("progressWrap").classList.remove("hidden");
    setStatus(isReroute?"Nouvel itinéraire chargé":"Itinéraire chargé · passe en 3D quand tu veux");updateUi(S.gps)
  }catch(e){setStatus(e?.name==="AbortError"?"Calcul d’itinéraire trop long · réessaie.":"Itinéraire indisponible : "+e.message)}
  finally{clearTimeout(timer);S.routeLoading=false}
}
function setDestination(lat,lon,label=null){S.destinationLabel=label;calculateRoute(lat,lon,false)}
function clearRoute(){S.route=null;S.routeCoords=[];S.routeCum=[];S.routeManeuvers=[];S.routeLaneHints=[];S.routeIntersections=[];S.lastRouteAlong=null;S.routeFilter={along:null,index:null,quality:0,ambiguity:1,candidates:[],lastAt:0};S.aheadPrefetch={lastAt:0,center:null,loading:false,count:0};S.destination=null;S.destinationLabel=null;S.lastVoiceKey="";S.arrived=false;S.offRouteHits=0;if(S.routeLayer){S.map.removeLayer(S.routeLayer);S.routeLayer=null}if(S.destinationMarker){S.map.removeLayer(S.destinationMarker);S.destinationMarker=null}$("routeTitle").textContent="Touchez la carte pour choisir une destination";$("routeMeta").textContent="Active d’abord le GPS.";$("clearRoute").hidden=true;$("progressWrap").classList.add("hidden");$("progressBar").style.width="0%";$("junctionAssist").classList.add("hidden");if(S.gps)updateUi(S.gps)}
function speakNav(text){
  if(!S.voiceEnabled||!("speechSynthesis"in window)||!text)return;
  try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="fr-FR";u.rate=.98;u.pitch=1;window.speechSynthesis.speak(u)}catch(_){}
}
function toggleVoice(){
  S.voiceEnabled=!S.voiceEnabled;$("voiceBtn").textContent=S.voiceEnabled?"🔊":"🔇";S.lastVoiceKey="";
  if(S.voiceEnabled)speakNav("Guidage vocal activé");else try{window.speechSynthesis.cancel()}catch(_){}
}
function voiceCue(nav){
  if(!S.voiceEnabled||!nav)return;
  if(nav.arrived){if(S.lastVoiceKey!=="arrived"){S.lastVoiceKey="arrived";speakNav("Destination atteinte")}return}
  if(!Number.isFinite(nav.distance)||nav.distance>480)return;
  const band=nav.distance<=55?50:nav.distance<=170?150:400,key=`${nav.maneuverId||nav.instruction}:${band}`;
  if(S.lastVoiceKey===key)return;S.lastVoiceKey=key;
  const rounded=nav.distance<100?Math.max(10,Math.round(nav.distance/10)*10):Math.round(nav.distance/50)*50;
  speakNav(`Dans ${rounded} mètres, ${nav.instruction.toLowerCase()}`)
}
function renderTruthButtons(lane=S.lastLane){
  const box=$("truthLanes");if(!box)return;box.replaceChildren();
  const total=Math.min(6,lane?.total||0);
  if(!total){const span=document.createElement("span");span.textContent="Nombre de voies inconnu";box.appendChild(span);return}
  for(let i=1;i<=total;i++){
    const b=document.createElement("button");b.type="button";b.textContent=String(i);b.classList.toggle("active",S.currentTruth===i);
    b.onclick=()=>markLaneTruth(i);box.appendChild(b)
  }
}
function markLaneTruth(index){
  if(!S.gps||!S.lastLane?.total)return;
  S.currentTruth=index;
  const ev={
    t:new Date().toISOString(),lane:index,total:S.lastLane.total,
    predicted:S.lastLane.index,confidence:S.lastLane.confidence,
    matchQuality:S.lastMatch?.quality??0,matchDistanceM:S.lastMatch?+S.lastMatch.distance.toFixed(2):null,
    gpsAccuracy:S.rawGps?.accuracy??S.gps.accuracy,
    vision:S.visionCue?{confidence:S.visionCue.confidence,valid:S.visionCue.valid,offsetNorm:S.visionCue.offsetNorm,nearBoundary:S.visionCue.nearBoundary}:null,calibration:S.lastLane.calibration||null,
    road:S.lastMatch?roadName(S.lastMatch.road):null,wayId:S.lastMatch?.road?.id||null,lat:S.gps.lat,lon:S.gps.lon
  };
  S.truthEvents.push(ev);addLaneCalibrationSample(S.lastMatch,S.lastLane,index);$("exportBtn").disabled=false;$("diagTruth").textContent=`voie ${index}/${S.lastLane.total}`;renderTruthButtons(S.lastLane);setStatus(`Vérité terrain enregistrée : voie ${index}/${S.lastLane.total}`)
}
function updateDiagnostics(pos=S.gps,m=S.lastMatch,lane=S.lastLane,nav=S.lastNav){
  if(!$("diagGps"))return;
  $("diagGps").textContent=pos?`±${Math.round(S.rawGps?.accuracy??pos.accuracy??0)} m · ${Math.round((pos.speedMps||0)*3.6)} km/h`:"—";
  $("diagMatch").textContent=m?`${m.distance.toFixed(1)} m · Q${m.quality??0}`:"—";
  $("diagHeading").textContent=pos?`${Math.round(pos.heading||0)}°`:"—";
  $("diagLane").textContent=lane?(lane.index?`${lane.index}/${lane.total} · ${lane.confidence}%`:(lane.total?`?/${lane.total} · ${lane.confidence}%`:"—")):"—";
  $("diagRoute").textContent=nav&&Number.isFinite(nav.offRoute)?`${nav.offRoute.toFixed(1)} m écart`:(S.route?"sur route":"—");
  $("diagEnv").textContent=`${S.environment.length} objets`;$("diagVision").textContent=S.visionCue?`${S.visionCue.confidence}% · ${S.visionCue.alignment?"alignée":"à aligner"}`:"—";$("diagTruth").textContent=S.currentTruth&&lane?`voie ${S.currentTruth}/${lane.total}`:"—";$("diagFusion").textContent=`${S.fusion.mode} · Q${Math.round(S.fusion.quality||0)}`;$("diagRejected").textContent=String(S.gpsRejected||0);$("diagSensors").textContent=`${S.sensorHealth.label} · ${S.sensorHealth.overall}%`;$("diagRouteFilter").textContent=S.routeCoords.length?`Q${Math.round(S.routeFilter.quality||0)} · amb ${Math.round((S.routeFilter.ambiguity||0)*100)}%`:"—";renderTruthButtons(lane);
}
function recordSample(){
  if(!S.recording||!S.gps)return;
  const now=Date.now();if(now-S.lastTrackAt<900)return;S.lastTrackAt=now;
  const m=S.lastMatch,l=S.lastLane,n=S.lastNav;
  S.track.push({
    t:new Date(now).toISOString(),
    gps:{lat:S.gps.lat,lon:S.gps.lon,accuracy:S.rawGps?.accuracy??S.gps.accuracy,speedKph:+((S.gps.speedMps||0)*3.6).toFixed(1),heading:+(S.gps.heading||0).toFixed(1)},
    raw:S.rawGps?{lat:S.rawGps.lat,lon:S.rawGps.lon}:null,
    match:m?{distanceM:+m.distance.toFixed(2),quality:m.quality??0,score:+m.score.toFixed(2),road:roadName(m.road),wayId:m.road.id}:null,
    lane:l?{index:l.index,total:l.total,confidence:l.confidence,belief:l.belief||null,beliefTop:l.beliefTop??null,beliefGap:l.beliefGap??null,lateralM:Number.isFinite(l.lateralM)?+l.lateralM.toFixed(2):null}:null,
    route:n?{offRouteM:Number.isFinite(n.offRoute)?+n.offRoute.toFixed(2):null,nextM:Number.isFinite(n.distance)?Math.round(n.distance):null,turn:n.turn}:null,fusion:{mode:S.fusion.mode,quality:Math.round(S.fusion.quality||0),along:Number.isFinite(S.fusion.along)?+S.fusion.along.toFixed(2):null,lateralM:+(S.fusion.lateralM||0).toFixed(2),gpsRejected:S.gpsRejected},vision:S.visionCue?{confidence:S.visionCue.confidence,valid:S.visionCue.valid,offsetNorm:S.visionCue.offsetNorm,nearBoundary:S.visionCue.nearBoundary,stable:S.visionCue.stable,alignment:S.visionCue.alignment,yawNorm:S.visionCue.yawNorm,vanishX:S.visionCue.vanishX,vanishY:S.visionCue.vanishY,exposure:S.visionCue.exposure,lowLight:S.visionCue.lowLight}:null
  });
  $("recordBtn").textContent=`■ Arrêter (${S.track.length})`;
  $("exportBtn").disabled=S.track.length===0&&S.truthEvents.length===0
}
function toggleRecording(){
  if(S.recording){
    S.recording=false;$("recordBtn").classList.remove("recording");$("recordBtn").textContent=`● Reprendre (${S.track.length})`;
    $("exportBtn").disabled=S.track.length===0&&S.truthEvents.length===0;setStatus(`Trace arrêtée · ${S.track.length} points`);return
  }
  if(!S.gps){setStatus("Active le GPS avant d’enregistrer une trace.");return}
  if(!S.track.length)S.track=[];
  S.recording=true;S.lastTrackAt=0;$("recordBtn").classList.add("recording");$("recordBtn").textContent=`■ Arrêter (${S.track.length})`;
  setStatus("Trace terrain locale démarrée")
}
function calibrationSummary(){
  const total=S.truthEvents.length,comparable=S.truthEvents.filter(e=>Number.isFinite(e.predicted)),correct=comparable.filter(e=>e.predicted===e.lane);
  const avg=a=>a.length?+(a.reduce((sum,x)=>sum+x,0)/a.length).toFixed(2):null,confusion={};
  for(const e of S.truthEvents){const key=`${e.lane}->${Number.isFinite(e.predicted)?e.predicted:"?"}`;confusion[key]=(confusion[key]||0)+1}
  return{
    truthCount:total,comparable:comparable.length,correct:correct.length,
    coveragePct:total?+(comparable.length/total*100).toFixed(1):null,
    laneAccuracyPct:comparable.length?+(correct.length/comparable.length*100).toFixed(1):null,
    overallCorrectPct:total?+(correct.length/total*100).toFixed(1):null,
    avgGpsAccuracyM:avg(comparable.map(e=>Number(e.gpsAccuracy)).filter(Number.isFinite)),
    avgMatchQuality:avg(comparable.map(e=>Number(e.matchQuality)).filter(Number.isFinite)),
    confusion
  }
}
function exportTrack(){
  if(!S.track.length&&!S.truthEvents.length)return;
  const payload={app:"Marseille Drive",version:"BETA 9",exportedAt:new Date().toISOString(),summary:calibrationSummary(),points:S.track,truthEvents:S.truthEvents,destination:S.destination?{...S.destination,label:S.destinationLabel||null}:null,route:S.route?{distance:S.route.distance,duration:S.route.duration,geometry:S.route.geometry,legs:S.route.legs}:null};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`marseille-drive-trace-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
function resetFusionForReplay(){
  S.fusion={position:null,along:null,lateralM:0,heading:0,speedMps:0,quality:0,mode:"GPS",lastGpsAt:0,lastPredictAt:0,roadId:null};S.sensorHealth={gps:0,map:0,route:0,vision:0,compass:0,overall:0,label:"FAIBLE"};
  S.laneBelief={roadId:null,total:0,probs:[],index:null,confidence:0,lastVisionShift:0};S.laneCalibration={byRoad:{}};S.laneTransition={state:"STABLE",direction:0,score:0,lastLateral:null,lastAt:0,startedAt:0,lateralSpeed:0};
  S.laneFilter={roadId:null,index:null,candidate:null,hits:0};S.lastMatch=null;S.lastGoodMatch=null;S.lastGoodMatchAt=0;S.previousMatch=null;S.lastLane=null;S.lastNav=null;S.lastSignal=null;S.visualGps=null;S.lastRouteAlong=null;S.routeFilter={along:null,index:null,quality:0,ambiguity:1,candidates:[],lastAt:0};S.gpsRejected=0
}
function replayTruthIndex(points,truth){
  const map=new Map();if(!Array.isArray(truth)||!truth.length)return map;
  const times=points.map(p=>Date.parse(p.t||"")||0);
  for(const ev of truth){
    const t=Date.parse(ev.t||"");if(!t)continue;let best=-1,bestD=Infinity;
    for(let i=0;i<times.length;i++){const d=Math.abs(times[i]-t);if(d<bestD){bestD=d;best=i}}
    if(best>=0&&bestD<=1800){if(!map.has(best))map.set(best,[]);map.get(best).push(ev)}
  }
  return map
}
function applyReplayRoute(payload){
  if(!payload?.route?.geometry?.coordinates?.length)return;
  S.route=payload.route;S.routeCoords=payload.route.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}));S.routeLengthM=payload.route.distance||0;buildRouteCum();buildRouteManeuvers();
  if(payload.destination){S.destination={lat:Number(payload.destination.lat),lon:Number(payload.destination.lon)};S.destinationLabel=payload.destination.label||null}
  if(S.routeLayer)S.map.removeLayer(S.routeLayer);S.routeLayer=L.polyline(S.routeCoords.map(p=>[p.lat,p.lon]),{color:"#fff",weight:7,opacity:.93,className:"route-line"}).addTo(S.map)
}
function replayStats(){
  const total=S.replayResults.length,currentKnown=S.replayResults.filter(x=>Number.isFinite(x.predicted)),currentCorrect=currentKnown.filter(x=>x.correct).length,baseKnown=S.replayResults.filter(x=>Number.isFinite(x.baselinePredicted)),baseCorrect=baseKnown.filter(x=>x.baselineCorrect).length;
  return{
    total,
    current:{known:currentKnown.length,correct:currentCorrect,accuracy:currentKnown.length?Math.round(currentCorrect/currentKnown.length*100):null,coverage:total?Math.round(currentKnown.length/total*100):null,global:total?Math.round(currentCorrect/total*100):null},
    baseline:{known:baseKnown.length,correct:baseCorrect,accuracy:baseKnown.length?Math.round(baseCorrect/baseKnown.length*100):null,coverage:total?Math.round(baseKnown.length/total*100):null,global:total?Math.round(baseCorrect/total*100):null}
  }
}
function replayPointAt(index){
  const p=S.replayPoints[index],g=p?.gps;if(!g)return;
  const raw={lat:Number(g.lat),lon:Number(g.lon),accuracy:Number(g.accuracy)||8,speedMps:Math.max(0,(Number(g.speedKph)||0)/3.6),heading:Number(g.heading)||0,t:Date.now(),rejected:false};
  S.rawGps=raw;S.gps={...raw};S.heading=raw.heading;S.lastAcceptedRaw={...raw};S.visualGps={...raw};updateUi(S.gps);updateUserMarker(S.gps);
  const truths=S.replayTruthByIndex?.get(index)||[];
  for(const truth of truths){
    const actual=Number(truth.lane),predicted=S.lastLane?.index??null,baselinePredicted=Number.isFinite(Number(truth.predicted))?Number(truth.predicted):null,correct=Number.isFinite(predicted)&&predicted===actual,baselineCorrect=Number.isFinite(baselinePredicted)&&baselinePredicted===actual;
    S.replayResults.push({index,t:p.t||null,truth:actual,predicted,correct,baselinePredicted,baselineCorrect});
    addLaneCalibrationSample(S.lastMatch,S.lastLane,actual)
  }
  const stats=replayStats(),score=$("replayScore"),cur=stats.current,base=stats.baseline;
  score.textContent=`Replay ${index+1}/${S.replayPoints.length} · B10 ${cur.correct}/${stats.total} (${cur.coverage??0}% couv.)${base.known?` · B9 ${base.correct}/${stats.total}`:""}`;score.classList.remove("hidden")
}
function stopReplay(done=false){
  clearInterval(S.replayTimer);S.replayTimer=null;
  if(!S.replayActive&&!done)return;S.replayActive=false;
  $("stopReplayBtn").classList.add("hidden");$("replayBtn").classList.remove("hidden");
  const s=replayStats(),c=s.current,b=s.baseline,delta=Number.isFinite(c.global)&&Number.isFinite(b.global)?c.global-b.global:null;
  $("replayScore").textContent=done?`Replay terminé · B10 précision ${c.accuracy??"—"}% · couverture ${c.coverage??"—"}% · global ${c.global??"—"}%${b.known?` · B9 global ${b.global}% · Δ ${delta>=0?"+":""}${delta} pts`:""}`:"Replay arrêté";
  setStatus(done?"Replay terminé":"Replay arrêté")
}
async function loadReplayFile(ev){
  const file=ev?.target?.files?.[0];if(!file)return;
  try{
    const payload=JSON.parse(await file.text()),points=Array.isArray(payload.points)?payload.points:[];
    if(points.length<2)throw Error("Trace vide ou incompatible");
    stopReplay();if(S.gpsWatch!==null){navigator.geolocation?.clearWatch?.(S.gpsWatch);S.gpsWatch=null}
    if(S.demo){S.demo=false;clearInterval(S.demoTimer);S.demoTimer=null}
    resetFusionForReplay();S.replayPoints=points;S.replayIndex=0;S.replayResults=[];S.replayTruthByIndex=replayTruthIndex(points,payload.truthEvents||[]);
    applyReplayRoute(payload);const first=points[0].gps;if(first?.lat&&first?.lon)await loadRoadData(Number(first.lat),Number(first.lon));
    S.replayActive=true;$("replayBtn").classList.add("hidden");$("stopReplayBtn").classList.remove("hidden");$("replayScore").classList.remove("hidden");setView("drive");setStatus(`Replay local · ${points.length} points`);
    replayPointAt(0);S.replayTimer=setInterval(()=>{S.replayIndex++;if(S.replayIndex>=S.replayPoints.length){stopReplay(true);return}replayPointAt(S.replayIndex)},450)
  }catch(e){setStatus("Replay impossible : "+e.message)}
  finally{if(ev?.target)ev.target.value=""}
}
function toggleDiag(){
  const p=$("diagPanel");p.classList.toggle("hidden");if(!p.classList.contains("hidden"))updateDiagnostics()
}
function recenterMap(){
  if(!S.gps){setStatus("Active le GPS pour te recentrer.");return}
  S.followMap=true;document.body.classList.remove("map-free");S.map.setView([S.gps.lat,S.gps.lon],17,{animate:true})
}
function clearSearchResults(){$("searchResults").classList.add("hidden");$("searchResults").replaceChildren()}
function renderSearchResults(items){
  const box=$("searchResults");box.replaceChildren();
  if(!items.length){const e=document.createElement("button");e.type="button";e.textContent="Aucun résultat";e.disabled=true;box.appendChild(e);box.classList.remove("hidden");return}
  for(const item of items.slice(0,5)){
    const b=document.createElement("button");b.type="button";b.textContent=item.display_name||"Destination";
    b.onclick=()=>{const lat=Number(item.lat),lon=Number(item.lon),label=(item.display_name||"").split(",").slice(0,2).join(",");clearSearchResults();$("searchInput").value=label;S.followMap=false;document.body.classList.add("map-free");S.map.setView([lat,lon],16,{animate:true});if(S.gps)setDestination(lat,lon,label);else{S.destinationLabel=label;S.destination={lat,lon};setStatus("Destination mémorisée · active le GPS, l’itinéraire partira automatiquement.")}};
    box.appendChild(b)
  }
  box.classList.remove("hidden")
}
async function searchDestinationQuery(ev){
  ev?.preventDefault();const q=$("searchInput").value.trim();if(q.length<3){setStatus("Écris au moins 3 caractères.");return}
  setStatus("Recherche de destination…");$("searchBtn").disabled=true;
  try{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=fr&addressdetails=1&q=${encodeURIComponent(q)}`;
    const r=await fetch(url,{headers:{"Accept-Language":"fr"},signal:ctrl.signal});clearTimeout(timer);if(!r.ok)throw Error(`HTTP ${r.status}`);
    const data=await r.json();renderSearchResults(Array.isArray(data)?data:[]);setStatus(data.length?`${Math.min(5,data.length)} destination(s) trouvée(s)`:"Aucun résultat")
  }catch(e){setStatus("Recherche indisponible pour le moment.")}
  finally{$("searchBtn").disabled=false}
}
function visionLuma(data,i){return data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722}
function fitVisionLine(points){
  if(points.length<4)return null;
  let sy=0,sx=0,syy=0,syx=0;for(const p of points){sy+=p.y;sx+=p.x;syy+=p.y*p.y;syx+=p.y*p.x}
  const n=points.length,den=n*syy-sy*sy;if(Math.abs(den)<1e-6)return null;
  const a=(n*syx-sy*sx)/den,b=(sx-a*sy)/n;
  let err=0;for(const p of points)err+=Math.abs(p.x-(a*p.y+b));
  return{a,b,error:err/n,xAt:y=>a*y+b}
}
function visionLaneCue(left,right,W,H,pointConfidence){
  const L=fitVisionLine(left),R=fitVisionLine(right);if(!L||!R)return{confidence:Math.round(pointConfidence*.35),valid:false,alignment:false,offsetNorm:0,nearBoundary:false};
  const denom=L.a-R.a,vanishY=Math.abs(denom)>1e-4?(R.b-L.b)/denom:null,vanishX=Number.isFinite(vanishY)?L.xAt(vanishY):null;
  const alignment=Number.isFinite(vanishX)&&Number.isFinite(vanishY)&&vanishX>W*.20&&vanishX<W*.80&&vanishY>-140&&vanishY<H*.68;
  const yawNorm=Number.isFinite(vanishX)?(vanishX-W/2)/W:null;
  const y=H*.89,lx=L.xAt(y),rx=R.xAt(y),width=rx-lx;
  if(width<28||width>118||lx>=rx)return{confidence:Math.round(pointConfidence*.4),valid:false,alignment,yawNorm,vanishX,vanishY,offsetNorm:0,nearBoundary:false};
  const residual=(L.error+R.error)/2,geometry=clamp(100-residual*9-Math.abs(width-66)*.45,0,100),alignPenalty=alignment?0:34,confidence=Math.round(clamp(pointConfidence*.62+geometry*.38-alignPenalty,0,100));
  const center=(lx+rx)/2,offsetNorm=(W/2-center)/width,edge=Math.min(W/2-lx,rx-W/2)/width,nearBoundary=edge<.25||Math.abs(offsetNorm)>.27;
  return{confidence,valid:alignment&&confidence>=38,alignment,yawNorm:Number.isFinite(yawNorm)?+yawNorm.toFixed(3):null,vanishX:Number.isFinite(vanishX)?+vanishX.toFixed(1):null,vanishY:Number.isFinite(vanishY)?+vanishY.toFixed(1):null,offsetNorm:+offsetNorm.toFixed(3),nearBoundary,laneWidthPx:+width.toFixed(1),leftFit:L,rightFit:R}
}
function fuseLaneWithVision(lane){
  const v=S.visionCue;if(!lane||!v?.valid||v.confidence<62)return lane;
  let confidence=lane.confidence,reason=lane.reason,visionAssist=false;
  if(Math.abs(v.offsetNorm)<.16){confidence=clamp(confidence+5,0,100);reason+=" + vision stable";visionAssist=true}
  else if(v.nearBoundary){confidence=clamp(confidence-3,0,100);reason+=" + proche marquage";visionAssist=true}
  return{...lane,confidence,visionAssist,visionOffset:v.offsetNorm}
}
function analyzeVisionFrame(){
  const v=$("camera"),overlay=$("visionOverlay");if(!S.visionStream||v.readyState<2)return;
  const W=160,H=96,work=S.visionWork||(S.visionWork=document.createElement("canvas"));work.width=W;work.height=H;
  const wc=work.getContext("2d",{willReadFrequently:true}),vw=v.videoWidth||W,vh=v.videoHeight||H,target=W/H,ratio=vw/vh;
  let sx0=0,sy0=0,sw=vw,sh=vh;if(ratio>target){sw=vh*target;sx0=(vw-sw)/2}else{sh=vw/target;sy0=(vh-sh)*.43}
  wc.drawImage(v,sx0,sy0,sw,sh,0,0,W,H);
  let img;try{img=wc.getImageData(0,0,W,H).data}catch(_){return}
  let sumLum=0,samples=0;for(let y=42;y<H;y+=4)for(let x=8;x<W-8;x+=4){sumLum+=visionLuma(img,(y*W+x)*4);samples++}
  const avgLum=samples?sumLum/samples:110,lumThreshold=clamp(avgLum+30,92,172),edgeThreshold=clamp(15+(118-avgLum)*.055,14,29);
  const left=[],right=[];
  for(let y=48;y<94;y+=2){
    const spread=(y-46)*.76,leftExp=80-spread,rightExp=80+spread;
    for(const [exp,out] of [[leftExp,left],[rightExp,right]]){
      let best=null;
      for(let x=Math.max(5,Math.floor(exp-21));x<=Math.min(W-6,Math.ceil(exp+21));x++){
        const i=(y*W+x)*4,lum=visionLuma(img,i),l=visionLuma(img,i-12),rr=visionLuma(img,i+12),score=lum-(l+rr)/2;
        if(lum>lumThreshold&&score>edgeThreshold&&(!best||score>best.score))best={x,y,score}
      }
      if(best)out.push(best)
    }
  }
  const pointConf=clamp(Math.min(left.length,right.length)/20*100,0,100),cue=visionLaneCue(left,right,W,H,pointConf);
  if(cue.valid&&cue.alignment&&cue.confidence>=65)S.visionStableFrames=Math.min(20,S.visionStableFrames+1);else S.visionStableFrames=Math.max(0,S.visionStableFrames-1);
  S.visionCue={...cue,left,right,stable:S.visionStableFrames>=3,exposure:Math.round(avgLum),lowLight:avgLum<72};
  const rect=v.getBoundingClientRect(),D=devicePixelRatio||1;overlay.width=Math.max(1,Math.round(rect.width*D));overlay.height=Math.max(1,Math.round(rect.height*D));
  const c=overlay.getContext("2d");c.setTransform(D,0,0,D,0,0);c.clearRect(0,0,rect.width,rect.height);
  const sx=rect.width/W,sy=rect.height/H;
  const drawFit=(fit)=>{if(!fit)return;c.beginPath();c.moveTo(fit.xAt(48)*sx,48*sy);c.lineTo(fit.xAt(94)*sx,94*sy);c.lineWidth=3;c.strokeStyle=cue.confidence>=65?"rgba(80,240,160,.92)":"rgba(255,255,255,.6)";c.stroke()};
  drawFit(cue.leftFit);drawFit(cue.rightFit);
  c.strokeStyle=cue.nearBoundary?"rgba(255,195,70,.9)":"rgba(255,255,255,.28)";c.lineWidth=2;c.beginPath();c.moveTo(rect.width*.5,rect.height*.49);c.lineTo(rect.width*.5,rect.height*.96);c.stroke();
  if(Number.isFinite(cue.vanishX)&&Number.isFinite(cue.vanishY)){c.fillStyle=cue.alignment?"rgba(80,240,160,.95)":"rgba(255,175,65,.95)";c.beginPath();c.arc(cue.vanishX*sx,cue.vanishY*sy,4,0,Math.PI*2);c.fill()}
  const state=!cue.alignment?"caméra à aligner":cue.valid?(cue.nearBoundary?"proche marquage":"centrage voie"):"repères incomplets";
  $("visionStatus").textContent=`Vision ${cue.confidence}% · ${state}${avgLum<72?" · faible lumière":""} · fusion prudente`;
  updateDiagnostics()
}
function setView(v){
  S.view=v;document.body.classList.toggle("drive-mode",v==="drive");
  $("map").style.display=v==="map"?"block":"none";$("drive").style.display=v==="drive"?"block":"none";$("car").style.display=v==="drive"?"block":"none";
  $("mapBtn").classList.toggle("active",v==="map");$("driveBtn").classList.toggle("active",v==="drive");
  $("modeLabel").textContent=`BETA 9 · ${v==="map"?"CARTE RÉELLE":"NAVIGATION 3D"}`;
  if(v==="map")setTimeout(()=>S.map.invalidateSize(),80);
  else draw3D(currentDrawState())
}
async function toggleVision(){
  if(S.visionStream){closeVision();return}
  if(!navigator.mediaDevices?.getUserMedia){setStatus("Caméra non disponible.");return}
  try{
    S.visionStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
    $("camera").srcObject=S.visionStream;$("visionPanel").classList.remove("hidden");$("visionBtn").classList.add("active");await $("camera").play().catch(()=>{});
    clearInterval(S.visionTimer);S.visionTimer=setInterval(analyzeVisionFrame,250);
    setStatus("Vision locale active · analyse expérimentale non fusionnée")
  }catch(e){setStatus("Caméra : autorisation refusée ou indisponible.")}
}
function closeVision(){
  clearInterval(S.visionTimer);S.visionTimer=null;S.visionCue=null;S.visionStream?.getTracks().forEach(t=>t.stop());S.visionStream=null;
  $("visionPanel").classList.add("hidden");$("visionBtn").classList.remove("active");const c=$("visionOverlay");c.getContext("2d")?.clearRect(0,0,c.width,c.height)
}
function startDemo(){if(S.demo){S.demo=false;clearInterval(S.demoTimer);S.demoTimer=null;$("demoBtn").querySelector("span").textContent="Démo";setStatus(S.gps?"GPS réel":"Démo arrêtée");if(S.gps)updateUi(S.gps);return}S.demo=true;S.demoT=0;setView("drive");$("demoBtn").querySelector("span").textContent="Pause";$("source").textContent="SIMULATION";setStatus("MODE DÉMO — données simulées");S.demoTimer=setInterval(()=>{S.demoT+=.1;if(S.demoT>24)S.demoT=0;const t=S.demoT,change=t>7&&t<15,lane=t>=15?3:2,recommended=change?3:lane,turn=t>7?"right":"through",signal=18-(t%18),distance=Math.max(0,460-t*17),progress=clamp(t/24,0,1);$("speed").textContent=Math.round(48+Math.sin(t*.8)*2);$("lane").textContent=`${lane}/3`;$("confidence").textContent="96%";$("road").textContent="Avenue pilote";$("signal").textContent=`${Math.ceil(signal)} s*`;$("limitBadge").textContent="50";$("limitBadge").classList.remove("hidden");$("instruction").textContent=change?"Change de voie":turn==="right"?"Tourne à droite":"Continue tout droit";$("detail").textContent=`Dans ${Math.round(distance)} m · feu SIMULÉ`;$("advice").textContent=recommended===lane?`🟢 RESTE VOIE ${lane}/3`:`➡️ ${distance>120?"REJOINS":"MAINTENANT"} VOIE ${recommended}/3`;$("routeTitle").textContent="Itinéraire de démonstration";$("routeMeta").textContent=`${Math.max(0,(3.2*(1-progress))).toFixed(1)} km restants`;$("progressWrap").classList.remove("hidden");$("progressBar").style.width=`${progress*100}%`;const demoNav={instruction:turn==="right"?"Tourne à droite":"Continue tout droit",turn,distance,arrived:false};updateJunctionAssist({total:3,index:lane,hasTurnLanes:true,turns:["through","through","right"]},demoNav);updateManeuverHud(demoNav);$("fusionBadge").textContent="SIMULATION · MATCH 100";draw3D({lane,total:3,current:lane,recommended,compatible:turn==="right"?[3]:[1,2,3],turn,signal,distance,demo:true})},100)}
function poly(c,p,f){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.closePath();c.fillStyle=f;c.fill()}
function line(c,p,col,w){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.strokeStyle=col;c.lineWidth=w;c.stroke()}
function arrow(c,x,y,on,turn){
  c.save();c.strokeStyle=on?"#fff":"#aeb8bd";c.globalAlpha=on?1:.68;c.lineWidth=on?5:3;c.lineCap="round";c.lineJoin="round";c.beginPath();c.moveTo(x,y+20);c.lineTo(x,y-16);
  if(turn==="right"){c.quadraticCurveTo(x,y-27,x+18,y-28);c.moveTo(x+18,y-28);c.lineTo(x+10,y-35);c.moveTo(x+18,y-28);c.lineTo(x+10,y-21)}
  else if(turn==="left"){c.quadraticCurveTo(x,y-27,x-18,y-28);c.moveTo(x-18,y-28);c.lineTo(x-10,y-35);c.moveTo(x-18,y-28);c.lineTo(x-10,y-21)}
  else if(turn==="uturn"){c.quadraticCurveTo(x-2,y-30,x-17,y-20);c.quadraticCurveTo(x-24,y-13,x-14,y-4);c.moveTo(x-17,y-20);c.lineTo(x-8,y-22);c.moveTo(x-17,y-20);c.lineTo(x-18,y-11)}
  else{c.moveTo(x,y-16);c.lineTo(x-8,y-6);c.moveTo(x,y-16);c.lineTo(x+8,y-6)}
  c.stroke();c.restore()
}
function laneArrowTurn(raw,fallback="through"){
  const vals=String(raw||"").split(";").map(normalizeIndication).filter(Boolean);
  if(vals.includes(fallback))return fallback;
  if(fallback==="left"&&vals.some(v=>v.includes("left")))return"left";
  if(fallback==="right"&&vals.some(v=>v.includes("right")))return"right";
  const v=vals[0];return v?.includes("left")?"left":v?.includes("right")?"right":v==="uturn"?"uturn":"through"
}
function isDayScene(){const h=new Date().getHours();return h>=7&&h<20}
function roadSurfaceColor(){
  const surface=String(effectiveMatch()?.road?.tags?.surface||"").toLowerCase(),day=isDayScene();
  if(/cobblestone|sett|paving_stones/.test(surface))return day?"#45494a":"#252a2d";
  if(/concrete/.test(surface))return day?"#555a5c":"#2b3032";
  if(/gravel|unpaved|ground/.test(surface))return day?"#625b4f":"#342f29";
  return day?"#2d3234":"#14191c"
}
function cycleLaneSides(){
  const t=effectiveMatch()?.road?.tags||{},generic=String(t.cycleway||"").toLowerCase(),left=String(t["cycleway:left"]||"").toLowerCase(),right=String(t["cycleway:right"]||"").toLowerCase();
  const yes=v=>/lane|track|shared_lane/.test(v);
  return{left:yes(left),right:yes(right)||(!left&&!right&&yes(generic))}
}
function scenePosition(){return S.visualGps||fusionPosition()||S.gps}
function advanceVisualGps(now){
  advanceFusion(Date.now());const target=fusionPosition()||S.gps;if(!target)return;
  if(!S.visualGps){S.visualGps={...target};S.visualTickAt=now;return}
  const dt=Math.max(1,Math.min(120,now-(S.visualTickAt||now)));S.visualTickAt=now,a=1-Math.exp(-dt/105);
  S.visualGps.lat+=(target.lat-S.visualGps.lat)*a;S.visualGps.lon+=(target.lon-S.visualGps.lon)*a;
  S.visualGps.speedMps+=(target.speedMps-S.visualGps.speedMps)*a;S.visualGps.accuracy=target.accuracy;
  S.visualGps.heading=lerpAngle(S.visualGps.heading||target.heading,target.heading||0,a)
}
function currentDrawState(){
  const lane=S.lastLane,nav=S.lastNav,plan=nav&&lane?routeLaneStrategy(lane,nav):null;
  return{lane:lane?.index||2,total:lane?.total||3,current:lane?.index||null,recommended:plan?.next||plan?.target||(lane?.index||2),target:plan?.target||null,compatible:plan?.compatible||[],accessible:lane?.accessible||[],turns:lane?.turns||[],laneSource:plan?.source||null,strategic:plan?.strategic||false,turn:nav?.turn||"through",distance:nav?.distance,afterTurn:nav?.after?.turn||null,afterDistance:Number.isFinite(nav?.distance)&&Number.isFinite(nav?.after?.distance)?nav.distance+nav.after.distance:null,arrived:nav?.arrived,signal:S.lastSignal}
}
function renderLoop(now=performance.now()){
  advanceVisualGps(now);
  if(!S.demo&&now-S.lastHudAt>280){
    S.lastHudAt=now;const fp=fusionPosition();updateFusionBadge(fp,effectiveMatch());updateBeliefHud(S.lastLane);updateHorizonHud(S.lastNav,S.lastLane);
    if(S.view==="map"&&S.gps&&["PRÉDICTIF","GPS PERDU"].includes(S.fusion.mode))updateUserMarker(S.gps);
    if(S.fusion.mode==="PRÉDICTIF"||S.fusion.mode==="GPS PERDU")$("source").textContent=S.fusion.mode;
    if(S.lastLane)$("confidence").textContent=`${Math.round(S.lastLane.confidence||0)}%`
  }
  if(S.view==="drive"&&!S.demo&&now-S.lastRenderAt>50){S.lastRenderAt=now;draw3D(currentDrawState())}
  S.renderRaf=requestAnimationFrame(renderLoop)
}
function sceneHeading(){
  if(S.demo)return 0;
  const pos=scenePosition();
  if(pos&&S.routeCoords.length){
    const p=routeProjection(pos,S.lastRouteAlong);
    if(p&&S.routeCoords[p.index+1])return bearing(p.nearest,S.routeCoords[p.index+1])
  }
  const em=effectiveMatch();if(em&&pos)return travelDirection(em,pos)==="forward"?em.roadBearing:(em.roadBearing+180)%360;
  return S.heading||0
}
function geoToLocal(origin,heading,p){const d=haversineM(origin,p),a=signedAngle(heading,bearing(origin,p));return{side:Math.sin(rad(a))*d,forward:Math.cos(rad(a))*d}}
function scenePath(maxM=280){
  if(S.demo){
    const out=[];for(let f=0;f<=maxM;f+=12){const bend=Math.sin((f/115)+(S.demoT||0)*.05)*Math.min(10,f*.035);out.push({side:bend,forward:f})}return out
  }
  const pos=scenePosition();if(!pos)return[{side:0,forward:0},{side:0,forward:maxM}];
  const heading=sceneHeading(),geo=[];
  if(S.routeCoords.length){
    const p=routeProjection(pos,S.lastRouteAlong);
    if(p){geo.push(p.nearest);for(let i=p.index+1;i<S.routeCoords.length&&geo.length<100;i++)geo.push(S.routeCoords[i])}
  }else if(effectiveMatch()){
    const m=effectiveMatch(),coords=m.road.coords,dir=travelDirection(m,pos),i=m.segmentIndex??0;geo.push(m.nearest);
    if(dir==="forward")for(let j=i+1;j<coords.length&&geo.length<90;j++)geo.push(coords[j]);
    else for(let j=i;j>=0&&geo.length<90;j--)geo.push(coords[j])
  }
  if(geo.length<2)return[{side:0,forward:0},{side:0,forward:maxM}];
  const first=geoToLocal(pos,heading,geo[0]),acc=S.rawGps?.accuracy??pos.accuracy??30,trust=clamp((S.matchQuality-45)/45,0,1)*clamp((12-acc)/8,0,1),centerCorrection=first.side*(1-trust);
  const raw=[{side:clamp(first.side-centerCorrection,-14,14),forward:0}];let cum=0,prev=geo[0];
  for(let i=1;i<geo.length;i++){
    const p=geo[i];cum+=haversineM(prev,p);prev=p;if(cum>maxM+35)break;
    const local=geoToLocal(pos,heading,p),side=local.side-centerCorrection;if(Math.abs(side)<190)raw.push({side,forward:cum})
  }
  const out=[];
  for(let i=0;i<raw.length;i++){
    const a=raw[Math.max(0,i-1)],b=raw[i],c=raw[Math.min(raw.length-1,i+1)],side=(a.side+b.side*2+c.side)/4;
    if(!out.length||b.forward-out[out.length-1].forward>1.5)out.push({side,forward:b.forward})
  }
  if(out.length<2)out.push({side:out[0]?.side||0,forward:maxM});
  return out
}
function roadScreenPoint(local,w,h,hz){
  const maxM=280,f=clamp(local.forward,0,maxM),bot=h*1.04;
  const y=bot-(bot-hz)*Math.pow(f/maxM,.56),ppm=(w*.055)/(1+f/38),x=w/2+local.side*ppm;
  return{x,y,ppm,forward:f}
}
function offsetScreenPath(path,offset,w,h,hz){return path.map(p=>{const q=roadScreenPoint(p,w,h,hz);return[q.x+offset*q.ppm,q.y]})}
function drawPathLine(c,pts,color,width,dash=[]){if(pts.length<2)return;c.save();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.strokeStyle=color;c.lineWidth=width;c.lineCap="round";c.lineJoin="round";c.setLineDash(dash);c.stroke();c.restore()}
function screenAtForward(path,forward,w,h,hz){
  let best=path[0]||{side:0,forward:0};
  for(const p of path)if(Math.abs(p.forward-forward)<Math.abs(best.forward-forward))best=p;
  return roadScreenPoint(best,w,h,hz)
}
function perspectiveEnvPoint(side,forward,w,h,hz){
  if(forward<=4||forward>280)return null;
  return roadScreenPoint({side,forward},w,h,hz)
}
function drawFallbackCity(c,w,h,hz){
  const blocks=[[-.48,.11,.16,.24],[-.30,.09,.13,.18],[-.14,.08,.11,.14],[.14,.08,.11,.15],[.30,.10,.14,.20],[.48,.12,.16,.26]];
  for(const [sx,sw,sh,depth] of blocks){const bw=w*sw,bh=h*sh,x=w/2+w*sx-bw/2,y=hz;c.fillStyle=depth>.2?"#46545c":"#38464e";c.fillRect(x,y-bh,bw,bh);c.fillStyle="#9aa8ae";for(let r=0;r<3;r++)for(let col=0;col<2;col++)c.fillRect(x+bw*.18+col*bw*.38,y-bh*.78+r*bh*.23,Math.max(2,bw*.10),Math.max(2,bh*.07))}
  for(let i=0;i<6;i++){const side=i<3?-1:1,k=i%3,x=w/2+side*(w*.18+k*w*.11),y=hz+28+k*18;c.strokeStyle="#68747a";c.lineWidth=2;c.beginPath();c.moveTo(x,y);c.lineTo(x,y-28-k*3);c.stroke();c.fillStyle="#dbe2c1";c.beginPath();c.arc(x,y-30-k*3,3,0,Math.PI*2);c.fill()}
  for(let i=0;i<4;i++){const side=i<2?-1:1,k=i%2,x=w/2+side*(w*.27+k*w*.13),y=hz+55+k*35;c.strokeStyle="#314139";c.lineWidth=3;c.beginPath();c.moveTo(x,y);c.lineTo(x,y-20);c.stroke();c.fillStyle="#42604e";c.beginPath();c.arc(x,y-28,10,0,Math.PI*2);c.fill()}
}
function osmFacadeColor(tags,day){
  const raw=String(tags?.["building:colour"]||tags?.["building:color"]||"").trim();
  if(/^#[0-9a-f]{3,6}$/i.test(raw))return raw;
  const material=String(tags?.["building:material"]||"").toLowerCase();
  if(/brick/.test(material))return day?"#a77b69":"#5a4038";
  if(/stone/.test(material))return day?"#a39d91":"#56524c";
  if(/glass/.test(material))return day?"#7f9da8":"#38515c";
  return day?"#899499":"#435058"
}
function projectGroundShape(geom,pos,heading,w,h,hz){
  if(!geom?.length)return null;const out=[];
  for(const g of geom){
    const local=geoToLocal(pos,heading,g);if(local.forward<3||local.forward>285||Math.abs(local.side)>180)continue;
    const p=roadScreenPoint(local,w,h,hz);out.push({...p,local})
  }
  return out.length>=3?out:null
}
function drawExtrudedBuilding(c,o,pos,heading,w,h,hz,day){
  const base=projectGroundShape(o.geometry,pos,heading,w,h,hz);if(!base)return false;
  const top=base.map(p=>({x:p.x,y:p.y-clamp(o.height*p.ppm*.82,5,h*.44),ppm:p.ppm}));
  const facade=osmFacadeColor(o.tags,day),side=day?"#707c81":"#343e43",roof=day?"#a7b0b2":"#586368";
  const faces=[];
  for(let i=0;i<base.length;i++){
    const j=(i+1)%base.length,a=base[i],b=base[j],ta=top[i],tb=top[j],depth=(a.forward+b.forward)/2;
    faces.push({depth,pts:[[a.x,a.y],[b.x,b.y],[tb.x,tb.y],[ta.x,ta.y]]})
  }
  faces.sort((a,b)=>b.depth-a.depth);
  faces.forEach((f,i)=>poly(c,f.pts,i%2?side:facade));
  poly(c,top.map(p=>[p.x,p.y]),roof);
  if(o.name&&base.some(p=>p.ppm>2.7)){const near=base.reduce((a,b)=>a.forward<b.forward?a:b);c.fillStyle="#fff";c.font="800 8px -apple-system,Arial";c.textAlign="center";c.fillText(o.name.slice(0,16),near.x,near.y-clamp(o.height*near.ppm*.82,5,h*.44)-4)}
  return true
}
function drawEnvironment(c,w,h,hz,heading){
  const day=isDayScene(),pos=S.demo?null:scenePosition();if(!pos||!S.environment.length){drawFallbackCity(c,w,h,hz);return}
  const objs=visibleEnvironment(pos,heading);let labels=0;
  for(const o of objs){
    if(o.kind==="crossing")continue;
    const p=perspectiveEnvPoint(o.side,o.forward,w,h,hz);if(!p)continue;
    if(o.kind==="green"||o.kind==="water"){
      const ww=clamp((o.footprint||18)*p.ppm*1.4,10,180),hh=clamp(ww*.16,3,26);
      c.fillStyle=o.kind==="water"?(day?"#6c9eaa":"#284b56"):(day?"#5d815f":"#304b38");
      c.beginPath();c.ellipse(p.x,p.y,ww/2,hh/2,0,0,Math.PI*2);c.fill()
    }else if(o.kind==="sign"){
      const hh=clamp(5*p.ppm,8,34);c.strokeStyle="#767f84";c.lineWidth=2;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y-hh);c.stroke();
      c.fillStyle="#d9e0e3";c.fillRect(p.x-5,p.y-hh-7,10,7)
    }else if(o.kind==="building"){
      if(o.geometry&&o.forward<175&&drawExtrudedBuilding(c,o,pos,heading,w,h,hz,day))continue;
      const footprint=o.footprint||10,bw=clamp(footprint*p.ppm*.72,7,135),bh=clamp(o.height*p.ppm*1.25,9,h*.46);
      c.fillStyle=osmFacadeColor(o.tags,day);c.fillRect(p.x-bw/2,p.y-bh,bw,bh);
      c.fillStyle=day?"#667278":"#26343b";c.beginPath();c.moveTo(p.x-bw/2,p.y-bh);c.lineTo(p.x-bw*.34,p.y-bh-5*p.ppm/3);c.lineTo(p.x+bw*.46,p.y-bh-5*p.ppm/3);c.lineTo(p.x+bw/2,p.y-bh);c.fill();
      if(p.ppm>2.1&&bw>18){c.fillStyle=day?"#d1d7d5":"#94a6ad";const rows=Math.min(6,Math.max(1,Math.round(o.height/5)));for(let r=0;r<rows;r++)for(let col=0;col<Math.min(4,Math.max(2,Math.round(bw/30)));col++){const cols=Math.min(4,Math.max(2,Math.round(bw/30))),ww=Math.max(2,bw*.07),wh=Math.max(2,bh*.035),wx=p.x-bw*.35+col*(bw*.7/Math.max(1,cols-1)),wy=p.y-bh+bh*(r+1)/(rows+1);c.fillRect(wx,wy,ww,wh)}}
    }else if(o.kind==="tree"){
      const th=clamp(4.8*p.ppm,7,48);c.strokeStyle="#2f3b34";c.lineWidth=Math.max(1,1.7*p.ppm/3);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y-th*.55);c.stroke();c.fillStyle=day?"#47775a":"#3e5b49";c.beginPath();c.arc(p.x,p.y-th*.72,clamp(2.2*p.ppm,3,13),0,Math.PI*2);c.fill()
    }else if(o.kind==="lamp"){
      const lh=clamp(6*p.ppm,9,58);c.strokeStyle="#748087";c.lineWidth=Math.max(1,1.3*p.ppm/3);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y-lh);c.stroke();c.fillStyle="#e4e8c8";c.beginPath();c.arc(p.x,p.y-lh,clamp(.7*p.ppm,1.5,4),0,Math.PI*2);c.fill()
    }else if(o.kind==="transit"){
      const hh=clamp(5*p.ppm,8,35);c.fillStyle="#c7d4da";c.fillRect(p.x-2,p.y-hh,4,hh);c.fillStyle="#6fa6c8";c.fillRect(p.x-7,p.y-hh,14,8)
    }else if(o.kind==="poi"){
      const size=clamp(1.8*p.ppm,3,15);c.fillStyle="#dbe5ea";c.fillRect(p.x-size/2,p.y-size,size,size);
      if(o.name&&p.ppm>2.6&&labels<4){c.fillStyle="#fff";c.font="800 9px -apple-system,Arial";c.textAlign="center";c.fillText(o.name.slice(0,18),p.x,p.y-size-3);labels++}
    }
  }
}
function drawCrossings(c,w,h,hz,heading,total){
  const pos=scenePosition();if(S.demo||!pos)return;
  for(const o of visibleEnvironment(pos,heading,100).filter(x=>x.kind==="crossing").slice(0,3)){
    const p=roadScreenPoint({side:0,forward:o.forward},w,h,hz),half=CFG.laneWidthM*Math.max(1,total)/2*p.ppm;
    c.save();c.strokeStyle="rgba(255,255,255,.88)";c.lineWidth=Math.max(2,p.ppm*.22);
    for(let i=-3;i<=3;i++){const yy=p.y+i*Math.max(2,p.ppm*.26);c.beginPath();c.moveTo(p.x-half,yy);c.lineTo(p.x+half,yy);c.stroke()}
    c.restore()
  }
}
function drawRouteIntersections(c,w,h,hz,heading,path,total){
  if(S.demo||!S.routeIntersections.length)return;
  const along=S.fusion.along??S.routeFilter.along??S.lastRouteAlong;if(!Number.isFinite(along))return;
  const visible=S.routeIntersections.filter(x=>x.along>=along+12&&x.along<=along+180).slice(0,5),roadHalfM=CFG.laneWidthM*Math.max(1,total)/2;
  for(const it of visible){
    const distance=it.along-along,p=screenAtForward(path,distance,w,h,hz),scale=p.ppm,baseHalf=roadHalfM*scale;
    it.bearings.forEach((b,i)=>{
      if(i===it.in)return;const rel=signedAngle(heading,b);if(Math.abs(rel)<18||Math.abs(rel)>168)return;
      const reachable=it.entry?.[i]!==false,isOut=i===it.out,span=clamp(42+scale*12,42,w*.32),dx=Math.sin(rad(rel))*span,dy=-Math.cos(rad(rel))*span*.28;
      c.save();c.strokeStyle=isOut?"rgba(61,239,139,.82)":reachable?(isDayScene()?"rgba(65,70,72,.92)":"rgba(29,35,39,.96)"):"rgba(90,95,98,.28)";c.lineWidth=isOut?Math.max(5,scale*1.25):Math.max(7,scale*2.1);c.lineCap="round";c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x+dx,p.y+dy);c.stroke();
      if(isOut){c.strokeStyle="rgba(224,255,236,.9)";c.lineWidth=Math.max(1.5,scale*.34);c.setLineDash([6,6]);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x+dx,p.y+dy);c.stroke()}
      c.restore()
    })
  }
}
function drawMappedJunctions(c,w,h,hz,heading,path,total){
  const pos=scenePosition();if(S.demo||!pos||!S.junctions.length)return;
  const candidates=[];
  for(const j of S.junctions){
    const local=geoToLocal(pos,heading,j);if(local.forward<18||local.forward>150||Math.abs(local.side)>45)continue;
    const rp=S.routeCoords.length?routeProjection(j,S.lastRouteAlong):null;
    if(S.routeCoords.length&&rp&&rp.distance>28)continue;
    candidates.push({...j,local})
  }
  candidates.sort((a,b)=>b.local.forward-a.local.forward);
  for(const j of candidates.slice(0,5)){
    const p=screenAtForward(path,j.local.forward,w,h,hz),roadHalf=CFG.laneWidthM*Math.max(1,total)/2*p.ppm,th=clamp(p.ppm*3.2,7,30);
    const rel=j.branches.map(b=>signedAngle(heading,b.bearing));
    const left=rel.some(a=>a<-35&&a>-145),right=rel.some(a=>a>35&&a<145);
    c.fillStyle=isDayScene()?"#363b3d":"#181d20";
    if(left)c.fillRect(0,p.y-th/2,p.x+roadHalf,p.y?th:th);
    if(right)c.fillRect(p.x-roadHalf,p.y-th/2,w-(p.x-roadHalf),th);
    c.strokeStyle=isDayScene()?"rgba(245,245,245,.72)":"rgba(220,225,228,.65)";c.lineWidth=1;
    if(left){c.beginPath();c.moveTo(0,p.y-th/2);c.lineTo(p.x-roadHalf,p.y-th/2);c.moveTo(0,p.y+th/2);c.lineTo(p.x-roadHalf,p.y+th/2);c.stroke()}
    if(right){c.beginPath();c.moveTo(p.x+roadHalf,p.y-th/2);c.lineTo(w,p.y-th/2);c.moveTo(p.x+roadHalf,p.y+th/2);c.lineTo(w,p.y+th/2);c.stroke()}
  }
}
function drawJunctionGeometry(c,w,h,hz,d,path,total){
  if(!Number.isFinite(d.distance)||d.distance>145||d.arrived)return;
  const p=screenAtForward(path,Math.max(10,d.distance),w,h,hz),roadHalf=CFG.laneWidthM*Math.max(1,total)/2*p.ppm,th=clamp(p.ppm*4.5,10,52);
  c.fillStyle="#191e21";
  if(d.turn==="roundabout"){c.beginPath();c.arc(p.x,p.y,clamp(roadHalf*1.15,14,48),0,Math.PI*2);c.fill();c.strokeStyle="#d7dde0";c.lineWidth=2;c.stroke();c.fillStyle="#33423c";c.beginPath();c.arc(p.x,p.y,clamp(roadHalf*.45,6,20),0,Math.PI*2);c.fill()}
  else if(d.turn==="left"||d.turn==="right"){const dir=d.turn==="right"?1:-1;c.fillRect(dir>0?p.x-roadHalf:p.x-w,p.y-th/2,dir>0?w-p.x+roadHalf:p.x+roadHalf,th);c.strokeStyle="#d7dde0";c.lineWidth=1.5;c.beginPath();c.moveTo(dir>0?p.x-roadHalf:0,p.y-th/2);c.lineTo(dir>0?w:p.x+roadHalf,p.y-th/2);c.moveTo(dir>0?p.x-roadHalf:0,p.y+th/2);c.lineTo(dir>0?w:p.x+roadHalf,p.y+th/2);c.stroke()}
}
function drawDecisionRibbon(c,w,h,hz,d,path,total){
  const one=(turn,distance,secondary=false)=>{
    if(!Number.isFinite(distance)||distance<8||distance>255||!turn)return;
    const p=screenAtForward(path,distance,w,h,hz),q=screenAtForward(path,Math.min(275,distance+42),w,h,hz),span=clamp(w*.19+p.ppm*10,42,w*.34);
    c.save();c.strokeStyle=secondary?"rgba(72,235,143,.48)":"rgba(61,239,139,.92)";c.lineWidth=secondary?3:6;c.lineCap="round";c.lineJoin="round";c.setLineDash(secondary?[7,7]:[]);
    c.beginPath();
    if(turn==="right"){c.moveTo(q.x,q.y);c.quadraticCurveTo(p.x,p.y,p.x+span,p.y-2)}
    else if(turn==="left"){c.moveTo(q.x,q.y);c.quadraticCurveTo(p.x,p.y,p.x-span,p.y-2)}
    else if(turn==="uturn"){c.moveTo(q.x,q.y);c.quadraticCurveTo(p.x-span*.35,p.y-20,p.x-span*.15,p.y+18)}
    else if(turn==="roundabout"){c.arc(p.x,p.y,clamp(p.ppm*6,10,32),Math.PI*.15,Math.PI*1.65)}
    else{c.moveTo(p.x,p.y);c.lineTo(q.x,q.y)}
    c.stroke();c.restore()
  };
  one(d.turn,d.distance,false);one(d.afterTurn,d.afterDistance,true)
}
function drawSignal(c,p,demoCount){
  c.fillStyle="#090b0d";c.fillRect(p.x-8,p.y-44,16,42);
  if(Number.isFinite(demoCount)){c.fillStyle="#ef5050";c.beginPath();c.arc(p.x,p.y-34,5,0,Math.PI*2);c.fill();c.fillStyle="#fff";c.font="900 10px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.ceil(demoCount)}s*`,p.x,p.y+14)}
  else{c.fillStyle="#59666d";for(let i=0;i<3;i++){c.beginPath();c.arc(p.x,p.y-34+i*12,4,0,Math.PI*2);c.fill()}}
}
function roadContext(){
  const t=effectiveMatch()?.road?.tags||{};
  return{tunnel:["yes","building_passage"].includes(String(t.tunnel||"").toLowerCase()),bridge:["yes","viaduct"].includes(String(t.bridge||"").toLowerCase())||Boolean(t.man_made==="bridge")}
}
function specialLaneIndexes(kind,total){
  const lane=S.lastLane,t=effectiveMatch()?.road?.tags||{};if(!lane||!total)return[];
  const raw=directionalLaneValue(t,`${kind}:lanes`,lane.dir)||directionalLaneValue(t,kind,lane.dir),vals=pipe(raw);
  if(vals.length!==total)return[];
  const yes=v=>/yes|designated|permissive|official/.test(String(v).toLowerCase());
  return vals.map((v,i)=>yes(v)?i+1:null).filter(Boolean)
}
function drawTunnelShell(c,w,h,hz,path,roadHalf){
  const near=screenAtForward(path,12,w,h,hz),far=screenAtForward(path,250,w,h,hz);
  const nearHalf=(roadHalf+2.2)*near.ppm,farHalf=(roadHalf+2.2)*far.ppm;
  c.fillStyle="#171b1e";poly(c,[[0,hz],[far.x-farHalf,far.y],[near.x-nearHalf,near.y],[0,h]],"#202529");poly(c,[[w,hz],[far.x+farHalf,far.y],[near.x+nearHalf,near.y],[w,h]],"#202529");
  c.strokeStyle="rgba(220,225,225,.22)";c.lineWidth=2;for(let f=40;f<250;f+=45){const p=screenAtForward(path,f,w,h,hz),half=(roadHalf+1.8)*p.ppm;c.beginPath();c.arc(p.x,p.y,half,Math.PI,Math.PI*2);c.stroke()}
}
function drawBridgeRails(c,w,h,hz,path,roadHalf){
  for(const side of [-1,1]){const pts=offsetScreenPath(path,side*(roadHalf+1.15),w,h,hz);drawPathLine(c,pts,"#c3c9cc",2);const inner=offsetScreenPath(path,side*(roadHalf+.82),w,h,hz);drawPathLine(c,inner,"rgba(190,198,202,.55)",1)}
}
function sceneRoadLayout(d){
  const current=Math.max(1,d.total||1),tags=effectiveMatch()?.road?.tags||{},oneway=["yes","1","true","-1"].includes(String(tags.oneway||"").toLowerCase());
  if(oneway)return{visualTotal:current,ownTotal:current,ownOffset:0,divider:null};
  const dir=S.lastLane?.dir||"forward",opp=laneCount(tags,dir==="forward"?"backward":"forward"),full=positiveInt(tags.lanes)||current+opp;
  if(full>current&&opp>0)return{visualTotal:full,ownTotal:current,ownOffset:Math.max(0,full-current),divider:Math.max(0,full-current)};
  return{visualTotal:current,ownTotal:current,ownOffset:0,divider:null}
}
function draw3D(d={}){
  const cv=$("drive"),r=cv.getBoundingClientRect(),D=Math.min(devicePixelRatio||1,2),w=Math.max(1,r.width),h=Math.max(1,r.height),tw=Math.round(w*D),th=Math.round(h*D);
  if(cv.width!==tw||cv.height!==th){cv.width=tw;cv.height=th}
  const c=cv.getContext("2d");c.setTransform(D,0,0,D,0,0);c.clearRect(0,0,w,h);
  const hz=h*.29,total=Math.max(1,d.total||3),rec=clamp(d.recommended||d.lane||1,1,total),layout=sceneRoadLayout(d),visualTotal=layout.visualTotal,heading=sceneHeading(),path=scenePath(280),context=roadContext();
  const day=isDayScene(),g=c.createLinearGradient(0,0,0,hz);
  g.addColorStop(0,day?"#77a8bd":"#0d1a22");g.addColorStop(1,day?"#c1d9df":"#263944");c.fillStyle=g;c.fillRect(0,0,w,hz);
  if(day){c.fillStyle="rgba(255,244,190,.55)";c.beginPath();c.arc(w*.82,hz*.25,18,0,Math.PI*2);c.fill()}
  c.fillStyle=day?"#74817b":"#29353a";c.fillRect(0,hz,w,h-hz);
  if(!context.tunnel)drawEnvironment(c,w,h,hz,heading);
  const roadHalf=CFG.laneWidthM*visualTotal/2,sidewalk=1.8;
  const walkLeft=offsetScreenPath(path,-roadHalf-sidewalk,w,h,hz),roadLeft=offsetScreenPath(path,-roadHalf,w,h,hz),roadRight=offsetScreenPath(path,roadHalf,w,h,hz),walkRight=offsetScreenPath(path,roadHalf+sidewalk,w,h,hz);
  poly(c,[...walkLeft,...roadLeft.slice().reverse()],day?"#92999a":"#596267");poly(c,[...roadRight,...walkRight.slice().reverse()],day?"#92999a":"#596267");
  poly(c,[...roadLeft,...roadRight.slice().reverse()],roadSurfaceColor());
  if(context.tunnel)drawTunnelShell(c,w,h,hz,path,roadHalf);
  if(context.bridge)drawBridgeRails(c,w,h,hz,path,roadHalf);
  const cyc=cycleLaneSides();
  if(cyc.left)poly(c,[...offsetScreenPath(path,-roadHalf-1.45,w,h,hz),...offsetScreenPath(path,-roadHalf-.18,w,h,hz).reverse()],day?"#5f8f79":"#315647");
  if(cyc.right)poly(c,[...offsetScreenPath(path,roadHalf+.18,w,h,hz),...offsetScreenPath(path,roadHalf+1.45,w,h,hz).reverse()],day?"#5f8f79":"#315647");
  drawPathLine(c,roadLeft,"#e7ecee",2);drawPathLine(c,roadRight,"#e7ecee",2);
  const laneW=CFG.laneWidthM;
  const bus=[...new Set([...specialLaneIndexes("bus",total),...specialLaneIndexes("psv",total)])];
  if(bus.length){c.globalAlpha=.22;for(const idx of bus){const vi=layout.ownOffset+idx,l=-roadHalf+(vi-1)*laneW,r=l+laneW;poly(c,[...offsetScreenPath(path,l,w,h,hz),...offsetScreenPath(path,r,w,h,hz).reverse()],"#4d8fb8")}c.globalAlpha=1}
  const access=Array.isArray(d.accessible)&&d.accessible.length===total?d.accessible:Array.from({length:total},()=>true);
  for(let idx=1;idx<=total;idx++)if(access[idx-1]===false){
    const vi=layout.ownOffset+idx,l=-roadHalf+(vi-1)*laneW,r=l+laneW;
    c.globalAlpha=.18;poly(c,[...offsetScreenPath(path,l,w,h,hz),...offsetScreenPath(path,r,w,h,hz).reverse()],"#7e3540");c.globalAlpha=1;
    const p=screenAtForward(path,24+idx*3,w,h,hz),x=p.x+(-roadHalf+(vi-.5)*laneW)*p.ppm;c.fillStyle="rgba(255,255,255,.78)";c.font="900 7px -apple-system,Arial";c.textAlign="center";c.fillText("RÉSERVÉE",x,p.y)
  }
  const compatible=Array.isArray(d.compatible)?d.compatible.filter(i=>i>=1&&i<=total&&access[i-1]!==false):[];
  if(compatible.length){c.globalAlpha=.10;for(const idx of compatible){const vi=layout.ownOffset+idx,l=-roadHalf+(vi-1)*laneW,r=l+laneW;poly(c,[...offsetScreenPath(path,l,w,h,hz),...offsetScreenPath(path,r,w,h,hz).reverse()],"#64ef9b")}c.globalAlpha=1}
  if(d.current&&d.current!==rec){const vi=layout.ownOffset+d.current,l=-roadHalf+(vi-1)*laneW,r=l+laneW;c.globalAlpha=.12;poly(c,[...offsetScreenPath(path,l,w,h,hz),...offsetScreenPath(path,r,w,h,hz).reverse()],"#4b9fff");c.globalAlpha=1}
  const visualRec=layout.ownOffset+rec,leftOffset=-roadHalf+(visualRec-1)*laneW,rightOffset=leftOffset+laneW;
  c.globalAlpha=.20;poly(c,[...offsetScreenPath(path,leftOffset,w,h,hz),...offsetScreenPath(path,rightOffset,w,h,hz).reverse()],"#38e88c");c.globalAlpha=1;
  for(let i=1;i<visualTotal;i++){
    const divider=layout.divider===i;
    drawPathLine(c,offsetScreenPath(path,-roadHalf+i*laneW,w,h,hz),divider?"#f2f2f2":"#d9dfe2",divider?2.5:2,divider?[]:[10,13])
  }
  drawCrossings(c,w,h,hz,heading,visualTotal);drawRouteIntersections(c,w,h,hz,heading,path,visualTotal);drawMappedJunctions(c,w,h,hz,heading,path,visualTotal);drawJunctionGeometry(c,w,h,hz,d,path,visualTotal);drawDecisionRibbon(c,w,h,hz,d,path,visualTotal);
  const arrowP=screenAtForward(path,18,w,h,hz);
  for(let i=1;i<=total;i++){const vi=layout.ownOffset+i,x=arrowP.x+(-roadHalf+(vi-.5)*laneW)*arrowP.ppm,lt=laneArrowTurn(d.turns?.[i-1],d.turn||"through");arrow(c,x,Math.min(h*.73,arrowP.y),i===rec,lt)}
  if(Number.isFinite(d.distance)){const p=screenAtForward(path,clamp(d.distance,18,190),w,h,hz);c.fillStyle="#fff";c.font="900 12px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.round(d.distance)} m`,p.x,p.y-12)}
  if(d.demo){const p=screenAtForward(path,70,w,h,hz);drawSignal(c,p,d.signal)}
  else if(d.signal){const p=screenAtForward(path,clamp(d.signal.distance||80,25,180),w,h,hz);drawSignal(c,p,null)}
}
function bind(){
  $("mapBtn").onclick=()=>setView("map");$("driveBtn").onclick=()=>setView("drive");$("gpsBtn").onclick=startGps;$("visionBtn").onclick=toggleVision;$("demoBtn").onclick=startDemo;
  $("allowGps").onclick=startGps;$("later").onclick=()=>$("permission")?.remove();$("closeVision").onclick=closeVision;$("clearRoute").onclick=clearRoute;$("streetRef").onclick=openStreetReference;
  $("searchForm").onsubmit=searchDestinationQuery;$("recenterBtn").onclick=recenterMap;$("voiceBtn").onclick=toggleVoice;$("diagBtn").onclick=toggleDiag;$("closeDiag").onclick=toggleDiag;$("recordBtn").onclick=toggleRecording;$("exportBtn").onclick=exportTrack;$("replayBtn").onclick=()=>$("replayInput").click();$("replayInput").onchange=loadReplayFile;$("stopReplayBtn").onclick=()=>stopReplay(false);
  $("searchInput").addEventListener("input",()=>{if($("searchInput").value.trim().length<3)clearSearchResults()});
  window.addEventListener("online",()=>setStatus("Connexion rétablie"));
  window.addEventListener("offline",()=>setStatus("Hors ligne · GPS et caches locaux restent disponibles"));
  window.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.view==="map")setTimeout(()=>S.map.invalidateSize(),80)});
  window.addEventListener("resize",()=>{if(S.view==="drive")draw3D(currentDrawState())})
}
async function boot(){
  bind();initMap();setView("map");setStatus("BETA 9 · fusion + rendu fluide · active le GPS");if(!S.renderRaf)S.renderRaf=requestAnimationFrame(renderLoop);
  if("serviceWorker"in navigator)try{
    const regs=await navigator.serviceWorker.getRegistrations();
    for(const reg of regs){const url=reg.active?.scriptURL||reg.waiting?.scriptURL||reg.installing?.scriptURL||"";if(url&&!url.includes("v=9.0.0"))await reg.unregister()}
    if("caches"in window){for(const key of await caches.keys())if(key.startsWith("md-beta-")&&key!=="md-beta-9.0.0")await caches.delete(key)}
    await navigator.serviceWorker.register("./sw.js?v=9.0.0",{updateViaCache:"none"})
  }catch(e){}
}
boot();
})();
