// Page butiran job — rantaian Quotation → PO → DO → Invois → Bayaran.
const params = new URLSearchParams(location.search);
const jobId = params.get("id");
const autoOpen = params.get("buka");
function toast(message) {
  if (!message) return;
  const box = $("#toast");
  box.textContent = message; box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 2600);
}
let jobs = readJobs();
let job = jobs.find(item => item.id === jobId);
let openDocKey = null;
let editingPaymentId = null;
let confirmDeleteJob = false;
let confirmDeletePayment = false;
let confirmClearDoc = false;

const DOC_META = {
  quotation: {
    eyebrow: "LANGKAH 1", title: "Sebut harga", prefix: "prefixQuote",
    statuses: [["draft", "Draf — belum hantar"], ["sent", "Sudah dihantar"], ["won", "Pelanggan setuju"], ["lost", "Pelanggan tolak"], ["expired", "Tempoh luput"]],
    showAmount: true, showExtra: true, showStatus: true, showTerms: false, showItems: true
  },
  invoice: {
    eyebrow: "LANGKAH 2", title: "Invois", prefix: "prefixInvoice",
    statuses: [], showAmount: true, showExtra: false, showStatus: false, showTerms: true, showItems: true
  }
};

function saveAll() { writeJobs(jobs); render(); }
function statusLabel(key, value) {
  const found = (DOC_META[key].statuses || []).find(pair => pair[0] === value);
  return found ? found[1] : "";
}

function docRows(key) {
  const doc = job[key] || {};
  const rows = [];
  if (doc.no) rows.push(["No", doc.no]);
  if (doc.date) rows.push(["Tarikh", dateLabel(doc.date)]);
  if (DOC_META[key].showAmount && doc.amount) rows.push(["Jumlah", money(doc.amount)]);
  if (itemsOf(job).length) rows.push(["Item", `${itemsOf(job).length} baris`]);
  if (key === "quotation" && doc.validUntil) rows.push(["Sah sehingga", dateLabel(doc.validUntil)]);
  if (key === "invoice") {
    const due = dueDateOf(job);
    if (due) rows.push(["Jatuh tempo", `${dateLabel(due)}${doc.terms ? ` (${doc.terms} hari)` : ""}`]);
  }
  if (DOC_META[key].showStatus && doc.status) rows.push(["Status", statusLabel(key, doc.status)]);
  if (key === "invoice") rows.push(["Status", doc.sent ? `Sudah dihantar${doc.sentAt ? ` · ${dateLabel(doc.sentAt)}` : ""}` : "Belum ditanda hantar"]);
  return rows;
}

function renderDoc(key, containerId) {
  const container = $(containerId);
  const card = container.closest(".doc-card");
  const filled = hasDoc(job, key);
  card.classList.toggle("is-filled", filled);
  container.innerHTML = "";
  const button = card.querySelector(".doc-button");
  button.textContent = filled ? "Edit" : "Isi";

  if (!filled) {
    container.innerHTML = `<p class="doc-empty">Belum ada.</p>`;
    return;
  }
  const rows = docRows(key);
  const list = document.createElement("dl");
  list.className = "doc-rows";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    list.append(dt, dd);
  });
  container.append(list);
  const link = (job[key] || {}).link;
  if (link) {
    const anchor = document.createElement("a");
    anchor.className = "doc-link"; anchor.href = link; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
    anchor.textContent = "Buka fail ↗";
    container.append(anchor);
  }
}

function renderPayments() {
  const list = $("#paymentList");
  const items = paymentsOf(job).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  $("#paymentCount").textContent = `${items.length} bayaran`;
  list.innerHTML = "";
  if (!items.length) { list.innerHTML = `<p class="doc-empty">Belum ada bayaran direkod.</p>`; return; }
  items.forEach(payment => {
    const row = document.createElement("article");
    row.className = "payment-row";
    row.innerHTML = `<div><b></b><span></span></div><div class="row-end"><strong>${money(payment.amount)}</strong><a class="edit-button" href="doc.html?id=${encodeURIComponent(job.id)}&jenis=receipt&bayaran=${payment.id}" aria-label="Cetak resit">🖨</a><button class="edit-button" type="button" data-payment="${payment.id}" aria-label="Edit bayaran">✎</button></div>`;
    row.querySelector("b").textContent = `${dateLabel(payment.date)} · ${payment.method || "—"}`;
    row.querySelector("span").textContent = [payment.receiptNo, payment.ref].filter(Boolean).join(" · ") || "Tiada rujukan";
    list.append(row);
  });
}

function render() {
  if (!job) return;
  $("#jobNoLabel").textContent = job.jobNo || "JOB";
  $("#jobCustomerLabel").textContent = job.customer || "Tanpa nama";
  $("#jobTitleLabel").textContent = job.title || "";
  $("#jobValueLabel").textContent = money(jobValue(job));
  $("#jobPaidLabel").textContent = money(paidTotal(job));
  $("#jobBalanceLabel").textContent = money(balanceOf(job));
  $("#jobDateLabel").textContent = jobDate(job) ? dateLabel(jobDate(job)) : "—";
  $("#jobDueLabel").textContent = hasDoc(job, "invoice") ? dateLabel(dueDateOf(job)) : "—";

  renderNext();
  renderPrintButtons();
  renderDoc("quotation", "#docQuotation");
  renderDoc("invoice", "#docInvoice");
  renderPayments();
}

function markInvoiceSent() {
  const message = applyInstant(job, jobs, "invoice-sent");
  saveAll(); toast(message);
}

function renderPrintButtons() {
  $("#printQuote").hidden = !hasDoc(job, "quotation");
  $("#printInvoice").hidden = !hasDoc(job, "invoice");
}
$("#printQuote").addEventListener("click", () => { location.href = `doc.html?id=${encodeURIComponent(job.id)}&jenis=quotation`; });
$("#printInvoice").addEventListener("click", () => { location.href = `doc.html?id=${encodeURIComponent(job.id)}&jenis=invoice`; });

function renderNext() {
  const card = $("#nextCard");
  const action = nextAction(job);
  if (!action) {
    card.className = "next-card done";
    $("#nextTitle").textContent = isPaid(job) ? "Selesai — duit dah masuk 🎉" : "Tiada tindakan";
    $("#nextHint").textContent = isPaid(job) ? "Kerja ini lengkap dari sebut harga sampai bayaran." : "Job ini ditandakan pelanggan tolak.";
    $("#nextCta").hidden = true; $("#nextSecondary").hidden = true;
    return;
  }
  card.className = `next-card${action.urgent ? " urgent" : ""}`;
  $("#nextTitle").textContent = action.title;
  $("#nextHint").textContent = action.hint;
  const cta = $("#nextCta");
  cta.hidden = false; cta.textContent = action.cta;
  cta.dataset.instant = action.instant || ""; cta.dataset.open = action.open || "";
  const secondary = $("#nextSecondary");
  if (action.secondary) {
    secondary.hidden = false; secondary.textContent = action.secondary.cta;
    secondary.dataset.instant = action.secondary.instant || "";
    secondary.dataset.open = action.secondary.open || "";
    secondary.dataset.print = action.secondary.print || "";
  }
  else secondary.hidden = true;
}

function runNext(button) {
  if (button.dataset.print) { location.href = `doc.html?id=${encodeURIComponent(job.id)}&jenis=${button.dataset.print}`; return; }
  if (button.dataset.instant) { const message = applyInstant(job, jobs, button.dataset.instant); saveAll(); toast(message); return; }
  if (button.dataset.open === "payment") return openPayment(null);
  if (button.dataset.open) return openDoc(button.dataset.open);
}
$("#nextCta").addEventListener("click", () => runNext($("#nextCta")));
$("#nextSecondary").addEventListener("click", () => runNext($("#nextSecondary")));

/* ---------- Editor senarai item ---------- */
let draftItems = [];
function renderItemsEditor() {
  const box = $("#itemRowsEdit");
  box.innerHTML = "";
  draftItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<input type="text" placeholder="Perihal kerja atau barang" maxlength="90" data-field="description" data-index="${index}" />
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Kuantiti" data-field="qty" data-index="${index}" />
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Harga" data-field="price" data-index="${index}" />
      <button type="button" class="delete-button" data-remove="${index}" aria-label="Buang baris">×</button>`;
    row.querySelector('[data-field="description"]').value = item.description || "";
    row.querySelector('[data-field="qty"]').value = item.qty ?? 1;
    row.querySelector('[data-field="price"]').value = item.price ?? "";
    box.append(row);
  });
  const total = draftItems.reduce((sum, item) => sum + lineTotal(item), 0);
  $("#itemsTotalLabel").textContent = money(total);
  if (draftItems.length) $("#docAmount").value = total.toFixed(2);
}
$("#addItem").addEventListener("click", () => { draftItems.push({ description: "", qty: 1, price: "" }); renderItemsEditor(); });
$("#itemRowsEdit").addEventListener("input", event => {
  const field = event.target.dataset.field;
  if (!field) return;
  draftItems[Number(event.target.dataset.index)][field] = field === "description" ? event.target.value : Number(event.target.value);
  const total = draftItems.reduce((sum, item) => sum + lineTotal(item), 0);
  $("#itemsTotalLabel").textContent = money(total);
  $("#docAmount").value = total.toFixed(2);
});
$("#itemRowsEdit").addEventListener("click", event => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  draftItems.splice(Number(button.dataset.remove), 1);
  renderItemsEditor();
});

/* ---------- Edit maklumat job ---------- */
$("#editJob").addEventListener("click", () => {
  $("#editCustomer").value = job.customer || "";
  $("#editJobNo").value = job.jobNo || "";
  $("#editTitle").value = job.title || "";
  $("#editDate").value = jobDate(job) || "";
  $("#editCustomerAddress").value = job.customerAddress || "";
  $("#editCustomerContact").value = job.customerContact || "";
  $("#editNote").value = job.note || "";
  $("#jobDialog").showModal();
});
$("#jobEditForm").addEventListener("submit", event => {
  event.preventDefault();
  job.customer = $("#editCustomer").value.trim();
  job.jobNo = $("#editJobNo").value.trim();
  job.title = $("#editTitle").value.trim();
  job.date = $("#editDate").value;
  job.customerAddress = $("#editCustomerAddress").value.trim();
  job.customerContact = $("#editCustomerContact").value.trim();
  job.note = $("#editNote").value.trim();
  $("#jobDialog").close();
  saveAll();
});

/* ---------- Dialog dokumen ---------- */
document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => openDoc(button.dataset.open)));

function openDoc(key) {
  const meta = DOC_META[key];
  const doc = job[key] || {};
  openDocKey = key;
  confirmClearDoc = false;
  $("#docEyebrow").textContent = meta.eyebrow;
  $("#docTitle").textContent = meta.title;
  $("#docHelp").textContent = meta.help || "";

  const settings = readSettings();
  $("#docNo").value = doc.no || (key === "po" ? "" : nextNumber(settings[meta.prefix], allNumbers(jobs, key)));
  $("#docDate").value = doc.date || todayIso();
  $("#docAmount").value = doc.amount || suggestedAmount(job, key) || "";
  $("#docExtraDate").value = doc.validUntil || "";
  $("#docTerms").value = doc.terms ?? settings.terms;
  $("#docDueDate").value = doc.dueDate || "";
  $("#docLink").value = doc.link || "";

  draftItems = itemsOf(job).map(item => ({ ...item }));
  if (!draftItems.length && !hasDoc(job, key)) draftItems = [{ description: job.title || "", qty: 1, price: suggestedAmount(job, key) || "" }];
  renderItemsEditor();
  $("#docAmountField").hidden = !meta.showAmount;
  $("#docExtraField").hidden = !meta.showExtra;

  $("#docTermsRow").hidden = !meta.showTerms;
  $("#docStatusField").hidden = !meta.showStatus;
  if (meta.showStatus) {
    $("#docStatus").innerHTML = meta.statuses.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    $("#docStatus").value = doc.status || meta.statuses[0][0];
  }
  $("#clearDoc").textContent = "Kosongkan dokumen ini";
  $("#clearDoc").hidden = !hasDoc(job, key);
  $("#docDialog").showModal();
  $("#docNo").focus();
}

$("#docForm").addEventListener("submit", event => {
  event.preventDefault();
  const key = openDocKey;
  const meta = DOC_META[key];
  const doc = { ...(job[key] || {}) };
  doc.no = $("#docNo").value.trim();
  doc.date = $("#docDate").value;
  doc.link = $("#docLink").value.trim();
  if (meta.showAmount) doc.amount = Number($("#docAmount").value) || 0;
  if (meta.showExtra) doc.validUntil = $("#docExtraDate").value;
  if (meta.showStatus) doc.status = $("#docStatus").value;
  if (meta.showTerms) {
    doc.terms = Number($("#docTerms").value) || 0;
    doc.dueDate = $("#docDueDate").value;
  }
  const cleanItems = draftItems.filter(item => (item.description || "").trim() || Number(item.price) > 0);
  if (cleanItems.length) { job.items = cleanItems; doc.amount = cleanItems.reduce((sum, item) => sum + lineTotal(item), 0); }
  job[key] = doc;
  if (key === "invoice" && doc.date && !doc.dueDate) job.invoice.dueDate = dueDateOf(job);
  $("#docDialog").close();
  saveAll();
  toast(`${DOC_META[key].title} disimpan.`);
});

$("#clearDoc").addEventListener("click", () => {
  if (!confirmClearDoc) { confirmClearDoc = true; $("#clearDoc").textContent = "Tekan sekali lagi untuk kosongkan"; return; }
  job[openDocKey] = {};
  confirmClearDoc = false;
  $("#docDialog").close();
  saveAll();
});

$("#docTerms").addEventListener("input", () => {
  const date = $("#docDate").value;
  const terms = Number($("#docTerms").value);
  if (!date || !Number.isFinite(terms)) return;
  const due = new Date(`${date}T12:00:00`);
  due.setDate(due.getDate() + terms);
  $("#docDueDate").value = due.toISOString().slice(0, 10);
});

/* ---------- Bayaran ---------- */
$("#addPayment").addEventListener("click", () => openPayment(null));
$("#paymentList").addEventListener("click", event => {
  const button = event.target.closest("[data-payment]");
  if (button) openPayment(button.dataset.payment);
});

function openPayment(paymentId) {
  editingPaymentId = paymentId;
  confirmDeletePayment = false;
  const payment = paymentId ? paymentsOf(job).find(item => item.id === paymentId) : null;
  const settings = readSettings();
  $("#paymentDialogTitle").textContent = payment ? "Edit bayaran" : "Rekod bayaran";
  $("#paymentHelp").textContent = hasDoc(job, "invoice")
    ? `Invois ${job.invoice.no || ""} ${money(invoiced(job))} · baki semasa ${money(balanceOf(job))}`
    : "Belum ada invois untuk job ini — bayaran tetap boleh direkod (contoh: deposit).";
  $("#payAmount").value = payment ? payment.amount : (balanceOf(job) || "");
  $("#payDate").value = payment ? payment.date : todayIso();
  $("#payMethod").value = payment ? payment.method || "Online Transfer" : "Online Transfer";
  $("#payReceipt").value = payment ? payment.receiptNo || "" : nextNumber(settings.prefixReceipt, jobs.flatMap(item => paymentsOf(item).map(entry => entry.receiptNo)).filter(Boolean));
  $("#payRef").value = payment ? payment.ref || "" : "";
  $("#deletePayment").hidden = !payment;
  $("#deletePayment").textContent = "Padam bayaran ini";
  $("#paymentDialog").showModal();
  $("#payAmount").focus();
}

$("#paymentForm").addEventListener("submit", event => {
  event.preventDefault();
  const amount = Number($("#payAmount").value);
  if (!amount || amount <= 0) return;
  if (!Array.isArray(job.payments)) job.payments = [];
  const details = { amount, date: $("#payDate").value, method: $("#payMethod").value, receiptNo: $("#payReceipt").value.trim(), ref: $("#payRef").value.trim() };
  const existing = editingPaymentId ? job.payments.find(item => item.id === editingPaymentId) : null;
  if (existing) Object.assign(existing, details);
  else job.payments.push({ id: newId(), ...details });
  editingPaymentId = null;
  $("#paymentDialog").close();
  saveAll();
});

$("#deletePayment").addEventListener("click", () => {
  if (!editingPaymentId) return;
  if (!confirmDeletePayment) { confirmDeletePayment = true; $("#deletePayment").textContent = "Tekan sekali lagi untuk padam"; return; }
  job.payments = paymentsOf(job).filter(item => item.id !== editingPaymentId);
  editingPaymentId = null; confirmDeletePayment = false;
  $("#paymentDialog").close();
  saveAll();
});

/* ---------- Padam job ---------- */
$("#deleteJob").addEventListener("click", () => {
  if (!confirmDeleteJob) { confirmDeleteJob = true; $("#deleteJob").textContent = "Tekan sekali lagi untuk padam kerja ini"; return; }
  writeJobs(jobs.filter(item => item.id !== job.id));
  location.href = "index.html";
});

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
document.addEventListener("ft-cloud-data", () => { jobs = readJobs(); job = jobs.find(item => item.id === jobId) || job; render(); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));

if (!job) {
  document.querySelector(".app-shell").innerHTML = '<header class="topbar"><div><p class="eyebrow">BISNES TRACKER</p><h1>Kerja tidak dijumpai</h1></div><a class="icon-button nav-home" href="index.html">←</a></header><p class="doc-empty">Rekod ini mungkin sudah dipadam. <a href="index.html">Kembali ke senarai kerja</a>.</p>';
} else {
  render();
  if (autoOpen === "payment") openPayment(null);
  else if (autoOpen && DOC_META[autoOpen]) openDoc(autoOpen);
  if (autoOpen) history.replaceState(null, "", `job.html?id=${encodeURIComponent(jobId)}`);
}
