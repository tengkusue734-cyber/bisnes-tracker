// Page "Kerja saya" — tindakan seterusnya, ringkasan duit dan senarai kerja.
let jobs = readJobs();
let jobFilter = "active";
let searchTerm = "";
let deferredInstallPrompt;

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 2600);
}

function matchesSearch(job) {
  if (!searchTerm) return true;
  const haystack = [job.jobNo, job.customer, job.title, job.note,
    (job.quotation || {}).no, (job.po || {}).no, (job.delivery || {}).no, (job.invoice || {}).no,
    ...paymentsOf(job).map(payment => payment.receiptNo)].join(" ").toLowerCase();
  return haystack.includes(searchTerm);
}

function visibleJobs() {
  return jobs.filter(job => {
    if (!matchesSearch(job)) return false;
    if (jobFilter === "all") return true;
    if (jobFilter === "paid") return isPaid(job);
    if (jobFilter === "overdue") return overdueDays(job) > 0;
    return !isPaid(job) && (job.quotation || {}).status !== "lost";
  }).sort((a, b) => (overdueDays(b) - overdueDays(a)) || (jobDate(b) || "").localeCompare(jobDate(a) || "") || (b.createdAt || 0) - (a.createdAt || 0));
}

/* ---------- Panel "Apa perlu buat" ---------- */
function actionPriority(job, action) {
  if (action.urgent) return 0;
  if (action.id === "invoice") return 1;
  if (action.id === "payment") return 2;
  if (action.id === "po") return 3;
  return 4;
}

function renderToday() {
  const list = $("#todayList");
  const items = jobs
    .map(job => ({ job, action: nextAction(job) }))
    .filter(entry => entry.action)
    .sort((a, b) => actionPriority(a.job, a.action) - actionPriority(b.job, b.action))
    .slice(0, 6);

  $("#todayCount").textContent = items.length ? `${items.length} perkara` : "";
  list.innerHTML = "";
  if (!jobs.length) { $(".today-section").hidden = true; return; }
  $(".today-section").hidden = false;

  if (!items.length) {
    list.innerHTML = `<p class="all-clear">Semua kerja sudah selesai atau menunggu pelanggan. Tiada apa perlu dibuat sekarang. 👍</p>`;
    return;
  }

  items.forEach(({ job, action }) => {
    const row = document.createElement("article");
    row.className = `today-row${action.urgent ? " urgent" : ""}`;
    row.innerHTML = `<div class="today-text"><b></b><span></span></div><button type="button" class="today-cta" data-job="${job.id}" data-action="${action.instant || ""}" data-open="${action.open || ""}"></button>`;
    row.querySelector("b").textContent = `${job.customer} · ${job.title}`;
    row.querySelector("span").textContent = action.title;
    row.querySelector(".today-cta").textContent = action.cta;
    list.append(row);
  });
}

/* ---------- Ringkasan ---------- */
function renderStats() {
  const unpaid = jobs.filter(job => hasDoc(job, "invoice") && !isPaid(job));
  const overdue = unpaid.filter(job => overdueDays(job) > 0);
  const toInvoice = jobs.filter(needsInvoice);
  const openQuotes = jobs.filter(quoteOpen);
  $("#statOutstanding").textContent = money(unpaid.reduce((sum, job) => sum + balanceOf(job), 0));
  $("#statOutstandingCount").textContent = `${unpaid.length} invois`;
  $("#statOverdue").textContent = money(overdue.reduce((sum, job) => sum + balanceOf(job), 0));
  $("#statOverdueCount").textContent = `${overdue.length} invois`;
  $("#statToInvoice").textContent = money(toInvoice.reduce((sum, job) => sum + jobValue(job), 0));
  $("#statToInvoiceCount").textContent = `${toInvoice.length} kerja`;
  $("#statQuotes").textContent = money(openQuotes.reduce((sum, job) => sum + jobValue(job), 0));
  $("#statQuotesCount").textContent = `${openQuotes.length} sebut harga`;
}

/* ---------- Senarai kerja ---------- */
function trackMarkup(job) {
  const done = stepsDoneCount(job);
  const dots = STEPS.map((step, index) => {
    const isDone = stepDone(job, step.key);
    const isNow = !isDone && index === done;
    return `<span class="dot ${isDone ? "done" : isNow ? "now" : ""}" title="${step.name}"></span>`;
  }).join("");
  const current = STEPS[Math.min(done, STEPS.length - 1)];
  const label = done === STEPS.length ? "Semua selesai" : `Langkah ${done + 1} daripada ${STEPS.length} · ${current.name}`;
  return `<div class="track"><div class="dots">${dots}</div><span class="track-label">${label}</span></div>`;
}

function renderJobs() {
  const list = $("#jobList");
  const items = visibleJobs();
  $("#jobCount").textContent = `${items.length} kerja`;
  list.innerHTML = "";
  if (!jobs.length) { list.append($("#emptyJobTemplate").content.cloneNode(true)); return; }
  if (!items.length) {
    const messages = {
      active: "Tiada kerja yang sedang berjalan. Semua dah selesai — tekan <b>Sudah selesai</b> untuk lihat rekod lama, atau mula kerja baharu di atas.",
      overdue: "Tiada invois yang lewat tempoh. Bagus. 👍",
      paid: "Belum ada kerja yang dibayar penuh.",
      all: "Tiada kerja sepadan dengan carian kau."
    };
    list.innerHTML = `<p class="all-clear">${messages[jobFilter] || messages.all}</p>`;
    return;
  }

  items.forEach(job => {
    const action = nextAction(job);
    const late = overdueDays(job);
    const card = document.createElement("article");
    card.className = `job-card${late ? " is-late" : ""}${isPaid(job) ? " is-paid" : ""}`;
    const status = isPaid(job) ? `<span class="pill ok">Sudah dibayar penuh</span>`
      : late ? `<span class="pill late">Lewat ${late} hari</span>`
      : (job.quotation || {}).status === "lost" ? `<span class="pill">Pelanggan tolak</span>`
      : paidTotal(job) > 0 ? `<span class="pill">Baki ${money(balanceOf(job))}</span>` : "";

    card.innerHTML = `<a class="job-link" href="job.html?id=${encodeURIComponent(job.id)}">
        <div class="job-card-top"><div class="job-ident"><span class="job-no"></span><h3></h3><p class="job-sub"></p><p class="job-date"></p></div><div class="job-amount"><strong>${money(jobValue(job))}</strong></div></div>
        ${trackMarkup(job)}
        ${status ? `<div class="job-notes">${status}</div>` : ""}
      </a>
      ${action ? `<button type="button" class="job-cta" data-job="${job.id}" data-action="${action.instant || ""}" data-open="${action.open || ""}">${action.cta}</button>` : ""}`;
    card.querySelector(".job-no").textContent = job.jobNo || "—";
    card.querySelector("h3").textContent = job.customer || "Tanpa nama";
    card.querySelector(".job-sub").textContent = job.title || "";
    card.querySelector(".job-date").textContent = jobDate(job) ? `Tarikh kerja: ${dateLabel(jobDate(job))}` : "Tiada tarikh";
    list.append(card);
  });
}

function renderCustomers() {
  const names = [...new Set(jobs.map(job => job.customer).filter(Boolean))].sort();
  $("#customerList").innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function renderAll() { jobs = readJobs(); renderToday(); renderStats(); renderJobs(); renderCustomers(); }

/* ---------- Tindakan ---------- */
document.addEventListener("click", event => {
  const button = event.target.closest("[data-job]");
  if (!button) return;
  const job = jobs.find(item => item.id === button.dataset.job);
  if (!job) return;
  if (button.dataset.action) {
    const message = applyInstant(job, jobs, button.dataset.action);
    writeJobs(jobs); renderAll(); toast(message);
  } else if (button.dataset.open) {
    location.href = `job.html?id=${encodeURIComponent(job.id)}&buka=${button.dataset.open}`;
  }
});

$("#openNewJob").addEventListener("click", () => { $("#jobDate").value = todayIso(); $("#newJobDialog").showModal(); $("#jobCustomer").focus(); });
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));

$("#jobForm").addEventListener("submit", event => {
  event.preventDefault();
  const customer = $("#jobCustomer").value.trim();
  const title = $("#jobTitle").value.trim();
  if (!customer || !title) return;
  const estimate = Number($("#jobEstimate").value) || 0;
  const workDate = $("#jobDate").value || todayIso();
  const settings = readSettings();
  const job = { id: newId(), jobNo: nextNumber(settings.prefixJob, allNumbers(jobs, "jobNo")), customer, title, estimate, date: workDate, createdAt: Date.now(), quotation: {}, po: {}, delivery: {}, invoice: {}, payments: [] };
  const startAt = $("#jobStart").value;
  if (estimate > 0) job.items = [{ description: title, qty: 1, price: estimate }];
  if (estimate > 0 && startAt === "quotation") {
    job.quotation = { no: nextNumber(settings.prefixQuote, allNumbers(jobs, "quotation")), date: workDate, amount: estimate, status: "draft" };
  } else if (estimate > 0 && startAt === "invoice") {
    const due = new Date(`${workDate}T12:00:00`); due.setDate(due.getDate() + (Number(settings.terms) || 30));
    job.invoice = { no: nextNumber(settings.prefixInvoice, allNumbers(jobs, "invoice")), date: workDate, amount: estimate, terms: Number(settings.terms) || 30, dueDate: due.toISOString().slice(0, 10), sent: true, sentAt: workDate };
  }
  jobs.push(job);
  writeJobs(jobs);
  event.target.reset();
  $("#newJobDialog").close();
  renderAll();
  toast(estimate <= 0 ? "Kerja disimpan." : startAt === "invoice" ? "Kerja disimpan dan invois ditanda sudah dihantar." : "Kerja disimpan dan sebut harga disediakan.");
});

/* Butang dalam empty state */
document.addEventListener("click", event => {
  const button = event.target.closest("[data-onboard]");
  if (!button) return;
  if (button.dataset.onboard === "new") { $("#jobDate").value = todayIso(); $("#newJobDialog").showModal(); $("#jobCustomer").focus(); return; }
  const settings = readSettings();
  const demo = [
    { id: newId(), jobNo: "JOB-CONTOH-1", demo: true, customer: "ABC Sdn Bhd (contoh)", title: "Bekalan & pasang signage", createdAt: Date.now() - 3000,
      quotation: { no: "QT-CONTOH-1", date: todayIso(), amount: 12000, status: "won" },
      invoice: {}, payments: [], items: [{ description: "Signage 8ft x 4ft", qty: 1, price: 9000 }, { description: "Kerja pemasangan", qty: 1, price: 3000 }] },
    { id: newId(), jobNo: "JOB-CONTOH-2", demo: true, customer: "Maju Jaya Enterprise (contoh)", title: "Servis penyelenggaraan", createdAt: Date.now() - 2000,
      quotation: { no: "QT-CONTOH-2", date: todayIso(), amount: 3500, status: "sent" }, invoice: {}, payments: [], items: [{ description: "Servis penyelenggaraan bulanan", qty: 1, price: 3500 }] }
  ];
  jobs.push(...demo);
  writeJobs(jobs);
  renderAll();
  toast("Dua contoh kerja ditambah. Padam bila-bila dari dalam kerja itu.");
});

document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  jobFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(other => other.classList.toggle("active", other === button));
  renderJobs();
}));
$("#searchBox").addEventListener("input", event => { searchTerm = event.target.value.trim().toLowerCase(); renderJobs(); });

window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; $("#installButton").hidden = false; });
$("#installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("#installButton").hidden = true; });
document.addEventListener("ft-cloud-data", renderAll);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));
renderAll();
