function getToken() { return localStorage.getItem("token") }
function getUser() { try { return JSON.parse(localStorage.getItem("user")) } catch { return null } }
async function api(url, options = {}) {
  options.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) options.headers.Authorization = "Bearer " + token;
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "เกิดข้อผิดพลาด");
  return data;
}
async function fetchJSON(url) { return api(url) }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) }
function safeUrl(value) {
  const s = String(value || "");
  return /^https?:\/\//i.test(s) ? s : "https://images.unsplash.com/photo-1601758125946-6ec2ef64daf8?auto=format&fit=crop&w=900&q=80";
}
function petCard(p) {
  return `<article class="pet-card"><img src="${safeUrl(p.image)}" alt="${escapeHtml(p.name)}"><div class="pet-card-body"><span class="badge">${escapeHtml(p.category)}</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><div class="tags"><span>ความยาก: ${escapeHtml(p.difficulty)}</span><span>ขนาด: ${escapeHtml(p.size)}</span></div><a class="btn btn-light full" href="/pet-detail.html?id=${p._id}">ดูรายละเอียด</a></div></article>`;
}
async function loadAuthNav() {
  const nav = document.getElementById("authNav"); if (!nav) return;
  const u = getUser();
  if (u) nav.innerHTML = `<a href="/favorites.html">รายการโปรด</a>${u.role === "admin" ? '<a href="/admin.html">Admin</a>' : ''}<a href="#" onclick="logout()">ออกจากระบบ</a>`;
  else nav.innerHTML = '<a href="/login.html">เข้าสู่ระบบ</a><a class="nav-register" href="/register.html">สมัครสมาชิก</a>';
}
function logout() { localStorage.removeItem("token"); localStorage.removeItem("user"); location.href = "/" }

// ดึงข้อมูล User จาก LocalStorage
function getUser() {
  try {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

// แปลงข้อความ HTML เพื่อความปลอดภัย
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(url) {
  return url || "https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=900&q=80";
}

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function api(url, options = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || "เกิดข้อผิดพลาด");
    throw new Error(data.message);
  }
  return data;
}

// ฟังก์ชันสร้าง Card สัตว์เลี้ยง (คลิกแล้วไปหน้า pet-detail.html)
function petCard(p) {
  return `
    <div class="pet-card">
      <img src="${safeUrl(p.image)}" alt="${escapeHtml(p.name)}">
      <div class="pet-card-body">
        <span class="badge">${escapeHtml(p.category)}</span>
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.description || "ไม่มีคำอธิบาย")}</p>
        <div class="tags">
          <span>ความยาก: ${escapeHtml(p.difficulty)}</span>
          <span>ขนาด: ${escapeHtml(p.size)}</span>
        </div>
        <a class="btn btn-primary full" href="pet-detail.html?id=${p._id}">ดูรายละเอียด</a>
      </div>
    </div>
  `;
}

function loadAuthNav() {
  const authContainer = document.getElementById("nav-auth");
  if (!authContainer) return;

  const user = getUser(); // ดึงข้อมูลผู้ใช้จาก localStorage

  if (user && user.username) {
    // กำหนดสีตัวหนังสือเป็น #1b4332 
    authContainer.innerHTML = `
      <span style="font-size: 0.95rem; color: #1b4332; margin-right: 12px; font-weight: 500;">
        ${escapeHtml(user.username)}
      </span>
      <button type="button" class="btn btn-light" onclick="logout()">ออกจากระบบ</button>
    `;
  } else {
    authContainer.innerHTML = `
      <a href="login.html" class="btn btn-light">เข้าสู่ระบบ</a>
      <a href="register.html" class="btn btn-primary">สมัครสมาชิก</a>
    `;
  }
}

function logout() {
  if (confirm("ต้องการออกจากระบบหรือไม่?")) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = "login.html";
  }
}