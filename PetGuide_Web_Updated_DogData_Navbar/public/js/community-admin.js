(() => {
  if (getUser()?.role !== "admin") { location.replace("/login.html"); return; }
  loadAuthNav();
  const $ = id => document.getElementById(id);
  let cursor = null, generation = 0, rejectionOptions = [];
  const labels = { pending: "รอตรวจสอบ", approved: "อนุมัติแล้ว", rejected: "ไม่ผ่านกฎชุมชน" };
  async function load(append = false) {
    const version = append ? generation : ++generation;
    if (!append) { cursor = null; $("moderation-posts").replaceChildren(); }
    $("moderation-more").disabled = true; $("moderation-more").hidden = true;
    $("moderation-message").textContent = "กำลังโหลดโพสต์...";
    const query = new URLSearchParams({ status: $("moderation-status").value });
    if (append && cursor) query.set("before", cursor);
    try {
      const data = await api(`/api/community/admin/posts?${query}`, { silent: true });
      if (version !== generation) return;
      for (const post of data.posts) {
        const card = document.createElement("article");
        card.className = "community-card moderation-post"; card.dataset.id = post._id;
        const state = post.status || "approved";
        card.innerHTML = `<div class="community-author"><strong>${escapeHtml(post.username)}</strong><span class="community-meta">${escapeHtml(new Date(post.createdAt).toLocaleString("th-TH"))}</span></div>
          <span class="community-badge">${escapeHtml(post.category)}</span><span class="community-badge">${post.type === "question" ? "คำถาม" : "บทความ"}</span><span class="community-badge community-state-${state}">${labels[state] || ""}</span>
          <h3>${escapeHtml(post.title)}</h3><p class="community-content">${escapeHtml(post.content)}</p>
          <div class="community-images">${(post.images || []).map(src => `<a href="${escapeHtml(safeUrl(src))}" target="_blank" rel="noopener"><img src="${escapeHtml(safeUrl(src))}" alt="รูปประกอบโพสต์" loading="lazy" /></a>`).join("")}</div>
          ${state === "rejected" ? `<p class="community-review-message">เหตุผล: ${escapeHtml(post.rejectionReason)}</p>` : ""}
          ${state === "pending" ? `<form class="moderation-review"><p class="reason-label" id="reason-label-${post._id}">เหตุผลเมื่อไม่อนุมัติ <span class="community-meta">(เลือกได้หลายข้อ)</span></p>
            <details class="reason-picker"><summary aria-labelledby="reason-label-${post._id} reason-summary-${post._id}"><span id="reason-summary-${post._id}" class="reason-summary">เลือกเหตุผลที่ไม่อนุมัติ</span></summary>
              <fieldset class="reason-options"><legend class="visually-hidden">เหตุผลที่ไม่อนุมัติ เลือกได้หลายข้อ</legend>${rejectionOptions.map(option => `<label class="reason-option"><input type="checkbox" name="reasons" value="${escapeHtml(option.code)}" /><span>${escapeHtml(option.label)}</span></label>`).join("")}</fieldset>
            </details><p class="reason-selection community-meta" aria-live="polite" hidden></p><p class="reason-error" role="alert" hidden>กรุณาเลือกเหตุผลอย่างน้อย 1 ข้อก่อนแจ้งผู้ใช้</p>
            <div class="moderation-actions"><button type="button" class="btn btn-primary" data-approve>อนุมัติและเผยแพร่</button><button type="submit" class="btn btn-light">ไม่อนุมัติ / แจ้งผู้ใช้</button></div></form>` : ""}`;
        const deleteActions = document.createElement("div");
        deleteActions.className = "moderation-actions";
        deleteActions.innerHTML = '<button type="button" class="btn admin-delete-post" data-delete>&#x0e25;&#x0e1a; &#x0e42;&#x0e1e;&#x0e2a;&#x0e15;&#x0e4c;</button>';
        card.append(deleteActions);
        $("moderation-posts").append(card);
      }
      cursor = data.nextCursor;
      $("moderation-message").textContent = $("moderation-posts").children.length ? "" : "ไม่มีโพสต์ในสถานะนี้";
    } catch (error) { if (version === generation) $("moderation-message").textContent = "โหลดไม่สำเร็จ กรุณารีเฟรชรายการ"; }
    finally { if (version === generation) { $("moderation-more").disabled = false; $("moderation-more").hidden = !cursor; } }
  }
  async function review(card, state) {
    const form = card.querySelector("form"), reasons = Array.from(form.querySelectorAll('[name="reasons"]:checked'), input => input.value);
    if (state === "rejected" && !reasons.length) {
      form.querySelector(".reason-error").hidden = false;
      form.querySelector(".reason-picker").open = true;
      form.querySelector('[name="reasons"]').focus(); return;
    }
    const controls = Array.from(form.elements);
    if (controls.some(control => control.disabled)) return;
    controls.forEach(control => { control.disabled = true; });
    try {
      const result = await api(`/api/community/admin/posts/${card.dataset.id}/review`, { method: "PUT", body: JSON.stringify({ status: state, reasons }), silent: true });
      await load(); $("moderation-message").textContent = result.message;
    } catch (error) { $("moderation-message").textContent = error.message; }
    finally { controls.forEach(control => { control.disabled = false; }); }
  }
  const deleteDialog = $("delete-post-dialog");
  const deleteDescription = $("delete-post-description");
  const deleteError = $("delete-post-error");
  const confirmDeleteButton = $("confirm-delete-post");
  let pendingDelete = null;

  function closeDeleteDialog() {
    deleteDialog.hidden = true;
    pendingDelete = null;
    deleteError.hidden = true;
    confirmDeleteButton.disabled = false;
  }
  function openDeleteDialog(card, button) {
    pendingDelete = { card, button };
    deleteDescription.textContent = card.querySelector("h3")?.textContent || "this post";
    deleteError.hidden = true;
    deleteDialog.hidden = false;
    $("cancel-delete-post").focus();
  }
  async function deletePost() {
    if (!pendingDelete || confirmDeleteButton.disabled) return;
    const { card } = pendingDelete;
    confirmDeleteButton.disabled = true;
    deleteError.hidden = true;
    try {
      const result = await api("/api/community/admin/posts/" + card.dataset.id, { method: "DELETE", silent: true });
      closeDeleteDialog();
      await load();
      $("moderation-message").textContent = result.message;
    } catch (error) {
      deleteError.textContent = error.status === 404 && error.message === "Post not found"
        ? "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e42\u0e1e\u0e2a\u0e15\u0e4c\u0e19\u0e35\u0e49 \u0e2d\u0e32\u0e08\u0e16\u0e39\u0e01\u0e25\u0e1a\u0e44\u0e1b\u0e41\u0e25\u0e49\u0e27 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e35\u0e40\u0e1f\u0e23\u0e0a\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23"
        : error.status === 404
          ? "\u0e44\u0e21\u0e48\u0e1e\u0e1a API \u0e25\u0e1a\u0e42\u0e1e\u0e2a\u0e15\u0e4c \u0e01\u0e23\u0e38\u0e13\u0e32\u0e23\u0e35\u0e2a\u0e15\u0e32\u0e23\u0e4c\u0e17\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e43\u0e2b\u0e21\u0e48"
          : error.message || "\u0e25\u0e1a\u0e42\u0e1e\u0e2a\u0e15\u0e4c\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e25\u0e2d\u0e07\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07";
      deleteError.hidden = false;
      confirmDeleteButton.disabled = false;
    }
  }
  $("cancel-delete-post").addEventListener("click", closeDeleteDialog);
  confirmDeleteButton.addEventListener("click", deletePost);
  deleteDialog.addEventListener("click", event => { if (event.target === deleteDialog) closeDeleteDialog(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !deleteDialog.hidden) closeDeleteDialog(); });
  $("moderation-posts").addEventListener("click", event => {
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) return openDeleteDialog(event.target.closest(".moderation-post"), deleteButton);
    if (event.target.closest("[data-approve]")) review(event.target.closest(".moderation-post"), "approved");
  });
  $("moderation-posts").addEventListener("submit", event => { event.preventDefault(); review(event.target.closest(".moderation-post"), "rejected"); });
  $("moderation-posts").addEventListener("change", event => {
    if (event.target.name !== "reasons") return;
    const form = event.target.closest("form");
    const selected = Array.from(form.querySelectorAll('[name="reasons"]:checked'), input => rejectionOptions.find(option => option.code === input.value).label);
    form.querySelector(".reason-summary").textContent = selected.length ? `เลือกแล้ว ${selected.length} ข้อ` : "เลือกเหตุผลที่ไม่อนุมัติ";
    const selection = form.querySelector(".reason-selection");
    selection.hidden = !selected.length; selection.textContent = selected.join(" • ");
    form.querySelector(".reason-error").hidden = true;
  });
  document.addEventListener("click", event => {
    document.querySelectorAll(".reason-picker[open]").forEach(picker => { if (!picker.contains(event.target)) picker.open = false; });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const picker = event.target.closest(".reason-picker[open]");
    if (picker) { picker.open = false; picker.querySelector("summary").focus(); }
  });
  $("moderation-status").onchange = () => load();
  $("moderation-refresh").onclick = () => load();
  $("moderation-more").onclick = () => load(true);
  (async () => {
    try { rejectionOptions = await api("/data/community-rejection-reasons.json", { silent: true }); await load(); }
    catch { $("moderation-message").textContent = "โหลดตัวเลือกเหตุผลไม่สำเร็จ กรุณารีเฟรชหน้า"; }
  })();
})();
