/* Service worker: a mailbox between the page and the Python worker.

   While a program runs, its worker is busy and cannot receive messages, so a key press or a click made during a `while True:`
   animation loop would never reach it. Instead the page drops those events in this mailbox, and the running program reads
   them with a synchronous request (runner.mailbox) each time it updates its window. That works on any static host: it needs
   no special server headers (SharedArrayBuffer would), only a browser with service workers, https or localhost.

   Nothing is cached and every other request goes straight to the network. If service workers are unavailable (a private
   window in Firefox, an old browser) the app still works; programs just don't see events until they finish. */

const MAX = 500; // events kept per library if a program never reads them
const HOLD = 20000; // ms a waiting request (?wait=1, input()) is held open before it is answered with [] (the worker then asks again)
const boxes = {}; // library name -> events not yet read
const waiting = {}; // library name -> resolve() of a held request: input() waits for the line typed in the console (box "__input")

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim())); // take over the page that registered us, no reload needed

// page -> mailbox: {lib, ev} adds an event, {lib, clear: true} empties the box (a new run starts with nothing waiting)
self.addEventListener('message', ({ data }) => {
  if (!data || typeof data.lib !== 'string') return;
  if (data.clear) { delete boxes[data.lib]; return; }
  if (waiting[data.lib]) { waiting[data.lib]([data.ev]); return; } // someone is waiting for exactly this: hand it over
  const box = (boxes[data.lib] ||= []);
  box.push(data.ev);
  if (box.length > MAX) box.shift();
});

// Python worker <- mailbox: GET <folder>/__mailbox?lib=<name> answers with the waiting events (a JSON array) and empties the box.
// With &wait=1 an empty box doesn't answer at once: the request is held until an event arrives or HOLD ms pass (input() uses this).
const answer = events => new Response(JSON.stringify(events), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (!u.pathname.endsWith('/__mailbox')) return;
  const lib = u.searchParams.get('lib'), events = boxes[lib] || [];
  delete boxes[lib];
  if (events.length || !u.searchParams.has('wait')) return e.respondWith(answer(events));
  waiting[lib]?.([]); // a request left over from a stopped program
  e.respondWith(new Promise(resolve => {
    const done = evs => { clearTimeout(t); if (waiting[lib] === done) delete waiting[lib]; resolve(answer(evs)); };
    const t = setTimeout(() => done([]), HOLD);
    waiting[lib] = done;
  }));
});
