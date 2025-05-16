/*
 * server.js
 * TTRPG Date Picker with Auth, Multi-Game Support, GM Effects, User Management
 * Updated: Added 'Keep me logged in' and restored full styles including gradient on Welcome
 * Dependencies: express, body-parser, express-session, bcrypt
 * Data: users.json, games.json
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
function loadJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function intersect(arrays) { if (!arrays.length) return []; return arrays.reduce((a, b) => a.filter(x => b.includes(x))); }
function explainNoCommonDays(votesObj) {
  const players = Object.keys(votesObj);
  if (!players.length) return 'No one has voted yet.';
  const voteArrays = Object.values(votesObj);
  const common = intersect(voteArrays);
  if (!common.length) {
    const all = Array.from(new Set(voteArrays.flat()));
    const reasons = players.map(p => {
      const unavailable = all.filter(d => !votesObj[p].includes(d));
      return `${p} cannot attend on ${unavailable.join(', ')}`;
    });
    return reasons.join('; ');
  }
  return 'Unexpected overlap.';
}

let users = loadJSON(USERS_FILE);
let games = loadJSON(GAMES_FILE);

// App setup
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  req.user = users[req.session.user];
  next();
}
function requireGM(req, res, next) {
  if (!req.user.isGM) return res.status(403).send('Forbidden');
  next();
}

// HTML renderer
function renderPage(title, bodyHtml, hideLogout = false) {
  const logoutLink = hideLogout ? '' : '<a href="/logout" class="logout"><button>Logout</button></a>';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title><style>
  body { background:#121212; color:#EEE; font-family:'Segoe UI',sans-serif; margin:0; padding:0; }
  .logout { position:absolute; top:1rem; right:1rem; }
  .container { max-width:600px; margin:4rem auto; padding:2rem; background:rgba(0,0,0,0.7); border-radius:8px; text-align:center; }
  .logo { display:block; margin:0 auto 1rem; width:120px; }
  h1 { font-size:2rem; margin-bottom:1rem; }
  /* Login/Register gradient */
  .login-container h1 { background: linear-gradient(90deg, #f7ca28, #fe574e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .login-container { display:inline-block; text-align:center; }
  .login-container form { display:flex; flex-direction:column; gap:1rem; }
  .login-container input { padding:.5rem; border:none; border-radius:4px; background:#1e1e1e; color:#EEE; }
  .login-container label { font-size:0.9rem; }
  .btn-group { display:flex; justify-content:center; gap:1rem; margin:1rem auto; max-width:360px; }
  .btn-group button, .btn-group a { flex:1; padding:.5rem 1rem; border-radius:4px; text-decoration:none; font-weight:bold; transition:transform .1s; }
  .btn-group button { background:#f7ca29; color:#000; border:none; }
  .btn-group button:active { transform:scale(0.95); }
  .btn-group a { background:#fe594e; color:#000; font-weight:normal; }
  .btn-group a:active { transform:scale(0.95); }
  .game-title { color:#fe614b !important; }
  hr { border:1px solid #333; margin:1.5rem 0; }
  .gm-form { display:flex; flex-direction:column; gap:1rem; align-items:center; }
  .gm-form input, .gm-form select { width:80%; padding:.5rem; border:none; border-radius:4px; background:#1e1e1e; color:#EEE; }
  .gm-form button { padding:.5rem 1.5rem; }
  .back-button { margin-top:1rem; display:inline-block; background:linear-gradient(to right,#f7ca28,#fe574e); color:#000; padding:.5rem 1rem; border-radius:4px; text-decoration:none; font-weight:bold; }
  .container table { margin:2rem auto; width:90%; max-width:500px; border-collapse:collapse; }
  .container th { background:#1e1e1e; color:#EEE; padding:.75rem; border:1px solid #333; text-align:left; }
  .container td { padding:.5rem; border:1px solid #333; text-align:left; }
</style></head><body>${logoutLink}<div class="container">
  <img src="https://cdn.glitch.global/b531c8c5-09ae-4cd7-99e6-839e9c3a434a/34.png?v=1747391468623" class="logo" alt="Logo">
  ${bodyHtml}
</div></body></html>`;
}

// Routes
app.get('/login', (req, res) => {
  const html = `
<div class="login-container">
  <h1>Welcome!</h1>
  <form method="POST" action="/login">
    <input name="login" placeholder="Username or Email" required>
    <input name="password" type="password" placeholder="Password" required>
    <label><input type="checkbox" name="remember"> Keep me logged in</label>
    <div class="btn-group">
      <button type="submit">Login</button>
      <a href="/register">Register</a>
    </div>
  </form>
</div>`;
  res.send(renderPage('Login', html, true));
});
app.post('/login', async (req, res) => {
  let { login, password, remember } = req.body;
  let uname = login;
  if (login.includes('@')) {
    const found = Object.entries(users).find(([, u]) => u.email === login);
    if (found) uname = found[0];
  }
  const user = users[uname];
  if (!user || !(await bcrypt.compare(password, user.hash))) return res.send('Invalid login');
  req.session.user = uname;
  if (remember) {
    req.session.cookie.maxAge = 30*24*60*60*1000; // 30 days
  }
  res.redirect('/');
});

app.get('/register', (req, res) => {
  const html = `
<div class="login-container">
  <h1>Register</h1>
  <form method="POST" action="/register">
    <input name="username" placeholder="Username" required>
    <input name="email" type="email" placeholder="Email" required>
    <input name="password" type="password" placeholder="Password" required>
    <input name="gmsecret" type="password" placeholder="GM Secret (optional)">
    <div class="btn-group">
      <a href="/login">Login</a>
      <button type="submit">Register</button>
    </div>
  </form>
</div>`;
  res.send(renderPage('Register', html, true));
});

app.post('/register', async (req, res) => {
  const { username, email, password, gmsecret } = req.body;
  if (users[username]) return res.send('User exists');
  users[username] = { hash: await bcrypt.hash(password, SALT_ROUNDS), isGM: gmsecret===GM_SECRET, email, games: [] };
  saveJSON(USERS_FILE, users);
  req.session.user = username;
  res.redirect('/');
});

app.get('/logout', requireLogin, (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/', requireLogin, (req, res) => {
  const me = users[req.session.user];
  let html = `<h1>Welcome, ${req.session.user}</h1>`;
  if (me.isGM) html += `<div class="btn-group"><a href="/gm/create">Create Game</a><a href="/gm/users">Manage Users</a></div>`;
  html += '<h2>Your Games</h2><ul>';
  me.games.forEach(gid => {
    const eff = games[gid]?.effect||'none';
    html += `<li><a href="${me.isGM?'/gm/game':'/game'}/${gid}" class="effect-${eff} game-title">${games[gid]?.name||''}</a></li>`;
  });
  html += '</ul>';
  res.send(renderPage('Dashboard', html));
});

// ... rest of routes unchanged including GM dashboard using explainNoCommonDays ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
