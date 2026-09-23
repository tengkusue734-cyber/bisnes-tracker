// Page Pipeline — senarai job dan ringkasan.
let jobs = readJobs();
let jobFilter = "active";
let searchTerm = "";
let deferredInstallPrompt;

const STEP_LABELS = [
  { key: "quotation", short: "Q", name: "Quotation" },
  { key: "po", short: "PO", name: "PO" },
  { key: "delivery", short: "DO", name: "DO" },
  { key: "invoice", short: "INV", name: "Invois" }
];

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
    return !isPaid(job);
  }).sort((a, b) => {
    const diff = overdueDays(b) - overdueDays(a);
    if (diff) return diff;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

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
  $("#statToInvoiceCount").textContent = `${toInvoice.length} job`;
  $("#statQuotes").textContent = money(openQuotes.reduce((sum, job) => sum + jobValue(job), 0));
  $("#statQuotesCount").textContent = `${openQuotes.length} quotation`;
}

function stepsMarkup(job) {
  const paid = isPaid(job);
  const partial = paidTotal(job) > 0;
  const steps = STEP_LABELS.map(step => {
    const done = hasDoc(job, step.key);
    return `<span class="step ${done ? "done" : ""}" title="${step.name}">${step.short}</span>`;
  }).join("");
  return `${steps}<span class="step ${paid ? "done" : partial ? "partial" : ""}" title="Bayaran">RM</span>`;
}

function renderJobs() {
  const list = $("#jobList");
  const items = visibleJobs();
  $("#jobCount").textContent = `${items.length} job`;
  list.innerHTML = "";
  if (!items.length) { list.append($("#emptyJobTemplate").content.cloneNode(true)); return; }

  items.forEach(job => {
    const stage = stageOf(job);
    const late = overdueDays(job);
    const balance = balanceOf(job);
    const card = document.createElement("a");
    card.className = `job-card stage-${stage.key}${late ? " is-late" : ""}`;
    card.href = `job.html?id=${encodeURIComponent(job.id)}`;

    const notes = [];
    if (late) notes.push(`<b class="late">Lewat ${late} hari</b>`);
    else if (hasDoc(job, "invoice") && !isPaid(job)) notes.push(`Tempoh ${dateLabel(dueDateOf(job))}`);
    if (needsInvoice(job)) notes.push('<b class="warn">Perlu invois</b>');
    if (hasDoc(job, "invoice") && balance > 0 && paidTotal(job) > 0) notes.push(`Baki ${money(balance)}`);
    if (isPaid(job)) notes.push(`<b class="ok">Dibayar penuh</b>`);

    card.innerHTML = `<div class="job-card-top"><div class="job-ident"><span class="job-no"></span><h3></h3><p class="job-sub"></p></div><div class="job-amount"><strong>${money(jobValue(job))}</strong><span class="stage-chip">${stage.label}</span></div></div><div class="job-steps">${stepsMarkup(job)}</div>${notes.length ? `<div class="job-notes">${notes.join(" · ")}</div>` : ""}`;
    card.querySelector(".job-no").textContent = job.jobNo || "—";
    card.querySelector("h3").textContent = job.customer || "Tanpa nama";
    card.querySelector(".job-sub").textContent = job.title || "";
    list.append(card);
  });
}

function renderCustomers() {
  const names = [...new Set(jobs.map(job => job.customer).filter(Boolean))].sort();
  $("#customerList").innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function renderAll() { jobs = readJobs(); renderStats(); renderJobs(); renderCustomers(); }

$("#jobForm").addEventListener("submit", event => {
  event.preventDefault();
  const customer = $("#jobCustomer").value.trim();
  const title = $("#jobTitle").value.trim();
  if (!customer || !title) return;
  const settings = readSettings();
  const jobNo = $("#jobNo").value.trim() || nextNumber(settings.prefixJob, allNumbers(jobs, "jobNo"));
  jobs.push({ id: newId(), jobNo, customer, title, note: $("#jobNote").value.trim(), createdAt: Date.now(), quotation: {}, po: {}, delivery: {}, invoice: {}, payments: [] });
  writeJobs(jobs);
  event.target.reset();
  renderAll();
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
