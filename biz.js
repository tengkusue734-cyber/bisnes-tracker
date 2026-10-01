// Fungsi kongsi untuk Bisnes Tracker — rekod job, dokumen dan bayaran.
const JOBS_KEY = "biz-tracker-jobs-v1";
const SETTINGS_KEY = "biz-tracker-settings-v1";
const $ = selector => document.querySelector(selector);
const todayIso = () => new Date().toISOString().slice(0, 10);

const defaultSettings = {
  prefixJob: "JOB", prefixQuote: "QT", prefixInvoice: "INV", prefixReceipt: "RCP", terms: 30,
  company: "", ssm: "", address: "", phone: "", email: "",
  bankName: "", bankAccount: "", note: "Terima kasih atas urusan anda."
};

function readJobs() { try { return JSON.parse(localStorage.getItem(JOBS_KEY)) || []; } catch { return []; } }
function writeJobs(list) { localStorage.setItem(JOBS_KEY, JSON.stringify(list)); }
function readSettings() { try { return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; } catch { return { ...defaultSettings }; } }
function writeSettings(value) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); }

function money(value) { return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(Number(value) || 0); }
function dateLabel(date) { return date ? new Intl.DateTimeFormat("ms-MY", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)) : "—"; }
function daysBetween(from, to) { return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000); }
function newId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }

/* ---------- Nombor dokumen automatik ---------- */
function nextNumber(prefix, existing) {
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const highest = existing
    .filter(value => typeof value === "string" && value.startsWith(head))
    .map(value => parseInt(value.slice(head.length), 10))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
  return `${head}${String(highest + 1).padStart(3, "0")}`;
}
function allNumbers(jobs, field) {
  if (field === "jobNo") return jobs.map(job => job.jobNo);
  return jobs.map(job => (job[field] || {}).no).filter(Boolean);
}

/* ---------- Item baris ---------- */
function itemsOf(job) { return Array.isArray(job.items) ? job.items : []; }
function lineTotal(item) { return (Number(item.qty) || 0) * (Number(item.price) || 0); }
function itemsTotal(job) { return itemsOf(job).reduce((sum, item) => sum + lineTotal(item), 0); }

/* ---------- Pengiraan job ---------- */
function paymentsOf(job) { return Array.isArray(job.payments) ? job.payments : []; }
function paidTotal(job) { return paymentsOf(job).reduce((sum, item) => sum + (Number(item.amount) || 0), 0); }
function jobValue(job) {
  const invoice = Number(job.invoice && job.invoice.amount) || 0;
  const quote = Number(job.quotation && job.quotation.amount) || 0;
  return invoice || quote || itemsTotal(job) || Number(job.estimate) || 0;
}
function invoiced(job) { return Number(job.invoice && job.invoice.amount) || 0; }
function balanceOf(job) { return Math.max(0, invoiced(job) - paidTotal(job)); }
function hasDoc(job, key) {
  const doc = job[key];
  if (!doc) return false;
  if (key === "quotation") return Boolean(doc.no || doc.amount);
  if (key === "po") return Boolean(doc.no || doc.amount);
  if (key === "delivery") return Boolean(doc.no || doc.date);
  if (key === "invoice") return Boolean(doc.no || doc.amount);
  return false;
}
function dueDateOf(job) {
  const invoice = job.invoice || {};
  if (invoice.dueDate) return invoice.dueDate;
  if (!invoice.date) return "";
  const terms = Number(invoice.terms);
  const base = new Date(`${invoice.date}T12:00:00`);
  base.setDate(base.getDate() + (Number.isFinite(terms) ? terms : 30));
  return base.toISOString().slice(0, 10);
}
function isPaid(job) { return invoiced(job) > 0 && balanceOf(job) <= 0.004; }
function overdueDays(job) {
  if (!hasDoc(job, "invoice") || isPaid(job)) return 0;
  const due = dueDateOf(job);
  if (!due) return 0;
  return Math.max(0, daysBetween(due, todayIso()));
}
function needsInvoice(job) {
  return (job.quotation || {}).status === "won" && !hasDoc(job, "invoice");
}
function quoteOpen(job) {
  const status = (job.quotation || {}).status;
  return hasDoc(job, "quotation") && (status === "sent" || status === "draft") && !hasDoc(job, "po");
}

function jobDate(job) { return job.date || (job.quotation || {}).date || (job.invoice || {}).date || ""; }

function stageOf(job) {
  if (isPaid(job)) return { key: "paid", label: "Selesai" };
  if (hasDoc(job, "invoice")) return { key: "invoiced", label: paidTotal(job) > 0 ? "Bayaran separa" : "Invois dihantar" };
  if (hasDoc(job, "quotation")) return { key: "quote", label: "Sebut harga" };
  return { key: "new", label: "Baharu" };
}

function ageBucket(days) {
  if (days <= 0) return "Semasa";
  if (days <= 30) return "1–30 hari";
  if (days <= 60) return "31–60 hari";
  if (days <= 90) return "61–90 hari";
  return "Lebih 90 hari";
}
const AGE_BUCKETS = ["Semasa", "1–30 hari", "31–60 hari", "61–90 hari", "Lebih 90 hari"];

/* ---------- Muat turun CSV ---------- */
function toCsv(rows) {
  return rows.map(row => row.map(cell => {
    const value = cell === null || cell === undefined ? "" : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\r\n");
}
function downloadCsv(filename, rows) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Langkah dalam bahasa mudah ---------- */
const STEPS = [
  { key: "quotation", name: "Sebut harga" },
  { key: "invoice", name: "Invois" },
  { key: "payment", name: "Bayaran" }
];
function stepDone(job, key) {
  if (key === "payment") return isPaid(job);
  if (key === "quotation") return hasDoc(job, "quotation") && (job.quotation.status === "sent" || job.quotation.status === "won");
  return hasDoc(job, key);
}
function stepsDoneCount(job) { return STEPS.filter(step => stepDone(job, step.key)).length; }

/* Jumlah yang dicadang untuk peringkat seterusnya — supaya tak payah taip semula */
function suggestedAmount(job, key) {
  const quote = Number((job.quotation || {}).amount) || 0;
  if (key === "quotation") return itemsTotal(job) || Number(job.estimate) || quote;
  if (key === "invoice") return itemsTotal(job) || quote || Number(job.estimate) || 0;
  if (key === "payment") return balanceOf(job);
  return 0;
}

/* Apa yang patut dibuat seterusnya untuk job ini */
function nextAction(job) {
  const quote = job.quotation || {};
  if (!hasDoc(job, "quotation") && !hasDoc(job, "invoice")) {
    return { id: "quotation", cta: "Buat sebut harga", title: "Buat sebut harga", hint: "Rekod harga yang kau beri kepada pelanggan. Kalau pelanggan terus minta invois, tekan butang kedua.", open: "quotation", secondary: { cta: "Terus tanda invois dihantar", instant: "invoice-sent" } };
  }
  if (hasDoc(job, "quotation") && quote.status === "draft" && !hasDoc(job, "invoice")) {
    return { id: "send-quote", cta: "Tandakan sudah dihantar", title: "Hantar sebut harga kepada pelanggan", hint: `Sebut harga ${money(quote.amount)} masih draf. Cetak atau hantar dokumen, kemudian tandakan di sini.`, instant: "send-quote", secondary: { cta: "Cetak sebut harga", print: "quotation" } };
  }
  if (quote.status === "lost") return null;
  if (!hasDoc(job, "invoice")) {
    return { id: "invoice", cta: `Tanda invois dihantar ${money(suggestedAmount(job, "invoice"))}`, title: "Invois sudah dihantar kepada pelanggan?", hint: "Satu tekan sahaja. Jumlah dibawa dari sebut harga dan tarikh jatuh tempo dikira automatik — kau tak perlu buat apa-apa dokumen di sini.", instant: "invoice-sent", secondary: { cta: "Pelanggan tolak", instant: "lost" } };
  }
  if (balanceOf(job) > 0.004) {
    const late = overdueDays(job);
    return { id: "payment", cta: `Rekod bayaran ${money(balanceOf(job))}`, title: late ? `Kejar bayaran — lewat ${late} hari` : "Tunggu bayaran masuk", hint: late ? `Invois sepatutnya dibayar pada ${dateLabel(dueDateOf(job))}.` : `Tempoh bayaran ${dateLabel(dueDateOf(job))}.`, open: "payment", urgent: Boolean(late), secondary: { cta: "Cetak invois", print: "invoice" } };
  }
  return null;
}

/* Tindakan satu-tekan */
function applyInstant(job, jobsList, action) {
  const settings = readSettings();
  if (action === "send-quote") { job.quotation = { ...(job.quotation || {}), status: "sent" }; return "Sebut harga ditandakan sudah dihantar."; }
  if (action === "lost") { job.quotation = { ...(job.quotation || {}), status: "lost" }; return "Kerja ditandakan pelanggan tolak."; }
  if (action === "invoice-sent") {
    const terms = Number(settings.terms) || 30;
    const date = todayIso();
    const due = new Date(`${date}T12:00:00`); due.setDate(due.getDate() + terms);
    const existing = job.invoice || {};
    job.invoice = {
      ...existing,
      no: existing.no || nextNumber(settings.prefixInvoice, allNumbers(jobsList, "invoice")),
      date: existing.date || date,
      amount: Number(existing.amount) || suggestedAmount(job, "invoice"),
      terms: existing.terms ?? terms,
      dueDate: existing.dueDate || due.toISOString().slice(0, 10),
      sent: true, sentAt: date
    };
    if (job.quotation && job.quotation.status && job.quotation.status !== "won") job.quotation.status = "won";
    return `Invois ditanda sudah dihantar — tempoh bayaran ${dateLabel(job.invoice.dueDate)}.`;
  }
  return "";
}
