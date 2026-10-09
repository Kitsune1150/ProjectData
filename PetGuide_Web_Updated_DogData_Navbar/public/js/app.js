// ==========================================
// 1. Helper Functions (ฟังก์ชันช่วยเหลือทั่วไป)
// ==========================================

function getToken() {
  return localStorage.getItem("token");
}

function getUser() {
  try {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

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

// ==========================================
// 2. API Call Functions (ฟังก์ชันเชื่อมต่อ Server)
// ==========================================

async function api(url, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    alert(data.message || "เกิดข้อผิดพลาด");
    throw new Error(data.message || "เกิดข้อผิดพลาด");
  }
  return data;
}

async function fetchJSON(url) {
  return api(url);
}

// ==========================================
// 3. UI Functions (ฟังก์ชันจัดการการแสดงผล)
// ==========================================

// ฟังก์ชันสร้าง Card สัตว์เลี้ยง
function petCard(p) {
  const params = new URLSearchParams({ id: p._id });
  if (location.pathname.replace(/\/$/, "") === "/pets.html") {
    params.set("returnTo", location.pathname + location.search);
  }
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
        <a class="btn btn-primary full" href="/pet-detail.html?${params.toString()}">ดูรายละเอียด</a>
      </div>
    </div>
  `;
}

// ฟังก์ชันจัดการ Navbar ด้านขวา
function loadAuthNav() {
  const authContainer = document.getElementById("nav-auth") || document.getElementById("authNav");
  if (!authContainer) return;

  const user = getUser();

  if (user && user.username) {
    // แสดงชื่อผู้ใช้เป็นข้อความสีเขียวเข้ม (#1b4332) + ปุ่มออกจากระบบ
    authContainer.innerHTML = `
      <span style="font-size: 0.95rem; color: #1b4332; margin-right: 12px; font-weight: 500;">
        ${escapeHtml(user.username)}
      </span>
      <button type="button" class="btn btn-light" onclick="logout()">ออกจากระบบ</button>
    `;
  } else {
    // กรณีไม่ได้เข้าสู่ระบบ
    authContainer.innerHTML = `
      <a href="login.html" class="btn btn-light">เข้าสู่ระบบ</a>
      <a href="register.html" class="btn btn-primary nav-register">สมัครสมาชิก</a>
    `;
  }
}

// ฟังก์ชันออกจากระบบ
function logout() {
  if (confirm("ต้องการออกจากระบบหรือไม่?")) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = "login.html";
  }
}