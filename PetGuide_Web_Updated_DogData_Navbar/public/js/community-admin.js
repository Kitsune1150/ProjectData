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
      const data = await api(`/api/community/admin/posts?${query}`);
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
      const result = await api(`/api/community/admin/posts/${card.dataset.id}/review`, { method: "PUT", body: JSON.stringify({ status: state, reasons }) });
      await load(); $("moderation-message").textContent = result.message;
    } catch (error) { if (!error.alerted) alert(error.message); }
    finally { controls.forEach(control => { control.disabled = false; }); }
  }
  $("moderation-posts").addEventListener("click", event => {
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
    try { rejectionOptions = await fetchJSON("/data/community-rejection-reasons.json"); await load(); }
    catch { $("moderation-message").textContent = "โหลดตัวเลือกเหตุผลไม่สำเร็จ กรุณารีเฟรชหน้า"; }
  })();
})();
