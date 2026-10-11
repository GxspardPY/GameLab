/* GameLab partagé : authentification et données Supabase sécurisées par RLS. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const conf = window.GAMELAB_SUPABASE || {};
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(conf.url||'') && !String(conf.anonKey||'').startsWith('REMPLACER');
  const db = configured && window.supabase ? window.supabase.createClient(conf.url,conf.anonKey) : null;
  let account=null, room=null, roomRows=[] , roomChannel=null, pollTimer=null;
  const busyMsg = e => (e?.message || 'Une erreur est survenue');
  const STATUSES = { todo:'À faire', playing:'En cours', done:'Terminé' };
  const UNKNOWN = 'Prix indisponible';
  const currency = new Intl.NumberFormat('fr-FR',{ style:'currency', currency:'EUR' });
  // Ancienne version locale conservée uniquement pour compatibilité d'export ; la liste est maintenant dans Supabase.
  let catalog = [];
  let snapshots = {};
  let latestRun = null;
  let selected = null;
  let toastTimeout;
  let games = [];

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
    // Les données partagées proviennent exclusivement de Supabase.
    games = roomRows.map((raw,index)=>makeBase({
      id:raw.game_id, appid:raw.appid, name:raw.name, genre:raw.genre,
      players:raw.players, description:raw.description, image:raw.image,
      priceManual:raw.price_manual===null?null:Number(raw.price_manual),
      status:raw.status, fav:raw.fav
    },raw.sort_index??index,true));
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
  async function applyChange(game, patch) {
    if (!room || !db) return toast('Connecte-toi à ton groupe pour modifier la liste.');
    const allowed={name:'name',description:'description',genre:'genre',players:'players',
      image:'image',appid:'appid',priceManual:'price_manual',status:'status',fav:'fav'};
    const update={};
    Object.entries(patch).forEach(([key,value])=>{if(allowed[key])update[allowed[key]]=value;});
    try {
      const {error}=await db.from('room_games').update(update)
        .eq('room_id',room.id).eq('game_id',game.id);
      if(error)throw error;
      await refreshGames();
    } catch(e){toast('Modification non enregistrée : '+busyMsg(e));}
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
    statusSelect.addEventListener('change',async()=>{await applyChange(game,{status:statusSelect.value});const current=games.find(g=>g.id===selected);if(current)openDetails(current);});
    sGroup.append(statusSelect);properties.append(sGroup);inside.append(properties);
    if(snap.releaseDate || snap.developer){
      const more=node('p','detail-extra',[snap.developer&&`Studio : ${snap.developer}`,snap.releaseDate&&`Sortie : ${snap.releaseDate}`].filter(Boolean).join('  •  '));inside.append(more);
    }
    const actions=node('div','detail-actions');
    const steam=node('a','btn btn-primary','Voir sur Steam ↗');steam.href=steamUrl(game);steam.target='_blank';steam.rel='noopener noreferrer';
    actions.append(steam,button(game.fav?'♥ Dans mes favoris':'♡ Ajouter aux favoris','btn btn-outline',async()=>{await applyChange(game,{fav:!game.fav});const current=games.find(g=>g.id===selected);if(current)openDetails(current);}));
    actions.append(button('Modifier','btn btn-quiet',()=>{$('details').close();openEdit(game);}),button('Supprimer','btn btn-danger',()=>removeGame(game)));
    inside.append(actions);content.append(inside);$('details').showModal();
  }
  function formatDate(iso) {
    const d=new Date(iso);return Number.isNaN(d.getTime())?'date indisponible':new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(d);
  }
  async function removeGame(game) {
    if (!confirm(`Supprimer « ${game.name} » de la liste commune pour les deux joueurs ?`))return;
    try{
      const {error}=await db.from('room_games').delete().eq('room_id',room.id).eq('game_id',game.id);
      if(error)throw error;
      $('details').close();await refreshGames();toast('Jeu supprimé de la liste commune.');
    }catch(e){toast('Suppression impossible : '+busyMsg(e));}
  }
  function openEdit(game=null) {
    if(!room)return toast('Connecte-toi à un groupe pour modifier la liste.');
    selected=game?.id||null;
    $('editTitle').textContent=game?'Modifier le jeu':'Ajouter un jeu';
    $('name').value=game?.name||'';
    $('steam').value=game?.appid?String(game.appid):'';
    $('description').value=game?.description||'';
    $('price').value=game?.priceManual??'';
    $('status').value=game?.status||'todo';
    $('editModal').showModal();
  }
  $('gameForm').addEventListener('submit',async(e)=>{
    e.preventDefault();
    if(!room || !db)return toast('Rejoins un groupe pour ajouter un jeu.');
    const submit=$('gameForm').querySelector('[type=submit]');submit.disabled=true;
    try{
      const name=$('name').value.trim(),steamRaw=$('steam').value.trim(),appId=toAppId(steamRaw);
      if(!name)throw Error('Indique le nom du jeu.');
      if(steamRaw&&!appId)throw Error('Lien Steam ou App ID invalide.');
      const rawPrice=$('price').value.trim(),price=rawPrice===''?null:Number(rawPrice);
      if(price!==null&&(!Number.isFinite(price)||price<0))throw Error('Prix invalide.');
      const existing=games.find(g=>g.id===selected);
      if(!existing && appId && games.some(g=>g.appid===appId))throw Error('Jeu déjà présent.');
      const row={name,appid:appId,description:$('description').value.trim(),
        price_manual:price,status:$('status').value};
      if(existing){
        const {error}=await db.from('room_games').update(row).eq('room_id',room.id).eq('game_id',existing.id);
        if(error)throw error;
      }else{
        const id=appId?`steam-${appId}`:`custom-${crypto.randomUUID()}`;
        const {error}=await db.from('room_games').insert({room_id:room.id,game_id:id,
          ...row,genre:'Ajout partagé',players:'À découvrir',fav:false,sort_index:games.length});
        if(error)throw error;
      }
      $('editModal').close();await refreshGames();toast('Liste commune mise à jour.');
    }catch(error){toast(busyMsg(error));}
    finally{submit.disabled=false;}
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
    const blob=new Blob([JSON.stringify({format:'gamelab-shared-v1',games:roomRows,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='gamelab-liste-partagee.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importList(file){
    if(!room)return toast('Rejoins un groupe avant un import.');
    try{
      if(file.size>500000)throw Error('Fichier trop volumineux');
      const data=JSON.parse(await file.text());
      if(data.format!=='gamelab-shared-v1'||!Array.isArray(data.games)||data.games.length>300)throw Error('Format non pris en charge');
      if(!confirm(`Importer ${data.games.length} jeux dans la liste commune ? Les identifiants identiques seront mis à jour.`))return;
      const rows=data.games.map((r,i)=>({room_id:room.id,game_id:String(r.game_id||'').slice(0,80),
        name:String(r.name||'').slice(0,90),appid:r.appid||null,genre:String(r.genre||'Coop').slice(0,90),
        players:String(r.players||'Multijoueur').slice(0,70),description:String(r.description||'').slice(0,700),
        image:String(r.image||''),price_manual:r.price_manual??null,
        status:STATUSES[r.status]?r.status:'todo',fav:!!r.fav,sort_index:i}));
      if(rows.some(r=>!r.game_id||!r.name))throw Error('Entrée invalide');
      const {error}=await db.from('room_games').upsert(rows,{onConflict:'room_id,game_id'});
      if(error)throw error;await refreshGames();toast('Jeux importés dans le groupe.');
    }catch(e){toast('Import impossible : '+busyMsg(e));}
  }
  async function refreshGames(){
    if(!room || !db)return;
    const {data,error}=await db.from('room_games').select('*').eq('room_id',room.id).order('sort_index');
    if(error){toast('Synchronisation impossible : '+busyMsg(error));return;}
    roomRows=data||[];rebuild();
  }
  async function seedRoom(){
    if(!catalog.length)return;
    const rows=catalog.map((r,i)=>({room_id:room.id,game_id:`steam-${r.appid||'pending-'+i}`,
      name:r.name,appid:r.appid||null,genre:r.genre||'Coop',players:r.players||'Multijoueur',
      description:r.description||'',image:r.image||'',sort_index:i}));
    const {error}=await db.from('room_games').insert(rows);
    if(error)throw error;
  }
  async function selectRoom(id){
    if(roomChannel){await db.removeChannel(roomChannel);roomChannel=null;}
    if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
    const {data,error}=await db.from('rooms').select('id,name,invite_code').eq('id',id).single();
    if(error)throw error;
    room=data;
    $('sharedName').textContent=room.name;
    $('inviteValue').value=room.invite_code;
    $('sharedBar').hidden=false;
    $('accountPane').hidden=true;
    await refreshGames();
    roomChannel=db.channel(`gamelab-${room.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'room_games',filter:`room_id=eq.${room.id}`},()=>refreshGames())
      .subscribe();
    pollTimer=setInterval(()=>{if(!document.hidden)refreshGames();},15000);
    localStorage.setItem('gamelab-room',room.id);
  }
  async function showAccount(){
    $('accountPane').hidden=false;
    $('sharedBar').hidden=true;
    if(!account){
      $('authStep').hidden=false;$('roomStep').hidden=true;
      $('accountCaption').textContent='Connecte-toi pour retrouver la même liste sur vos deux ordinateurs.';
    }else{
      $('authStep').hidden=true;$('roomStep').hidden=false;
      $('accountCaption').textContent='Connecté : '+account.email;
      const {data}=await db.from('room_members').select('room_id,rooms(id,name)').eq('user_id',account.id);
      const holder=$('roomChoices');holder.replaceChildren();
      (data||[]).forEach(entry=>holder.append(button(entry.rooms?.name||'Ouvrir le groupe','btn btn-outline',async()=>{
        try{await selectRoom(entry.room_id);}catch(e){toast(busyMsg(e));}
      })));
    }
  }
  function setAuthError(msg){$('authError').textContent=msg||'';}
  async function startAuth(){
    if(!db){
      $('accountPane').hidden=false;$('authStep').hidden=true;$('roomStep').hidden=true;
      $('accountCaption').textContent='Configure config.js et exécute supabase.sql pour activer la liste partagée (voir README).';
      $('authError').textContent='Supabase n’est pas encore configuré.';
      return;
    }
    const {data:{session}}=await db.auth.getSession();account=session?.user||null;
    db.auth.onAuthStateChange((_event,session)=>{
      const previous=account?.id;account=session?.user||null;
      if(!account){room=null;roomRows=[];rebuild();showAccount();return;}
      if(previous!==account.id){setTimeout(()=>restoreRoom(),0);}
    });
    await restoreRoom();
  }
  async function restoreRoom(){
    if(!account){await showAccount();return;}
    const desired=localStorage.getItem('gamelab-room');
    if(desired){try{await selectRoom(desired);return;}catch(_){localStorage.removeItem('gamelab-room');}}
    await showAccount();
  }
  $('authForm').addEventListener('submit',async e=>{
    e.preventDefault();setAuthError('');const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(password.length<8)return setAuthError('Mot de passe : au moins 8 caractères.');
    const mode=e.submitter?.value||'login';
    const {data,error}=mode==='signup'?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
    if(error)return setAuthError(error.message);
    if(mode==='signup'&&!data.session)setAuthError('Compte créé : valide ton e-mail puis connecte-toi.');
  });
  $('createRoom').addEventListener('click',async()=>{
    try{
      const {data,error}=await db.rpc('create_game_room',{p_name:$('newRoomName').value.trim()||'Notre GameLab'});
      if(error)throw error;await selectRoom(data[0].room_id);await seedRoom();await refreshGames();toast('Groupe créé : partage le code privé avec ton pote.');
    }catch(e){toast('Création impossible : '+busyMsg(e));}
  });
  $('joinRoom').addEventListener('click',async()=>{
    try{
      const code=$('joinCode').value.trim();if(!code)throw Error('Saisis le code du groupe.');
      const {data,error}=await db.rpc('join_game_room',{p_code:code});if(error)throw error;
      await selectRoom(data);toast('Tu as rejoint la liste partagée.');
    }catch(e){toast('Impossible de rejoindre : '+busyMsg(e));}
  });
  $('copyInvite').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('inviteValue').value);toast('Code du groupe copié.');}
    catch(e){toast('Sélectionne et copie le code affiché.');}
  });
  $('signout').addEventListener('click',async()=>{
    if(roomChannel){await db.removeChannel(roomChannel);roomChannel=null;}
    if(pollTimer)clearInterval(pollTimer);room=null;roomRows=[];localStorage.removeItem('gamelab-room');
    await db.auth.signOut();rebuild();showAccount();
  });
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
  load().then(startAuth);
})();
