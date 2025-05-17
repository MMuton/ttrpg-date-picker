/*
 * server.js
 * TTRPG Date Picker with Auth, Multi-Game Support, GM Effects, User Management
 * Updated: Added "keep me logged in", common availability analysis, GM date selection, 
 *          Discord webhook integration with @mention support, color-coded matching days, and back buttons for error pages
 * Dependencies: express, body-parser, express-session, bcrypt, axios
 * Data: users.json, games.json
 */

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Added for Discord webhook support

// Config
const USERS_FILE = path.join(__dirname, 'users.json');
const GAMES_FILE = path.join(__dirname, 'games.json');
const SESSION_SECRET = '54324356345453';
const GM_SECRET = 'yatameansyarraktassak';
const SALT_ROUNDS = 10;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Helpers
function loadJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function intersect(arrays) { if (!arrays.length) return []; return arrays.reduce((a, b) => a.filter(x => b.includes(x))); }

// New helper to get color based on match percentage
function getMatchColor(matchCount, totalPlayers) {
  if (totalPlayers === 0) return '#666';
  const percentage = matchCount / totalPlayers;
  
  if (percentage === 1) return '#4CAF50'; // Green for 100% match
  if (percentage >= 0.8) return '#8BC34A'; // Light green for 80%+
  if (percentage >= 0.6) return '#FFEB3B'; // Yellow for 60%+
  if (percentage >= 0.4) return '#FF9800'; // Orange for 40%+
  if (percentage >= 0.2) return '#FF5722'; // Red-orange for 20%+
  return '#F44336'; // Red for < 20%
}

// New helper to analyze why there's no common availability
function analyzeNoCommonDays(game) {
  const votes = game.votes || {};
  const players = Object.keys(votes);
  
  if (players.length === 0) {
    return "No players have voted yet.";
  }
  
  if (players.length === 1) {
    return `Only ${players[0]} has voted so far.`;
  }
  
  // Find all unique days that have been voted for
  const allDays = [...new Set(Object.values(votes).flat())];
  if (allDays.length === 0) {
    return "Players haven't selected any days.";
  }
  
  // Check which days are missing for each player
  const missingDaysByPlayer = {};
  allDays.forEach(day => {
    players.forEach(player => {
      if (!votes[player].includes(day)) {
        missingDaysByPlayer[day] = missingDaysByPlayer[day] || [];
        missingDaysByPlayer[day].push(player);
      }
    });
  });
  
  // Find days that are closest to being common (have the most votes)
  const dayVoteCounts = {};
  allDays.forEach(day => {
    dayVoteCounts[day] = players.filter(player => votes[player].includes(day)).length;
  });
  
  const maxVotes = Math.max(...Object.values(dayVoteCounts));
  const closestDays = Object.keys(dayVoteCounts).filter(day => dayVoteCounts[day] === maxVotes);
  
  if (closestDays.length === 1) {
    const missingPlayers = missingDaysByPlayer[closestDays[0]].join(', ');
    return `${closestDays[0]} is closest to working, but ${missingPlayers} ${missingDaysByPlayer[closestDays[0]].length > 1 ? 'are' : 'is'} not available.`;
  } else {
    return `No days work for everyone. Try ${closestDays.join(' or ')}, which have the most availability.`;
  }
}

// Send Discord webhook for game session scheduling
async function sendDiscordWebhook(game, selectedDay, mentionText = '') {
  if (!game.webhookUrl) return;
  
  try {
    const baseMessage = `**Game Session Scheduled!**\n📅 Game: ${game.name}\n📆 Date: ${selectedDay}\n👥 Players: ${game.players.join(', ')}`;
    const fullMessage = mentionText ? `${mentionText}\n\n${baseMessage}` : baseMessage;
    
    await axios.post(game.webhookUrl, {
      content: fullMessage
    });
  } catch (error) {
    console.error('Discord webhook error:', error.message);
  }
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
  cookie: { maxAge: SESSION_MAX_AGE } // Add cookie max age for "keep me logged in"
}));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireLogin(req, res, next) { if (!req.session.user) return res.redirect('/login'); req.user = users[req.session.user]; next(); }
function requireGM(req, res, next) { if (!req.user.isGM) return res.status(403).send('Forbidden'); next(); }

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
    .checkbox-container{display:flex;align-items:center;justify-content:center;gap:.5rem;margin:.5rem 0;}
    .error-message{background:#ff5252;color:#fff;padding:1rem;border-radius:4px;margin:1rem 0;}
    .schedule-form{margin-top:1rem;padding:1rem;background:#1e1e1e;border-radius:4px;}
    .schedule-form select{margin-right:.5rem;padding:.5rem;background:#2a2a2a;color:#eee;border:none;border-radius:4px;}
    .schedule-form input{margin:.5rem 0;padding:.5rem;background:#2a2a2a;color:#eee;border:none;border-radius:4px;width:100%;}
    .webhook-input{width:100%;margin:.5rem 0;padding:.5rem;background:#1e1e1e;color:#eee;border:1px solid #333;border-radius:4px;}
    .mention-input{width:100%;margin:.5rem 0;padding:.5rem;background:#2a2a2a;color:#eee;border:1px solid #333;border-radius:4px;}
    .matching-day{color:#4A90E2 !important;}
    .day-selection{margin:1rem 0;padding:1rem;background:#1e1e1e;border-radius:4px;}
    .day-option{display:inline-block;margin:.5rem;padding:.5rem 1rem;border-radius:4px;color:#fff;font-weight:bold;text-decoration:none;transition:transform .1s;}
    .day-option:hover{transform:scale(1.05);}
    .day-option:active{transform:scale(0.95);}
    .selected-day{background:#4CAF50;color:#000;}
    .schedule-button{background:#4CAF50;color:#fff;padding:.75rem 1.5rem;border:none;border-radius:4px;font-weight:bold;margin-top:1rem;cursor:pointer;}
    .schedule-button:hover{background:#45a049;}
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
        <input type="checkbox" name="keepLoggedIn" id="keepLoggedIn">
        <label for="keepLoggedIn">Keep me logged in</label>
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
  let { login, password, keepLoggedIn } = req.body;
  let uname = login;
  if (login.includes('@')) {
    const f = Object.entries(users).find(([, u]) => u.email === login);
    if (f) uname = f[0];
  }
  const u = users[uname];
  if (!u || !(await bcrypt.compare(password, u.hash))) {
    return res.send(renderPage('Login Error', `
      <div class="error-message">Invalid username or password</div>
      <a href="/login" class="back-button">Back to Login</a>
    `, true));
  }
  
  req.session.user = uname;
  
  // If "keep me logged in" is checked, set the cookie to persist
  if (keepLoggedIn) {
    req.session.cookie.maxAge = SESSION_MAX_AGE;
  } else {
    req.session.cookie.expires = false; // Session cookie (expires when browser closes)
  }
  
  res.redirect('/');
});

// Register
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
  
  if (users[username]) {
    return res.send(renderPage('Registration Error', `
      <div class="error-message">Username already exists</div>
      <a href="/register" class="back-button">Back to Registration</a>
    `, true));
  }
  
  // Check if email is already in use
  const emailExists = Object.values(users).some(u => u.email === email);
  if (emailExists) {
    return res.send(renderPage('Registration Error', `
      <div class="error-message">Email already in use</div>
      <a href="/register" class="back-button">Back to Registration</a>
    `, true));
  }
  
  users[username] = {
    hash: await bcrypt.hash(password, SALT_ROUNDS),
    isGM: gmsecret === GM_SECRET,
    email,
    games: []
  };
  
  saveJSON(USERS_FILE, users);
  req.session.user = username;
  res.redirect('/');
});

// Logout
app.get('/logout', requireLogin, (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard
app.get('/', requireLogin, (req, res) => {
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
app.get('/gm/users', requireLogin, requireGM, (req, res) => {
  let html = '<h1>User Management</h1><table><tr><th>Username</th><th>Email</th><th>Role</th><th>Actions</th></tr>';
  Object.entries(users).forEach(([u, d]) => {
    html += `<tr><td>${u}</td><td>${d.email}</td><td>${d.isGM ? 'GM' : 'Player'}</td><td><form method="POST" action="/gm/users/${u}/delete"><button>Delete</button></form></td></tr>`;
  });
  html += '</table><a href="/" class="back-button">Back</a>';
  res.send(renderPage('Manage Users', html));
});

app.post('/gm/users/:username/delete', requireLogin, requireGM, (req, res) => {
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
app.get('/game/:id', requireLogin, (req, res) => {
  const id = req.params.id, game = games[id];
  if (!game || (!req.user.isGM && !req.user.games.includes(id))) {
    return res.send(renderPage('Access Error', `
      <div class="error-message">You don't have access to this game</div>
      <a href="/" class="back-button">Back to Dashboard</a>
    `));
  }
  
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const userVotes = (game.votes || {})[req.session.user] || [];
  
  let html = `<h1 class="effect-${game.effect || 'none'} game-title">Vote: ${game.name}</h1>
    <form method="POST" action="/game/${id}/vote">
      <input name="name" value="${req.session.user}" readonly>
      <div class="days">`;
  
  days.forEach(d => {
    const checked = userVotes.includes(d) ? 'checked' : '';
    html += `<label><input type="checkbox" name="days" value="${d}" ${checked}><span>${d}</span></label>`;
  });
  
  html += `</div>
    <button>Submit</button>
    </form>
    <a href="/" class="back-button">Back to Dashboard</a>`;
  
  res.send(renderPage(game.name, html));
});

app.post('/game/:id/vote', requireLogin, (req, res) => {
  const id = req.params.id;
  let days = req.body.days || [];
  if (!Array.isArray(days)) days = [days];
  games[id].votes = games[id].votes || {};
  games[id].votes[req.body.name] = days;
  saveJSON(GAMES_FILE, games);
  res.redirect('/');
});

// GM create
app.get('/gm/create', requireLogin, requireGM, (req, res) => {
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
      <input name="webhookUrl" placeholder="Discord Webhook URL (optional)" class="webhook-input">
      <button>Create</button>
    </form>
    <a href="/" class="back-button">Back</a>`;
  
  res.send(renderPage('Create Game', html));
});

app.post('/gm/create', requireLogin, requireGM, (req, res) => {
  const gid = Date.now().toString();
  games[gid] = {
    name: req.body.name,
    owner: req.session.user,
    votes: {},
    players: [],
    effect: req.body.effect || 'none',
    webhookUrl: req.body.webhookUrl || null,
    scheduledDay: null
  };
  
  users[req.session.user].games.push(gid);
  saveJSON(USERS_FILE, users);
  saveJSON(GAMES_FILE, games);
  res.redirect('/');
});

// GM game dashboard
app.get('/gm/game/:id', requireLogin, requireGM, (req, res) => {
  const id = req.params.id, game = games[id];
  if (!game || game.owner !== req.session.user) {
    return res.send(renderPage('Access Error', `
      <div class="error-message">You don't have access to this game</div>
      <a href="/" class="back-button">Back to Dashboard</a>
    `));
  }
  
  const votesObj = game.votes || {};
  const allPlayers = Object.keys(votesObj);
  const totalPlayers = allPlayers.length;
  const common = intersect(Object.values(votesObj));
  
  // Calculate match counts for all voted days
  const allDays = [...new Set(Object.values(votesObj).flat())];
  const dayMatchCounts = {};
  allDays.forEach(day => {
    dayMatchCounts[day] = allPlayers.filter(player => votesObj[player].includes(day)).length;
  });
  
  let html = `<h1 class="effect-${game.effect || 'none'} game-title">${game.name} (GM)</h1>
    <hr>
    <div class="btn-group">
      <form method="POST" action="/gm/game/${id}/reset">
        <button>Reset Votes</button>
      </form>
      <form method="POST" action="/gm/game/${id}/delete">
        <button>Delete Game</button>
      </form>
    </div>
    <hr>
    <h2 class="game-title">Webhook Settings</h2>
    <form method="POST" action="/gm/game/${id}/webhook">
      <input name="webhookUrl" class="webhook-input" placeholder="Discord Webhook URL" value="${game.webhookUrl || ''}">
      <button>Update</button>
    </form>
    <hr>
    <h2 class="game-title">Players</h2>
    <ul>`;
  
  Object.entries(votesObj).forEach(([u, ds]) => {
    const playerDays = ds.map(day => {
      const matchCount = dayMatchCounts[day];
      const color = getMatchColor(matchCount, totalPlayers);
      return `<span style="color: ${color}; font-weight: bold;">${day}</span>`;
    });
    html += `<li>${u}: ${playerDays.join(', ')}</li>`;
  });
  
  html += '</ul><hr>';
  
  // Show all available days with color coding and allow GM to select
  if (allDays.length > 0) {
    html += `<h2 class="game-title">Day Selection</h2>
      <div class="day-selection">
        <p>Choose a day to schedule the session:</p>
        <form method="POST" action="/gm/game/${id}/schedule">`;
    
    allDays.forEach(day => {
      const matchCount = dayMatchCounts[day];
      const color = getMatchColor(matchCount, totalPlayers);
      const isSelected = game.scheduledDay === day;
      const selectedClass = isSelected ? ' selected-day' : '';
      
      html += `<label>
        <input type="radio" name="scheduledDay" value="${day}" ${isSelected ? 'checked' : ''} style="display: none;">
        <span class="day-option${selectedClass}" style="background-color: ${color}; color: ${color === '#FFEB3B' ? '#000' : '#fff'};">
          ${day} (${matchCount}/${totalPlayers})
        </span>
      </label>`;
    });
    
    html += `<br><input name="mentionText" placeholder="@mentions (e.g., @everyone or @role)" class="mention-input">
      <br><button type="submit" class="schedule-button">Schedule Session</button>
      </form>`;
    
    if (game.scheduledDay) {
      html += `<p><strong>Currently scheduled for: <span style="color: ${getMatchColor(dayMatchCounts[game.scheduledDay], totalPlayers)};">${game.scheduledDay}</span></strong></p>`;
    }
    
    html += '</div><hr>';
  }
  
  // Display common days analysis
  if (common.length) {
    html += `<h2 class="game-title">Perfect Match Days</h2>
      <p style="color: #4CAF50; font-weight: bold;">${common.join(', ')}</p><hr>`;
  } else if (totalPlayers > 0) {
    html += `<h2 class="game-title">No Perfect Match</h2>
      <p>${analyzeNoCommonDays(game)}</p><hr>`;
  }
  
  html += `<h3>Assign Player</h3>
    <form method="POST" action="/gm/game/${id}/assign">
      <select name="username">`;
  
  Object.keys(users).filter(u => !game.players.includes(u)).forEach(u => {
    html += `<option>${u}</option>`;
  });
  
  html += `</select>
    <button>Add Player</button>
    </form>
    <a href="/" class="back-button">Back</a>`;
  
  res.send(renderPage(game.name, html));
});

// Add JavaScript for day selection interactivity
const daySelectionScript = `
<script>
document.addEventListener('DOMContentLoaded', function() {
  const dayOptions = document.querySelectorAll('.day-option');
  const radioInputs = document.querySelectorAll('input[name="scheduledDay"]');
  
  dayOptions.forEach((option, index) => {
    option.addEventListener('click', function() {
      // Clear all selected states
      dayOptions.forEach(opt => opt.classList.remove('selected-day'));
      radioInputs.forEach(radio => radio.checked = false);
      
      // Set current as selected
      option.classList.add('selected-day');
      radioInputs[index].checked = true;
    });
  });
});
</script>`;

// Update webhook URL
app.post('/gm/game/:id/webhook', requireLogin, requireGM, (req, res) => {
  const id = req.params.id;
  if (games[id] && games[id].owner === req.session.user) {
    games[id].webhookUrl = req.body.webhookUrl || null;
    saveJSON(GAMES_FILE, games);
  }
  res.redirect(`/gm/game/${id}`);
});

// Schedule a game session
app.post('/gm/game/:id/schedule', requireLogin, requireGM, async (req, res) => {
  const id = req.params.id;
  const { scheduledDay, mentionText } = req.body;
  
  if (games[id] && games[id].owner === req.session.user) {
    games[id].scheduledDay = scheduledDay;
    saveJSON(GAMES_FILE, games);
    
    // Send Discord webhook notification if URL exists
    if (scheduledDay && games[id].webhookUrl) {
      await sendDiscordWebhook(games[id], scheduledDay, mentionText || '');
    }
  }
  
  res.redirect(`/gm/game/${id}`);
});

app.post('/gm/game/:id/assign', requireLogin, requireGM, (req, res) => {
  const id = req.params.id, u = req.body.username;
  if (games[id] && !games[id].players.includes(u)) {
    games[id].players.push(u);
    users[u].games.push(id);
    saveJSON(USERS_FILE, users);
    saveJSON(GAMES_FILE, games);
  }
  res.redirect(`/gm/game/${id}`);
});

app.post('/gm/game/:id/reset', requireLogin, requireGM, (req, res) => {
  const id = req.params.id;
  games[id].votes = {};
  saveJSON(GAMES_FILE, games);
  res.redirect(`/gm/game/${id}`);
});

app.post('/gm/game/:id/delete', requireLogin, requireGM, (req, res) => {
  const id = req.params.id;
  delete games[id];
  Object.values(users).forEach(u => u.games = u.games.filter(gid => gid !== id));
  saveJSON(GAMES_FILE, games);
  saveJSON(USERS_FILE, users);
  res.redirect('/');
});

// Error handler for route not found
app.use((req, res) => {
  res.status(404).send(renderPage('Page Not Found', `
    <div class="error-message">The page you're looking for doesn't exist</div>
    <a href="/" class="back-button">Back to Dashboard</a>
  `));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    