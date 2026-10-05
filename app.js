(()=>{
"use strict";
const PILOT={lat:43.2858,lon:5.4140};
const CFG={laneWidthM:3.2,maxRoadDistanceM:45,queryRadiusKm:1.25,reloadAfterM:700,offRouteM:42,rerouteCooldownMs:12000,overpass:["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.nchc.org.tw/api/interpreter"],router:"https://router.project-osrm.org/route/v1/driving"};
const S={map:null,roads:[],signals:[],junctions:[],environment:[],gps:null,rawGps:null,heading:0,gpsWatch:null,areaCenter:null,environmentCenter:null,roadLoading:false,environmentLoading:false,userMarker:null,accuracyCircle:null,destinationMarker:null,destination:null,route:null,routeLoading:false,routeLayer:null,routeCoords:[],routeCum:[],routeLengthM:0,routeManeuvers:[],lastRouteAlong:null,view:"map",followMap:true,demo:false,demoT:0,demoTimer:null,visionStream:null,visionTimer:null,visionCue:null,visionStableFrames:0,compassHeading:null,compassActive:false,lastMatch:null,previousMatch:null,matchQuality:0,lastLane:null,lastNav:null,lastRerouteAt:0,lastRouteAttemptAt:0,offRouteHits:0,arrived:false,recording:false,track:[],lastTrackAt:0,truthEvents:[],currentTruth:null,searchMarker:null,destinationLabel:null,voiceEnabled:false,lastVoiceKey:"",statusTimer:null,laneFilter:{roadId:null,index:null,candidate:null,hits:0}};
const $=id=>document.getElementById(id),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI,angleDiff=(a,b)=>Math.abs(((a-b+540)%360)-180),pipe=v=>typeof v==="string"?v.split("|").map(x=>x.trim()):[],positiveInt=v=>{const n=parseInt(v,10);return Number.isFinite(n)&&n>0?n:0};
function setStatus(t,ms=3200){
  const el=$("status");el.textContent=t;el.classList.remove("quiet");clearTimeout(S.statusTimer);
  if(ms>0)S.statusTimer=setTimeout(()=>el.classList.add("quiet"),ms)
}
function turnHudGlyph(turn){
  return turn==="left"?"↰":turn==="right"?"↱":turn==="uturn"?"↶":turn==="roundabout"?"⟳":"↑"
}
function updateFusionBadge(pos=S.gps,m=S.lastMatch){
  const gps=pos?`GPS ±${Math.round(S.rawGps?.accuracy??pos.accuracy??0)}m`:"GPS —",match=m?`MATCH ${m.quality??0}`:"MATCH —",vision=S.visionCue?.stable?` · VIS ${S.visionCue.confidence}`:"";
  $("fusionBadge").textContent=`${gps} · ${match}${vision}`
}
function updateManeuverHud(nav){
  const hud=$("maneuverHud");if(!nav){$("maneuverText").textContent="Suivre la route";$("maneuverDistance").textContent="—";$("maneuverGlyph").textContent="↑";return}
  $("maneuverGlyph").textContent=turnHudGlyph(nav.turn);
  $("maneuverText").textContent=nav.arrived?"Destination atteinte":nav.instruction;
  $("maneuverDistance").textContent=nav.arrived?"ARRIVÉE":Number.isFinite(nav.distance)?(nav.distance>=1000?`${(nav.distance/1000).toFixed(1)} km`:`${Math.max(0,Math.round(nav.distance))} m`):"—"
}
function roadName(r){const m={motorway:"Autoroute",trunk:"Voie rapide",primary:"Axe principal",secondary:"Route secondaire",tertiary:"Route tertiaire",residential:"Rue résidentielle",service:"Voie de service",unclassified:"Route",living_street:"Zone de rencontre"};return r?.tags?.name||r?.tags?.ref||m[r?.tags?.highway]||"Route sans nom"}
function haversineM(a,b){const R=6371000,p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon),q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360}
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
function maxspeedKph(tags){const raw=String(tags?.maxspeed||"").trim().toLowerCase();if(!raw)return null;const n=parseFloat(raw);if(Number.isFinite(n))return Math.round(raw.includes("mph")?n*1.60934:n);return({"fr:urban":50,"fr:rural":80,"fr:trunk":110,"fr:motorway":130})[raw]||null}
function updateSpeedLimit(match,pos){const el=$("limitBadge"),limit=match?maxspeedKph(match.road.tags):null;if(!limit){el.classList.add("hidden");el.classList.remove("alert");return}el.textContent=String(limit);el.classList.remove("hidden");el.classList.toggle("alert",pos.speedMps*3.6>limit+5)}
function turnGlyph(raw){const vals=String(raw||"through").split(";").map(v=>v.trim());const glyph=v=>v.includes("uturn")||v.includes("reverse")?"↶":v.includes("left")?"↰":v.includes("right")?"↱":"↑";return [...new Set(vals.map(glyph))].join("")}
function updateJunctionAssist(lane,nav){const panel=$("junctionAssist");if(!nav||nav.arrived||!Number.isFinite(nav.distance)||nav.distance>500){panel.classList.add("hidden");return}panel.classList.remove("hidden");$("junctionText").textContent=`${nav.instruction} · ${Math.max(0,Math.round(nav.distance))} m`;const lanes=$("junctionLanes");if(lane.hasTurnLanes&&lane.turns.length){const good=compatibleLanes(lane,nav.turn);lanes.innerHTML=lane.turns.map((t,i)=>`<span class="${good.includes(i+1)?"recommended":""}">${turnGlyph(t)}</span>`).join("")}else{lanes.innerHTML='<small>Voies directionnelles non renseignées sur cette section</small>'}}
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
  return{id:String(e.id),kind,lat:loc.lat,lon:loc.lon,height:envHeight(tags),footprint,name:tags.name||tags.brand||tags.shop||tags.amenity||"",tags}
}
async function loadEnvironmentData(lat,lon){
  if(S.environmentLoading)return;S.environmentLoading=true;S.environmentCenter={lat,lon};
  const b=bbox(lat,lon,.48),q=`[out:json][timeout:25];(way["building"](${b});way["natural"="water"](${b});way["leisure"="park"](${b});way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${b});node["natural"="tree"](${b});node["highway"="street_lamp"](${b});node["highway"="crossing"](${b});node["highway"="bus_stop"](${b});node["public_transport"="platform"](${b});node["traffic_sign"](${b});node["amenity"](${b});node["shop"](${b}););out geom tags;`;
  try{
    const data=await fetchOverpass(q),objects=[];
    for(const e of data.elements||[]){const o=environmentObject(e);if(o)objects.push(o)}
    objects.sort((a,b)=>haversineM({lat,lon},a)-haversineM({lat,lon},b));S.environment=objects.slice(0,650);
    try{localStorage.setItem("mdEnvCacheV1",JSON.stringify({lat,lon,time:Date.now(),objects:S.environment}))}catch(_){}
    if($("envBadge"))$("envBadge").textContent=`URBAIN ${S.environment.length}`
  }catch(e){
    let used=false;
    try{const cache=JSON.parse(localStorage.getItem("mdEnvCacheV1")||"null");if(cache&&Date.now()-cache.time<86400000&&haversineM({lat,lon},cache)<2500){S.environment=cache.objects||[];S.environmentCenter={lat:cache.lat,lon:cache.lon};used=true}}catch(_){}
    if($("envBadge"))$("envBadge").textContent=used?`CACHE ${S.environment.length}`:"URBAIN —"
  }finally{S.environmentLoading=false}
}
function signedAngle(from,to){return((to-from+540)%360)-180}
function visibleEnvironment(pos,heading,maxM=260){if(!pos||!S.environment.length)return[];const out=[];for(const o of S.environment){const d=haversineM(pos,o);if(d<5||d>maxM)continue;const a=signedAngle(heading,bearing(pos,o)),forward=Math.cos(rad(a))*d,side=Math.sin(rad(a))*d;if(forward<5||forward>maxM||Math.abs(side)>130)continue;out.push({...o,distance:d,forward,side})}return out.sort((a,b)=>b.forward-a.forward).slice(0,90)}
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
  const b=bbox(lat,lon,CFG.queryRadiusKm),q=`[out:json][timeout:30];(way["highway"]["highway"!~"footway|path|steps|pedestrian|cycleway"](${b});node["highway"="traffic_signals"](${b}););out geom tags;`;
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
  if(pos.speedMps<1.5||!Number.isFinite(pos.heading))return"forward";
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
function estimateLane(m,pos){
  const dir=travelDirection(m,pos),total=laneCount(m.road.tags,dir),rb=dir==="forward"?m.roadBearing:(m.roadBearing+180)%360,acc=Number.isFinite(pos.accuracy)?pos.accuracy:999,headErr=Number.isFinite(pos.heading)?angleDiff(pos.heading,rb):90;
  const mapQ=Number.isFinite(m.quality)?m.quality:50,confidence=clamp(Math.round(92-Math.min(m.distance,40)*1.1-Math.min(acc,40)*2.25-Math.min(headErr,90)*.22+(mapQ-50)*.18),0,100);
  const hasTurnLanes=Boolean(directionalLaneValue(m.road.tags,"turn:lanes",dir)),geom=laneGeometry(m.road.tags,dir,total);
  const base={dir,total,confidence,hasTurnLanes,turns:laneTurns(m.road.tags,dir),changes:laneChanges(m.road.tags,dir),geometry:geom};
  if(!total)return{...base,index:null,reason:"Nombre de voies absent dans OSM"};
  if(acc>5.5||confidence<62)return{...base,index:null,reason:`GPS ±${Math.round(acc)} m : pas assez précis pour une voie`};
  const off=signedLateralM(pos,m.nearest,rb),index=laneFromOffset(geom,off);
  if(!index)return{...base,index:null,lateralM:off,reason:"Position latérale incompatible avec la géométrie des voies"};
  const penalty=geom?.quality==="inferred"?8:0;
  return{...base,index,lateralM:off,confidence:clamp(confidence-penalty,0,100),reason:geom?.quality==="inferred"?"Estimation GPS + axe OSM (géométrie inférée)":"Estimation GPS + géométrie OSM"}
}
function stabilizeLane(lane,m){
  const f=S.laneFilter,roadId=m?.road?.id||null;
  if(f.roadId!==roadId){f.roadId=roadId;f.index=null;f.candidate=null;f.hits=0}
  if(!lane.index){f.candidate=null;f.hits=0;return lane}
  if(f.index===null){
    if(f.candidate===lane.index)f.hits++;else{f.candidate=lane.index;f.hits=1}
    if(f.hits>=2){f.index=lane.index;f.candidate=null;f.hits=0;return lane}
    return{...lane,index:null,reason:"Stabilisation de la voie…"}
  }
  if(lane.index===f.index){f.candidate=null;f.hits=0;return lane}
  if(f.candidate===lane.index)f.hits++;else{f.candidate=lane.index;f.hits=1}
  const visionCrossing=Boolean(S.visionCue?.stable&&S.visionCue.nearBoundary&&S.visionCue.confidence>=70),needed=visionCrossing?2:3;
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
function smoothGps(raw){if(!S.gps)return raw;const acc=clamp(raw.accuracy,3,40),alpha=raw.speedMps>8?.5:raw.speedMps>2?.35:.22,weight=clamp(alpha*(12/acc),.12,.65);const sm={...raw,lat:S.gps.lat+(raw.lat-S.gps.lat)*weight,lon:S.gps.lon+(raw.lon-S.gps.lon)*weight};if(Number.isFinite(raw.heading)&&raw.speedMps>1.5){const a=rad(S.gps.heading||raw.heading),b=rad(raw.heading),x=Math.cos(a)*.65+Math.cos(b)*.35,y=Math.sin(a)*.65+Math.sin(b)*.35;sm.heading=(deg(Math.atan2(y,x))+360)%360}else sm.heading=Number.isFinite(S.compassHeading)?S.compassHeading:(S.gps.heading||raw.heading||0);return sm}
function updateUserMarker(pos){const ll=[pos.lat,pos.lon];if(!S.userMarker){const icon=L.divIcon({className:"",html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});S.userMarker=L.marker(ll,{icon,zIndexOffset:1000}).addTo(S.map);S.accuracyCircle=L.circle(ll,{radius:pos.accuracy||10,weight:1,color:"#1d79ff",fillColor:"#1d79ff",fillOpacity:.08}).addTo(S.map)}else{S.userMarker.setLatLng(ll);S.accuracyCircle.setLatLng(ll).setRadius(pos.accuracy||10)}const dot=S.userMarker.getElement()?.querySelector(".user-dot");if(dot)dot.style.transform=`rotate(${Math.round(pos.heading||S.heading||0)}deg)`;if(S.view==="map"&&S.followMap)S.map.setView(ll,17,{animate:true})}
function buildRouteCum(){
  S.routeCum=[0];let cum=0;
  for(let i=0;i<S.routeCoords.length-1;i++){cum+=haversineM(S.routeCoords[i],S.routeCoords[i+1]);S.routeCum.push(cum)}
  S.routeLengthM=cum||S.routeLengthM
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
function buildRouteManeuvers(){S.routeManeuvers=[];const steps=S.route?.legs?.[0]?.steps||[];for(const step of steps){const loc=step.maneuver?.location;if(!loc)continue;const point={lat:loc[1],lon:loc[0]},proj=routeProjection(point,null);if(!proj)continue;S.routeManeuvers.push({step,along:proj.along,point,type:step.maneuver?.type||"",modifier:step.maneuver?.modifier||"straight"})}S.routeManeuvers.sort((a,b)=>a.along-b.along)}
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
  let candidate=null;
  for(const m of S.routeManeuvers){if(m.type==="depart")continue;if(m.along>=proj.along-12){candidate=m;break}}
  if(!candidate)return{instruction:"Continue jusqu’à destination",detail:`${Math.round(proj.remaining)} m restants`,turn:"through",distance:proj.remaining,remaining:proj.remaining,progress:proj.progress,offRoute:proj.distance,maneuverId:"final"};
  const distance=Math.max(0,candidate.along-proj.along),turn=maneuverTurn(candidate),instruction=maneuverInstruction(candidate,turn);
  return{instruction,detail:`Dans ~${Math.round(distance)} m · ${candidate.step.name||"prochaine voie"}`,nextRoad:candidate.step.name||"",turn,distance,remaining:proj.remaining,progress:proj.progress,offRoute:proj.distance,arrived:false,maneuverId:`${candidate.type}:${Math.round(candidate.along)}`}
}
function compatibleLanes(lane,turn){if(!lane.total)return[];const desired=turn||"through",out=[];lane.turns.forEach((raw,i)=>{const vals=raw.split(";").map(v=>v.trim());if(vals.includes(desired)||(desired==="through"&&(vals.includes("through")||vals.includes("straight"))))out.push(i+1)});return out}
function recommendedLane(lane,turn){if(turn&&turn!=="through"&&!lane.hasTurnLanes)return null;const c=compatibleLanes(lane,turn);if(!c.length)return turn==="through"?(lane.index||null):null;if(!lane.index)return c[0];return c.reduce((a,b)=>Math.abs(b-lane.index)<Math.abs(a-lane.index)?b:a)}
function adviceText(lane,nav){
  if(!nav)return lane.index?`🟢 VOIE PROBABLE ${lane.index}/${lane.total}`:(lane.total?`🟡 ${lane.total} VOIES · POSITION INCONNUE`:"Voies non renseignées");
  if(nav.arrived)return"🏁 DESTINATION ATTEINTE";
  if(nav.turn!=="through"&&!lane.hasTurnLanes){const dir=nav.turn==="left"?"À GAUCHE":nav.turn==="right"?"À DROITE":nav.turn==="roundabout"?"AU ROND-POINT":"POUR LA MANŒUVRE";return `↪ PRÉPARE-TOI ${dir} · VOIE NON CARTOGRAPHIÉE`}
  const rec=recommendedLane(lane,nav.turn),d=nav.distance??9999;if(!rec)return lane.total?`🟡 ${lane.total} VOIES · POSITION INCONNUE`:"Voies non renseignées";
  if(lane.index&&rec!==lane.index&&!laneChangeAllowed(lane,lane.index,rec))return"⚠️ CHANGEMENT DE VOIE CARTOGRAPHIÉ COMME INTERDIT ICI";
  const urgency=d>350?"PRÉPARE":d>120?"REJOINS":"MAINTENANT";
  if(lane.index&&rec===lane.index)return d<120?`🟢 RESTE VOIE ${lane.index}/${lane.total}`:`🟢 BONNE VOIE ${lane.index}/${lane.total}`;
  return lane.index?`➡️ ${urgency} VOIE ${rec}/${lane.total}`:`➡️ VOIE CONSEILLÉE ${rec}/${lane.total}`
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
function updateUi(pos){$("speed").textContent=Math.round(pos.speedMps*3.6);const m=nearestRoad(pos);S.previousMatch=S.lastMatch;S.lastMatch=m;S.matchQuality=m?.quality||0;if(!m){$("road").textContent="—";$("lane").textContent="—";$("confidence").textContent="—";$("advice").textContent="Route à confirmer";$("source").textContent="SOURCE GPS";updateSpeedLimit(null,pos);$("junctionAssist").classList.add("hidden");updateManeuverHud(null);updateFusionBadge(pos,null);updateDiagnostics(pos,null,null,null);return}const lane=stabilizeLane(fuseLaneWithVision(estimateLane(m,pos)),m),nav=S.route?nextInstruction(pos):null,sig=relevantSignal(pos,m);S.lastLane=lane;S.lastNav=nav;updateSpeedLimit(m,pos);updateJunctionAssist(lane,nav);updateManeuverHud(nav);updateFusionBadge(pos,m);voiceCue(nav);$("road").textContent=roadName(m.road);$("lane").textContent=lane.index?`${lane.index}/${lane.total}`:(lane.total?`?/${lane.total}`:"—");$("confidence").textContent=`${lane.confidence}%`;$("signal").textContent=sig?`${Math.round(sig.distance)} m`:"—";$("source").textContent=lane.index?(lane.visionAssist&&S.visionCue?.stable?"GPS + VISION":"ESTIMATION"):"PAS ASSEZ PRÉCIS";if(nav){$("instruction").textContent=nav.instruction;$("detail").textContent=`${nav.detail} · ${lane.reason}`;$("advice").textContent=adviceText(lane,nav);if(nav.arrived){S.arrived=true;$("progressWrap").classList.remove("hidden");$("progressBar").style.width="100%";$("routeMeta").textContent="Arrivée";setStatus("Destination atteinte")}else if(Number.isFinite(nav.progress)){S.arrived=false;$("progressWrap").classList.remove("hidden");$("progressBar").style.width=`${clamp(nav.progress*100,0,100)}%`;const rem=nav.remaining??S.route.distance;const eta=S.route?.distance?S.route.duration*(rem/S.route.distance):rem/Math.max(6,pos.speedMps||10);$("routeMeta").textContent=`${(rem/1000).toFixed(1)} km restants · ~${Math.max(1,Math.round(eta/60))} min`}}else{$("instruction").textContent=roadName(m.road);$("detail").textContent=lane.reason;$("advice").textContent=adviceText(lane,null)}draw3D({lane:lane.index||2,total:lane.total||3,recommended:nav?recommendedLane(lane,nav.turn)||(lane.index||2):(lane.index||2),turn:nav?.turn||"through",distance:nav?.distance,arrived:nav?.arrived,signal:sig});updateDiagnostics(pos,m,lane,nav);maybeReroute(pos,nav)}
async function startGps(){enableCompass();if(!window.isSecureContext){setStatus("GPS : ouvre bien l’adresse HTTPS GitHub Pages.");return}if(!navigator.geolocation){setStatus("GPS non disponible.");return}$("permission")?.remove();$("gpsBtn").classList.add("active");$("gpsBtn").querySelector("span").textContent="Actif";if(S.gpsWatch!==null)navigator.geolocation.clearWatch(S.gpsWatch);S.gpsWatch=navigator.geolocation.watchPosition(async p=>{const c=p.coords,raw={lat:c.latitude,lon:c.longitude,speedMps:Math.max(0,Number.isFinite(c.speed)?c.speed:0),heading:Number.isFinite(c.heading)&&c.heading>=0?c.heading:(Number.isFinite(S.compassHeading)?S.compassHeading:S.heading),accuracy:Number.isFinite(c.accuracy)?c.accuracy:999};S.rawGps=raw;S.gps=smoothGps(raw);S.heading=S.gps.heading;updateUserMarker(S.gps);if(!S.areaCenter||haversineM(S.gps,S.areaCenter)>CFG.reloadAfterM)await loadRoadData(S.gps.lat,S.gps.lon);if(!S.environmentCenter||haversineM(S.gps,S.environmentCenter)>240)loadEnvironmentData(S.gps.lat,S.gps.lon);updateUi(S.gps);recordSample();if(S.destination&&!S.route&&!S.routeLoading&&Date.now()-S.lastRouteAttemptAt>15000)calculateRoute(S.destination.lat,S.destination.lon,false);updateFusionBadge(S.gps,S.lastMatch)},e=>setStatus("GPS : "+e.message),{enableHighAccuracy:true,maximumAge:500,timeout:15000})}
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
    S.route=d.routes[0];S.routeCoords=S.route.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}));S.routeLengthM=S.route.distance;buildRouteCum();S.lastRouteAlong=null;buildRouteManeuvers();S.arrived=false;S.lastVoiceKey="";
    if(S.routeLayer)S.map.removeLayer(S.routeLayer);S.routeLayer=L.polyline(S.routeCoords.map(p=>[p.lat,p.lon]),{color:"#fff",weight:7,opacity:.93,className:"route-line"}).addTo(S.map);
    if(!isReroute){S.followMap=false;document.body.classList.add("map-free");S.map.fitBounds(S.routeLayer.getBounds(),{padding:[45,45]})};
    $("routeMeta").textContent=`${(S.route.distance/1000).toFixed(1)} km · ~${Math.max(1,Math.round(S.route.duration/60))} min`;$("progressWrap").classList.remove("hidden");
    setStatus(isReroute?"Nouvel itinéraire chargé":"Itinéraire chargé · passe en 3D quand tu veux");updateUi(S.gps)
  }catch(e){setStatus(e?.name==="AbortError"?"Calcul d’itinéraire trop long · réessaie.":"Itinéraire indisponible : "+e.message)}
  finally{clearTimeout(timer);S.routeLoading=false}
}
function setDestination(lat,lon,label=null){S.destinationLabel=label;calculateRoute(lat,lon,false)}
function clearRoute(){S.route=null;S.routeCoords=[];S.routeCum=[];S.routeManeuvers=[];S.lastRouteAlong=null;S.destination=null;S.destinationLabel=null;S.lastVoiceKey="";S.arrived=false;S.offRouteHits=0;if(S.routeLayer){S.map.removeLayer(S.routeLayer);S.routeLayer=null}if(S.destinationMarker){S.map.removeLayer(S.destinationMarker);S.destinationMarker=null}$("routeTitle").textContent="Touchez la carte pour choisir une destination";$("routeMeta").textContent="Active d’abord le GPS.";$("clearRoute").hidden=true;$("progressWrap").classList.add("hidden");$("progressBar").style.width="0%";$("junctionAssist").classList.add("hidden");if(S.gps)updateUi(S.gps)}
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
  const ev={t:new Date().toISOString(),lane:index,total:S.lastLane.total,road:S.lastMatch?roadName(S.lastMatch.road):null,wayId:S.lastMatch?.road?.id||null,lat:S.gps.lat,lon:S.gps.lon};
  S.truthEvents.push(ev);$("diagTruth").textContent=`voie ${index}/${S.lastLane.total}`;renderTruthButtons(S.lastLane);setStatus(`Vérité terrain enregistrée : voie ${index}/${S.lastLane.total}`)
}
function updateDiagnostics(pos=S.gps,m=S.lastMatch,lane=S.lastLane,nav=S.lastNav){
  if(!$("diagGps"))return;
  $("diagGps").textContent=pos?`±${Math.round(S.rawGps?.accuracy??pos.accuracy??0)} m · ${Math.round((pos.speedMps||0)*3.6)} km/h`:"—";
  $("diagMatch").textContent=m?`${m.distance.toFixed(1)} m · Q${m.quality??0}`:"—";
  $("diagHeading").textContent=pos?`${Math.round(pos.heading||0)}°`:"—";
  $("diagLane").textContent=lane?(lane.index?`${lane.index}/${lane.total} · ${lane.confidence}%`:(lane.total?`?/${lane.total} · ${lane.confidence}%`:"—")):"—";
  $("diagRoute").textContent=nav&&Number.isFinite(nav.offRoute)?`${nav.offRoute.toFixed(1)} m écart`:(S.route?"sur route":"—");
  $("diagEnv").textContent=`${S.environment.length} objets`;$("diagVision").textContent=S.visionCue?`${S.visionCue.confidence}% · ${S.visionCue.valid?(S.visionCue.nearBoundary?"bord":"centré"):"?"}`:"—";$("diagTruth").textContent=S.currentTruth&&lane?`voie ${S.currentTruth}/${lane.total}`:"—";renderTruthButtons(lane);
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
    lane:l?{index:l.index,total:l.total,confidence:l.confidence}:null,
    route:n?{offRouteM:Number.isFinite(n.offRoute)?+n.offRoute.toFixed(2):null,nextM:Number.isFinite(n.distance)?Math.round(n.distance):null,turn:n.turn}:null,vision:S.visionCue?{confidence:S.visionCue.confidence,valid:S.visionCue.valid,offsetNorm:S.visionCue.offsetNorm,nearBoundary:S.visionCue.nearBoundary,stable:S.visionCue.stable}:null
  });
  $("recordBtn").textContent=`■ Arrêter (${S.track.length})`;
  $("exportBtn").disabled=S.track.length===0
}
function toggleRecording(){
  if(S.recording){
    S.recording=false;$("recordBtn").classList.remove("recording");$("recordBtn").textContent=`● Reprendre (${S.track.length})`;
    $("exportBtn").disabled=S.track.length===0;setStatus(`Trace arrêtée · ${S.track.length} points`);return
  }
  if(!S.gps){setStatus("Active le GPS avant d’enregistrer une trace.");return}
  if(!S.track.length)S.track=[];
  S.recording=true;S.lastTrackAt=0;$("recordBtn").classList.add("recording");$("recordBtn").textContent=`■ Arrêter (${S.track.length})`;
  setStatus("Trace terrain locale démarrée")
}
function exportTrack(){
  if(!S.track.length)return;
  const payload={app:"Marseille Drive",version:"BETA 8",exportedAt:new Date().toISOString(),points:S.track,truthEvents:S.truthEvents};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`marseille-drive-trace-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)
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
  const L=fitVisionLine(left),R=fitVisionLine(right);if(!L||!R)return{confidence:Math.round(pointConfidence*.45),valid:false,offsetNorm:0,nearBoundary:false};
  const y=H*.89,lx=L.xAt(y),rx=R.xAt(y),width=rx-lx;
  if(width<28||width>118||lx>=rx)return{confidence:Math.round(pointConfidence*.5),valid:false,offsetNorm:0,nearBoundary:false};
  const residual=(L.error+R.error)/2,geometry=clamp(100-residual*9-Math.abs(width-66)*.45,0,100),confidence=Math.round(clamp(pointConfidence*.65+geometry*.35,0,100));
  const center=(lx+rx)/2,offsetNorm=(W/2-center)/width,edge=Math.min(W/2-lx,rx-W/2)/width,nearBoundary=edge<.25||Math.abs(offsetNorm)>.27;
  return{confidence,valid:true,offsetNorm:+offsetNorm.toFixed(3),nearBoundary,laneWidthPx:+width.toFixed(1),leftFit:L,rightFit:R}
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
  const wc=work.getContext("2d",{willReadFrequently:true});wc.drawImage(v,0,0,W,H);
  let img;try{img=wc.getImageData(0,0,W,H).data}catch(_){return}
  const left=[],right=[];
  for(let y=48;y<94;y+=2){
    const spread=(y-46)*.76,leftExp=80-spread,rightExp=80+spread;
    for(const [exp,out] of [[leftExp,left],[rightExp,right]]){
      let best=null;
      for(let x=Math.max(5,Math.floor(exp-21));x<=Math.min(W-6,Math.ceil(exp+21));x++){
        const i=(y*W+x)*4,lum=visionLuma(img,i),l=visionLuma(img,i-12),rr=visionLuma(img,i+12),score=lum-(l+rr)/2;
        if(lum>125&&score>18&&(!best||score>best.score))best={x,y,score}
      }
      if(best)out.push(best)
    }
  }
  const pointConf=clamp(Math.min(left.length,right.length)/20*100,0,100),cue=visionLaneCue(left,right,W,H,pointConf);
  if(cue.valid&&cue.confidence>=65)S.visionStableFrames=Math.min(20,S.visionStableFrames+1);else S.visionStableFrames=Math.max(0,S.visionStableFrames-1);
  S.visionCue={...cue,left,right,stable:S.visionStableFrames>=3};
  const rect=v.getBoundingClientRect(),D=devicePixelRatio||1;overlay.width=Math.max(1,Math.round(rect.width*D));overlay.height=Math.max(1,Math.round(rect.height*D));
  const c=overlay.getContext("2d");c.setTransform(D,0,0,D,0,0);c.clearRect(0,0,rect.width,rect.height);
  const sx=rect.width/W,sy=rect.height/H;
  const drawFit=(fit)=>{if(!fit)return;c.beginPath();c.moveTo(fit.xAt(48)*sx,48*sy);c.lineTo(fit.xAt(94)*sx,94*sy);c.lineWidth=3;c.strokeStyle=cue.confidence>=65?"rgba(80,240,160,.92)":"rgba(255,255,255,.6)";c.stroke()};
  drawFit(cue.leftFit);drawFit(cue.rightFit);
  c.strokeStyle=cue.nearBoundary?"rgba(255,195,70,.9)":"rgba(255,255,255,.28)";c.lineWidth=2;c.beginPath();c.moveTo(rect.width*.5,rect.height*.49);c.lineTo(rect.width*.5,rect.height*.96);c.stroke();
  const state=cue.valid?(cue.nearBoundary?"proche marquage":"centrage voie"):"repères incomplets";
  $("visionStatus").textContent=`Vision ${cue.confidence}% · ${state} · assistance de stabilité uniquement`;
  updateDiagnostics()
}
function setView(v){
  S.view=v;document.body.classList.toggle("drive-mode",v==="drive");
  $("map").style.display=v==="map"?"block":"none";$("drive").style.display=v==="drive"?"block":"none";$("car").style.display=v==="drive"?"block":"none";
  $("mapBtn").classList.toggle("active",v==="map");$("driveBtn").classList.toggle("active",v==="drive");
  $("modeLabel").textContent=`BETA 8 · ${v==="map"?"CARTE RÉELLE":"NAVIGATION 3D"}`;
  if(v==="map")setTimeout(()=>S.map.invalidateSize(),80);
  else draw3D({lane:S.lastLane?.index||2,total:S.lastLane?.total||3,recommended:S.lastNav?recommendedLane(S.lastLane,S.lastNav.turn)||(S.lastLane?.index||2):(S.lastLane?.index||2),turn:S.lastNav?.turn||"through",distance:S.lastNav?.distance,arrived:S.lastNav?.arrived,signal:S.gps?relevantSignal(S.gps,S.lastMatch):null})
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
function startDemo(){if(S.demo){S.demo=false;clearInterval(S.demoTimer);S.demoTimer=null;$("demoBtn").querySelector("span").textContent="Démo";setStatus(S.gps?"GPS réel":"Démo arrêtée");if(S.gps)updateUi(S.gps);return}S.demo=true;S.demoT=0;setView("drive");$("demoBtn").querySelector("span").textContent="Pause";$("source").textContent="SIMULATION";setStatus("MODE DÉMO — données simulées");S.demoTimer=setInterval(()=>{S.demoT+=.1;if(S.demoT>24)S.demoT=0;const t=S.demoT,change=t>7&&t<15,lane=t>=15?3:2,recommended=change?3:lane,turn=t>7?"right":"through",signal=18-(t%18),distance=Math.max(0,460-t*17),progress=clamp(t/24,0,1);$("speed").textContent=Math.round(48+Math.sin(t*.8)*2);$("lane").textContent=`${lane}/3`;$("confidence").textContent="96%";$("road").textContent="Avenue pilote";$("signal").textContent=`${Math.ceil(signal)} s*`;$("limitBadge").textContent="50";$("limitBadge").classList.remove("hidden");$("instruction").textContent=change?"Change de voie":turn==="right"?"Tourne à droite":"Continue tout droit";$("detail").textContent=`Dans ${Math.round(distance)} m · feu SIMULÉ`;$("advice").textContent=recommended===lane?`🟢 RESTE VOIE ${lane}/3`:`➡️ ${distance>120?"REJOINS":"MAINTENANT"} VOIE ${recommended}/3`;$("routeTitle").textContent="Itinéraire de démonstration";$("routeMeta").textContent=`${Math.max(0,(3.2*(1-progress))).toFixed(1)} km restants`;$("progressWrap").classList.remove("hidden");$("progressBar").style.width=`${progress*100}%`;const demoNav={instruction:turn==="right"?"Tourne à droite":"Continue tout droit",turn,distance,arrived:false};updateJunctionAssist({total:3,index:lane,hasTurnLanes:true,turns:["through","through","right"]},demoNav);updateManeuverHud(demoNav);$("fusionBadge").textContent="SIMULATION · MATCH 100";draw3D({lane,total:3,recommended,turn,signal,distance,demo:true})},100)}
function poly(c,p,f){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.closePath();c.fillStyle=f;c.fill()}
function line(c,p,col,w){c.beginPath();p.forEach((x,i)=>i?c.lineTo(x[0],x[1]):c.moveTo(x[0],x[1]));c.strokeStyle=col;c.lineWidth=w;c.stroke()}
function arrow(c,x,y,on,turn){c.save();c.strokeStyle=on?"#fff":"#c5cdd1";c.lineWidth=on?5:3;c.lineCap="round";c.lineJoin="round";c.beginPath();c.moveTo(x,y+20);c.lineTo(x,y-16);if(on&&turn==="right"){c.quadraticCurveTo(x,y-27,x+18,y-28);c.moveTo(x+18,y-28);c.lineTo(x+10,y-35);c.moveTo(x+18,y-28);c.lineTo(x+10,y-21)}else if(on&&turn==="left"){c.quadraticCurveTo(x,y-27,x-18,y-28);c.moveTo(x-18,y-28);c.lineTo(x-10,y-35);c.moveTo(x-18,y-28);c.lineTo(x-10,y-21)}else{c.moveTo(x,y-16);c.lineTo(x-8,y-6);c.moveTo(x,y-16);c.lineTo(x+8,y-6)}c.stroke();c.restore()}
function isDayScene(){const h=new Date().getHours();return h>=7&&h<20}
function roadSurfaceColor(){
  const surface=String(S.lastMatch?.road?.tags?.surface||"").toLowerCase(),day=isDayScene();
  if(/cobblestone|sett|paving_stones/.test(surface))return day?"#45494a":"#252a2d";
  if(/concrete/.test(surface))return day?"#555a5c":"#2b3032";
  if(/gravel|unpaved|ground/.test(surface))return day?"#625b4f":"#342f29";
  return day?"#2d3234":"#14191c"
}
function cycleLaneSides(){
  const t=S.lastMatch?.road?.tags||{},generic=String(t.cycleway||"").toLowerCase(),left=String(t["cycleway:left"]||"").toLowerCase(),right=String(t["cycleway:right"]||"").toLowerCase();
  const yes=v=>/lane|track|shared_lane/.test(v);
  return{left:yes(left),right:yes(right)||(!left&&!right&&yes(generic))}
}
function sceneHeading(){
  if(S.demo)return 0;
  if(S.gps&&S.routeCoords.length){
    const p=routeProjection(S.gps,S.lastRouteAlong);
    if(p&&S.routeCoords[p.index+1])return bearing(p.nearest,S.routeCoords[p.index+1])
  }
  if(S.lastMatch&&S.gps)return travelDirection(S.lastMatch,S.gps)==="forward"?S.lastMatch.roadBearing:(S.lastMatch.roadBearing+180)%360;
  return S.heading||0
}
function geoToLocal(origin,heading,p){const d=haversineM(origin,p),a=signedAngle(heading,bearing(origin,p));return{side:Math.sin(rad(a))*d,forward:Math.cos(rad(a))*d}}
function scenePath(maxM=280){
  if(S.demo){
    const out=[];for(let f=0;f<=maxM;f+=12){const bend=Math.sin((f/115)+(S.demoT||0)*.05)*Math.min(10,f*.035);out.push({side:bend,forward:f})}return out
  }
  if(!S.gps)return[{side:0,forward:0},{side:0,forward:maxM}];
  const heading=sceneHeading(),geo=[];
  if(S.routeCoords.length){
    const p=routeProjection(S.gps,S.lastRouteAlong);
    if(p){geo.push(p.nearest);for(let i=p.index+1;i<S.routeCoords.length&&geo.length<100;i++)geo.push(S.routeCoords[i])}
  }else if(S.lastMatch){
    const m=S.lastMatch,coords=m.road.coords,dir=travelDirection(m,S.gps),i=m.segmentIndex??0;geo.push(m.nearest);
    if(dir==="forward")for(let j=i+1;j<coords.length&&geo.length<90;j++)geo.push(coords[j]);
    else for(let j=i;j>=0&&geo.length<90;j--)geo.push(coords[j])
  }
  if(geo.length<2)return[{side:0,forward:0},{side:0,forward:maxM}];
  const first=geoToLocal(S.gps,heading,geo[0]),acc=S.rawGps?.accuracy??S.gps.accuracy??30,trust=clamp((S.matchQuality-45)/45,0,1)*clamp((12-acc)/8,0,1),centerCorrection=first.side*(1-trust);
  const raw=[{side:clamp(first.side-centerCorrection,-14,14),forward:0}];let cum=0,prev=geo[0];
  for(let i=1;i<geo.length;i++){
    const p=geo[i];cum+=haversineM(prev,p);prev=p;if(cum>maxM+35)break;
    const local=geoToLocal(S.gps,heading,p),side=local.side-centerCorrection;if(Math.abs(side)<190)raw.push({side,forward:cum})
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
function drawEnvironment(c,w,h,hz,heading){
  const day=isDayScene(),pos=S.demo?null:S.gps;if(!pos||!S.environment.length){drawFallbackCity(c,w,h,hz);return}
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
      const footprint=o.footprint||10,bw=clamp(footprint*p.ppm*.72,7,135),bh=clamp(o.height*p.ppm*1.25,9,h*.46);
      c.fillStyle=day?(o.forward<70?"#8b969a":"#78858a"):(o.forward<70?"#46545c":"#35434b");c.fillRect(p.x-bw/2,p.y-bh,bw,bh);
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
  if(S.demo||!S.gps)return;
  for(const o of visibleEnvironment(S.gps,heading,100).filter(x=>x.kind==="crossing").slice(0,3)){
    const p=roadScreenPoint({side:0,forward:o.forward},w,h,hz),half=CFG.laneWidthM*Math.max(1,total)/2*p.ppm;
    c.save();c.strokeStyle="rgba(255,255,255,.88)";c.lineWidth=Math.max(2,p.ppm*.22);
    for(let i=-3;i<=3;i++){const yy=p.y+i*Math.max(2,p.ppm*.26);c.beginPath();c.moveTo(p.x-half,yy);c.lineTo(p.x+half,yy);c.stroke()}
    c.restore()
  }
}
function drawMappedJunctions(c,w,h,hz,heading,path,total){
  if(S.demo||!S.gps||!S.junctions.length)return;
  const candidates=[];
  for(const j of S.junctions){
    const local=geoToLocal(S.gps,heading,j);if(local.forward<18||local.forward>150||Math.abs(local.side)>45)continue;
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
function drawSignal(c,p,demoCount){
  c.fillStyle="#090b0d";c.fillRect(p.x-8,p.y-44,16,42);
  if(Number.isFinite(demoCount)){c.fillStyle="#ef5050";c.beginPath();c.arc(p.x,p.y-34,5,0,Math.PI*2);c.fill();c.fillStyle="#fff";c.font="900 10px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.ceil(demoCount)}s*`,p.x,p.y+14)}
  else{c.fillStyle="#59666d";for(let i=0;i<3;i++){c.beginPath();c.arc(p.x,p.y-34+i*12,4,0,Math.PI*2);c.fill()}}
}
function sceneRoadLayout(d){
  const current=Math.max(1,d.total||1),tags=S.lastMatch?.road?.tags||{},oneway=["yes","1","true","-1"].includes(String(tags.oneway||"").toLowerCase());
  if(oneway)return{visualTotal:current,ownTotal:current,ownOffset:0,divider:null};
  const dir=S.lastLane?.dir||"forward",opp=laneCount(tags,dir==="forward"?"backward":"forward"),full=positiveInt(tags.lanes)||current+opp;
  if(full>current&&opp>0)return{visualTotal:full,ownTotal:current,ownOffset:Math.max(0,full-current),divider:Math.max(0,full-current)};
  return{visualTotal:current,ownTotal:current,ownOffset:0,divider:null}
}
function draw3D(d={}){
  const cv=$("drive"),r=cv.getBoundingClientRect(),D=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);
  cv.width=Math.round(w*D);cv.height=Math.round(h*D);const c=cv.getContext("2d");c.setTransform(D,0,0,D,0,0);
  const hz=h*.29,total=Math.max(1,d.total||3),rec=clamp(d.recommended||d.lane||1,1,total),layout=sceneRoadLayout(d),visualTotal=layout.visualTotal,heading=sceneHeading(),path=scenePath(280);
  const day=isDayScene(),g=c.createLinearGradient(0,0,0,hz);
  g.addColorStop(0,day?"#77a8bd":"#0d1a22");g.addColorStop(1,day?"#c1d9df":"#263944");c.fillStyle=g;c.fillRect(0,0,w,hz);
  if(day){c.fillStyle="rgba(255,244,190,.55)";c.beginPath();c.arc(w*.82,hz*.25,18,0,Math.PI*2);c.fill()}
  c.fillStyle=day?"#74817b":"#29353a";c.fillRect(0,hz,w,h-hz);
  drawEnvironment(c,w,h,hz,heading);
  const roadHalf=CFG.laneWidthM*visualTotal/2,sidewalk=1.8;
  const walkLeft=offsetScreenPath(path,-roadHalf-sidewalk,w,h,hz),roadLeft=offsetScreenPath(path,-roadHalf,w,h,hz),roadRight=offsetScreenPath(path,roadHalf,w,h,hz),walkRight=offsetScreenPath(path,roadHalf+sidewalk,w,h,hz);
  poly(c,[...walkLeft,...roadLeft.slice().reverse()],day?"#92999a":"#596267");poly(c,[...roadRight,...walkRight.slice().reverse()],day?"#92999a":"#596267");
  poly(c,[...roadLeft,...roadRight.slice().reverse()],roadSurfaceColor());
  const cyc=cycleLaneSides();
  if(cyc.left)poly(c,[...offsetScreenPath(path,-roadHalf-1.45,w,h,hz),...offsetScreenPath(path,-roadHalf-.18,w,h,hz).reverse()],day?"#5f8f79":"#315647");
  if(cyc.right)poly(c,[...offsetScreenPath(path,roadHalf+.18,w,h,hz),...offsetScreenPath(path,roadHalf+1.45,w,h,hz).reverse()],day?"#5f8f79":"#315647");
  drawPathLine(c,roadLeft,"#e7ecee",2);drawPathLine(c,roadRight,"#e7ecee",2);
  const laneW=CFG.laneWidthM,visualRec=layout.ownOffset+rec,leftOffset=-roadHalf+(visualRec-1)*laneW,rightOffset=leftOffset+laneW;
  c.globalAlpha=.20;poly(c,[...offsetScreenPath(path,leftOffset,w,h,hz),...offsetScreenPath(path,rightOffset,w,h,hz).reverse()],"#38e88c");c.globalAlpha=1;
  for(let i=1;i<visualTotal;i++){
    const divider=layout.divider===i;
    drawPathLine(c,offsetScreenPath(path,-roadHalf+i*laneW,w,h,hz),divider?"#f2f2f2":"#d9dfe2",divider?2.5:2,divider?[]:[10,13])
  }
  drawCrossings(c,w,h,hz,heading,visualTotal);drawMappedJunctions(c,w,h,hz,heading,path,visualTotal);drawJunctionGeometry(c,w,h,hz,d,path,visualTotal);
  const arrowP=screenAtForward(path,18,w,h,hz);
  for(let i=1;i<=total;i++){const vi=layout.ownOffset+i,x=arrowP.x+(-roadHalf+(vi-.5)*laneW)*arrowP.ppm;arrow(c,x,Math.min(h*.73,arrowP.y),i===rec,d.turn||"through")}
  if(Number.isFinite(d.distance)){const p=screenAtForward(path,clamp(d.distance,18,190),w,h,hz);c.fillStyle="#fff";c.font="900 12px -apple-system,Arial";c.textAlign="center";c.fillText(`${Math.round(d.distance)} m`,p.x,p.y-12)}
  if(d.demo){const p=screenAtForward(path,70,w,h,hz);drawSignal(c,p,d.signal)}
  else if(d.signal){const p=screenAtForward(path,clamp(d.signal.distance||80,25,180),w,h,hz);drawSignal(c,p,null)}
}
function bind(){
  $("mapBtn").onclick=()=>setView("map");$("driveBtn").onclick=()=>setView("drive");$("gpsBtn").onclick=startGps;$("visionBtn").onclick=toggleVision;$("demoBtn").onclick=startDemo;
  $("allowGps").onclick=startGps;$("later").onclick=()=>$("permission")?.remove();$("closeVision").onclick=closeVision;$("clearRoute").onclick=clearRoute;$("streetRef").onclick=openStreetReference;
  $("searchForm").onsubmit=searchDestinationQuery;$("recenterBtn").onclick=recenterMap;$("voiceBtn").onclick=toggleVoice;$("diagBtn").onclick=toggleDiag;$("closeDiag").onclick=toggleDiag;$("recordBtn").onclick=toggleRecording;$("exportBtn").onclick=exportTrack;
  $("searchInput").addEventListener("input",()=>{if($("searchInput").value.trim().length<3)clearSearchResults()});
  window.addEventListener("online",()=>setStatus("Connexion rétablie"));
  window.addEventListener("offline",()=>setStatus("Hors ligne · GPS et caches locaux restent disponibles"));
  window.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.view==="map")setTimeout(()=>S.map.invalidateSize(),80)});
  window.addEventListener("resize",()=>{if(S.view==="drive")draw3D({lane:S.lastLane?.index||2,total:S.lastLane?.total||3,recommended:S.lastNav?recommendedLane(S.lastLane,S.lastNav.turn)||(S.lastLane?.index||2):(S.lastLane?.index||2),turn:S.lastNav?.turn||"through",distance:S.lastNav?.distance,arrived:S.lastNav?.arrived,signal:S.gps?relevantSignal(S.gps,S.lastMatch):null})})
}
async function boot(){
  bind();initMap();setView("map");setStatus("BETA 8 · moteur 3D route réelle · active le GPS");
  if("serviceWorker"in navigator)try{
    const regs=await navigator.serviceWorker.getRegistrations();
    for(const reg of regs){const url=reg.active?.scriptURL||reg.waiting?.scriptURL||reg.installing?.scriptURL||"";if(url&&!url.includes("v=8.0.0"))await reg.unregister()}
    if("caches"in window){for(const key of await caches.keys())if(key.startsWith("md-beta-")&&key!=="md-beta-8.0.0")await caches.delete(key)}
    await navigator.serviceWorker.register("./sw.js?v=8.0.0",{updateViaCache:"none"})
  }catch(e){}
}
boot();
})();
