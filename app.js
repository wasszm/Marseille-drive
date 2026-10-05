import * as maplibregl from "https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";
import * as turf from "https://cdn.jsdelivr.net/npm/@turf/turf@7.4.0/+esm";

const CFG={center:[5.4140,43.2858],zoom:15.1,bbox:"43.262,5.382,43.305,5.442",maxDistanceM:35,laneWidthM:3.2,router:"https://router.project-osrm.org/route/v1/driving"};
const S={roads:[],signals:[],pos:null,heading:0,following:true,route:null};

const $=id=>document.getElementById(id);
const map=new maplibregl.Map({container:"map",style:"https://tiles.openfreemap.org/styles/liberty",center:CFG.center,zoom:CFG.zoom,pitch:58,bearing:0,antialias:true});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),"bottom-right");

const pt=c=>turf.point(c),ln=(c,p={})=>turf.lineString(c,p),fc=f=>({type:"FeatureCollection",features:f});
const pipe=v=>typeof v==="string"?v.split("|"):[],num=v=>{const n=Number.parseInt(v,10);return Number.isFinite(n)&&n>0?n:0};
function laneCount(tags,dir="forward"){const k=dir==="forward"?"lanes:forward":"lanes:backward";return num(tags[k]||tags.lanes)}
function laneTurns(tags,dir="forward"){const a=pipe(tags[`turn:lanes:${dir}`]||tags["turn:lanes"]);return a.length?a:Array.from({length:laneCount(tags,dir)||1},()=> "through")}
function angle(a,b){return Math.abs((a-b+180)%360-180)}
function roadName(r){return r.tags.name||r.tags.ref||r.tags.highway||"Route inconnue"}

async function loadOSM(){
 const q=`[out:json][timeout:45];(way["highway"](${CFG.bbox});node["highway"="traffic_signals"](${CFG.bbox}););out geom tags;`;
 const res=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:"data="+encodeURIComponent(q)});
 if(!res.ok)throw new Error("Overpass HTTP "+res.status);
 const d=await res.json();S.roads=[];S.signals=[];
 for(const e of d.elements||[]){
   if(e.type==="way"&&e.tags?.highway&&e.geometry?.length>=2)S.roads.push({id:String(e.id),tags:e.tags,coords:e.geometry.map(p=>[p.lon,p.lat])});
   if(e.type==="node"&&e.tags?.highway==="traffic_signals")S.signals.push({id:String(e.id),coord:[e.lon,e.lat],tags:e.tags});
 }
 render();
 $("instruction").textContent=`${S.roads.length} routes OSM`;
 $("detail").textContent=`${S.signals.length} feux cartographiés · lanes/turn:lanes analysés`;
}
function render(){
 const roadFeatures=S.roads.map(r=>ln(r.coords,r.tags)),sigFeatures=S.signals.map(s=>pt(s.coord,{id:s.id}));
 if(map.getSource("roads"))map.getSource("roads").setData(fc(roadFeatures));else{
  map.addSource("roads",{type:"geojson",data:fc(roadFeatures)});
  map.addLayer({id:"road-casing",type:"line",source:"roads",paint:{"line-color":"#12171b","line-width":["interpolate",["linear"],["zoom"],12,4,17,10],"line-opacity":.82}});
  map.addLayer({id:"roads",type:"line",source:"roads",paint:{"line-color":["case",["in",["get","highway"],"primary","trunk","motorway"],"#77838a","#9ba5aa"],"line-width":["interpolate",["linear"],["zoom"],12,2,17,6],"line-opacity":.76}});
 }
 if(map.getSource("signals"))map.getSource("signals").setData(fc(sigFeatures));else{
  map.addSource("signals",{type:"geojson",data:fc(sigFeatures)});
  map.addLayer({id:"signals",type:"circle",source:"signals",paint:{"circle-radius":5,"circle-color":"#ef4c4c","circle-stroke-color":"#fff","circle-stroke-width":1.5}});
 }
}
function nearest(pos){
 const p=pt([pos.lng,pos.lat]);let best=null;
 for(const r of S.roads){const np=turf.nearestPointOnLine(ln(r.coords,r.tags),p,{units:"kilometers"});const d=np.properties.dist*1000;if(d>CFG.maxDistanceM)continue;
  const i=np.properties.index||0,a=r.coords[Math.min(i,r.coords.length-2)],b=r.coords[Math.min(i+1,r.coords.length-1)],rb=turf.bearing(pt(a),pt(b));
  const score=d+(pos.speed>2?angle(pos.heading,rb)/15:0);if(!best||score<best.score)best={r,np,d,rb,score};
 }return best;
}
function lateral(m,pos,rb){const d=turf.distance(pt(m.np.geometry.coordinates),pt([pos.lng,pos.lat]),{units:"kilometers"})*1000;const b=turf.bearing(pt(m.np.geometry.coordinates),pt([pos.lng,pos.lat]));return Math.sin((b-rb)*Math.PI/180)*d}
function match(pos){
 const m=nearest(pos);if(!m)return null;
 const dir=m.r.tags.oneway==="yes"||m.r.tags.oneway==="1"||angle(pos.heading,m.rb)<=90?"forward":"backward";
 const total=laneCount(m.r.tags,dir);if(!total)return {m,total:0,index:null,confidence:Math.max(0,100-m.d*7)};
 const rb=dir==="forward"?m.rb:(m.rb+180)%360;
 const off=lateral(m,pos,rb),ratio=Math.max(-.49,Math.min(.49,off/(total*CFG.laneWidthM)));
 const index=Math.max(1,Math.min(total,Math.floor((ratio+.5)*total)+1));
 const confidence=Math.max(0,Math.min(100,100-m.d*7-angle(pos.heading,rb)*.7));
 return {m,total,index,confidence,dir,turns:laneTurns(m.r.tags,dir)};
}
function nearestSignal(pos){let b=null;for(const s of S.signals){const d=turf.distance(pt([pos.lng,pos.lat]),pt(s.coord),{units:"kilometers"})*1000;if(d<300&&(!b||d<b.d))b={...s,d}}return b}
function update(pos){
 S.pos=pos;$("speed").textContent=Math.round(pos.speed*3.6);
 const m=match(pos);if(!m){$("lane").textContent="—";$("conf").textContent="—";$("road").textContent="—";$("advice").textContent="Voie à déterminer";return}
 $("lane").textContent=m.index?`${m.index}/${m.total}`:"—";$("conf").textContent=Math.round(m.confidence)+"%";$("road").textContent=roadName(m.m.r);
 const rec=m.index; $("advice").textContent=rec?`🟢 RESTE VOIE ${rec}/${m.total}`:"Voie à confirmer";
 const s=nearestSignal(pos);$("signal").textContent=s?`${Math.round(s.d)} m`:"—";
 $("instruction").textContent=roadName(m.m.r);$("detail").textContent=m.total?`${m.total} voie(s) · ${m.dir} · route à ${Math.round(m.m.d)} m`:"Nombre de voies OSM non renseigné";
 if(S.following)map.easeTo({center:[pos.lng,pos.lat],bearing:pos.heading||0,zoom:16.7,pitch:58,duration:300});
}
function gps(){if(!navigator.geolocation){$("detail").textContent="Géolocalisation indisponible";return}
 navigator.geolocation.watchPosition(p=>{const h=p.coords.heading!=null&&p.coords.heading>=0?p.coords.heading:S.heading;S.heading=h;update({lng:p.coords.longitude,lat:p.coords.latitude,speed:Math.max(0,p.coords.speed||0),heading:h,accuracy:p.coords.accuracy||999})},
 e=>$("detail").textContent="GPS : "+e.message,{enableHighAccuracy:true,maximumAge:1000,timeout:10000});
}
async function compass(){try{if(typeof DeviceOrientationEvent?.requestPermission==="function"&&await DeviceOrientationEvent.requestPermission()!=="granted")throw 0;window.addEventListener("deviceorientationabsolute",e=>{if(typeof e.alpha==="number"){S.heading=(360-e.alpha)%360;if(S.pos)update({...S.pos,heading:S.heading})}},true);$("compass").textContent="🧭 Actif"}catch{$("detail").textContent="Compas non activé."}}
async function camera(){const p=$("cameraPanel");if(!p.hidden){$("video").srcObject?.getTracks().forEach(t=>t.stop());p.hidden=true;return}try{$("video").srcObject=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});p.hidden=false}catch{$("detail").textContent="Caméra non disponible ou permission refusée."}}
async function routeTo(dest){
 if(!S.pos)throw Error("GPS non disponible.");
 const o=[S.pos.lng,S.pos.lat];const url=`${CFG.router}/${o[0]},${o[1]};${dest[0]},${dest[1]}?overview=full&geometries=geojson&steps=true`;
 const r=await fetch(url);if(!r.ok)throw Error("Routeur indisponible");
 const d=await r.json();if(d.code!=="Ok")throw Error("Aucun itinéraire");
 S.route=d.routes[0];
 const data=fc([ln(S.route.geometry.coordinates,{route:true})]);
 if(map.getSource("route"))map.getSource("route").setData(data);else{map.addSource("route",{type:"geojson",data});map.addLayer({id:"route-casing",type:"line",source:"route",paint:{"line-color":"#11161a","line-width":10,"line-opacity":.85}});map.addLayer({id:"route",type:"line",source:"route",paint:{"line-color":"#fff","line-width":6}})}
 $("instruction").textContent=`Itinéraire ${Math.round(S.route.distance)} m`;$("detail").textContent=`${Math.round(S.route.duration/60)} min · tape à nouveau la carte pour remplacer la destination`;
}
function demo(){const fake={lng:5.414,lat:43.2858,speed:12,heading:0};update(fake);$("detail").textContent="Mode démo logique : connecte le GPS pour la position réelle."}
map.on("load",async()=>{$("follow").onclick=()=>{S.following=!S.following;$("follow").textContent=S.following?"🎯 Suivre":"✋ Libre"};$("compass").onclick=compass;$("camera").onclick=camera;$("demo").onclick=demo;
 $("closeRoute").onclick=()=>$("search").style.display="none";
 map.on("click",async e=>{try{await routeTo([e.lngLat.lng,e.lngLat.lat])}catch(err){$("detail").textContent=err.message}});
 gps();try{await loadOSM()}catch(e){$("detail").textContent="OSM : "+e.message}
 if("serviceWorker" in navigator)try{await navigator.serviceWorker.register("./sw.js")}catch(_){}
});
