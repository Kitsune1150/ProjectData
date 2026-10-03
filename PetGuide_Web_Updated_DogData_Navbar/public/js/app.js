function getToken(){return localStorage.getItem("token")}
function getUser(){try{return JSON.parse(localStorage.getItem("user"))}catch{return null}}
async function api(url, options={}){
  options.headers = {"Content-Type":"application/json", ...(options.headers||{})};
  const token=getToken();
  if(token) options.headers.Authorization="Bearer "+token;
  const res=await fetch(url,options);
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message||"เกิดข้อผิดพลาด");
  return data;
}
async function fetchJSON(url){return api(url)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function safeUrl(value){
  const s=String(value||"");
  return /^https?:\/\//i.test(s)?s:"https://images.unsplash.com/photo-1601758125946-6ec2ef64daf8?auto=format&fit=crop&w=900&q=80";
}
function petCard(p){
 return `<article class="pet-card"><img src="${safeUrl(p.image)}" alt="${escapeHtml(p.name)}"><div class="pet-card-body"><span class="badge">${escapeHtml(p.category)}</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><div class="tags"><span>ความยาก: ${escapeHtml(p.difficulty)}</span><span>ขนาด: ${escapeHtml(p.size)}</span></div><a class="btn btn-light full" href="/pet-detail.html?id=${p._id}">ดูรายละเอียด</a></div></article>`;
}
async function loadAuthNav(){
 const nav=document.getElementById("authNav"); if(!nav)return;
 const u=getUser();
 if(u) nav.innerHTML=`<a href="/favorites.html">รายการโปรด</a>${u.role==="admin"?'<a href="/admin.html">Admin</a>':''}<a href="#" onclick="logout()">ออกจากระบบ</a>`;
 else nav.innerHTML='<a href="/login.html">เข้าสู่ระบบ</a><a class="nav-register" href="/register.html">สมัครสมาชิก</a>';
}
function logout(){localStorage.removeItem("token");localStorage.removeItem("user");location.href="/"}
