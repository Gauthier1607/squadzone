
/*
  SquadZone prototype server
  - Express API with session-based auth
  - SQLite for storage (file: squadzone.db)
  - Multer for image uploads (uploads/)
  - Socket.IO for simple chat
*/
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

// Ensure uploads dir
const UPLOADS = path.join(__dirname, 'uploads');
if(!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now().toString() + '-' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage });

// Sessions (in-memory for demo)
app.use(session({
  secret: 'squadzone-demo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7*24*60*60*1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploads and public
app.use('/uploads', express.static(UPLOADS));
app.use('/', express.static(path.join(__dirname, 'public')));

// Initialize DB
const DB_FILE = path.join(__dirname, 'squadzone.db');
const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, avatar TEXT
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT, image TEXT, created INTEGER
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, text TEXT, created INTEGER
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, friend_id INTEGER, status TEXT
  );`);
});
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_a INTEGER, user_b INTEGER, last_updated INTEGER
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, sender_id INTEGER, text TEXT, created INTEGER
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, type TEXT
  );`);


// Helpers
function requireAuth(req, res, next){
  if(req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}

// API: register
app.post('/api/register', upload.single('avatar'), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if(!email || !password) return res.status(400).json({ error: 'email & password required' });
    const hash = await bcrypt.hash(password, 10);
    const avatar = req.file ? '/uploads/' + req.file.filename : '/assets/default-avatar.png';
    db.run(`INSERT INTO users (name,email,password,avatar) VALUES (?,?,?,?)`, [name||email, email, hash, avatar], function(err){
      if(err) return res.status(400).json({ error: err.message });
      req.session.userId = this.lastID;
      res.json({ id: this.lastID, name: name||email, email, avatar });
    });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// API: login
app.post('/api/login', (req,res) => {
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'email & password required' });
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if(!ok) return res.status(400).json({ error: 'invalid credentials' });
    req.session.userId = row.id;
    res.json({ id: row.id, name: row.name, email: row.email, avatar: row.avatar });
  });
});

// API: logout
app.post('/api/logout', (req,res) => {
  req.session.destroy(()=> res.json({ ok: true }));
});

// API: current user
app.get('/api/me', (req,res) => {
  if(!req.session.userId) return res.json({ user: null });
  db.get(`SELECT id,name,email,avatar FROM users WHERE id = ?`, [req.session.userId], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ user: row });
  });
});

// API: create post
app.post('/api/posts', requireAuth, upload.single('image'), (req,res) => {
  const userId = req.session.userId;
  const text = req.body.text || '';
  const image = req.file ? '/uploads/' + req.file.filename : null;
  const created = Date.now();
  db.run(`INSERT INTO posts (user_id,text,image,created) VALUES (?,?,?,?)`, [userId, text, image, created], function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get(`SELECT posts.*, users.name as author_name, users.avatar as author_avatar FROM posts JOIN users ON users.id = posts.user_id WHERE posts.id = ?`, [this.lastID], (e,row)=>{
      res.json({ post: row });
      io.emit('new_post', row);
    });
  });
});

// API: list posts
app.get('/api/posts', (req,res) => {
  db.all(`SELECT posts.*, users.name as author_name, users.avatar as author_avatar,
    (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count
    FROM posts JOIN users ON users.id = posts.user_id ORDER BY created DESC LIMIT 100`, [], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ posts: rows });
  });
});

// API: comment
app.post('/api/posts/:postId/comments', requireAuth, (req,res) => {
  const postId = req.params.postId;
  const userId = req.session.userId;
  const text = req.body.text || '';
  const created = Date.now();
  db.run(`INSERT INTO comments (post_id,user_id,text,created) VALUES (?,?,?,?)`, [postId, userId, text, created], function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get(`SELECT comments.*, users.name as author_name, users.avatar as author_avatar FROM comments JOIN users ON users.id = comments.user_id WHERE comments.id = ?`, [this.lastID], (e,row)=>{
      res.json({ comment: row });
      io.emit('new_comment', { postId, comment: row });
    });
  });
});

// API: get comments for post
app.get('/api/posts/:postId/comments', (req,res) => {
  const postId = req.params.postId;
  db.all(`SELECT comments.*, users.name as author_name, users.avatar as author_avatar FROM comments JOIN users ON users.id = comments.user_id WHERE post_id = ? ORDER BY created ASC`, [postId], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ comments: rows });
  });
});

// API: like / unlike
app.post('/api/posts/:postId/like', requireAuth, (req,res) => {
  const postId = req.params.postId;
  const userId = req.session.userId;
  db.get(`SELECT * FROM likes WHERE post_id = ? AND user_id = ?`, [postId,userId], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    if(row){
      db.run(`DELETE FROM likes WHERE id = ?`, [row.id], function(err2){
        if(err2) return res.status(500).json({ error: err2.message });
        res.json({ liked: false });
        io.emit('like_changed', { postId, userId, liked: false });
      });
    } else {
      db.run(`INSERT INTO likes (post_id,user_id) VALUES (?,?)`, [postId,userId], function(err3){
        if(err3) return res.status(500).json({ error: err3.message });
        res.json({ liked: true });
        io.emit('like_changed', { postId, userId, liked: true });
      });
    }
  });
});

// API: list users (simple friends suggestions)
app.get('/api/users', requireAuth, (req,res) => {
  const q = req.query.q || '';
  db.all(`SELECT id,name,email,avatar FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 50`, ['%'+q+'%','%'+q+'%'], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ users: rows });
  });
});

// Simple friends: send request and accept (status: requested, accepted)
app.post('/api/friends/:friendId', requireAuth, (req,res) => {
  const me = req.session.userId;
  const friendId = req.params.friendId;
  db.run(`INSERT INTO friends (user_id,friend_id,status) VALUES (?,?,?)`, [me, friendId, 'accepted'], function(err){
    if(err) return res.status(500).json({ error: err.message });
    res.json({ ok:true });
  });
});
app.get('/api/friends', requireAuth, (req,res) => {
  const me = req.session.userId;
  db.all(`SELECT users.id, users.name, users.avatar FROM friends JOIN users ON users.id = friends.friend_id WHERE friends.user_id = ?`, [me], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ friends: rows });
  });
});

// Socket.IO for chat (very simple broadcast)

// API: get user profile
app.get('/api/users/:id', (req,res) => {
  const id = req.params.id;
  db.get(`SELECT id,name,email,avatar FROM users WHERE id = ?`, [id], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    // also fetch user's posts
    db.all(`SELECT posts.*, (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count FROM posts WHERE user_id = ? ORDER BY created DESC LIMIT 100`, [id], (e,posts)=>{
      if(e) return res.status(500).json({ error: e.message });
      res.json({ user: row, posts });
    });
  });
});

// API: update profile (name, avatar)
// Accepts multipart/form-data with optional avatar file
app.post('/api/users/:id', upload.single('avatar'), requireAuth, (req,res) => {
  const id = parseInt(req.params.id,10);
  if(req.session.userId !== id) return res.status(403).json({ error: 'forbidden' });
  const name = req.body.name || null;
  let avatar = null;
  if(req.file) avatar = '/uploads/' + req.file.filename;
  db.get(`SELECT * FROM users WHERE id = ?`, [id], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    const newName = name || row.name;
    const newAvatar = avatar || row.avatar;
    db.run(`UPDATE users SET name = ?, avatar = ? WHERE id = ?`, [newName, newAvatar, id], function(err2){
      if(err2) return res.status(500).json({ error: err2.message });
      res.json({ ok:true, name: newName, avatar: newAvatar });
    });
  });
});

// Conversations & messages APIs
app.post('/api/conversations', requireAuth, (req,res) => {
  const a = req.session.userId;
  const b = parseInt(req.body.otherId,10);
  if(!b) return res.status(400).json({ error: 'otherId required' });
  // ensure conversation exists (user_a < user_b for uniqueness)
  const ua = Math.min(a,b), ub = Math.max(a,b);
  db.get(`SELECT * FROM conversations WHERE user_a = ? AND user_b = ?`, [ua,ub], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    if(row) return res.json({ conversation: row });
    const now = Date.now();
    db.run(`INSERT INTO conversations (user_a,user_b,last_updated) VALUES (?,?,?)`, [ua,ub,now], function(err2){
      if(err2) return res.status(500).json({ error: err2.message });
      db.get(`SELECT * FROM conversations WHERE id = ?`, [this.lastID], (e,newrow)=>{ res.json({ conversation: newrow }); });
    });
  });
});

app.get('/api/conversations', requireAuth, (req,res) => {
  const me = req.session.userId;
  db.all(`SELECT * FROM conversations WHERE user_a = ? OR user_b = ? ORDER BY last_updated DESC`, [me,me], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ conversations: rows });
  });
});

app.get('/api/conversations/:id/messages', requireAuth, (req,res) => {
  const convId = req.params.id;
  db.all(`SELECT messages.*, users.name as sender_name, users.avatar as sender_avatar FROM messages JOIN users ON users.id = messages.sender_id WHERE conversation_id = ? ORDER BY created ASC`, [convId], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ messages: rows });
  });
});

// API: send message to conversation (server will persist and emit to room)
app.post('/api/conversations/:id/messages', requireAuth, (req,res) => {
  const convId = req.params.id;
  const userId = req.session.userId;
  const text = req.body.text || '';
  const now = Date.now();
  db.run(`INSERT INTO messages (conversation_id, sender_id, text, created) VALUES (?,?,?,?)`, [convId, userId, text, now], function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get(`SELECT messages.*, users.name as sender_name, users.avatar as sender_avatar FROM messages JOIN users ON users.id = messages.sender_id WHERE messages.id = ?`, [this.lastID], (e,row)=>{
      if(e) return res.status(500).json({ error: e.message });
      // update conversation last_updated
      db.run(`UPDATE conversations SET last_updated = ? WHERE id = ?`, [now, convId]);
      // emit to room
      io.to('conv_'+convId).emit('conv_message', row);
      res.json({ message: row });
    });
  });
});

// Reactions API: react/unreact to post
app.post('/api/posts/:postId/react', requireAuth, (req,res) => {
  const postId = req.params.postId;
  const userId = req.session.userId;
  const type = req.body.type || 'like';
  // check existing
  db.get(`SELECT * FROM reactions WHERE post_id = ? AND user_id = ?`, [postId,userId], (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    if(row){
      // update type
      db.run(`UPDATE reactions SET type = ? WHERE id = ?`, [type, row.id], function(err2){
        if(err2) return res.status(500).json({ error: err2.message });
        io.emit('reaction_changed', { postId, userId, type });
        res.json({ ok:true, updated:true });
      });
    } else {
      db.run(`INSERT INTO reactions (post_id,user_id,type) VALUES (?,?,?)`, [postId,userId,type], function(err3){
        if(err3) return res.status(500).json({ error: err3.message });
        io.emit('reaction_changed', { postId, userId, type });
        res.json({ ok:true, created:true });
      });
    }
  });
});

app.get('/api/posts/:postId/reactions', (req,res) => {
  const postId = req.params.postId;
  db.all(`SELECT reactions.*, users.name as user_name, users.avatar as user_avatar FROM reactions JOIN users ON users.id = reactions.user_id WHERE post_id = ?`, [postId], (err,rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json({ reactions: rows });
  });
});
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('chat_message', (msg) => {
    io.emit('chat_message', msg);
  });
  socket.on('join_conv', (data) => {
    const convId = data.convId;
    socket.join('conv_'+convId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('SquadZone server listening on', PORT));
