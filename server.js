/*
 * server.js
 * TTRPG Date Picker with Auth, Multi-Game Support, GM Effects, User Management
 * Updated: Added email verification, "keep me logged in", and availability explanation
 * Dependencies: express, body-parser, express-session, bcrypt, nodemailer, crypto
 * Data: users.json, games.json
 */

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Config
const USERS_FILE = path.join(__dirname, 'users.json');
const GAMES_FILE = path.join(__dirname, 'games.json');
const SESSION_SECRET = '54324356345453';
const GM_SECRET = 'yatameansyarraktassak';
const SALT_ROUNDS = 10;
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Configure email transporter (replace with your SMTP settings)
const transporter = nodemailer.createTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@example.com',
    pass: 'your-email-password'
  }
});

// Helpers
function loadJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function intersect(arrays) { if (!arrays.length) return []; return arrays.reduce((a, b) => a.filter(x => b.includes(x))); }
function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function findNoCommonDaysReason(game) {
  const votesObj = game.votes || {};
  const playerVotes = Object.entries(votesObj);
  
  // If no votes yet
  if (playerVotes.length === 0) {
    return "No players have submitted their availability yet.";
  }
  
  // If only one player voted
  if (playerVotes.length === 1) {
    return `Only ${playerVotes[0][0]} has submitted availability so far.`;
  }
  
  // Check for players with no days selected
  const emptyVotePlayers = playerVotes.filter(([_, days]) => days.length === 0).map(([player]) => player);
  if (emptyVotePlayers.length > 0) {
    return `${emptyVotePlayers.join(', ')} ${emptyVotePlayers.length === 1 ? 'has' : 'have'} not selected any available days.`;
  }
  
  // For each day, identify which players are NOT available
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayMissingPlayers = {};
  
  days.forEach(day => {
    const unavailablePlayers = playerVotes
      .filter(([_, availableDays]) => !availableDays.includes(day))
      .map(([player]) => player);
    
    if (unavailablePlayers.length === playerVotes.length) {
      dayMissingPlayers[day] = "all players";
    } else {
      dayMissingPlayers[day] = unavailablePlayers;
    }
  });
  
  // Find days with the fewest missing players
  const minMissing = Math.min(...Object.values(dayMissingPlayers).map(p => typeof p === 'string' ? Infinity : p.length));
  const bestDays = Object.entries(dayMissingPlayers)
    .filter(([_, players]) => typeof players !== 'string' && players.length === minMissing)
    .map(([day, players]) => ({ day, players }));
  
  if (bestDays.length > 0) {
    const example = bestDays[0];
    return `Best option is ${example.day} but ${example.players.join(' and ')} ${example.players.length === 1 ? 'is' : 'are'} not available.`;
  }
  
  return "No common days found among all players' schedules.";
}

// Data stores
let users = loadJSON(USERS_FILE);
let games = loadJSON(GAMES_FILE);

// App setup
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ 
  secret: SESSION_SECRET, 
  resave: false, 
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
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

function requireVerified(req, res, next) {
  if (!req.user.verified) {
    return res.send(renderPage('Verification Required', 
      `<h1>Email Verification Required</h1>
       <p>Please check your email and click the verification link.</p>
       <form method="POST" action="/resend-verification">
         <button>Resend Verification Email</button>
       </form>`, true));
  }
  next();
}

// HTML renderer
function renderPage(title, bodyHtml, hideLogout = false) {
  const logoutLink = hideLogout ? '' : '<a href="/logout" class="logout"><button>Logout</button></a>';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title><style>
    body{background:#121212;color:#EEE;font-family:'Segoe UI',sans-serif;margin:0;padding:0;}
    .logout{position:absolute;top:1rem;right:1rem;}
    .container{max-width:600px;margin:4rem auto;padding:2rem;background:rgba(0,0,0,0.7);border-radius:8px;text-align:center;}
    .logo{display:block;margin:0 auto 1rem;width:120px;}
    h1{font-size:2rem;margin-bottom:1rem;}
    .login-container h1{background:linear-gradient(90deg,#f7ca28,#fe574e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
    .login-container{display:inline-block;text-align:center;}
    .login-container form{display:flex;flex-direction:column;gap:1rem;}
    .login-container input{padding:.5rem;border:none;border-radius:4px;background:#1e1e1e;color:#EEE;}
    .btn-group{display:flex;justify-content:center;gap:1rem;margin:1rem auto;max-width:320px;}
    .btn-group button,.btn-group a{flex:1;padding:.5rem 1rem;border-radius:4px;text-decoration:none;font-weight:bold;transition:transform .1s;}
    .btn-group button{background:#f7ca29;color:#000;border:none;}
    .btn-group button:active{transform:scale(0.95);}
    .btn-group a{background:#fe594e;color:#000;font-weight:normal;transition:transform .1s;}
    .btn-group a:active{transform:scale(0.95);}
    .game-title{color:#fe614b !important;}
    hr { border: 1px solid #333; margin: 1.5rem 0; }
    .gm-form { display: flex; flex-direction: column; gap: 1rem; align-items: center; }
    .gm-form input, .gm-form select { width: 80%; }
    .gm-form button { width: auto; padding: .5rem 1.5rem; }
    .checkbox-container { display: flex; align-items: center; gap: 0.5rem; justify-content: center; }
    .checkbox-container input { width: auto; }
    .reason-box { background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 4px; margin: 1rem 0; text-align: left; }
    /* Effects */
    .effect-snow{position:relative;}
    .effect-snow::before,.effect-snow::after{content:'❄';position:absolute;top:0;font-size:1.2rem;opacity:0;animation:snowFall 2s linear infinite;}
    .effect-snow::before{left:20%;}.effect-snow::after{left:60%;animation-delay:1s;}
    @keyframes snowFall{0%{transform:translateY(0);opacity:1;}100%{transform:translateY(1em);opacity:0;}}
    .effect-electricity{animation:electricFlicker .2s infinite;color:#0ff;}
    @keyframes electricFlicker{0%{text-shadow:0 0 4px #0ff;}50%{text-shadow:0 0 8px #0ff;}100%{text-shadow:0 0 4px #0ff;}}
    .effect-glitch{animation:glitch 1s infinite;}
    @keyframes glitch{0%{text-shadow:2px 2px red;}20%{text-shadow:-2px -2px blue;}40%{text-shadow:2px -2px green;}60%{text-shadow:-2px 2px yellow;}80%{text-shadow:2px 2px cyan;}100%{text-shadow:none;}}
    .effect-swords{position:relative;z-index:1;}
    .effect-swords::before,.effect-swords::after{content:'⚔️';position:absolute;top:50%;transform:translateY(-50%);font-size:1.5rem;opacity:.3;z-index:0;}
    .effect-swords::before{left:-1.5rem;}.effect-swords::after{right:-1.5rem;}
    .back-button{margin-top:1rem;display:inline-block;background:linear-gradient(to right,#f7ca28,#fe574e);color:#000;padding:.5rem 1rem;border-radius:4px;text-decoration:none;font-weight:bold;}
    /* User management table styling */
    .container table{margin:2rem auto;width:90%;max-width:500px;border-collapse:collapse;}
    .container th{background:#1e1e1e;color:#EEE;padding:.75rem;border:1px solid #333;text-align:left;}
    .container td{padding:.5rem;border:1px solid #333;text-align:left;}
  </style></head><body>${logoutLink}<div class="container">
    <img src="https://cdn.glitch.global/b531c8c5-09ae-4cd7-99e6-839e9c3a434a/34.png?v=1747391468623" class="logo" alt="Logo">
    ${bodyHtml}
  </div></body></html>`;
}

// Login
app.get('/login', (req, res) => {
  const html = `<div class="login-container">
    <h1>Welcome!</h1>
    <form method="POST" action="/login">
      <input name="login" placeholder="Username or Email" required>
      <input name="password" type="password" placeholder="Password" required>
      <div class="checkbox-container">
        <input type="checkbox" name="rememberMe" id="rememberMe">
        <label for="rememberMe">Keep me logged in</label>
      </div>
      <div class="btn-group">
        <button type="submit">Login</button>
        <a href="/register">Register</a>
      </div>
    </form>
  </div>`;
  res.send(renderPage('Login', html, true));
});

app.post('/login', async (req, res) => {
  let { login, password, rememberMe } = req.body;
  let uname = login;
  
  if (login.includes('@')) {
    const f = Object.entries(users).find(([, u]) => u.email === login);
    if (f) uname = f[0];
  }
  
  const u = users[uname];
  if (!u || !(await bcrypt.compare(password, u.hash))) {
    return res.send('Invalid login');
  }
  
  req.session.user = uname;
  
  // If "Keep me logged in" is checked, extend session duration
  if (rememberMe) {
    req.session.cookie.maxAge = COOKIE_MAX_AGE;
  }
  
  res.redirect('/');
});

// Registration
app.get('/register', (req, res) => {
  const html = `<div class="login-container">
    <h1>Register</h1>
    <form method="POST" action="/register">
      <input name="username" placeholder="Username" required>
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password" required>
      <input name="gmsecret" type="password" placeholder="GM Secret (optional)" />
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
  
  // Check if username exists
  if (users[username]) {
    return res.send('User exists');
  }
  
  // Check if email is already in use
  const emailExists = Object.values(users).some(user => user.email === email);
  if (emailExists) {
    return res.send('Email already registered');
  }
  
  // Generate verification token
  const verificationToken = generateToken();
  
  // Create user
  users[username] = {
    hash: await bcrypt.hash(password, SALT_ROUNDS),
    isGM: gmsecret === GM_SECRET,
    email,
    games: [],
    verified: false,
    verificationToken
  };
  
  saveJSON(USERS_FILE, users);
  
  // Send verification email
  const verificationLink = `http://localhost:3000/verify/${username}/${verificationToken}`;
  
  const mailOptions = {
    from: 'your-email@example.com',
    to: email,
    subject: 'Verify your TTRPG Date Picker account',
    html: `
      <h1>TTRPG Date Picker</h1>
      <p>Hello ${username},</p>
      <p>Thank you for registering. Please click the link below to verify your email address:</p>
      <p><a href="${verificationLink}">Verify Email</a></p>
      <p>If you didn't register for this service, please ignore this email.</p>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    req.session.user = username;
    res.redirect('/');
  } catch (error) {
    console.error('Error sending verification email:', error);
    res.send('Registration successful but error sending verification email. Please contact support.');
  }
});

// Email verification
app.get('/verify/:username/:token', (req, res) => {
  const { username, token } = req.params;
  const user = users[username];
  
  if (!user || user.verificationToken !== token) {
    return res.status(400).send('Invalid verification link');
  }
  
  // Mark user as verified
  user.verified = true;
  delete user.verificationToken;
  saveJSON(USERS_FILE, users);
  
  // Auto-login
  req.session.user = username;
  res.redirect('/');
});

app.post('/resend-verification', requireLogin, (req, res) => {
  const username = req.session.user;
  const user = users[username];
  
  if (user.verified) {
    return res.redirect('/');
  }
  
  // Generate new token if needed
  if (!user.verificationToken) {
    user.verificationToken = generateToken();
    saveJSON(USERS_FILE, users);
  }
  
  // Send verification email
  const verificationLink = `http://localhost:3000/verify/${username}/${user.verificationToken}`;
  
  const mailOptions = {
    from: 'your-email@example.com',
    to: user.email,
    subject: 'Verify your TTRPG Date Picker account',
    html: `
      <h1>TTRPG Date Picker</h1>
      <p>Hello ${username},</p>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verificationLink}">Verify Email</a></p>
      <p>If you didn't register for this service, please ignore this email.</p>
    `
  };
  
  transporter.sendMail(mailOptions, (error) => {
    if (error) {
      console.error('Error sending verification email:', error);
      res.send('Error sending verification email. Please try again later.');
    } else {
      res.redirect('/');
    }
  });
});

// Logout
app.get('/logout', requireLogin, (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard
app.get('/', requireLogin, requireVerified, (req, res) => {
  const me = users[req.session.user];
  let html = `<h1>Welcome, ${req.session.user}</h1>`;
  
  if (me.isGM) {
    html += `<div class="btn-group">
      <a href="/gm/create">Create Game</a>
      <a href="/gm/users">Manage Users</a>
    </div>`;
  }
  
  html += "<h2>Your Games</h2><ul>";
  
  me.games.forEach(gid => {
    const eff = games[gid]?.effect || 'none';
    html += `<li><a href="${me.isGM ? '/gm/game' : '/game'}/${gid}" class="effect-${eff} game-title">${games[gid]?.name || ''}</a></li>`;
  });
  
  html += "</ul>";
  res.send(renderPage('Dashboard', html));
});

// Manage Users
app.get('/gm/users', requireLogin, requireVerified, requireGM, (req, res) => {
  let html = '<h1>User Management</h1><table><tr><th>Username</th><th>Email</th><th>Role</th><th>Verified</th><th>Actions</th></tr>';
  
  Object.entries(users).forEach(([u, d]) => {
    html += `<tr>
      <td>${u}</td>
      <td>${d.email}</td>
      <td>${d.isGM ? 'GM' : 'Player'}</td>
      <td>${d.verified ? '✓' : '✗'}</td>
      <td><form method="POST" action="/gm/users/${u}/delete"><button>Delete</button></form></td>
    </tr>`;
  });
  
  html += '</table><a href="/" class="back-button">Back</a>';
  res.send(renderPage('Manage Users', html));
});

app.post('/gm/users/:username/delete', requireLogin, requireVerified, requireGM, (req, res) => {
  const u = req.params.username;
  
  delete users[u];
  
  Object.values(games).forEach(g => {
    g.players = g.players.filter(p => p !== u);
    delete g.votes[u];
  });
  
  saveJSON(USERS_FILE, users);
  saveJSON(GAMES_FILE, games);
  res.redirect('/gm/users');
});

// Player vote
app.get('/game/:id', requireLogin, requireVerified, (req, res) => {
  const id = req.params.id, game = games[id];
  
  if (!game || (!req.user.isGM && !req.user.games.includes(id))) {
    return res.status(403).send('Forbidden');
  }
  
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const userVotes = game.votes && game.votes[req.session.user] ? game.votes[req.session.user] : [];
  
  let html = `<h1 class="effect-${game.effect || 'none'} game-title">Vote: ${game.name}</h1>
    <form method="POST" action="/game/${id}/vote">
      <input name="name" value="${req.session.user}" readonly>
      <div class="days">`;
  
  days.forEach(d => {
    const checked = userVotes.includes(d) ? 'checked' : '';
    html += `<label><input type="checkbox" name="days" value="${d}" ${checked}><span>${d}</span></label>`;
  });
  
  html += `</div><button>Submit</button></form>`;
  res.send(renderPage(game.name, html));
});

app.post('/game/:id/vote', requireLogin, requireVerified, (req, res) => {
  const id = req.params.id;
  let days = req.body.days || [];
  
  if (!Array.isArray(days)) days = [days];
  
  games[id].votes = games[id].votes || {};
  games[id].votes[req.body.name] = days;
  
  saveJSON(GAMES_FILE, games);
  res.redirect('/');
});

// GM create
app.get('/gm/create', requireLogin, requireVerified, requireGM, (req, res) => {
  const html = `<h1>Create Game</h1>
    <form method="POST" action="/gm/create" class="gm-form">
      <input name="name" placeholder="Game Name" required>
      <select name="effect">
        <option value="none">None</option>
        <option value="snow">Snow</option>
        <option value="electricity">Electricity</option>
        <option value="glitch">Glitch</option>
        <option value="swords">Swords</option>
      </select>
      <button>Create</button>
    </form>
    <a href="/" class="back-button">Back</a>`;
  
  res.send(renderPage('Create Game', html));
});

app.post('/gm/create', requireLogin, requireVerified, requireGM, (req, res) => {
  const gid = Date.now().toString();
  
  games[gid] = {
    name: req.body.name,
    owner: req.session.user,
    votes: {},
    players: [],
    effect: req.body.effect || 'none'
  };
  
  users[req.session.user].games.push(gid);
  
  saveJSON(USERS_FILE, users);
  saveJSON(GAMES_FILE, games);
  res.redirect('/');
});

// GM game dashboard
app.get('/gm/game/:id', requireLogin, requireVerified, requireGM, (req, res) => {
  const id = req.params.id, game = games[id];
  
  if (!game || game.owner !== req.session.user) {
    return res.status(403).send('Forbidden');
  }
  
  const votesObj = game.votes || {};
  const common = intersect(Object.values(votesObj));
  
  let html = `<h1 class="effect-${game.effect || 'none'} game-title">${game.name} (GM)</h1>
    <hr>
    <div class="btn-group">
      <form method="POST" action="/gm/game/${id}/reset"><button>Reset Votes</button></form>
      <form method="POST" action="/gm/game/${id}/delete"><button>Delete Game</button></form>
    </div>
    <hr>
    <h2 class="game-title">Players</h2>
    <ul>`;
  
  Object.entries(votesObj).forEach(([u, ds]) => {
    html += `<li>${u}: ${ds.join(', ')}</li>`;
  });
  
  html += '</ul><hr>';
  
  if (common.length) {
    html += `<h2 class="game-title">Common Days</h2><p>${common.join(', ')}</p><hr>`;
  } else {
    const reason = findNoCommonDaysReason(game);
    html += `<h2 class="game-title">No common availability</h2>
      <div class="reason-box">${reason}</div><hr>`;
  }
  
  html += `<h3>Assign Player</h3>
    <form method="POST" action="/gm/game/${id}/assign">
      <select name="username">`;
  
  Object.keys(users)
    .filter(u => !game.players.includes(u))
    .forEach(u => html += `<option>${u}</option>`);
  
  html += `</select>
      <button>Add Player</button>
    </form>
    <a href="/" class="back-button">Back</a>`;
  
  res.send(renderPage(game.name, html));
});

app.post('/gm/game/:id/assign', requireLogin, requireVerified, requireGM, (req, res) => {
  const id = req.params.id, u = req.body.username;
  
  if (games[id] && !games[id].players.includes(u)) {
    games[id].players.push(u);
    users[u].games.push(id);
    
    saveJSON(USERS_FILE, users);
    saveJSON(GAMES_FILE, games);
  }
  
  res.redirect(`/gm/game/${id}`);
});

app.post('/gm/game/:id/reset', requireLogin, requireVerified, requireGM, (req, res) => {
  const id = req.params.id;
  
  games[id].votes = {};
  saveJSON(GAMES_FILE, games);
  
  res.redirect(`/gm/game/${id}`);
});

app.post('/gm/game/:id/delete', requireLogin, requireVerified, requireGM, (req, res) => {
  const id = req.params.id;
  
  delete games[id];
  
  Object.values(users).forEach(u => {
    u.games = u.games.filter(gid => gid !== id);
  });
  
  saveJSON(GAMES_FILE, games);
  saveJSON(USERS_FILE, users);
  
  res.redirect('/');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));