/*
 * server.js
 * TTRPG Scheduler with Auth, Multi-Game, GM Effects, User Management
 * Includes explainNoCommonDays helper and all routes
 * Dependencies: express, body-parser, express-session, bcrypt
 */

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// Config
const USERS_FILE = path.join(__dirname, 'users.json');
const GAMES_FILE = path.join(__dirname, 'games.json');
const SESSION_SECRET = '54324356345453';
const GM_SECRET = 'yatameansyarraktassak';
const SALT_ROUNDS = 10;

// Helpers
function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function intersect(arrays) {
  if (!arrays.length) return [];
  return arrays.reduce((a, b) => a.filter(x => b.includes(x)));
}
function explainNoCommonDays(votes) {
  const players = Object.keys(votes);
  if (!players.length) return 'No one has voted yet.';
  const votesArr = Object.values(votes);
  const common = intersect(votesArr);
  if (common.length) return `Unexpected overlap: ${common.join(', ')}`;
  const allChosen = Array.from(new Set(votesArr.flat()));
  const reasons = players.map(p => {
    const unavailable = allChosen.filter(d => !votes[p].includes(d));
    return `${p} cannot attend on ${unavailable.join(', ')}`;
  });
  return reasons.join('; ');
}

// Data
let users = loadJSON(USERS_FILE);
let games = loadJSON(GAMES_FILE);

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  req.user = users[req.session.user];
  next();
}
function requireGM(req, res, next) {
  if (!req.user.isGM) return res.status(403).send('Forbidden');
  next();
}

// HTML
function renderPage(title, content, hideLogout=false) {
  const logout = hideLogout ? '' : `<a href="/logout" class="logout"><button>Logout</button></a>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    body{background:#121212;color:#EEE;font-family:'Segoe UI',sans-serif;margin:0;padding:0;}
    .logout{position:absolute;top:1rem;right:1rem;}
    .container{max-width:600px;margin:4rem auto;padding:2rem;background:rgba(0,0,0,0.7);border-radius:8px;text-align:center;}
    h1{font-size:2rem;margin-bottom:1rem;}
    /* gradient */
    .login-container h1{background:linear-gradient(90deg,#f7ca28,#fe574e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
    .btn-group{display:flex;justify-content:center;gap:1rem;}
    .btn-group button{flex:1;padding:.5rem;background:#f7ca29;border:none;color:#000;border-radius:4px;transition:transform .1s;}
    .btn-group a{flex:1;padding:.5rem;background:#fe594e;color:#000;border-radius:4px;text-decoration:none;transition:transform .1s;}
    .btn-group button:active,.btn-group a:active{transform:scale(0.95);}
    .game-title{color:#fe614b;}
    .gm-form{display:flex;flex-direction:column;gap:1rem;align-items:center;}
    .gm-form input,.gm-form select{width:80%;padding:.5rem;border-radius:4px;border:none;background:#1e1e1e;color:#EEE;}
    .back-button{margin-top:1rem;display:inline-block;background:linear-gradient(to right,#f7ca28,#fe574e);color:#000;padding:.5rem 1rem;border-radius:4px;text-decoration:none;}
    hr{border:1px solid #333;margin:1.5rem 0;}
    table{margin:2rem auto;width:90%;border-collapse:collapse;}
    th,td{padding:.5rem;border:1px solid #333;text-align:left;}
  </style></head><body>${logout}<div class="container">${content}</div></body></html>`;
}

// Routes
app.get('/login',(req,res)=>{
  const html = `<div class="login-container"><h1>Welcome!</h1><form method="POST" action="/login"><input name="login" placeholder="Username or Email" required><input name="password" type="password" placeholder="Password" required><label><input type="checkbox" name="remember">Keep me logged in</label><div class="btn-group"><button type="submit">Login</button><a href="/register">Register</a></div></form></div>`;
  res.send(renderPage('Login',html,true));
});
app.post('/login',async(req,res)=>{
  let {login,password,remember}=req.body;let uname=login;
  if(login.includes('@')){const f=Object.entries(users).find(([,u])=>u.email===login);if(f)uname=f[0];}
  const user=users[uname];if(!user||!(await bcrypt.compare(password,user.hash)))return res.send('Invalid login');
  req.session.user=uname;if(remember)req.session.cookie.maxAge=30*24*60*60*1000;
  res.redirect('/');
});

app.get('/register',(req,res)=>{
  const html = `<div class="login-container"><h1>Register</h1><form method="POST" action="/register"><input name="username" placeholder="Username" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="gmsecret" type="password" placeholder="GM Secret (optional)"><div class="btn-group"><a href="/login">Login</a><button type="submit">Register</button></div></form></div>`;
  res.send(renderPage('Register',html,true));
});
app.post('/register',async(req,res)=>{const{username,email,password,gmsecret}=req.body;if(users[username])return res.send('User exists');users[username]={hash:await bcrypt.hash(password,SALT_ROUNDS),isGM:gmsecret===GM_SECRET,email,games:[]};saveJSON(USERS_FILE,users);req.session.user=username;res.redirect('/');});

app.get('/logout',requireLogin,(req,res)=>{req.session.destroy();res.redirect('/login');});
app.get('/',requireLogin,(req,res)=>{const me=users[req.session.user];let html=`<h1>Welcome, ${req.session.user}</h1>`;if(me.isGM)html+=`<div class="btn-group"><a href="/gm/create">Create Game</a><a href="/gm/users">Manage Users</a></div>`;html+=`<h2>Your Games</h2><ul>`;me.games.forEach(gid=>{const eff=games[gid]?.effect||'none';html+=`<li><a href="${me.isGM?'/gm/game':'/game'}/${gid}" class="effect-${eff} game-title">${games[gid]?.name||''}</a></li>`;});html+=`</ul>`;res.send(renderPage('Dashboard',html));});

app.get('/gm/users',requireLogin,requireGM,(req,res)=>{let html='<h1>User Management</h1><table><tr><th>Username</th><th>Email</th><th>Role</th><th>Actions</th></tr>';Object.entries(users).forEach(([u,d])=>{html+=`<tr><td>${u}</td><td>${d.email}</td><td>${d.isGM?'GM':'Player'}</td><td><form method="POST" action="/gm/users/${u}/delete"><button>Delete</button></form></td></tr>`;});html+='</table><a href="/" class="back-button">Back</a>';res.send(renderPage('Manage Users',html));});
app.post('/gm/users/:username/delete',requireLogin,requireGM,(req,res)=>{const u=req.params.username;delete users[u];Object.values(games).forEach(g=>{g.players=g.players.filter(p=>p!==u);delete g.votes[u];});saveJSON(USERS_FILE,users);saveJSON(GAMES_FILE,games);res.redirect('/gm/users');});

app.get('/gm/create',requireLogin,requireGM,(req,res)=>{const html=`<h1>Create Game</h1><form method="POST" action="/gm/create" class="gm-form"><input name="name" placeholder="Game Name" required><select name="effect"><option value="none">None</option><option value="snow">Snow</option><option value="electricity">Electricity</option><option value="glitch">Glitch</option><option value="swords">Swords</option></select><button>Create</button></form><a href="/" class="back-button">Back</a>`;res.send(renderPage('Create Game',html));});
app.post('/gm/create',requireLogin,requireGM,(req,res)=>{const gid=Date.now().toString();games[gid]={name:req.body.name,owner:req.session.user,votes:{},players:[],effect:req.body.effect||'none'};users[req.session.user].games.push(gid);saveJSON(USERS_FILE,users);saveJSON(GAMES_FILE,games);res.redirect('/');});

app.get('/gm/game/:id',requireLogin,requireGM,(req,res)=>{const id=req.params.id;const game=games[id];if(!game||game.owner!==req.session.user)return res.status(403).send('Forbidden');const votesObj=game.votes||{};const common=intersect(Object.values(votesObj));let html=`<h1 class="effect-${game.effect||
'use code too long truncated' issue
