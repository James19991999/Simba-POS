import { formatKes } from "@/lib/utils/currency";
import type { Order, PaymentChannel } from "@/types";
import type { BillBreakdown } from "@/lib/billing/tax";

// Real browser-native printing: opens a print-formatted window and calls
// window.print(), which hands off to whatever printer the operating system
// has configured — including a thermal KOT/receipt printer registered as a
// standard OS/CUPS printer. This needs no proprietary ESC/POS driver
// integration (which a web app cannot do directly from the browser sandbox
// anyway) and is genuinely functional today, not a placeholder: it produces
// a real print job on a real printer once one is set up on the till.

const RECEIPT_STYLES = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    width: 80mm;
    margin: 0 auto;
    padding: 8px;
    font-size: 12px;
    color: #000;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .title { font-size: 16px; font-weight: 800; }
  .uppercase { text-transform: uppercase; letter-spacing: 0.05em; }
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );
}

export function buildKotHtml(order: Order, tableCode: string): string {
  const rows = order.items
    .map(
      (i) => `<div class="row"><span>${i.qty}x ${escapeHtml(i.nameEn)}</span></div>${
        i.notes ? `<div style="padding-left:12px;font-style:italic">${escapeHtml(i.notes)}</div>` : ""
      }`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>KOT</title><style>${RECEIPT_STYLES}</style></head>
  <body>
    <div class="center title">KITCHEN ORDER TICKET</div>
    <div class="center uppercase">Table ${escapeHtml(tableCode)}</div>
    <div class="row"><span>Order</span><span>#${order.id.slice(0, 8).toUpperCase()}</span></div>
    <div class="row"><span>Time</span><span>${new Date(order.createdAt).toLocaleTimeString()}</span></div>
    <hr />
    ${rows}
    <hr />
    <div class="center">${order.items.length} item(s)</div>
  </body></html>`;
}

export function buildReceiptHtml(params: {
  orgName: string;
  stationName: string;
  tableCode?: string;
  order: Order;
  breakdown: BillBreakdown;
  channel: PaymentChannel;
  kraPin?: string;
  controlNumber?: string;
  simulatedEtims: boolean;
}): string {
  const { orgName, stationName, tableCode, order, breakdown, channel, kraPin, controlNumber, simulatedEtims } = params;
  const rows = order.items
    .map(
      (i) =>
        `<div class="row"><span>${i.qty}x ${escapeHtml(i.nameEn)}</span><span>${formatKes(
          i.qty * i.unitPriceKes
        )}</span></div>`
    )
    .join("");

  const channelLabel =
    channel === "mpesa_stk" ? "M-Pesa (IntaSend)" : channel === "card" ? "Card (IntaSend)" : "Cash";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>${RECEIPT_STYLES}</style></head>
  <body>
    <div class="center title">${escapeHtml(orgName)}</div>
    <div class="center">${escapeHtml(stationName)}</div>
    ${tableCode ? `<div class="center">Table ${escapeHtml(tableCode)}</div>` : ""}
    <hr />
    ${rows}
    <hr />
    <div class="row"><span>Subtotal</span><span>${formatKes(breakdown.itemsSubtotalKes)}</span></div>
    <div class="row"><span>Tourism &amp; Catering Levy</span><span>${formatKes(breakdown.tourismLevyKes)}</span></div>
    <div class="row"><span>VAT (incl.)</span><span>${formatKes(breakdown.vatKes)}</span></div>
    <div class="row bold"><span>TOTAL</span><span>${formatKes(breakdown.totalPayableKes)}</span></div>
    <hr />
    <div class="row"><span>Paid via</span><span>${channelLabel}</span></div>
    ${kraPin ? `<div class="row"><span>KRA PIN</span><span>${escapeHtml(kraPin)}</span></div>` : ""}
    ${
      controlNumber
        ? `<div class="row"><span>eTIMS Control No.</span><span>${escapeHtml(controlNumber)}</span></div>`
        : ""
    }
    ${
      simulatedEtims
        ? `<div class="center" style="font-size:10px">*** SIMULATED eTIMS — not KRA-verified ***</div>`
        : ""
    }
    <hr />
    <div class="center">Asante! Karibu tena.</div>
  </body></html>`;
}

/**
 * Opens a print-formatted window and immediately invokes window.print().
 * Must be called from a browser (client component) — SSR/Node has no
 * `window`. Returns false (rather than throwing) if no browser window is
 * available, so callers can show a message instead of crashing.
 */
export function printHtml(html: string): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank", "width=380,height=600");
  if (!printWindow) return false; // popup blocked
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
  return true;
}
