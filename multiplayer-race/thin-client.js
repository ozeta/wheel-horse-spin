// Thin client to exercise multiplayer server
//
// Setup & Run:
// 1) Install dependencies
//    cd multiplayer-race
//    npm install
//
// 2) Start server in another terminal
//    npm start
//    # or
//    node server.js
//
// 3) Run thin client(s)
//    node thin-client.js ws://localhost:8080 roomId=dev username=Alice
//    node thin-client.js ws://localhost:8080 roomId=dev username=Bob
//
// Debug mode:
//    Add `debug=true` to pause after each server message
//    node thin-client.js ws://localhost:8080 roomId=dev username=Alice debug=true pretty-output=true

const WebSocket = require('ws');

const url = process.argv[2] || 'ws://localhost:8080';
const args = Object.fromEntries(process.argv.slice(3).map(kv => {
  const [k, v] = kv.split('=');
  return [k, v];
}));
const roomId = args.roomId || 'default';
const username = args.username || `Tester_${Math.floor(Math.random()*1000)}`;
const debugPause = String(args.debug || 'false').toLowerCase() === 'true';
const prettyOutput = String(args['pretty-output'] || 'false').toLowerCase() === 'true';
function formatPretty(msg) {
  switch (msg.type) {
    case 'welcome':
      return `welcome: clientId=${msg.clientId} room=${msg.roomId} hostId=${msg.hostId}`;
    case 'roomState': {
      const phase = msg.phase;
      const hostId = msg.hostId;
      const players = (msg.players || []).map(p=>`${p.id}:${p.username}${p.ready?'[R]':''}@L${p.lane}`).join(', ');
      const bots = (msg.bots || []).length;
      return `roomState: phase=${phase} hostId=${hostId} players=[${players}] bots=${bots}`;
    }
    case 'countdown': {
      const secLeft = Math.max(0, Math.round((msg.countdownEndsAt - Date.now())/1000));
      return `countdown: secondsLeft=${msg.secondsLeft} (~${secLeft}s)`;
    }
    case 'raceStart': {
      const players = (msg.players || []).map(p=>`${p.username}@L${p.lane}`).join(', ');
      const bots = (msg.bots || []).map(b=>`Bot@L${b.lane}`).join(', ');
      return `raceStart: raceId=${msg.raceId} start=${new Date(msg.raceStartEpochMs).toLocaleTimeString()} players=[${players}] bots=[${bots}]`;
    }
    case 'tick':
      return `tick: tServer=${new Date(msg.tServerMs).toLocaleTimeString()}`;
    case 'boost':
      return `boost: playerId=${msg.playerId} ${msg.down?'DOWN':'UP'} at=${new Date(msg.atClientMs||Date.now()).toLocaleTimeString()}`;
    case 'raceEnd':
      return `raceEnd: results=${JSON.stringify(msg.results)}`;
    default:
      return `${msg.type}: ${JSON.stringify(msg)}`;
  }
}

let rl = null;
if (debugPause) {
  const readline = require('readline');
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

const ws = new WebSocket(url);

function send(obj) { ws.readyState === 1 && ws.send(JSON.stringify(obj)); }

ws.on('open', () => {
  console.log('Connected, sending hello');
  send({ type: 'hello', roomId, username, version: 1 });
});

// Message handling with optional pause between prints
ws.on('message', async (data) => {
  try {
    const msg = JSON.parse(data.toString());
    const line = prettyOutput ? ('<- ' + formatPretty(msg)) : ('<- ' + msg.type + ' ' + JSON.stringify(msg));
    console.log(line);
    if (debugPause && rl) {
      await new Promise(resolve => rl.question('(debug) Press Enter to continue...', () => resolve()));
    }
    if (msg.type === 'welcome') {
      // set ready
      setTimeout(()=>send({ type: 'setReady', ready: true }), 500);
      // if host, try starting after 2s
      setTimeout(()=>send({ type: 'startGame' }), 2000);
      // simulate pressing boost during race
      setInterval(()=>{
        send({ type: 'pressBoost', down: true, atClientMs: Date.now() });
        setTimeout(()=>send({ type: 'pressBoost', down: false, atClientMs: Date.now() }), 200);
      }, 1500);
    }
  } catch (e) {
    console.error('parse error', e);
  }
});

ws.on('close', ()=>console.log('Disconnected'));
ws.on('error', (e)=>console.error('WS error', e));
