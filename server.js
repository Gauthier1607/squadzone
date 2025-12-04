const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

const UPLOADS = path.join(__dirname,'uploads');
if(!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, UPLOADS),
  filename: (req,file,cb)=> cb(null, Date.now()+'-'+Math.random().toString(36,8)+path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(session({ secret:'squadzone-secret-v2', resave:false, saveUninitialized:false, cookie:{ maxAge:7*24*3600*1000 }}));
app.use('/uploads', express.static(UPLOADS));
app.use('/public', express.static(path.join(__dirname,'public')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const DB = path.join(__dirname,'squadzone.db');
const db = new sqlite3.Database(DB);
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, avatar TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, image TEXT, created INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER, text TEXT, created INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS likes (id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER)`);
});

app.post('/api/register', upload.single('avatar'), async (req,res)=>{
  try{
    const { name, email, password } = req.body;
    if(!email || !password) return res.status(400).json({ error:'email & password required' });
    const hash = await bcrypt.hash(password,10);
    const avatar = req.file ? '/uploads/'+req.file.filename : '/public/assets/default-avatar.png';
    db.run('INSERT INTO users (name,email,password,avatar) VALUES (?,?,?,?)',[name||email,email,hash,avatar], function(err){
      if(err) return res.status(400).json({ error: err.message });
      req.session.userId = this.lastID;
      res.json({ id:this.lastID, name:name||email, email, avatar });
    });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/login', (req,res)=>{
  const { email, password } = req.body;
  if(!email||!password) return res.status(400).json({ error:'email & password required' });
  db.get('SELECT * FROM users WHERE email = ?',[email], async (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(400).json({ error:'invalid credentials' });
    const ok = await bcrypt.compare(password,row.password);
    if(!ok) return res.status(400).json({ error:'invalid credentials' });
    req.session.userId = row.id;
    res.json({ id:row.id, name:row.name, email:row.email, avatar:row.avatar });
  });
});

app.post('/api/logout', (req,res)=>{ req.session.destroy(()=>res.json({ ok:true })); });

app.post('/api/posts', (req,res)=>{
  if(!req.session.userId) return res.status(401).json({ error:'unauthenticated' });
  const fd = { text: req.body.text || '' };
  db.run('INSERT INTO posts (user_id,text,created) VALUES (?,?,?)',[req.session.userId, fd.text, Date.now()], function(err){
    if(err) return res.status(500).json({ error: err.message });
    db.get('SELECT posts.*, users.name as author_name FROM posts JOIN users ON users.id = posts.user_id WHERE posts.id = ?',[this.lastID], (e,row)=>{ io.emit('new_post', row); res.json({ post: row }); });
  });
});

app.get('/api/posts', (req,res)=>{
  db.all('SELECT posts.*, users.name as author_name FROM posts JOIN users ON users.id = posts.user_id ORDER BY created DESC LIMIT 200', [], (err,rows)=>{ if(err) return res.status(500).json({ error: err.message }); res.json({ posts: rows }); });
});

io.on('connection', socket=>{
  socket.on('chat_message', msg=> io.emit('chat_message', msg));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('SquadZone v2 listening on', PORT));
