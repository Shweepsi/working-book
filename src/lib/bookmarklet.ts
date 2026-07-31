// Builder for the "Import direct" bookmarklet.
//
// The operator drops this on their bookmarks bar and clicks it while the
// Operator Mashup is on screen, already authenticated. It reads the report out
// of the page it is standing on and POSTs the raw text to /api/schedules/ingest,
// which parses it with the very same parser the paste sheet uses.
//
// Everything the bookmarklet needs is baked in at generation time — it runs on
// the Infor origin and has no way to ask the app for anything.

export type IngestMode = 'auto' | 'append' | 'replace';

export const INGEST_MODES: readonly { key: IngestMode; label: string; help: string }[] = [
  {
    key: 'auto',
    label: 'Auto',
    help: 'La page 1 remplace le rapport, les suivantes s’y ajoutent. À laisser tel quel.',
  },
  {
    key: 'append',
    label: 'Ajouter',
    help: 'Ajoute toujours au rapport existant, sans jamais le remplacer.',
  },
  {
    key: 'replace',
    label: 'Remplacer',
    help: 'Remplace toujours le rapport, même sur une page 2. Un seul clic par import.',
  },
];

// Written as ES5 in one expression: it has to survive being pasted into a
// bookmark, so no arrow functions, no template literals, no optional chaining.
// `__API__` / `__TOKEN__` / `__MODE__` are substituted with JSON literals.
//
// Backslashes are doubled: this is a TS template literal, so `\\d` here is the
// `\d` the browser finally sees.
//
// Two ways in, tried in that order:
//
//  1. Scrape the page. Works when the mashup is the top document, or when it
//     sits in a same-origin frame.
//  2. Read the clipboard. On the real portal the M3 grid is served from a
//     different host than mingle-portal, so the browser blocks the top frame
//     from reading it — no bookmarklet can get around that, it is the
//     same-origin policy doing its job. The operator copies the grid instead
//     (Ctrl+A, Ctrl+C, which is where they already are) and the favourite
//     takes it from there: still one click, still no tab switch, and the
//     result goes through the exact same parse-and-store path.
//
// The clipboard route confirms before sending — unlike a scrape, its contents
// may be an old copy the operator never meant to import.
const SOURCE = `(function(){
var API=__API__,TOKEN=__TOKEN__,MODE=__MODE__;
var ANCHOR=/\\b22\\d{8}\\b/g;
var seen=0,blocked=0;
function collect(win,out,depth){
if(depth>5)return;
seen++;
var doc;try{doc=win.document;}catch(e){blocked++;return;}
try{var t=(doc.body&&(doc.body.innerText||doc.body.textContent))||'';if(t)out.push(t);}catch(e){blocked++;}
var fr;try{fr=win.frames;}catch(e){return;}
for(var i=0;i<fr.length;i++){try{collect(fr[i],out,depth+1);}catch(e){blocked++;}}
}
function score(t){var m=t?t.match(ANCHOR):null;return m?m.length:0;}
function help(){
return 'Working Book\\n\\nAucune ligne de planning lisible sur cette page.\\n\\nLe rapport est affiche dans un cadre d un autre domaine (' + blocked + ' cadre(s) protege(s) sur ' + seen + ') : le navigateur interdit au favori de le lire directement.\\n\\nA faire : cliquez dans le rapport, Ctrl+A puis Ctrl+C, et recliquez ce favori. Il prendra le rapport dans le presse-papiers.';
}
function done(r){
if(!r.ok){alert('Working Book\\n\\nEchec de l import (' + r.status + ' ' + (r.body.error||'') + ').' + (r.body.error==='no_records'?'\\n\\nLe texte a bien ete lu mais aucune ligne n a pu etre decodee : verifiez que le rapport PMS230 est bien affiche.':''));return;}
var b=r.body;
var page=b.totalPages&&b.totalPages>1?'\\n\\nPage ' + b.currentPage + '/' + b.totalPages + ' : passez a la page suivante et recliquez pour completer.':'';
alert('Working Book\\n\\n' + b.imported + ' lignes lues (' + (b.mode==='append'?'ajoutees au rapport':'rapport remplace') + ').\\nRapport : ' + b.records + ' lignes, ' + b.schedules + ' schedules.' + page);
}
function failed(err){
alert('Working Book\\n\\nEnvoi impossible : ' + err + '.\\n\\nLe rapport n a pas ete importe. Reessayez, ou collez-le dans Working Book, onglet Planning, bouton Importer.');
}
function send(text){
var h={'Content-Type':'application/json'};
if(TOKEN)h['X-WB-Token']=TOKEN;
fetch(API + '/api/schedules/ingest',{method:'POST',headers:h,body:JSON.stringify({text:text,mode:MODE})}).then(function(res){
return res.text().then(function(raw){var body={};try{body=JSON.parse(raw);}catch(e){}return{ok:res.ok,status:res.status,body:body};});
}).then(done).catch(failed);
}
function fromClipboard(){
if(!navigator.clipboard||!navigator.clipboard.readText){alert(help());return;}
navigator.clipboard.readText().then(function(t){
var c=score(t);
if(!c){alert(help());return;}
if(!confirm('Working Book\\n\\n' + c + ' lignes trouvees dans le presse-papiers.\\n\\nImporter ce contenu ?'))return;
send(t);
},function(){alert(help() + '\\n\\n(Lecture du presse-papiers refusee : autorisez-la dans la barre d adresse.)');});
}
var found=[];collect(window,found,0);
var best='',n=0;
for(var i=0;i<found.length;i++){var c=score(found[i]);if(c>n){n=c;best=found[i];}}
if(n)send(best);else fromClipboard();
})();`;

export interface BookmarkletOptions {
  apiBase: string;
  token: string;
  mode: IngestMode;
}

// The readable source, with the operator's settings substituted in. Shown in the
// sheet so nothing about what gets sent is hidden, and used to build the href.
export function bookmarkletSource({ apiBase, token, mode }: BookmarkletOptions): string {
  return SOURCE.replace('__API__', JSON.stringify(apiBase.replace(/\/+$/, '')))
    .replace('__TOKEN__', JSON.stringify(token.trim()))
    .replace('__MODE__', JSON.stringify(mode));
}

// The `javascript:` URL itself. Newlines and the rest are percent-encoded so the
// whole thing survives being stored as a bookmark URL.
export function bookmarkletHref(opts: BookmarkletOptions): string {
  return `javascript:${encodeURIComponent(bookmarkletSource(opts))}`;
}
