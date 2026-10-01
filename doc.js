// Dokumen boleh cetak: sebut harga, invois atau resit rasmi.
const docParams = new URLSearchParams(location.search);
const docJobId = docParams.get("id");
const docKind = docParams.get("jenis") || "invoice";
const paymentId = docParams.get("bayaran") || "";
const settings = readSettings();
const jobsList = readJobs();
const theJob = jobsList.find(item => item.id === docJobId);

const KIND_LABEL = { quotation: "SEBUT HARGA", invoice: "INVOIS", receipt: "RESIT RASMI" };

function setText(id, value) { $(id).textContent = value || ""; }

function renderCompany() {
  setText("#companyName", settings.company || "Nama syarikat belum diisi");
  setText("#companySsm", settings.ssm ? `No. Pendaftaran: ${settings.ssm}` : "");
  setText("#companyAddress", settings.address || "");
  setText("#companyContact", [settings.phone, settings.email].filter(Boolean).join(" · "));
  setText("#signName", settings.company || "");
  const bank = $("#bankBox");
  if (settings.bankName || settings.bankAccount) {
    bank.innerHTML = `<p class="doc-label">Bayaran kepada</p><p class="doc-strong"></p><p class="doc-muted"></p>`;
    bank.querySelector(".doc-strong").textContent = settings.bankName || "";
    bank.querySelector(".doc-muted").textContent = settings.bankAccount || "";
  } else {
    bank.innerHTML = `<p class="doc-muted">Butiran bank belum diisi — tambah di Laporan → Maklumat syarikat.</p>`;
  }
  setText("#docNote", settings.note || "");
}

function dateRows(pairs) {
  $("#docDates").innerHTML = pairs.filter(pair => pair[1]).map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
}

function renderLines(rows, totals) {
  const body = $("#itemRows");
  body.innerHTML = "";
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="c-no">${index + 1}</td><td class="c-desc"></td><td class="c-num">${row.qty}</td><td class="c-num">${row.price}</td><td class="c-num">${row.total}</td>`;
    tr.querySelector(".c-desc").textContent = row.description;
    body.append(tr);
  });
  $("#docFoot").innerHTML = totals.map(([label, value, strong]) =>
    `<tr class="${strong ? "grand" : ""}"><td colspan="4">${label}</td><td class="c-num">${value}</td></tr>`).join("");
}

function render() {
  renderCompany();
  const kindLabel = KIND_LABEL[docKind] || "DOKUMEN";
  document.title = `${kindLabel} · ${theJob ? theJob.customer : "Bisnes Tracker"}`;
  setText("#docKind", kindLabel);
  $("#backLink").href = `job.html?id=${encodeURIComponent(docJobId)}`;

  setText("#billName", theJob.customer || "—");
  setText("#billDetails", [theJob.customerAddress, theJob.customerContact].filter(Boolean).join("\n"));

  const items = itemsOf(theJob);
  const fallbackAmount = docKind === "quotation" ? Number((theJob.quotation || {}).amount) || 0 : invoiced(theJob);
  const rows = items.length
    ? items.map(item => ({ description: item.description || "—", qty: Number(item.qty) || 0, price: (Number(item.price) || 0).toFixed(2), total: lineTotal(item).toFixed(2) }))
    : [{ description: theJob.title || "Perkhidmatan", qty: 1, price: fallbackAmount.toFixed(2), total: fallbackAmount.toFixed(2) }];
  const sum = rows.reduce((total, row) => total + Number(row.total), 0);

  if (docKind === "quotation") {
    const quote = theJob.quotation || {};
    setText("#docNumber", quote.no || "—");
    dateRows([["Tarikh", dateLabel(quote.date)], ["Sah sehingga", quote.validUntil ? dateLabel(quote.validUntil) : ""], ["Rujukan", theJob.jobNo]]);
    renderLines(rows, [["Jumlah keseluruhan", money(sum), true]]);
    return;
  }

  if (docKind === "receipt") {
    const payments = paymentsOf(theJob);
    const payment = paymentId ? payments.find(item => item.id === paymentId) : payments[payments.length - 1];
    if (!payment) { setText("#docNumber", "—"); renderLines([], [["Tiada bayaran direkod", "—", true]]); return; }
    setText("#docNumber", payment.receiptNo || "—");
    dateRows([["Tarikh bayaran", dateLabel(payment.date)], ["Kaedah", payment.method || ""], ["Rujukan", payment.ref || ""], ["Bagi invois", (theJob.invoice || {}).no || ""]]);
    renderLines([{ description: `Bayaran diterima bagi ${theJob.title || "kerja"}`, qty: 1, price: (Number(payment.amount) || 0).toFixed(2), total: (Number(payment.amount) || 0).toFixed(2) }],
      [["Jumlah diterima", money(payment.amount), true], ["Baki invois selepas bayaran ini", money(balanceOf(theJob))]]);
    return;
  }

  const invoice = theJob.invoice || {};
  setText("#docNumber", invoice.no || "—");
  dateRows([["Tarikh invois", dateLabel(invoice.date)], ["Tarikh kerja", jobDate(theJob) ? dateLabel(jobDate(theJob)) : ""], ["Jatuh tempo", dateLabel(dueDateOf(theJob))], ["Tempoh kredit", invoice.terms ? `${invoice.terms} hari` : ""], ["Rujukan", theJob.jobNo]]);
  const totals = [["Jumlah keseluruhan", money(sum), true]];
  if (paidTotal(theJob) > 0) {
    totals.push(["Sudah dibayar", `− ${money(paidTotal(theJob))}`]);
    totals.push(["Baki perlu dibayar", money(balanceOf(theJob)), true]);
  }
  renderLines(rows, totals);
}

$("#printButton").addEventListener("click", () => window.print());

if (!theJob) {
  document.body.innerHTML = '<div class="doc-toolbar"><a class="toolbar-back" href="index.html">← Kembali</a></div><p class="doc-tip">Kerja ini tidak dijumpai. Ia mungkin sudah dipadam.</p>';
} else {
  render();
}
