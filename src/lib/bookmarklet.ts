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
const SOURCE = `(function(){
var API=__API__,TOKEN=__TOKEN__,MODE=__MODE__;
var ANCHOR=/\\b22\\d{8}\\b/g;
function collect(win,out,depth){
if(depth>5)return;
var doc;try{doc=win.document;}catch(e){return;}
try{var t=(doc.body&&(doc.body.innerText||doc.body.textContent))||'';if(t)out.push(t);}catch(e){}
var fr;try{fr=win.frames;}catch(e){return;}
for(var i=0;i<fr.length;i++){try{collect(fr[i],out,depth+1);}catch(e){}}
}
var found=[];collect(window,found,0);
var best='',n=0;
for(var i=0;i<found.length;i++){var m=found[i].match(ANCHOR);var c=m?m.length:0;if(c>n){n=c;best=found[i];}}
if(!n){alert('Working Book\\n\\nAucune ligne de planning trouvee sur cette page.\\n\\n- Lancez la recherche dans l Operator Mashup avant de cliquer.\\n- Si le rapport est dans un cadre : clic droit dessus, "Ce cadre" puis "Afficher uniquement ce cadre", et recliquez.');return;}
function done(r){
if(!r.ok){alert('Working Book\\n\\nEchec de l import (' + r.status + ' ' + (r.body.error||'') + ').' + (r.body.error==='no_records'?'\\n\\nLa page a bien ete lue mais aucune ligne n a pu etre decodee.':''));return;}
var b=r.body;
var page=b.totalPages&&b.totalPages>1?'\\n\\nPage ' + b.currentPage + '/' + b.totalPages + ' : passez a la page suivante et recliquez pour completer.':'';
alert('Working Book\\n\\n' + b.imported + ' lignes lues (' + (b.mode==='append'?'ajoutees au rapport':'rapport remplace') + ').\\nRapport : ' + b.records + ' lignes, ' + b.schedules + ' schedules.' + page);
}
function fallback(err){
var msg='Working Book\\n\\nEnvoi impossible : ' + err + '.';
try{navigator.clipboard.writeText(best).then(function(){alert(msg + '\\n\\nLe rapport a ete copie dans le presse-papiers : collez-le dans Working Book, onglet Planning, bouton Importer.');},function(){alert(msg);});}catch(e){alert(msg);}
}
var h={'Content-Type':'application/json'};
if(TOKEN)h['X-WB-Token']=TOKEN;
fetch(API + '/api/schedules/ingest',{method:'POST',headers:h,body:JSON.stringify({text:best,mode:MODE})}).then(function(res){
return res.text().then(function(raw){var body={};try{body=JSON.parse(raw);}catch(e){}return{ok:res.ok,status:res.status,body:body};});
}).then(done).catch(fallback);
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
