'use strict';
/* ─── Constants ─── */
const DB='https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const NAMES=['Kuya AD','Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
const AVATARS=['🕵️','🤵','👩‍⚕️','👨‍💼','👩‍💼','🧑‍🌾','👩‍🍳','🧑‍🔧','👮','👨‍🍳'];
const AMAP=Object.fromEntries(NAMES.map((n,i)=>[n,AVATARS[i]]));
const RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS=['♠','♥','♦','♣'];
const RED_SUITS=new Set([1,2]); // ♥=1, ♦=2
const STARTING_CHIPS=2000; // $20.00 in cents
const SB=10, BB=20;        // small blind=10¢, big blind=20¢
const MIN_PLAYERS=2;
const STALE_MS=75000;

/* ─── State ─── */
let myName='',myAvatar='',isHost=false,hostName='';
let phase='',round=0;
let chipsMap={},foldedMap={},allInMap={},betStreetMap={};
let pot=0,currentBet=0,betLastRaise=BB;
let betQueue=[],betOn='',handStartTs=0;
let holeCards=[],communityCards=[],communityFull=[];
let playersInHand=[],dealerPos=0;
let avatarsMap={},lobbyPlayers={};
let amReady=false,ivs=[],_lobbyRunning=false,_pollRunning=false;
let _dealerDeck=[];

/* ─── Firebase ─── */
const encN=n=>n.replace(/ /g,'_');
const decN=k=>k.replace(/_/g,' ');

async function fb(method,path,data){
  const opts={method};
  if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  try{const r=await fetch(`${DB}${path}.json`,opts);return await r.json();}catch{return null;}
}

function getWeekKey(){
  const now=new Date();
  const diff=now.getDay()===0?-6:1-now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()+diff);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
async function recordWin(name){
  const url=`${DB}/leaderboard/${getWeekKey()}/${encodeURIComponent(name)}.json`;
  try{const cur=await fetch(url).then(r=>r.json()).catch(()=>0)||0;
    await fetch(url,{method:'PUT',body:JSON.stringify(cur+1)});}catch{}
}

/* ─── Card utilities ─── */
function createDeck(){
  const d=[];
  for(let s=0;s<4;s++) for(let r=0;r<13;r++) d.push({r,s});
  return d;
}
function shuffle(deck){
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}
function cardHTML(card,small=false){
  if(!card) return `<div class="card-back${small?' small':''}"></div>`;
  const red=RED_SUITS.has(card.s)?' red':'';
  const r=RANKS[card.r], s=SUITS[card.s];
  return `<div class="card${red}">
    <div class="card-top">${r}<br>${s}</div>
    <div class="card-mid">${s}</div>
    <div class="card-bot">${r}<br>${s}</div>
  </div>`;
}
function emptyCardHTML(){return '<div class="card-empty"></div>';}
function fmtChips(cents){return `$${(cents/100).toFixed(2)}`;}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ─── UI helpers ─── */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
let _tt;
function toast(m,d=2600){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),d);}
function stopIvs(){ivs.forEach(clearInterval);ivs=[];}
function getAvatar(name){return avatarsMap[name]||AMAP[name]||'🃏';}

/* ─── Init ─── */
function init(){
  const params=new URLSearchParams(location.search);
  const simName=params.get('simName');
  if(simName){myName=simName;myAvatar=params.get('simAvatar')||'🃏';}
  else{
    const stored=localStorage.getItem('filoName');
    if(!stored){location.replace('index.html');return;}
    myName=stored;
    myAvatar=localStorage.getItem('filoAvatar')||'🃏';
  }
  document.getElementById('rs-name').textContent=myName;
  checkActiveGame();
}
async function checkActiveGame(){
  const [phaseD,hostD]=await Promise.all([fb('GET','/poker2/phase'),fb('GET','/poker2/host')]);
  if(!phaseD||phaseD==='reset'){enterRoleSelect();return;}
  isHost=hostD===myName;hostName=hostD||'';
  const iAmDealer=isHost;
  const chipsVal=await fb('GET',`/poker2/chips/${encN(myName)}`);
  const inGame=iAmDealer||(chipsVal!=null);
  if(!inGame){enterRoleSelect();return;}
  if(phaseD==='lobby'){enterLobby();return;}
  if(iAmDealer){await reloadDealerState();reconnectDealer(phaseD);}
  else{show('s-player');startPlayerPolling();}
}

function enterRoleSelect(){
  document.getElementById('rs-name').textContent=myName;
  show('s-role-select');
}

async function joinAsPlayer(){enterLobby();}

async function joinAsDealer(){
  const cur=await fb('GET','/poker2/host');
  if(cur&&cur!==myName){toast(`${cur} is already the Dealer`);return;}
  await fb('PUT','/poker2/host',myName);
  isHost=true;hostName=myName;
  enterLobby();
}
/* ─── Hand Evaluator ─── */
// score = (handRank<<20)|(r0<<16)|(r1<<12)|(r2<<8)|(r3<<4)|r4
// handRank: 0=High Card … 8=Straight Flush (higher=better)
function evalHand5(cards){
  const rs=cards.map(c=>c.r).sort((a,b)=>b-a);
  const ss=cards.map(c=>c.s);
  const isFlush=ss.every(s=>s===ss[0]);
  let isStraight=false,straightHigh=0;
  if(rs[0]-rs[4]===4&&new Set(rs).size===5){isStraight=true;straightHigh=rs[0];}
  // Wheel A-2-3-4-5
  if(rs[0]===12&&rs[1]===3&&rs[2]===2&&rs[3]===1&&rs[4]===0){isStraight=true;straightHigh=3;}

  const cnt={};
  rs.forEach(r=>cnt[r]=(cnt[r]||0)+1);
  const grp=Object.entries(cnt).map(([r,c])=>[+r,c]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const f=grp.map(([,c])=>c);
  const t=grp.map(([r])=>r);

  let type,key;
  if(isStraight&&isFlush){type=8;key=[straightHigh,0,0,0,0];}
  else if(f[0]===4)       {type=7;key=[t[0],t[1],0,0,0];}
  else if(f[0]===3&&f[1]===2){type=6;key=[t[0],t[1],0,0,0];}
  else if(isFlush)         {type=5;key=rs;}
  else if(isStraight)      {type=4;key=[straightHigh,0,0,0,0];}
  else if(f[0]===3)        {type=3;key=[t[0],t[1],t[2],0,0];}
  else if(f[0]===2&&f[1]===2){type=2;key=[t[0],t[1],t[2],0,0];}
  else if(f[0]===2)        {type=1;key=[t[0],t[1],t[2],t[3],0];}
  else                     {type=0;key=rs;}

  return(type<<20)|(key[0]<<16)|(key[1]<<12)|(key[2]<<8)|(key[3]<<4)|(key[4]||0);
}

function bestOf7(cards7){
  let best=-1;
  for(let i=0;i<7;i++) for(let j=i+1;j<7;j++){
    const five=cards7.filter((_,k)=>k!==i&&k!==j);
    const s=evalHand5(five);
    if(s>best)best=s;
  }
  return best;
}

const HAND_NAMES=['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
function handName(score){return HAND_NAMES[score>>20]||'High Card';}

/* ─── Lobby ─── */
async function enterLobby(){
  amReady=false;
  show('s-lobby');
  await writeLobbyPresence();
  startLobbyPolling();
}

async function writeLobbyPresence(){
  await Promise.all([
    fb('PUT',`/poker2/lobby/${encN(myName)}`,{name:myName,ts:Date.now(),ready:amReady,avatar:myAvatar}),
    fb('PUT',`/online/${encodeURIComponent(myName)}`,{ts:Date.now()}),
    fb('PUT',`/rooms/room-7/lobby/${encN(myName)}`,{name:myName,ts:Date.now()}),
  ]);
}

function startLobbyPolling(){
  stopIvs();
  lobbyTick();
  ivs.push(setInterval(lobbyTick,2000));
  ivs.push(setInterval(writeLobbyPresence,20000));
}

async function lobbyTick(){
  if(!document.getElementById('s-lobby').classList.contains('active'))return;
  if(_lobbyRunning)return;_lobbyRunning=true;
  try{
    const[lobbyD,hostD,phaseD,chipsD]=await Promise.all([
      fb('GET','/poker2/lobby'),fb('GET','/poker2/host'),
      fb('GET','/poker2/phase'),fb('GET','/poker2/chips'),
    ]);
    if(!document.getElementById('s-lobby').classList.contains('active'))return;
    if(phaseD&&phaseD!=='lobby'&&phaseD!=='reset'){
      stopIvs();
      isHost=hostD===myName;hostName=hostD||'';
      if(isHost){await reloadDealerState();reconnectDealer(phaseD);}
      else{show('s-player');startPlayerPolling();}
      return;
    }
    if(chipsD)Object.entries(chipsD).forEach(([k,v])=>{chipsMap[decN(k)]=v;});
    hostName=hostD||'';
    lobbyPlayers=lobbyD||{};
    Object.values(lobbyPlayers).forEach(p=>{if(p?.name&&p.avatar)avatarsMap[p.name]=p.avatar;});
    renderLobbyUI();
  }finally{_lobbyRunning=false;}
}

function renderLobbyUI(){
  const now=Date.now();
  const players=Object.values(lobbyPlayers)
    .filter(p=>p?.name&&now-p.ts<STALE_MS)
    .sort((a,b)=>a.name.localeCompare(b.name));
  const readyCount=players.filter(p=>p.ready).length;
  document.getElementById('lb-count').textContent=
    `Lobby — ${players.length} player${players.length!==1?'s':''} · ${readyCount} ready`;
  document.getElementById('lb-players').innerHTML=players.length
    ?players.map(p=>`<div class="lp-row${p.ready?' is-ready':''}">
        <span class="lp-av">${getAvatar(p.name)}</span>
        <span class="lp-name">${escHtml(p.name)}${p.name===hostName?' 🃏':''}</span>
        <span class="lp-chips">${chipsMap[p.name]!=null?fmtChips(chipsMap[p.name]):''}</span>
        ${p.ready?'<span style="font-size:.75rem">✅</span>':''}
      </div>`).join('')
    :'<div style="opacity:.35;font-size:.8rem;text-align:center;padding:16px">Waiting for players…</div>';

  const hbar=document.getElementById('lb-host-bar');
  if(hostName===myName){isHost=true;hbar.innerHTML='<div class="host-badge">🃏 You are the Dealer</div>';}
  else if(hostName){hbar.innerHTML=`<div style="font-size:.75rem;opacity:.55">🃏 ${escHtml(hostName)} is Dealer</div>`;}
  else{hbar.innerHTML='';}

  document.getElementById('lb-claim-btn').style.display=hostName?'none':'';
  const rBtn=document.getElementById('lb-ready-btn');
  rBtn.textContent=amReady?'⬜ Cancel Ready':'✅ Ready Up';
  rBtn.className='btn w100'+(amReady?' btn-secondary':' btn-primary');

  const readyPlayers=players.filter(p=>p.name!==hostName&&p.ready);
  const canStart=isHost&&readyPlayers.length>=MIN_PLAYERS;
  const startBtn=document.getElementById('lb-start-btn');
  startBtn.style.display=canStart?'':'none';
  if(canStart)startBtn.textContent=`▶ Start Game (${readyPlayers.length} players)`;
}

async function toggleReady(){
  amReady=!amReady;
  await fb('PUT',`/poker2/lobby/${encN(myName)}`,{name:myName,ts:Date.now(),ready:amReady,avatar:myAvatar});
  renderLobbyUI();
}

async function claimDealer(){
  const cur=await fb('GET','/poker2/host');
  if(cur){toast(`${cur} is already the Dealer`);return;}
  await fb('PUT','/poker2/host',myName);
  isHost=true;hostName=myName;
  lobbyTick();
}

async function hostStartSession(){
  const freshLobby=await fb('GET','/poker2/lobby')||{};
  const now=Date.now();
  const readyPlayers=Object.values(freshLobby)
    .filter(p=>p?.name&&p.name!==hostName&&p.ready&&now-p.ts<STALE_MS)
    .map(p=>p.name);
  if(readyPlayers.length<MIN_PLAYERS){toast('Need at least 2 ready players');return;}

  const chipsInit={};
  readyPlayers.forEach(n=>{
    chipsInit[encN(n)]=STARTING_CHIPS;
    chipsMap[n]=STARTING_CHIPS;
    if(freshLobby[encN(n)]?.avatar)avatarsMap[n]=freshLobby[encN(n)].avatar;
  });
  await Promise.all([
    fb('PUT','/poker2/chips',chipsInit),
    fb('PUT','/poker2/phase','lobby'),
    fb('PUT','/poker2/round',0),
    fb('DELETE','/poker2/hands'),
    fb('DELETE','/poker2/community'),
    fb('DELETE','/poker2/communityFull'),
    fb('DELETE','/poker2/folded'),
    fb('DELETE','/poker2/allIn'),
    fb('DELETE','/poker2/bet'),
    fb('PUT','/poker2/pot',0),
    fb('PUT','/poker2/dealerPos',0),
    fb('PUT','/poker2/avatars',Object.fromEntries(readyPlayers.filter(n=>avatarsMap[n]).map(n=>[encN(n),avatarsMap[n]]))),
  ]);
  playersInHand=readyPlayers;
  dealerPos=-1;
  stopIvs();
  show('s-dealer');
  renderDealerConsole('lobby');
}

window.addEventListener('beforeunload',()=>{
  if(myName){
    fetch(`${DB}/online/${encodeURIComponent(myName)}.json`,{method:'DELETE',keepalive:true});
    fetch(`${DB}/poker2/lobby/${encN(myName)}.json`,{method:'DELETE',keepalive:true});
  }
});

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopIvs();return;}
  if(!myName)return;
  const active=id=>document.getElementById(id)?.classList.contains('active');
  if(active('s-lobby'))startLobbyPolling();
  else if(active('s-player'))startPlayerPolling();
  else if(isHost&&active('s-dealer')){
    stopIvs();
    ivs.push(setInterval(pollBettingActions,1500));
  }
});

init();
