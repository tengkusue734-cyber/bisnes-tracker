// Page Laporan — aged receivable, export CSV, tetapan penomboran.
let jobs = readJobs();

function unpaidJobs() { return jobs.filter(job => hasDoc(job, "invoice") && balanceOf(job) > 0.004); }

function agedRows() {
  const byCustomer = new Map();
  unpaidJobs().forEach(job => {
    const customer = job.customer || "Tanpa nama";
    const due = dueDateOf(job);
    const days = due ? daysBetween(due, todayIso()) : 0;
    const bucket = ageBucket(days);
    const row = byCustomer.get(customer) || { customer, total: 0, buckets: Object.fromEntries(AGE_BUCKETS.map(name => [name, 0])) };
    row.buckets[bucket] += balanceOf(job);
    row.total += balanceOf(job);
    byCustomer.set(customer, row);
  });
  return [...byCustomer.values()].sort((a, b) => b.total - a.total);
}

function renderAged() {
  const rows = agedRows();
  const totals = Object.fromEntries(AGE_BUCKETS.map(name => [name, 0]));
  rows.forEach(row => AGE_BUCKETS.forEach(name => { totals[name] += row.buckets[name]; }));
  const grand = rows.reduce((sum, row) => sum + row.total, 0);
  $("#agedTotal").textContent = money(grand);

  $("#bucketGrid").innerHTML = AGE_BUCKETS.map((name, index) =>
    `<article class="bucket b${index}"><small>${name}</small><strong>${money(totals[name])}</strong></article>`).join("");

  const body = $("#agedTable tbody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="doc-empty">Tiada invois tertunggak. 🎉</td></tr>`;
    return;
  }
  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th scope="row"></th>${AGE_BUCKETS.map(name => `<td>${row.buckets[name] ? money(row.buckets[name]) : "—"}</td>`).join("")}<td class="cell-total">${money(row.total)}</td>`;
    tr.querySelector("th").textContent = row.customer;
    body.append(tr);
  });
}

/* ---------- Export ---------- */
function inRange(date) {
  const from = $("#fromDate").value;
  const to = $("#toDate").value;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
function rangeLabel() {
  const from = $("#fromDate").value || "awal";
  const to = $("#toDate").value || "kini";
  return `${from}_${to}`;
}
function note(message) { $("#exportStatus").textContent = message; }

$("#exportSales").addEventListener("click", () => {
  const rows = [["Tarikh invois", "No invois", "No rujukan", "Pelanggan", "Perihal", "Tarikh kerja", "Invois dihantar", "Jumlah (RM)", "Tarikh jatuh tempo", "Dibayar (RM)", "Baki (RM)"]];
  jobs.filter(job => hasDoc(job, "invoice") && inRange(job.invoice.date))
    .sort((a, b) => (a.invoice.date || "").localeCompare(b.invoice.date || ""))
    .forEach(job => rows.push([job.invoice.date, job.invoice.no || "", job.jobNo || "", job.customer || "", job.title || "", jobDate(job), job.invoice.sent ? "Ya" : "Belum", invoiced(job).toFixed(2), dueDateOf(job), paidTotal(job).toFixed(2), balanceOf(job).toFixed(2)]));
  if (rows.length === 1) return note("Tiada invois dalam julat tarikh itu.");
  downloadCsv(`sales-register_${rangeLabel()}.csv`, rows);
  note(`${rows.length - 1} invois dieksport.`);
});

$("#exportPayments").addEventListener("click", () => {
  const rows = [["Tarikh bayaran", "No resit", "No invois", "No job", "Pelanggan", "Kaedah", "Rujukan", "Jumlah (RM)"]];
  const entries = [];
  jobs.forEach(job => paymentsOf(job).forEach(payment => {
    if (!inRange(payment.date)) return;
    entries.push([payment.date, payment.receiptNo || "", (job.invoice || {}).no || "", job.jobNo || "", job.customer || "", payment.method || "", payment.ref || "", (Number(payment.amount) || 0).toFixed(2)]);
  }));
  entries.sort((a, b) => a[0].localeCompare(b[0])).forEach(entry => rows.push(entry));
  if (rows.length === 1) return note("Tiada bayaran dalam julat tarikh itu.");
  downloadCsv(`payment-register_${rangeLabel()}.csv`, rows);
  note(`${rows.length - 1} bayaran dieksport.`);
});

$("#exportAged").addEventListener("click", () => {
  const rows = [["Pelanggan", ...AGE_BUCKETS, "Jumlah (RM)"]];
  agedRows().forEach(row => rows.push([row.customer, ...AGE_BUCKETS.map(name => row.buckets[name].toFixed(2)), row.total.toFixed(2)]));
  if (rows.length === 1) return note("Tiada invois tertunggak.");
  downloadCsv(`aged-receivable_${todayIso()}.csv`, rows);
  note(`${rows.length - 1} pelanggan dieksport.`);
});

$("#exportAll").addEventListener("click", () => {
  const rows = [["No rujukan", "Pelanggan", "Kerja", "Tarikh kerja", "Peringkat", "No sebut harga", "Tarikh sebut harga", "Jumlah sebut harga", "Status", "No invois", "Tarikh invois", "Jumlah invois", "Jatuh tempo", "Dibayar", "Baki", "Lewat (hari)"]];
  jobs.forEach(job => {
    const quote = job.quotation || {}, invoice = job.invoice || {};
    rows.push([job.jobNo || "", job.customer || "", job.title || "", jobDate(job), stageOf(job).label,
      quote.no || "", quote.date || "", quote.amount ? Number(quote.amount).toFixed(2) : "", quote.status || "",
      invoice.no || "", invoice.date || "", invoice.amount ? Number(invoice.amount).toFixed(2) : "", hasDoc(job, "invoice") ? dueDateOf(job) : "",
      paidTotal(job).toFixed(2), balanceOf(job).toFixed(2), overdueDays(job) || ""]);
  });
  if (rows.length === 1) return note("Belum ada job untuk dieksport.");
  downloadCsv(`semua-job_${todayIso()}.csv`, rows);
  note(`${rows.length - 1} job dieksport.`);
});

/* ---------- Tetapan ---------- */
const COMPANY_FIELDS = ["company", "ssm", "phone", "email", "address", "bankName", "bankAccount", "note"];
function loadCompany() {
  const settings = readSettings();
  COMPANY_FIELDS.forEach(field => { $(`#${field}`).value = settings[field] || ""; });
}
$("#companyForm").addEventListener("submit", event => {
  event.preventDefault();
  const settings = readSettings();
  COMPANY_FIELDS.forEach(field => { settings[field] = $(`#${field}`).value.trim(); });
  writeSettings(settings);
  $("#companyStatus").textContent = "Maklumat syarikat disimpan. Ia akan muncul pada dokumen yang kau cetak.";
});

function loadSettings() {
  const settings = readSettings();
  $("#prefixJob").value = settings.prefixJob;
  $("#prefixQuote").value = settings.prefixQuote;
  $("#prefixInvoice").value = settings.prefixInvoice;
  $("#prefixReceipt").value = settings.prefixReceipt;
  $("#defaultTerms").value = settings.terms;
}
$("#settingsForm").addEventListener("submit", event => {
  event.preventDefault();
  writeSettings({
    ...readSettings(),
    prefixJob: $("#prefixJob").value.trim().toUpperCase() || "JOB",
    prefixQuote: $("#prefixQuote").value.trim().toUpperCase() || "QT",
    prefixInvoice: $("#prefixInvoice").value.trim().toUpperCase() || "INV",
    prefixReceipt: $("#prefixReceipt").value.trim().toUpperCase() || "RCP",
    terms: Number($("#defaultTerms").value) || 30
  });
  loadSettings();
  $("#settingsStatus").textContent = "Tetapan disimpan.";
});

function renderAll() { jobs = readJobs(); renderAged(); loadSettings(); loadCompany(); }
document.addEventListener("ft-cloud-data", renderAll);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));

const firstDay = new Date(); firstDay.setDate(1);
$("#fromDate").value = firstDay.toISOString().slice(0, 10);
$("#toDate").value = todayIso();
renderAll();
