// Fungsi kongsi untuk Bisnes Tracker — rekod job, dokumen dan bayaran.
const JOBS_KEY = "biz-tracker-jobs-v1";
const SETTINGS_KEY = "biz-tracker-settings-v1";
const $ = selector => document.querySelector(selector);
const todayIso = () => new Date().toISOString().slice(0, 10);

const defaultSettings = { prefixJob: "JOB", prefixQuote: "QT", prefixPO: "PO", prefixDO: "DO", prefixInvoice: "INV", prefixReceipt: "RCP", terms: 30 };

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

/* ---------- Pengiraan job ---------- */
function paymentsOf(job) { return Array.isArray(job.payments) ? job.payments : []; }
function paidTotal(job) { return paymentsOf(job).reduce((sum, item) => sum + (Number(item.amount) || 0), 0); }
function jobValue(job) {
  const invoice = Number(job.invoice && job.invoice.amount) || 0;
  const po = Number(job.po && job.po.amount) || 0;
  const quote = Number(job.quotation && job.quotation.amount) || 0;
  return invoice || po || quote;
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
  const delivered = (job.delivery || {}).status === "delivered" || (job.delivery || {}).status === "acknowledged";
  return delivered && !hasDoc(job, "invoice");
}
function quoteOpen(job) {
  const status = (job.quotation || {}).status;
  return hasDoc(job, "quotation") && (status === "sent" || status === "draft") && !hasDoc(job, "po");
}

function stageOf(job) {
  if (isPaid(job)) return { key: "paid", label: "Selesai" };
  if (hasDoc(job, "invoice")) return { key: "invoiced", label: paidTotal(job) > 0 ? "Bayaran separa" : "Invois dihantar" };
  if (needsInvoice(job)) return { key: "toinvoice", label: "Perlu invois" };
  if (hasDoc(job, "delivery")) return { key: "delivery", label: "Dalam penghantaran" };
  if (hasDoc(job, "po")) return { key: "po", label: "PO diterima" };
  if (hasDoc(job, "quotation")) return { key: "quote", label: "Quotation" };
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
