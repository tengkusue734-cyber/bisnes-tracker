/* ==========================================================================
   Senarai invois bulanan — rujukan untuk filing akaun
   Boleh dicetak terus atau disimpan sebagai PDF.
   ========================================================================== */

const MS_MONTHS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
let monthJobs = readJobs();

function monthValue() { return $("#monthPick").value || todayIso().slice(0, 7); }
function monthTitle(value) {
  const [year, month] = String(value).split("-").map(Number);
  return `${MS_MONTHS[(month || 1) - 1]} ${year}`;
}
function shiftMonth(value, step) {
  const [year, month] = String(value).split("-").map(Number);
  const d = new Date(year, (month - 1) + step, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function inMonth(date, value) { return !!date && String(date).slice(0, 7) === value; }
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function amount2(value) { return (Number(value) || 0).toFixed(2); }

/* ---------- Kumpul data ---------- */
function invoicesOf(value) {
  return monthJobs
    .filter(job => hasDoc(job, "invoice") && inMonth((job.invoice || {}).date, value))
    .sort((a, b) => String(a.invoice.date).localeCompare(String(b.invoice.date))
      || String(a.invoice.no || "").localeCompare(String(b.invoice.no || "")));
}

function paymentsOfMonth(value) {
  const rows = [];
  monthJobs.forEach(job => paymentsOf(job).forEach(payment => {
    if (inMonth(payment.date, value)) rows.push({ job, payment });
  }));
  return rows.sort((a, b) => String(a.payment.date).localeCompare(String(b.payment.date)));
}

function carriedForward(value) {
  return monthJobs
    .filter(job => hasDoc(job, "invoice")
      && String((job.invoice || {}).date || "").slice(0, 7) < value
      && balanceOf(job) > 0.004)
    .sort((a, b) => String(a.invoice.date).localeCompare(String(b.invoice.date)));
}

function statusOf(job) {
  const balance = balanceOf(job);
  if (balance <= 0.004) return { label: "Dibayar penuh", cls: "st-paid" };
  const late = overdueDays(job);
  if (late > 0) return { label: `Lewat ${late} hari`, cls: "st-late" };
  if (paidTotal(job) > 0) return { label: "Bayaran sebahagian", cls: "st-part" };
  return { label: "Belum bayar", cls: "st-due" };
}

/* Sel nombor rujukan: boleh taip terus, atau dibiarkan kosong untuk tulis tangan */
function refCell(value, blank, attrs) {
  if (blank) return '<span class="ref-blank"></span>';
  const text = String(value || "");
  return `<span class="cell-edit" contenteditable="plaintext-only" role="textbox" ${attrs}
    data-placeholder="— taip —">${esc(text)}</span>`;
}

/* ---------- Bina dokumen ---------- */
function buildDoc() {
  const value = monthValue();
  const settings = readSettings();
  const showTick = $("#optTick").checked;
  const blankRefs = $("#optBlank").checked;
  const showPayments = $("#optPayments").checked;
  const showCarried = $("#optUnpaid").checked;

  const invoices = invoicesOf(value);
  const payments = paymentsOfMonth(value);
  const carried = showCarried ? carriedForward(value) : [];

  const totalInvoiced = invoices.reduce((sum, job) => sum + invoiced(job), 0);
  const totalPaidOnThese = invoices.reduce((sum, job) => sum + paidTotal(job), 0);
  const totalOutstanding = invoices.reduce((sum, job) => sum + balanceOf(job), 0);
  const totalReceived = payments.reduce((sum, row) => sum + (Number(row.payment.amount) || 0), 0);

  const tickHead = showTick ? '<th class="c-tick">☐</th>' : "";
  const tickCell = showTick ? '<td class="c-tick">☐</td>' : "";

  const rows = invoices.map((job, index) => {
    const status = statusOf(job);
    return `<tr>
        <td class="c-no">${index + 1}</td>
        ${tickCell}
        <td class="c-date">${esc(dateLabel(job.invoice.date))}</td>
        <td class="c-ref">${refCell(job.invoice.no, blankRefs, `data-edit-inv="${esc(job.id)}"`)}</td>
        <td class="c-ref">${esc(job.jobNo || "—")}</td>
        <td>${esc(job.customer || "—")}</td>
        <td>${esc(job.title || "")}</td>
        <td class="c-num">${esc(amount2(invoiced(job)))}</td>
        <td class="c-num">${esc(amount2(paidTotal(job)))}</td>
        <td class="c-num">${esc(amount2(balanceOf(job)))}</td>
        <td class="c-mid ${status.cls}">${esc(status.label)}</td>
      </tr>`;
  }).join("");

  const emptyRow = invoices.length ? "" :
    `<tr><td colspan="${showTick ? 11 : 10}" class="c-mid c-muted">Tiada invois direkod untuk ${esc(monthTitle(value))}.</td></tr>`;

  const paymentRows = payments.map((row, index) => `<tr>
      <td class="c-no">${index + 1}</td>
      ${showTick ? '<td class="c-tick">☐</td>' : ""}
      <td class="c-date">${esc(dateLabel(row.payment.date))}</td>
      <td class="c-ref">${refCell(row.payment.receiptNo, blankRefs, `data-edit-rcp="${esc(row.payment.id)}" data-job="${esc(row.job.id)}"`)}</td>
      <td class="c-ref">${esc((row.job.invoice || {}).no || "—")}</td>
      <td>${esc(row.job.customer || "—")}</td>
      <td>${esc(row.payment.method || "—")}${row.payment.ref ? ` · ${esc(row.payment.ref)}` : ""}</td>
      <td class="c-num">${esc(amount2(row.payment.amount))}</td>
    </tr>`).join("");

  const carriedRows = carried.map((job, index) => `<tr>
      <td class="c-no">${index + 1}</td>
      ${showTick ? '<td class="c-tick">☐</td>' : ""}
      <td class="c-date">${esc(dateLabel(job.invoice.date))}</td>
      <td class="c-ref">${refCell(job.invoice.no, blankRefs, `data-edit-inv="${esc(job.id)}"`)}</td>
      <td>${esc(job.customer || "—")}</td>
      <td class="c-num">${esc(amount2(invoiced(job)))}</td>
      <td class="c-num">${esc(amount2(balanceOf(job)))}</td>
      <td class="c-mid">${esc(dueDateOf(job) ? dateLabel(dueDateOf(job)) : "—")}</td>
    </tr>`).join("");

  $("#docRoot").innerHTML = `
    <article class="sheet-doc">
      <header class="doc-top">
        <div class="doc-company">
          <h1>${esc(settings.company || "Nama syarikat belum diisi")}</h1>
          ${settings.ssm ? `<p class="doc-muted">No. Pendaftaran: ${esc(settings.ssm)}</p>` : ""}
          ${settings.address ? `<p class="doc-muted">${esc(settings.address)}</p>` : ""}
          ${(settings.phone || settings.email) ? `<p class="doc-muted">${esc([settings.phone, settings.email].filter(Boolean).join(" · "))}</p>` : ""}
        </div>
        <div class="doc-title">
          <h2>SENARAI INVOIS BULANAN</h2>
          <p class="doc-no">${esc(monthTitle(value))}</p>
        </div>
      </header>

      <section class="sum-strip">
        <div class="sum-box"><small>Bilangan invois</small><strong>${invoices.length}</strong></div>
        <div class="sum-box"><small>Jumlah diinvois</small><strong>${esc(money(totalInvoiced))}</strong></div>
        <div class="sum-box"><small>Sudah dibayar</small><strong>${esc(money(totalPaidOnThese))}</strong></div>
        <div class="sum-box"><small>Baki belum bayar</small><strong>${esc(money(totalOutstanding))}</strong></div>
      </section>

      <div class="table-wrap"><table class="doc-table list-table">
        <thead><tr>
          <th class="c-no">#</th>${tickHead}
          <th class="c-date">Tarikh invois</th>
          <th class="c-ref">No invois</th>
          <th class="c-ref">No rujukan</th>
          <th>Pelanggan</th>
          <th>Perihal kerja</th>
          <th class="c-num">Jumlah (RM)</th>
          <th class="c-num">Dibayar (RM)</th>
          <th class="c-num">Baki (RM)</th>
          <th class="c-mid">Status</th>
        </tr></thead>
        <tbody>${rows}${emptyRow}</tbody>
        <tfoot><tr class="grand">
          <td colspan="${showTick ? 7 : 6}">JUMLAH BAGI ${esc(monthTitle(value).toUpperCase())}</td>
          <td class="c-num">${esc(amount2(totalInvoiced))}</td>
          <td class="c-num">${esc(amount2(totalPaidOnThese))}</td>
          <td class="c-num">${esc(amount2(totalOutstanding))}</td>
          <td></td>
        </tr></tfoot>
      </table></div>

      ${showPayments ? `
      <h3 class="sec-title">Bayaran diterima dalam ${esc(monthTitle(value))}</h3>
      <div class="table-wrap"><table class="doc-table list-table">
        <thead><tr>
          <th class="c-no">#</th>${tickHead}
          <th class="c-date">Tarikh</th><th class="c-ref">No resit</th><th class="c-ref">Bagi invois</th>
          <th>Pelanggan</th><th>Kaedah / rujukan</th><th class="c-num">Jumlah (RM)</th>
        </tr></thead>
        <tbody>${paymentRows || `<tr><td colspan="${showTick ? 8 : 7}" class="c-mid c-muted">Tiada bayaran diterima dalam bulan ini.</td></tr>`}</tbody>
        <tfoot><tr class="grand">
          <td colspan="${showTick ? 7 : 6}">JUMLAH DITERIMA</td>
          <td class="c-num">${esc(amount2(totalReceived))}</td>
        </tr></tfoot>
      </table></div>` : ""}

      ${showCarried ? `
      <h3 class="sec-title">Baki tertunggak dari bulan terdahulu</h3>
      <div class="table-wrap"><table class="doc-table list-table">
        <thead><tr>
          <th class="c-no">#</th>${tickHead}
          <th class="c-date">Tarikh invois</th><th class="c-ref">No invois</th>
          <th>Pelanggan</th><th class="c-num">Jumlah (RM)</th><th class="c-num">Baki (RM)</th><th class="c-mid">Jatuh tempo</th>
        </tr></thead>
        <tbody>${carriedRows || `<tr><td colspan="${showTick ? 8 : 7}" class="c-mid c-muted">Tiada baki tertunggak dari bulan sebelum ini.</td></tr>`}</tbody>
        <tfoot><tr class="grand">
          <td colspan="${showTick ? 6 : 5}">JUMLAH TERTUNGGAK</td>
          <td class="c-num">${esc(amount2(carried.reduce((sum, job) => sum + invoiced(job), 0)))}</td>
          <td class="c-num">${esc(amount2(carried.reduce((sum, job) => sum + balanceOf(job), 0)))}</td>
          <td></td>
        </tr></tfoot>
      </table></div>` : ""}

      <div class="print-foot">
        <div>
          <p class="doc-label">Disediakan oleh</p>
          <div class="sign-line"></div>
          <p class="doc-muted">${esc(settings.company || "")}</p>
        </div>
        <div>
          <p class="doc-label">Disemak oleh (akaun)</p>
          <div class="sign-line"></div>
          <p class="doc-muted">Tarikh: ______________</p>
        </div>
      </div>
      <p class="doc-note">Senarai dijana pada ${esc(dateLabel(todayIso()))} daripada Bisnes Tracker.${settings.note ? ` ${esc(settings.note)}` : ""}</p>
    </article>`;
}

/* ---------- CSV ---------- */
function exportCsv() {
  const value = monthValue();
  const rows = [["Tarikh invois", "No invois", "No rujukan", "Pelanggan", "Perihal kerja", "Jumlah (RM)", "Dibayar (RM)", "Baki (RM)", "Jatuh tempo", "Status"]];
  invoicesOf(value).forEach(job => rows.push([
    job.invoice.date, job.invoice.no || "", job.jobNo || "", job.customer || "", job.title || "",
    amount2(invoiced(job)), amount2(paidTotal(job)), amount2(balanceOf(job)),
    dueDateOf(job) || "", statusOf(job).label
  ]));
  if (rows.length === 1) { alert("Tiada invois dalam bulan ini."); return; }
  downloadCsv(`senarai-invois_${value}.csv`, rows);
}

/* ---------- Simpan suntingan nombor ---------- */
function saveRef(node) {
  const text = node.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
  const jobs = readJobs();
  let changed = false;

  if (node.dataset.editInv) {
    const job = jobs.find(item => item.id === node.dataset.editInv);
    if (job && job.invoice && (job.invoice.no || "") !== text) { job.invoice.no = text; changed = true; }
  } else if (node.dataset.editRcp) {
    const job = jobs.find(item => item.id === node.dataset.job);
    const payment = job && (job.payments || []).find(item => item.id === node.dataset.editRcp);
    if (payment && (payment.receiptNo || "") !== text) { payment.receiptNo = text; changed = true; }
  }
  if (!changed) return;
  writeJobs(jobs);
  monthJobs = jobs;
  node.classList.add("is-saved");
  setTimeout(() => node.classList.remove("is-saved"), 1200);
  // kemas kini sel lain yang merujuk nombor invois yang sama
  if (node.dataset.editInv) buildDoc();
}

$("#docRoot").addEventListener("focusout", event => {
  const node = event.target.closest("[contenteditable]");
  if (node) saveRef(node);
});
$("#docRoot").addEventListener("keydown", event => {
  const node = event.target.closest("[contenteditable]");
  if (!node) return;
  if (event.key === "Enter") { event.preventDefault(); node.blur(); }
  if (event.key === "Escape") { node.blur(); }
});

/* ---------- Pendengar ---------- */
const params = new URLSearchParams(location.search);
$("#monthPick").value = params.get("bulan") || todayIso().slice(0, 7);

$("#monthPick").addEventListener("change", buildDoc);
$("#prevMonth").addEventListener("click", () => { $("#monthPick").value = shiftMonth(monthValue(), -1); buildDoc(); });
$("#nextMonth").addEventListener("click", () => { $("#monthPick").value = shiftMonth(monthValue(), 1); buildDoc(); });
["#optTick", "#optPayments", "#optUnpaid", "#optBlank"].forEach(id => $(id).addEventListener("change", buildDoc));
$("#printButton").addEventListener("click", () => window.print());
$("#csvButton").addEventListener("click", exportCsv);
document.addEventListener("ft-cloud-data", () => { monthJobs = readJobs(); buildDoc(); });

buildDoc();
