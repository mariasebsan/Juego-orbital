'use strict';
const $ = id => document.getElementById(id);
const SIZES = [5,4,3,2,1];
const ACTIONS = [
  ['simple','⌖','ATAQUE SIMPLE',2], ['shield','⬡','ESCUDO',3],
  ['surprise','✧','SORPRESA',5], ['sweep','≋','BARRIDO',6], ['blast','✹','EXPLOSIÓN',8]
];
let ws = null, game = null, roomCode = '', userToken = '', selectedAction = 'simple';
let placed = [], vertical = false, hover = null, reconnectTimer = null, toastTimer = null;
let started = false, desiredRoom = '', joining = false;
const coordKey = (r,c) => `${r},${c}`;
const keySet = coords => new Set((coords || []).map(([r,c]) => coordKey(r,c)));
const shipCells = (r,c,len,vert) => Array.from({length:len},(_,i)=>[r+(vert?i:0),c+(vert?0:i)]);
const inside = ([r,c]) => r>=0&&r<10&&c>=0&&c<10;
const allShips = () => placed.flat();
const storeKey = code => `orbital-token-${code}`;

function toast(message){ const el=$('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3600); }
function setConnected(yes){$('connectionDot').classList.toggle('online',yes);$('connectionLabel').textContent=yes?'CANAL CONECTADO':'SIN CONEXIÓN';}
function show(id){for(const name of ['landing','roomScreen','battleScreen'])$(name).classList.toggle('hidden',name!==id);}
function send(msg){if(ws&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify(msg));return true;}toast('Sin conexión con el servidor. Reconectando…');return false;}
function connect(code,name,force=false){
  desiredRoom = code;
  if(ws && ws.readyState===WebSocket.OPEN)ws.close();
  const scheme=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(`${scheme}://${location.host}/ws`);
  ws.onopen=()=>{setConnected(true);send({type:'hello',code:desiredRoom,token:desiredRoom?localStorage.getItem(storeKey(desiredRoom))||'':'',name:name||localStorage.getItem('orbital-name')||'Comandante'});};
  ws.onmessage=({data})=>{
    let msg;try{msg=JSON.parse(data)}catch{return;}
    if(msg.type==='error'){toast(msg.message);if(!roomCode){joining=false;show('landing');}return;}
    if(msg.type==='joined'){
      roomCode=msg.room;userToken=msg.token;localStorage.setItem(storeKey(roomCode),userToken);
      const url=new URL(location.href);url.searchParams.set('sala',roomCode);history.replaceState(null,'',url.pathname+url.search);
      $('roomCode').textContent=roomCode;show('roomScreen');joining=false;
      return;
    }
    if(msg.type==='state'){game=msg;render();}
  };
  ws.onclose=()=>{setConnected(false);if(roomCode){toast('Conexión interrumpida. Intentando reconectar…');}clearTimeout(reconnectTimer);if(roomCode)reconnectTimer=setTimeout(()=>connect(roomCode,localStorage.getItem('orbital-name')),2000);};
  ws.onerror=()=>setConnected(false);
}
function login(code){
  if(joining)return;
  const name=$('nameInput').value.trim()||'Comandante';localStorage.setItem('orbital-name',name);
  if(code&&!/^[A-Z2-9]{6}$/.test(code)){toast('Introduce un código de sala válido de 6 caracteres.');return;}
  joining=true;connect(code,name);
}
$('createBtn').onclick=()=>login('');
$('joinBtn').onclick=()=>login($('codeInput').value.toUpperCase().trim());
$('codeInput').onkeydown=e=>{if(e.key==='Enter')$('joinBtn').click()};
$('nameInput').onkeydown=e=>{if(e.key==='Enter')$('createBtn').click()};
$('copyBtn').onclick=async()=>{let url=new URL(location.href);url.searchParams.set('sala',roomCode);try{await navigator.clipboard.writeText(url.toString());toast('¡Enlace de invitación copiado!');}catch{toast('Comparte este enlace: '+url.toString())}};
$('rotateBtn').onclick=()=>{vertical=!vertical;updatePlacement();};
$('randomBtn').onclick=()=>{if(game?.players[game.you]?.ready)return;randomPlacement();};
$('readyBtn').onclick=()=>{if(placed.length===5)send({type:'deploy',ships:placed});};
window.addEventListener('keydown',e=>{
  if(e.target.matches('input'))return;
  if((e.key==='r'||e.key==='R')&&game?.phase==='lobby')$('rotateBtn').click();
  if(game?.phase==='battle'){
    const n=Number(e.key);if(n>=1&&n<=5)selectAction(ACTIONS[n-1][0]);
  }
});

function boardLabels(which){$(which+'Top').innerHTML='';$(which+'Left').innerHTML='';
  for(let n=0;n<10;n++){$(which+'Top').insertAdjacentHTML('beforeend',`<span>${n}</span>`);$(which+'Left').insertAdjacentHTML('beforeend',`<span>${n}</span>`)}
}
['deploy','enemy','own'].forEach(boardLabels);
function createBoard(id,onClick,onHover){
  const root=$(id);root.innerHTML='';
  for(let r=0;r<10;r++)for(let c=0;c<10;c++){
    const cell=document.createElement('button');cell.className='cell';cell.type='button';cell.dataset.r=r;cell.dataset.c=c;
    cell.setAttribute('aria-label',`Fila ${r}, columna ${c}`);
    cell.onclick=()=>onClick(r,c);
    if(onHover){cell.onmouseenter=()=>onHover(r,c);cell.onmouseleave=()=>onHover(null,null)}
    root.appendChild(cell);
  }
}
createBoard('deployBoard',deployClick,(r,c)=>{hover=r===null?null:[r,c];paintDeployment()});
createBoard('enemyBoard',(r,c)=>chooseTarget(r,c,'enemy'),(r,c)=>{hover=r===null?null:[r,c];paintBattle()});
createBoard('ownBoard',(r,c)=>chooseTarget(r,c,'own'),(r,c)=>{hover=r===null?null:[r,c];paintBattle()});
function cellsAt(id){return Array.from($(id).children)}
function canPlace(cells){const occ=keySet(allShips());return cells.every(cell=>inside(cell)&&!occ.has(coordKey(...cell)))}
function deployClick(r,c){
  if(game?.phase!=='lobby'||game.players[game.you]?.ready)return;
  if(placed.length>=5)return toast('Ya has colocado todos los satélites. Confirma el despliegue.');
  const cells=shipCells(r,c,SIZES[placed.length],vertical);
  if(!canPlace(cells))return toast('No cabe aquí o se solapa con otro satélite.');
  placed.push(cells);updatePlacement();
}
function randomPlacement(){
  placed=[];
  for(const size of SIZES){
    let done=false;
    for(let i=0;i<3000&&!done;i++){
      const vert=Math.random()<.5,r=Math.floor(Math.random()*10),c=Math.floor(Math.random()*10);
      const cells=shipCells(r,c,size,vert);
      if(canPlace(cells)){placed.push(cells);done=true}
    }
    if(!done){placed=[];return randomPlacement()}
  }
  updatePlacement();toast('Despliegue aleatorio generado.');
}
function updatePlacement(){
  $('orientationLabel').textContent=vertical?'VERTICAL ↓':'HORIZONTAL →';
  const done=placed.length===5;
  $('deployInstruction').textContent=done?'Flota lista: confirma tu despliegue':`Coloca tu satélite de ${SIZES[placed.length]} casilla${SIZES[placed.length]!==1?'s':''}`;
  $('readyBtn').disabled=!done;$('readyBtn').textContent=done?'CONFIRMAR DESPLIEGUE →':`FALTAN ${5-placed.length} SATÉLITES`;
  paintDeployment();
}
function paintDeployment(){
  const ready=game?.players[game.you]?.ready;
  const occupied=keySet(allShips());
  const preview=(!ready&&placed.length<5&&hover)?shipCells(...hover,SIZES[placed.length],vertical):[];
  const previewSet=keySet(preview),valid=canPlace(preview);
  for(const cell of cellsAt('deployBoard')){
    const r=Number(cell.dataset.r),c=Number(cell.dataset.c),k=coordKey(r,c);
    cell.className='cell';
    if(occupied.has(k))cell.classList.add('ship');
    if(previewSet.has(k))cell.classList.add(valid?'preview':'preview-invalid');
    if(!ready)cell.classList.add('active');
  }
}
function renderLobby(){
  show('roomScreen');
  $('roomCode').textContent=game.room;
  const me=game.players[game.you];
  if(me.ready){placed=game.ships;$('deployInstruction').textContent='DESPLIEGUE CONFIRMADO · ESPERANDO AL RIVAL';$('deployTag').textContent='LISTO ✓';$('readyBtn').disabled=true;$('readyBtn').textContent='FLOTA EN POSICIÓN ✓';$('randomBtn').disabled=true;$('rotateBtn').disabled=true;}
  else{$('deployTag').textContent='EN PREPARACIÓN';$('randomBtn').disabled=false;$('rotateBtn').disabled=false;updatePlacement();}
  $('roomSubtitle').textContent=game.players.length===1?'Comparte el enlace para invitar a tu rival':'Ambos jugadores deben confirmar su flota';
  $('playersList').innerHTML=game.players.map((p,i)=>`<div class="player-line"><div class="player-avatar">${i+1}</div><div><div class="player-name">${escapeHTML(p.name)}${i===game.you?' (tú)':''}</div><div class="player-status ${p.ready?'ready-color':''}">${p.ready?'✓ FLOTA LISTA':'◌ PREPARANDO FLOTA'}${!p.online?' · DESCONECTADO':''}</div></div></div>`).join('')+(game.players.length<2?'<div class="player-line"><div class="player-avatar">?</div><div><div class="player-name">Comandante invitado</div><div class="player-status">EN ESPERA DE CONEXIÓN…</div></div></div>':'');
  paintDeployment();
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function selectAction(action){if(!game||game.phase!=='battle'||game.turn!==game.you)return;if(game.energy<ACTIONS.find(a=>a[0]===action)[3])return;selectedAction=action;hover=null;paintBattle();renderActions()}
function renderActions(){const canAct=game.phase==='battle'&&game.turn===game.you&&game.players[1-game.you]?.online;
  $('actionButtons').innerHTML='';
  for(const [id,icon,name,cost] of ACTIONS){
    const btn=document.createElement('button');btn.className='action-btn'+(selectedAction===id?' selected':'');btn.disabled=!canAct||game.energy<cost;btn.onclick=()=>selectAction(id);
    btn.innerHTML=`<span class="action-icon">${icon}</span><span class="action-name">${name}</span><span class="action-cost">⚡ ${cost} ENERGÍA</span>`;
    $('actionButtons').appendChild(btn);
  }
  $('actionHint').textContent=canAct?'UNA ACCIÓN POR TURNO':'ESPERANDO TURNO';
}
function targets(action,r,c){if(action==='shield'||action==='simple'||action==='surprise')return [[r,c]];if(action==='sweep')return shipCells(r,c,3,false);return [[r,c],[r,c+1],[r+1,c],[r+1,c+1]];}
function chooseTarget(r,c,which){
  if(!game||game.phase!=='battle')return;
  if(game.turn!==game.you)return toast('Espera a tu turno.');
  if(!game.players[1-game.you]?.online)return toast('El rival está desconectado.');
  if((selectedAction==='shield'?'own':'enemy')!==which)return toast(selectedAction==='shield'?'El escudo se coloca en tu tablero.':'Los ataques se realizan sobre el radar enemigo.');
  const cost=ACTIONS.find(a=>a[0]===selectedAction)[3];
  if(game.energy<cost)return toast('Energía insuficiente.');
  if(!targets(selectedAction,r,c).every(inside))return toast('El ataque se sale del tablero.');
  if(selectedAction!=='shield'&&(keySet(game.enemyHits).has(coordKey(r,c))||keySet(game.enemyMisses).has(coordKey(r,c))))return toast('Ya has atacado esa casilla.');
  send({type:'action',action:selectedAction,cell:[r,c]});hover=null;
}
function paintBattle(){
  if(!game||game.phase==='lobby')return;
  const myShips=keySet(game.ships.flat());
  const myHits=keySet(game.myHits),myMisses=keySet(game.myMisses);
  const enemyHits=keySet(game.enemyHits),enemyMisses=keySet(game.enemyMisses);
  const actionable=game.phase==='battle'&&game.turn===game.you&&game.players[1-game.you]?.online;
  const previewSet=keySet(hover?targets(selectedAction,...hover):[]);
  for(const [id,own] of [['ownBoard',true],['enemyBoard',false]]){
    for(const cell of cellsAt(id)){
      const k=coordKey(Number(cell.dataset.r),Number(cell.dataset.c));cell.className='cell';
      if(own&&myShips.has(k))cell.classList.add('ship');
      if((own?myHits:enemyHits).has(k))cell.classList.add('hit');
      else if((own?myMisses:enemyMisses).has(k))cell.classList.add('miss');
      if(own&&game.shield&&coordKey(...game.shield)===k)cell.classList.add('shield');
      if(actionable&&(own?selectedAction==='shield':selectedAction!=='shield')){
        cell.classList.add('active');if(previewSet.has(k))cell.classList.add('preview');
      }
    }
  }
}
function eventDescription(event){
  if(!event)return 'Los sistemas de comunicación están preparados. Buena suerte, comandante.';
  const actor=event.by===game.you?'Tú':'Tu rival';
  const label=(ACTIONS.find(a=>a[0]===event.action)||[])[2]||event.action;
  const hits=event.results.filter(r=>r.kind==='hit').length;
  const misses=event.results.filter(r=>r.kind==='miss').length;
  const blocked=event.results.filter(r=>r.kind==='blocked').length;
  if(event.action==='shield')return `${actor} ha activado un escudo protector.`;
  return `${actor} ha usado ${label.toLowerCase()}. ${hits} impacto${hits===1?'':'s'}, ${misses} fallo${misses===1?'':'s'}${blocked?`, ${blocked} bloqueado${blocked===1?'':'s'} por escudo`:''}.`;
}
function renderBattle(){
  show('battleScreen');
  const mine=game.turn===game.you;
  const online=game.players[1-game.you]?.online;
  $('battleTitle').textContent=game.phase==='finished'?'Misión completada':'Centro de mando';
  $('battleMessage').textContent=game.phase==='finished'?'La batalla ha terminado.':!online?'El rival está desconectado; sus turnos están pausados.':mine?'Es tu turno. Elige una maniobra y selecciona su objetivo.':'Es el turno de tu rival. Vigila tus defensas.';
  $('turnText').textContent=game.phase==='finished'?'BATALLA FINALIZADA':mine?'TU TURNO':'TURNO RIVAL';
  $('turnChip').classList.toggle('wait',!mine||game.phase==='finished');
  $('myEnergy').innerHTML=`${game.energy} <small>⚡</small>`;
  $('myHitsCount').innerHTML=`${game.enemyHits.length} <small>/ 15</small>`;
  $('enemySunk').innerHTML=`${game.sunkEnemy} <small>/ 5</small>`;
  $('myRemaining').innerHTML=`${5-game.sunkOwn} <small>/ 5</small>`;
  $('lastAction').textContent=eventDescription(game.lastEvent);
  renderActions();paintBattle();
  if(game.phase==='finished'){
    const won=game.winner===game.you;
    $('overlayIcon').textContent=won?'✦':'✕';
    $('overlayEyebrow').textContent=won?'OPERACIÓN EXITOSA':'MISIÓN FALLIDA';
    $('overlayTitle').textContent=won?'¡VICTORIA!':'DERROTA';
    $('overlayText').textContent=won?'Has destruido la constelación enemiga y conquistado la órbita.':'Tu constelación ha sido destruida. Reagrúpate y vuelve a intentarlo.';
    $('overlay').classList.remove('hidden');
  }
}
function render(){if(!game)return;if(game.phase==='lobby')renderLobby();else renderBattle();}

// Fondo animado de estrellas, sin dependencias externas.
const canvas=$('stars'),ctx=canvas.getContext('2d');let stars=[];
function resetStars(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);stars=Array.from({length:Math.min(190,Math.floor(innerWidth*innerHeight/6000))},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:Math.random()*1.5+.25,a:Math.random()*.55+.12,p:Math.random()*6.28}));}
addEventListener('resize',resetStars);resetStars();
function drawStars(t){ctx.clearRect(0,0,innerWidth,innerHeight);for(const s of stars){ctx.fillStyle=`rgba(174,206,255,${s.a*(.7+.3*Math.sin(t/1500+s.p))})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}requestAnimationFrame(drawStars);}requestAnimationFrame(drawStars);

const inviteCode=new URL(location.href).searchParams.get('sala');
if(inviteCode){$('codeInput').value=inviteCode.toUpperCase();}
$('nameInput').value=localStorage.getItem('orbital-name')||'';
setConnected(false);
