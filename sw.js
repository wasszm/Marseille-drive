const CACHE="md-beta-12.0.0";
const CORE=["./","./index.html","./styles.css?v=12.0.0","./app.js?v=12.0.0","./manifest.webmanifest?v=12.0","./icon.svg?v=12.0"];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})));
});

self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("md-beta-")&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting()});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin)return;

  if(e.request.mode==="navigate"){
    e.respondWith(
      fetch(new Request(e.request,{cache:"reload"}))
        .then(async r=>{const copy=r.clone();const c=await caches.open(CACHE);await c.put("./index.html",copy);return r})
        .catch(async()=>await caches.match("./index.html")||await caches.match("./"))
    );
    return;
  }

  e.respondWith(
    fetch(new Request(e.request,{cache:"reload"}))
      .then(async r=>{const copy=r.clone();const c=await caches.open(CACHE);await c.put(e.request,copy);return r})
      .catch(()=>caches.match(e.request))
  );
});