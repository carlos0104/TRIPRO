// TriPro · service worker
// Guarda só a "casca" do app (página, ícones, biblioteca). Dados vêm sempre do Supabase, ao vivo.
const VERSAO = 'tripro-v14';
const CASCA = ['./', './index.html', './manifest.webmanifest', './icons/logo-mark.png', './icons/google-g.png', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA.map(u => new Request(u, {cache:'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.hostname.endsWith('supabase.co')) return;              // login e dados: sempre pela rede
  if (r.mode === 'navigate'){                                     // página: rede primeiro, cópia offline se cair
    e.respondWith(fetch(r.url, {cache:'no-cache', credentials:'same-origin'}).then(res => { const c = res.clone(); caches.open(VERSAO).then(x => x.put('./index.html', c)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  if (u.origin === location.origin || r.url === LIB){             // estáticos: cache primeiro
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok){ const c = res.clone(); caches.open(VERSAO).then(x => x.put(r, c)); } return res; })));
  }
});

// notificações no celular
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x){ d = {titulo:'TriPro', texto:e.data ? e.data.text() : ''}; }
  const tarefas = [self.registration.showNotification(d.titulo || 'TriPro', {body:d.texto || '', icon:'icons/icon-192.png', badge:'icons/badge-96.png', tag:d.tag || 'tripro', renotify:true, data:{url:d.url || './'}})];
  if (d.nao_lidas != null && self.navigator && 'setAppBadge' in self.navigator) tarefas.push(d.nao_lidas ? self.navigator.setAppBadge(d.nao_lidas) : self.navigator.clearAppBadge());
  e.waitUntil(Promise.all(tarefas).catch(() => {}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(cs => {
    const c = cs.find(k => k.url.startsWith(self.registration.scope));
    if (c){ return c.focus().then(w => w && w.navigate ? w.navigate(alvo).catch(() => w) : w); }
    return self.clients.openWindow(alvo);
  }));
});
