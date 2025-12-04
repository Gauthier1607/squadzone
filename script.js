async function apiJSON(url,opt){ const r = await fetch(url,opt); return r.json(); }
const postsEl = document.getElementById('posts');
document.getElementById('publish').onclick = async ()=>{
  const txt = document.getElementById('postText').value.trim();
  if(!txt){ alert('Écris quelque chose'); return; }
  const fd = new FormData(); fd.append('text', txt);
  const res = await fetch('/api/posts', { method:'POST', body: fd }); const j = await res.json();
  if(j.error) alert(j.error); else { document.getElementById('postText').value=''; loadPosts(); }
};
async function loadPosts(){
  const j = await apiJSON('/api/posts');
  postsEl.innerHTML='';
  for(const p of j.posts){
    const d = document.createElement('div'); d.className='post card';
    d.innerHTML = `<div class="head"><div class="avatar"></div><div><strong>${p.author_name}</strong><div style="font-size:12px;color:var(--muted)">${new Date(p.created).toLocaleString()}</div></div></div><div style="margin-top:8px">${p.text||''}</div><div style="margin-top:8px"><button class="like" data-id="${p.id}">👍 ${p.like_count||0}</button> <button class="comment" data-id="${p.id}">💬</button></div>`;
    postsEl.appendChild(d);
    d.querySelector('.like').onclick = async ()=>{ await fetch('/api/posts/'+p.id+'/like',{method:'POST'}); loadPosts(); };
    d.querySelector('.comment').onclick = async ()=>{ const t = prompt('Votre commentaire'); if(t){ await fetch('/api/posts/'+p.id+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})}); loadPosts(); } };
  }
}
window.addEventListener('load', ()=>{ loadPosts(); });
