/* GameLab — interface statique sans compte.
   Sources : catalogue.json (jeux du dépôt), steam-data.json (dernier relevé GitHub Actions),
   localStorage (préférences et jeux ajoutés sur cet appareil uniquement). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORAGE = 'gamelab-preferences-v2';
  const STATUSES = { todo:'À faire', playing:'En cours', done:'Terminé' };
  const UNKNOWN = 'Prix indisponible';
  const currency = new Intl.NumberFormat('fr-FR',{ style:'currency', currency:'EUR' });
  const local = readSaved();
  let catalog = [];
  let snapshots = {};
  let latestRun = null;
  let selected = null;
  let toastTimeout;
  let games = [];

  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE));
      if (value && typeof value === 'object') return {
        edits: value.edits && typeof value.edits === 'object' && !Array.isArray(value.edits) ? value.edits : {},
        added: Array.isArray(value.added) ? value.added : [],
        hidden: Array.isArray(value.hidden) ? value.hidden : []
      };
    } catch (_) {}
    return { edits:{}, added:[], hidden:[] };
  }
  function save() {
    try { localStorage.setItem(STORAGE, JSON.stringify(local)); }
    catch (_) { toast('Stockage local bloqué : les changements ne seront pas conservés.'); }
  }
  function safeId(id) { return String(id || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80); }
  function toAppId(input) {
    const value = String(input || '').trim();
    if (/^\d{1,10}$/.test(value)) return Number(value);
    const match = value.match(/^https?:\/\/store\.steampowered\.com\/app\/(\d{1,10})(?:\/|\?|$)/i);
    return match ? Number(match[1]) : null;
  }
  function steamUrl(game) {
    return game.appid ? `https://store.steampowered.com/app/${game.appid}/?cc=fr` :
      `https://store.steampowered.com/search/?term=${encodeURIComponent(game.name)}&cc=fr`;
  }
  function coverUrl(game) {
    if (game.image && /^https:\/\/(?:shared(?:\.[a-z]+)?\.steamstatic\.com|cdn\.[a-z]+\.steamstatic\.com|steamcdn-a\.akamaihd\.net)\//.test(game.image)) return game.image;
    return game.appid ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg` : null;
  }
  function makeBase(raw, index, custom=false) {
    const appid = Number.isInteger(Number(raw.appid)) && Number(raw.appid)>0 ? Number(raw.appid) : null;
    const id = custom ? safeId(raw.id) : `steam-${appid || 'pending-'+index}`;
    return {
      id, appid, name: String(raw.name||'Jeu sans nom').slice(0,90),
      genre: String(raw.genre||'Coop / À découvrir').slice(0,90),
      players: String(raw.players||'Multijoueur').slice(0,70),
      description: String(raw.description||'À découvrir avec ton pote.').slice(0,700),
      image: String(raw.image||''), featuredIndex:index, custom,
      priceManual: Number.isFinite(raw.priceManual) && raw.priceManual>=0 ? raw.priceManual : null,
      status: STATUSES[raw.status] ? raw.status : 'todo', fav: Boolean(raw.fav)
    };
  }
  function rebuild() {
    const official = catalog.map((raw,index) => {
      const base = makeBase(raw,index);
      const override = local.edits[base.id];
      if (override && typeof override==='object') {
        for (const key of ['name','description','genre','players','image']) {
          if (typeof override[key]==='string') base[key] = override[key].slice(0,key==='description'?700:100);
        }
        if (Object.prototype.hasOwnProperty.call(override,'appid')) base.appid = toAppId(String(override.appid));
        if (Object.prototype.hasOwnProperty.call(override,'priceManual')) base.priceManual = isPrice(override.priceManual) ? Number(override.priceManual) : null;
        if (STATUSES[override.status]) base.status=override.status;
        base.fav=!!override.fav;
      }
      return base;
    }).filter(g=>!local.hidden.includes(g.id));
    const added = local.added.filter(raw=>raw && typeof raw.name==='string').map((raw,index)=>makeBase(raw,catalog.length+index,true));
    games = official.concat(added);
    render();
  }
  function isPrice(value) { return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value)>=0; }
  function snapshot(game) { return game.appid ? snapshots[String(game.appid)] || {} : {}; }
  function finalPrice(game) {
    const info = snapshot(game);
    if (info.available === true && info.currency === 'EUR' && isPrice(info.final)) return {value:Number(info.final), source:'steam', stale:isStale(info.checkedAt), info};
    if (isPrice(game.priceManual)) return {value:Number(game.priceManual), source:'manual', stale:false, info};
    return {value:null, source:'unknown', stale:false, info};
  }
  function isStale(iso) { const ts=Date.parse(iso);return !Number.isFinite(ts) || (Date.now()-ts) > 72*60*60*1000; }
  function euro(price) { return isPrice(price) ? currency.format(Number(price)) : UNKNOWN; }
  function discount(game) { const info=snapshot(game);return finalPrice(game).source==='steam' && Number(info.discountPercent)>0 ? Number(info.discountPercent) : 0; }
  function node(tag, className, text) { const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el; }
  function image(game, className='game-image') {
    const wrapper=node('div',className);
    const link=coverUrl(game);
    if (link) {
      const img=node('img');img.src=link;img.alt=`Pochette de ${game.name}`;img.loading='lazy';img.decoding='async';
      img.onerror=()=>{img.remove();if(!wrapper.querySelector('.image-fallback'))wrapper.append(node('div','image-fallback',game.name));};wrapper.append(img);
    } else wrapper.append(node('div','image-fallback',game.name));
    return wrapper;
  }
  function priceBadge(game,compact=false) {
    const p=finalPrice(game);
    const el=node('div',compact?'price-inline':'price-stack');
    el.append(node('strong',p.source==='unknown'?'price-unknown':'price-value',euro(p.value)));
    if (!compact) el.append(node('span','price-origin',p.source==='steam' ? (p.stale?'Ancien relevé Steam':'Relevé Steam') : p.source==='manual'?'Prix saisi manuellement':'Non renseigné'));
    return el;
  }
  function button(label, style, onClick, aria) {
    const el=node('button',style,label);el.type='button';if(aria)el.setAttribute('aria-label',aria);el.addEventListener('click',onClick);return el;
  }
  function applyChange(game, patch) {
    if (game.custom) {
      const entry=local.added.find(item=>item.id===game.id);
      if(entry) Object.assign(entry,patch);
    } else local.edits[game.id]={...local.edits[game.id],...patch};
    save();rebuild();
  }
  function gameCard(game) {
    const p=finalPrice(game);
    const article=node('article','game-card');
    const open=button('','cover-button',()=>openDetails(game),`Voir la fiche de ${game.name}`);
    open.append(image(game,'game-image'));
    const label=node('span','card-open-label','Voir la fiche ↗');open.append(label);
    article.append(open);
    const pct=discount(game);
    if(pct>0) article.append(node('span','discount-tag',`−${pct}%`));
    const heart=button(game.fav?'♥':'♡',`favorite ${game.fav?'is-fav':''}`,()=>applyChange(game,{fav:!game.fav}),game.fav?`Retirer ${game.name} des favoris`:`Ajouter ${game.name} aux favoris`);
    article.append(heart);
    const body=node('div','card-content');
    const eyebrow=node('div','card-eyebrow',game.genre);body.append(eyebrow);
    const name=button(game.name,'game-name',()=>openDetails(game));body.append(name);
    const meta=node('div','card-meta');meta.append(node('span','player-count',game.players),node('span',`status status-${game.status}`,STATUSES[game.status]));body.append(meta);
    const bottom=node('div','card-bottom');bottom.append(priceBadge(game));
    const right=node('div','card-bottom-actions');
    right.append(button('↗','round-btn',()=>window.open(steamUrl(game),'_blank','noopener,noreferrer'),`Voir ${game.name} sur Steam`));
    bottom.append(right);body.append(bottom);article.append(body);
    return article;
  }
  function visibleGames() {
    const q=$('search').value.trim().toLocaleLowerCase('fr-FR');
    const filter=$('filter').value;
    const sort=$('sort').value;
    const found=games.filter(g=>{
      const match = !q || [g.name,g.genre,g.description,g.players].some(v=>v.toLocaleLowerCase('fr-FR').includes(q));
      return match && (filter==='all' || (filter==='fav'?g.fav:filter==='deals'?discount(g)>0:g.status===filter));
    });
    found.sort((a,b)=>{
      if(sort==='name') return a.name.localeCompare(b.name,'fr');
      if(sort==='cheap'||sort==='expensive'){
        const pa=finalPrice(a).value,pb=finalPrice(b).value;
        if(pa===null&&pb!==null)return 1;
        if(pb===null&&pa!==null)return -1;
        if(pa!==null&&pb!==null&&pa!==pb)return sort==='cheap'?pa-pb:pb-pa;
      }
      if(sort==='discount' && discount(a)!==discount(b))return discount(b)-discount(a);
      return a.featuredIndex-b.featuredIndex;
    });
    return found;
  }
  function render() {
    const display=visibleGames();
    const frag=document.createDocumentFragment();display.forEach(g=>frag.append(gameCard(g)));
    $('grid').replaceChildren(frag);
    $('empty').hidden=display.length>0;
    $('shownCount').textContent=`${display.length} jeu${display.length>1?'x':''} affiché${display.length>1?'s':''}`;
    $('total').textContent=String(games.length);
    $('todo').textContent=String(games.filter(g=>g.status==='todo').length);
    $('favs').textContent=String(games.filter(g=>g.fav).length);
    const eligible=games.filter(g=>g.status!=='done');
    const known=eligible.map(finalPrice).filter(p=>p.value!==null);
    $('budget').textContent=known.length ? euro(known.reduce((n,p)=>n+p.value,0)) : '—';
    $('budget').title=`Somme des prix connus des ${known.length} jeux non terminés. ${eligible.length-known.length} prix manquant(s).`;
  }
  function openDetails(game) {
    selected=game.id;
    const snap=snapshot(game),price=finalPrice(game),pct=discount(game);
    const content=$('detailsContent');content.replaceChildren();
    const top=node('div','detail-hero');top.append(image(game,'detail-cover'));
    const close=button('✕','detail-close',()=> $('details').close(),'Fermer la fiche');top.append(close);
    if(pct>0)top.append(node('span','detail-discount',`−${pct}% sur Steam`));
    content.append(top);
    const inside=node('div','detail-body');
    inside.append(node('div','eyebrow',`${game.genre}  /  ${game.players}`));
    inside.append(node('h2','detail-title',game.name));
    inside.append(node('p','detail-description',game.description || snap.shortDescription || 'Pas encore de résumé.'));
    const properties=node('div','detail-properties');
    const pGroup=node('div');pGroup.append(node('span','property-label','PRIX ACTUEL AFFICHÉ'),priceBadge(game,true));
    if(price.source==='steam'&&pct>0&&isPrice(snap.initial))pGroup.append(node('span','old-price',`Au lieu de ${euro(snap.initial)}`));
    pGroup.append(node('small','price-subtitle',price.source==='steam' ? `${price.stale?'Tarif ancien • ':'Relevé Steam • '}${formatDate(snap.checkedAt)}` : price.source==='manual' ? 'Montant saisi manuellement, non vérifié' : 'Prix non confirmé sur Steam'));
    properties.append(pGroup);
    const sGroup=node('div');sGroup.append(node('span','property-label','VOTRE PROGRESSION'));
    const statusSelect=node('select','detail-status');
    Object.entries(STATUSES).forEach(([v,label])=>{const option=node('option',null,label);option.value=v;option.selected=v===game.status;statusSelect.append(option);});
    statusSelect.addEventListener('change',()=>{applyChange(game,{status:statusSelect.value});const current=games.find(g=>g.id===selected);if(current)openDetails(current);});
    sGroup.append(statusSelect);properties.append(sGroup);inside.append(properties);
    if(snap.releaseDate || snap.developer){
      const more=node('p','detail-extra',[snap.developer&&`Studio : ${snap.developer}`,snap.releaseDate&&`Sortie : ${snap.releaseDate}`].filter(Boolean).join('  •  '));inside.append(more);
    }
    const actions=node('div','detail-actions');
    const steam=node('a','btn btn-primary','Voir sur Steam ↗');steam.href=steamUrl(game);steam.target='_blank';steam.rel='noopener noreferrer';
    actions.append(steam,button(game.fav?'♥ Dans mes favoris':'♡ Ajouter aux favoris','btn btn-outline',()=>{applyChange(game,{fav:!game.fav});const current=games.find(g=>g.id===selected);if(current)openDetails(current);}));
    actions.append(button('Modifier','btn btn-quiet',()=>{$('details').close();openEdit(game);}),button('Supprimer','btn btn-danger',()=>removeGame(game)));
    inside.append(actions);content.append(inside);$('details').showModal();
  }
  function formatDate(iso) {
    const d=new Date(iso);return Number.isNaN(d.getTime())?'date indisponible':new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(d);
  }
  function removeGame(game) {
    if(!confirm(`Retirer « ${game.name} » de ta liste sur cet appareil ?`))return;
    if(game.custom)local.added=local.added.filter(g=>g.id!==game.id);
    else if(!local.hidden.includes(game.id))local.hidden.push(game.id);
    save();$('details').close();rebuild();toast('Jeu retiré de ta liste personnelle.');
  }
  function openEdit(game=null) {
    selected=game?.id||null;
    $('editTitle').textContent=game?'Modifier le jeu':'Ajouter un jeu';
    $('name').value=game?.name||'';
    $('steam').value=game?.appid?String(game.appid):'';
    $('description').value=game?.description||'';
    $('price').value=game?.priceManual??'';
    $('status').value=game?.status||'todo';
    $('editModal').showModal();
  }
  $('gameForm').addEventListener('submit',(e)=>{
    e.preventDefault();
    const name=$('name').value.trim(),steamRaw=$('steam').value.trim(),appId=toAppId(steamRaw);
    const description=$('description').value.trim();
    if(!name){toast('Indique le nom du jeu.');return;}
    if(steamRaw && !appId){toast('Utilise un lien Steam /app/1234/ ou un identifiant numérique.');return;}
    const rawPrice=$('price').value.trim();
    const p=rawPrice!==''?Number(rawPrice):null;
    if(p!==null&&(!Number.isFinite(p)||p<0)){toast('Prix manuel invalide.');return;}
    const data={name,appid:appId,description,priceManual:p,status:$('status').value};
    const existing=games.find(g=>g.id===selected);
    if(existing){applyChange(existing,data);toast('Jeu modifié.');}
    else {
      const duplicate=games.find(g=>appId&&g.appid===appId);
      if(duplicate){toast('Ce jeu figure déjà dans ta liste.');return;}
      local.added.push({...data,id:`local-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,genre:'Ajout personnel',players:'À découvrir',fav:false});
      save();rebuild();toast('Jeu ajouté à ton navigateur.');
    }
    $('editModal').close();
  });
  function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('visible'),3200);}
  function updateFeed() {
    const records=Object.values(snapshots).filter(p=>p.available===true&&p.currency==='EUR');
    const stale= !latestRun || isStale(latestRun);
    const f=$('feed');f.classList.toggle('feed-stale',stale);
    if (!latestRun) $('feedText').textContent='En attente du premier relevé Steam — lancez la GitHub Action « Actualiser Steam et publier ».';
    else if(stale) $('feedText').textContent=`Dernier relevé ancien (${formatDate(latestRun)}) · ${records.length} prix connus · tarifs à vérifier`;
    else $('feedText').textContent=`Relevé Steam FR du ${formatDate(latestRun)} · ${records.length} prix disponibles · mise à jour automatique`;
  }
  async function loadJSON(url) {
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function load() {
    try {
      const fetched=await loadJSON('./catalogue.json');
      if(!Array.isArray(fetched))throw Error('Catalogue invalide');
      catalog=fetched.filter(row=>row&&typeof row.name==='string').slice(0,250);
    }catch(e) {
      // file:// bloque fetch dans certains navigateurs : expliquer plutôt que masquer.
      $('feedText').textContent='Catalogue non chargé. Lance ce dossier avec Live Server dans VS Code.';
      $('grid').replaceChildren(node('p','load-error','Le catalogue est inaccessible. Ouvre le site avec Live Server ou GitHub Pages.'));
      return;
    }
    try {
      const data=await loadJSON('./steam-data.json');
      if(data && typeof data==='object' && data.games && typeof data.games==='object'){
        snapshots=data.games;latestRun=data.updatedAt||null;
      }
    }catch(_) {}
    rebuild();updateFeed();
  }
  function spin() {
    const pool=games.filter(g=>g.status!=='done');
    if(!pool.length){$('result').textContent='Ajoute un jeu pour lancer la roulette.';return;}
    const selectedGame=pool[Math.floor(Math.random()*pool.length)];
    const result=$('result');result.replaceChildren(node('span','result-label','LE JEU DE CE SOIR'),node('strong',null,selectedGame.name));
    result.append(button('Voir la fiche ↗','result-link',()=>openDetails(selectedGame)));
    $('decision').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function exportList() {
    const data={format:'gamelab-backup-v2',createdAt:new Date().toISOString(),catalogueEdits:local.edits,personalGames:local.added,hidden:local.hidden};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');
    a.href=url;a.download='gamelab-ma-liste.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importList(file) {
    try {
      if(file.size>500000)throw Error('Fichier trop volumineux');
      const data=JSON.parse(await file.text());
      if(data?.format!=='gamelab-backup-v2'||!Array.isArray(data.personalGames)||!Array.isArray(data.hidden)||!data.catalogueEdits||typeof data.catalogueEdits!=='object'||Array.isArray(data.catalogueEdits))throw Error('Format inconnu');
      if(data.personalGames.length>500||data.hidden.length>500)throw Error('Liste trop longue');
      if(!data.personalGames.every(g=>g&&typeof g.name==='string'&&g.name.length<=90&&typeof g.id==='string'))throw Error('Jeux invalides');
      if(!confirm('Remplacer tes favoris, statuts et jeux personnels par ceux de ce fichier ?'))return;
      local.edits=data.catalogueEdits;local.added=data.personalGames;local.hidden=data.hidden;
      save();rebuild();toast('Liste importée.');
    }catch(e){toast('Import impossible : '+(e.message||'fichier invalide'));}
  }
  $('addTop').onclick=()=>openEdit();$('addLibrary').onclick=()=>openEdit();
  $('search').addEventListener('input',render);$('filter').addEventListener('change',render);$('sort').addEventListener('change',render);
  $('spin').onclick=spin;$('spinHero').onclick=spin;
  $('export').onclick=exportList;
  $('import').onclick=()=>$('file').click();
  $('file').onchange=async(e)=>{const file=e.target.files?.[0];if(file)await importList(file);e.target.value='';};
  $('helpPrices').onclick=()=>$('infoModal').showModal();
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$(el.dataset.close).close());
  for(const modal of document.querySelectorAll('dialog')){
    modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
  }
  load();
})();
