// Builder for the "Import direct" bookmarklet.
//
// The operator drops this on their bookmarks bar, then uses it from the
// Operator Mashup: Ctrl+A, Ctrl+C in the report, one click, done. What it saves
// over the paste sheet is the tab switch, the sheet, the paste and the button.
//
// It reads the clipboard and nothing else. Scraping the page would only ever
// work when the mashup is the top document — inside Mingle the M3 grid is
// served from a different host, and the same-origin policy bars any script in
// the top frame from reading it. Carrying a second path for that rare case cost
// more in explaining than it ever returned. Reading the page directly is what
// the browser extension is for (see extension/).
//
// Everything the bookmarklet needs is baked in at generation time — it runs on
// the Infor origin and has no way to ask the app for anything.

// Written as ES5 in one expression: it has to survive being pasted into a
// bookmark, so no arrow functions, no template literals, no optional chaining.
// `__API__` and `__TOKEN__` are substituted with JSON literals.
//
// Backslashes are doubled: this is a TS template literal, so `\\d` here is the
// `\d` the browser finally sees.
const SOURCE = `(function(){
var API=__API__,TOKEN=__TOKEN__;
var ANCHOR=/\\b22\\d{8}\\b/g;
function help(){
alert('Working Book\\n\\nLe presse-papiers ne contient pas de rapport.\\n\\nDans l Operator Mashup : cliquez dans le rapport, Ctrl+A puis Ctrl+C, et recliquez ce favori.');
}
function send(text){
var h={'Content-Type':'application/json'};
if(TOKEN)h['X-WB-Token']=TOKEN;
fetch(API + '/api/schedules/ingest',{method:'POST',headers:h,body:JSON.stringify({text:text})}).then(function(res){
return res.text().then(function(raw){var body={};try{body=JSON.parse(raw);}catch(e){}return{ok:res.ok,status:res.status,body:body};});
}).then(function(r){
if(!r.ok){alert('Working Book\\n\\nEchec de l import (' + r.status + ' ' + (r.body.error||'') + ').' + (r.body.error==='no_records'?'\\n\\nLe texte a bien ete lu mais aucune ligne n a pu etre decodee : verifiez que le rapport PMS230 est bien affiche.':''));return;}
alert('Working Book\\n\\n' + r.body.imported + ' lignes ajoutees.\\nRapport : ' + r.body.records + ' lignes, ' + r.body.schedules + ' schedules.');
}).catch(function(e){
alert('Working Book\\n\\nEnvoi impossible : ' + e + '.\\n\\nRien n a ete importe. Reessayez, ou collez le rapport dans Working Book, onglet Schedule, bouton Importer.');
});
}
if(!navigator.clipboard||!navigator.clipboard.readText){help();return;}
navigator.clipboard.readText().then(function(t){
var m=t?t.match(ANCHOR):null;
if(!m||!m.length){help();return;}
if(!confirm('Working Book\\n\\n' + m.length + ' lignes trouvees dans le presse-papiers.\\n\\nLes ajouter au rapport ?'))return;
send(t);
},function(){alert('Working Book\\n\\nLecture du presse-papiers refusee.\\n\\nAutorisez-la via l icone dans la barre d adresse, puis recliquez.');});
})();`;

export interface BookmarkletOptions {
  apiBase: string;
  token: string;
}

// The readable source, with the operator's settings substituted in. Shown in the
// sheet so nothing about what gets sent is hidden, and used to build the href.
export function bookmarkletSource({ apiBase, token }: BookmarkletOptions): string {
  return SOURCE.replace('__API__', JSON.stringify(apiBase.replace(/\/+$/, ''))).replace(
    '__TOKEN__',
    JSON.stringify(token.trim()),
  );
}

// The `javascript:` URL itself. Newlines and the rest are percent-encoded so the
// whole thing survives being stored as a bookmark URL.
export function bookmarkletHref(opts: BookmarkletOptions): string {
  return `javascript:${encodeURIComponent(bookmarkletSource(opts))}`;
}
