(() => {
  const $ = id => document.getElementById(id);
  const user = getUser();
  let selectedImages = [], cursor = null, generation = 0, imageGeneration = 0;
  let categoriesReady = false, readingImages = false, publishing = false;
  const date = value => new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const status = message => { $("community-status").textContent = message; };
  const showError = error => { if (!error.alerted) alert(error.message || "เกิดข้อผิดพลาด กรุณาลองใหม่"); };
  loadAuthNav();
  $("composer-launcher").hidden = !user;
  $("login-hint").hidden = !!user;
  $("mine-option").hidden = !user;
  $("community-admin-link").hidden = user?.role !== "admin";
  $("post-review-hint").hidden = user?.role === "admin";
  const dialog = $("post-dialog");
  if (user) {
    $("composer-username").textContent = user.username;
    document.querySelectorAll(".composer-avatar").forEach(avatar => { avatar.textContent = Array.from(user.username || "?")[0]; });
  }
  function updatePublishState() {
    $("publish").disabled = !categoriesReady || readingImages || publishing || !$("post-title").value.trim() || !$("post-content").value.trim() || !$("post-category").value;
  }
  function openComposer(type, withPhotos = false) {
    if (!user) return;
    if (type) $("post-type").value = type;
    dialog.showModal();
    document.body.classList.add("post-dialog-open");
    $("post-title").focus();
    if (withPhotos) $("post-images").click();
  }
  $("open-composer").onclick = () => openComposer();
  $("open-photo-post").onclick = () => openComposer(null, true);
  $("open-article-post").onclick = () => openComposer("article");
  $("open-question-post").onclick = () => openComposer("question");
  $("choose-post-images").onclick = () => $("post-images").click();
  $("close-composer").onclick = () => { if (!publishing) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (publishing) event.preventDefault(); });
  dialog.addEventListener("close", () => document.body.classList.remove("post-dialog-open"));
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && !publishing && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  $("post-form").addEventListener("input", updatePublishState);
  $("post-form").addEventListener("change", updatePublishState);

  function commentForm(postId) {
    return user ? `<form class="community-comment-form" data-post="${postId}"><div class="community-reply-context" hidden></div><textarea name="content" rows="2" required maxlength="2000" aria-label="ความคิดเห็น" placeholder="เขียนความคิดเห็น..."></textarea><button class="btn btn-primary" type="submit">ส่ง</button></form>`
      : `<p><a href="login.html">เข้าสู่ระบบ</a> เพื่อร่วมแสดงความคิดเห็น</p>`;
  }

  function postCard(post) {
    const card = document.createElement("article");
    card.className = "community-card community-post";
    card.dataset.id = post._id;
    const own = user && String(user.id || user._id) === post.userId;
    const state = post.status || "approved";
    const labels = { pending: "รอแอดมินตรวจสอบ", approved: "อนุมัติแล้ว", rejected: "ไม่ผ่านกฎชุมชน" };
    card.innerHTML = `<div class="community-author"><span class="community-avatar">${escapeHtml(Array.from(post.username || "?")[0])}</span><div><strong>${escapeHtml(post.username)}</strong><p class="community-meta">${escapeHtml(date(post.createdAt))}</p></div></div>
      <span class="community-badge">${post.type === "question" ? "คำถาม" : "บทความ"}</span><span class="community-badge">${escapeHtml(post.category)}</span>
      ${own ? `<span class="community-badge community-state-${state}">${labels[state] || ""}</span><button type="button" class="community-text-button community-delete" data-action="delete">ลบโพสต์</button>` : ""}
      ${own && state === "rejected" ? `<p class="community-review-message">ไม่ผ่านกฎชุมชน: ${escapeHtml(post.rejectionReason || "กรุณาตรวจสอบกฎชุมชนก่อนโพสต์ใหม่")}</p>` : ""}
      ${own && state === "pending" ? `<p class="community-meta">โพสต์นี้จะปรากฏในชุมชนเมื่อแอดมินอนุมัติแล้ว</p>` : ""}
      <h2>${escapeHtml(post.title)}</h2><p class="community-content">${escapeHtml(post.content)}</p>
      <div class="community-images">${post.images.map(src => `<a href="${escapeHtml(safeUrl(src))}" target="_blank" rel="noopener"><img src="${escapeHtml(safeUrl(src))}" alt="รูปประกอบโพสต์ ${escapeHtml(post.title)}" loading="lazy" /></a>`).join("")}</div>
      ${state === "approved" ? `<button type="button" class="community-text-button" data-action="comments">ความคิดเห็นและคำตอบ (${post.commentCount})</button>
      <section class="community-comment-area" hidden><div class="community-comments"></div>${commentForm(post._id)}</section>` : ""}`;
    return card;
  }

  async function loadFeed(append = false) {
    const version = append ? generation : ++generation;
    if (!append) { $("community-feed").replaceChildren(); cursor = null; }
    $("load-more").disabled = true;
    $("load-more").hidden = true;
    status("กำลังโหลดโพสต์...");
    const query = new URLSearchParams({ category: $("filter-category").value, type: $("filter-type").value });
    if ($("filter-scope").value === "mine") query.set("mine", "true");
    if (append && cursor) query.set("before", cursor);
    try {
      const data = await api(`/api/community/posts?${query}`);
      if (version !== generation) return;
      data.posts.forEach(post => $("community-feed").append(postCard(post)));
      cursor = data.nextCursor;
      status($("community-feed").children.length ? "" : $("filter-scope").value === "mine" ? "ยังไม่มีโพสต์ของคุณที่ตรงกับตัวกรอง" : "ยังไม่มีโพสต์ในหมวดนี้ เริ่มแบ่งปันเรื่องราวของคุณได้เลย");
    } catch (error) { if (version === generation) status("โหลดโพสต์ไม่สำเร็จ กรุณาเลือกหมวดอีกครั้งเพื่อโหลดใหม่"); }
    finally { if (version === generation) { $("load-more").disabled = false; $("load-more").hidden = !cursor; } }
  }

  function renderComments(card, comments) {
    const children = new Map();
    comments.forEach(c => { const key = c.parentId || null; if (!children.has(key)) children.set(key, []); children.get(key).push(c); });
    function branch(parent, depth = 0) {
      return (children.get(parent) || []).map(c => `<div class="community-comment"><strong>${escapeHtml(c.username)}</strong><span class="community-meta"> · ${escapeHtml(date(c.createdAt))}</span><p>${escapeHtml(c.content)}</p>${user ? `<button class="community-text-button" type="button" data-action="reply" data-comment="${c._id}" data-name="${escapeHtml(c.username)}">ตอบกลับ</button>` : ""}</div>${children.has(c._id) ? `<div class="${depth < 3 ? "community-thread" : ""}">${branch(c._id, depth + 1)}</div>` : ""}`).join("");
    }
    card.querySelector(".community-comments").innerHTML = comments.length ? branch(null) : `<p class="community-meta">ยังไม่มีความคิดเห็น มาเริ่มพูดคุยกัน</p>`;
    card.querySelector('[data-action="comments"]').textContent = `ความคิดเห็นและคำตอบ (${comments.length})`;
  }

  $("community-feed").addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest(".community-post"), area = card.querySelector(".community-comment-area");
    if (button.dataset.action === "delete") {
      if (!confirm("ลบโพสต์นี้พร้อมความคิดเห็นทั้งหมด? เมื่อลบแล้วจะไม่สามารถกู้คืนได้")) return;
      button.disabled = true;
      try {
        await api(`/api/community/posts/${card.dataset.id}`, { method: "DELETE" });
        await loadFeed(); await loadNotifications(); status("ลบโพสต์แล้ว");
      } catch (error) { showError(error); }
      finally { button.disabled = false; }
      return;
    }
    if (button.dataset.action === "comments") {
      if (!area.hidden) { area.hidden = true; return; }
      button.disabled = true;
      try { renderComments(card, await api(`/api/community/posts/${card.dataset.id}/comments`)); area.hidden = false; }
      catch (error) { showError(error); }
      finally { button.disabled = false; }
    } else if (button.dataset.action === "reply") {
      const form = area.querySelector("form");
      form.dataset.parent = button.dataset.comment;
      const context = form.querySelector(".community-reply-context");
      context.hidden = false;
      context.replaceChildren(document.createTextNode(`กำลังตอบกลับ ${button.dataset.name} `));
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "community-text-button"; cancel.textContent = "ยกเลิก";
      cancel.onclick = () => { delete form.dataset.parent; context.hidden = true; };
      context.append(cancel); form.elements.content.focus();
    }
  });

  $("community-feed").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target, button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await api(`/api/community/posts/${form.dataset.post}/comments`, { method: "POST", body: JSON.stringify({ content: form.elements.content.value, parentId: form.dataset.parent || null }) });
      form.reset(); delete form.dataset.parent; form.querySelector(".community-reply-context").hidden = true;
      status("ส่งความคิดเห็นแล้ว");
      renderComments(form.closest(".community-post"), await api(`/api/community/posts/${form.dataset.post}/comments`));
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  });

  $("post-images").addEventListener("change", async event => {
    const version = ++imageGeneration;
    selectedImages = []; $("image-preview").replaceChildren();
    const files = Array.from(event.target.files);
    readingImages = true; updatePublishState();
    try {
      if (files.length > 4 || files.some(f => f.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(f.type))) throw new Error("เลือก JPG, PNG หรือ WebP ได้ไม่เกิน 4 รูป รูปละไม่เกิน 5 MB");
      const images = await Promise.all(files.map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("อ่านรูปภาพไม่สำเร็จ")); reader.readAsDataURL(file); })));
      if (version !== imageGeneration) return;
      selectedImages = images;
      images.forEach((src, index) => {
        const figure = document.createElement("figure"), img = document.createElement("img"), remove = document.createElement("button");
        img.src = src; img.alt = `รูปที่เลือก ${index + 1}`;
        remove.type = "button"; remove.className = "community-text-button"; remove.textContent = "นำรูปออก";
        remove.onclick = () => { selectedImages = selectedImages.filter(image => image !== src); figure.remove(); };
        figure.append(img, remove); $("image-preview").append(figure);
      });
    } catch (error) { if (version === imageGeneration) { event.target.value = ""; showError(error); } }
    finally { if (version === imageGeneration) { readingImages = false; updatePublishState(); } }
  });

  $("post-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    if ($("publish").disabled) return;
    publishing = true; updatePublishState();
    $("publish").textContent = "กำลังโพสต์...";
    $("close-composer").disabled = true;
    const body = Object.fromEntries(new FormData(form)); body.images = selectedImages;
    const controls = Array.from(form.elements);
    controls.forEach(control => { control.disabled = true; });
    try {
      const post = await api("/api/community/posts", { method: "POST", body: JSON.stringify(body) });
      form.reset(); selectedImages = []; ++imageGeneration; $("image-preview").replaceChildren();
      dialog.close();
      $("filter-category").value = ""; $("filter-type").value = "";
      $("filter-scope").value = "mine";
      await loadFeed(); status(post.status === "pending" ? "ส่งโพสต์แล้ว กำลังรอแอดมินตรวจสอบก่อนเผยแพร่" : "เผยแพร่โพสต์แล้ว");
    } catch (error) { showError(error); }
    finally {
      controls.forEach(control => { control.disabled = false; });
      publishing = false; $("publish").textContent = "โพสต์"; $("close-composer").disabled = false;
      updatePublishState();
    }
  });
  $("filter-category").onchange = () => loadFeed();
  $("filter-type").onchange = () => loadFeed();
  $("filter-scope").onchange = () => loadFeed();
  $("refresh-community").onclick = async () => { await loadFeed(); await loadNotifications(); };
  $("load-more").onclick = () => loadFeed(true);
  async function loadNotifications() {
    if (!user || !getToken()) return;
    try {
      const response = await fetch("/api/community/notifications", { headers: { Authorization: "Bearer " + getToken() } });
      if (!response.ok) return;
      const data = await response.json();
      const panel = $("community-notifications");
      panel.hidden = !data.total;
      panel.innerHTML = `<h2>ผลการตรวจสอบโพสต์ (${data.total})</h2>${data.items.map(item => `<div class="community-notification"><strong>${escapeHtml(item.title)}</strong><p>ไม่ผ่านกฎชุมชน: ${escapeHtml(item.rejectionReason)}</p><button type="button" class="community-text-button" data-dismiss="${item._id}">รับทราบ</button></div>`).join("")}`;
    } catch { /* Retry when the page becomes visible or on the next refresh. */ }
  }
  $("community-notifications").addEventListener("click", async event => {
    const button = event.target.closest("[data-dismiss]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try { await api(`/api/community/posts/${button.dataset.dismiss}/notification`, { method: "PUT" }); await loadNotifications(); }
    catch (error) { showError(error); button.disabled = false; }
  });
  if (user) {
    setInterval(() => { if (!document.hidden) loadNotifications(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadNotifications(); });
    loadNotifications();
  }
  (async () => {
    try {
      const categories = await api("/api/categories");
      categories.forEach(c => { [$("post-category"), $("filter-category")].forEach(select => select.add(new Option(c.name, c.name))); });
      categoriesReady = true; updatePublishState();
    } catch (error) { $("publish").disabled = true; status("โหลดหมวดสัตว์เลี้ยงไม่สำเร็จ กรุณารีเฟรชหน้า"); return; }
    await loadFeed();
  })();
})();
