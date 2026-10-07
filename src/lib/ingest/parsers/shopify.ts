/**
 * Shopify Analytics report exports (Analytics > Reports > any report >
 * Export). Handles both the current report headers ("Total sales", "Orders",
 * "Sessions") and older snake_case ones ("total_sales", "orders").
 *
 * Time column: Day/Date gives daily rows; Month or Week gives period totals.
 * Dimension column: Product title or Sales channel gives a breakdown.
 */
import { addDays, norm, num, parseDate, parseMonth } from "../cells";
import type { Parser, Period } from "../types";
import { cell, headerSet, hasAny, mapHeaders, missingPeriodMessage } from "./common";

const ROLES = {
  day: ["Day", "Date"],
  month: ["Month"],
  week: ["Week"],
  product: ["Product title", "Product", "Product name"],
  channel: ["Sales channel", "Channel", "Order sales channel", "Sales channel name"],
  totalSales: ["Total sales"],
  orders: ["Orders", "Total orders"],
  sessions: ["Sessions", "Online store sessions", "Online store visitors"],
  customers: ["Customers", "Total customers"],
  firstTime: ["First-time customers", "First time customers", "New customers"],
  returning: ["Returning customers"],
};
const IGNORE = [
  "Gross sales", "Discounts", "Returns", "Net sales", "Shipping", "Shipping charges", "Taxes", "Duties", "Additional fees",
  "Average order value", "Returning customer rate", "Conversion rate", "Online store conversion rate", "Net items sold",
  "Gross items sold*", "Product vendor", "Product type", "Variant title", "Variant SKU", "Product variant*",
  "Sessions with cart additions", "Sessions that reached checkout", "Sessions that completed checkout", "Added to cart*",
  "Reached checkout*", "Completed checkout*", "Orders fulfilled", "Ordered item quantity", "Cost of goods sold", "Gross profit",
  "Gross margin", "Visitors", "Hour", "Year", "Quarter",
];

export const shopifyParser: Parser = {
  id: "shopify_report",
  label: "Shopify Analytics report export",
  sources: ["shopify"],

  detect(sheets) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 3);
      const shopifyish = hasAny(h, "Net sales", "Gross sales", "Online store sessions", "Sessions that completed checkout", "Product title", "Returning customer rate", "First-time customers");
      if (hasAny(h, "Total sales", "Orders", "Sessions", "Returning customers") && shopifyish) return 0.9;
    }
    return 0;
  },

  parse(sheets, ctx, out) {
    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => ["total sales", "orders", "sessions", "online store sessions", "returning customers", "customers"].includes(norm(c))));
      if (h < 0) continue;
      const headers = sheet.rows[h];
      const { idx, mapped, unmapped } = mapHeaders(headers, ROLES, IGNORE);
      out.columns(mapped, unmapped);
      const hasTime = idx.day >= 0 || idx.month >= 0 || idx.week >= 0;
      if (!hasTime && !ctx.period) {
        out.error(missingPeriodMessage("Shopify"));
        return;
      }
      const dimension = idx.product >= 0 ? "product" : idx.channel >= 0 ? "channel" : "";
      const dimIdx = idx.product >= 0 ? idx.product : idx.channel;

      for (const row of sheet.rows.slice(h + 1)) {
        const first = norm(row[0] ?? "");
        if (!first || first === "total" || first === "totals" || first === "summary") continue;

        let when: { date: string } | Period | null = null;
        if (idx.day >= 0) {
          const d = parseDate(cell(row, idx.day));
          when = d ? { date: d } : null;
        } else if (idx.month >= 0) {
          when = parseMonth(cell(row, idx.month)) ?? (() => {
            const d = parseDate(cell(row, idx.month));
            return d ? parseMonth(d.slice(0, 7)) : null;
          })();
        } else if (idx.week >= 0) {
          const d = parseDate(cell(row, idx.week));
          when = d ? { start: d, end: addDays(d, 6) } : null;
        } else when = ctx.period!;
        if (!when) {
          out.warn(`Skipped a row with an unreadable date ("${row[0]}").`);
          continue;
        }
        out.rowsRead++;

        const dimValue = dimension ? cell(row, dimIdx) || "(none)" : "";
        out.value("shopify", "shop_total_sales", when, num(cell(row, idx.totalSales)), dimension, dimValue);
        out.value("shopify", "shop_orders", when, num(cell(row, idx.orders)), dimension, dimValue);
        if (!dimension) {
          out.value("shopify", "shop_sessions", when, num(cell(row, idx.sessions)));
          const firstTime = num(cell(row, idx.firstTime));
          const returning = num(cell(row, idx.returning));
          const customers = num(cell(row, idx.customers)) ?? (firstTime !== null && returning !== null ? firstTime + returning : null);
          // Customer counts are unique, so only whole-period values are exact.
          out.value("shopify", "shop_customers", when, customers);
          out.value("shopify", "shop_returning_customers", when, returning);
        }
      }

      // Sales by channel adds up to total sales; by product it does not
      // (one order can contain several products).
      if (dimension === "channel") {
        const batch = out.batch();
        const sums = new Map<string, number>();
        const add = (k: string, v: number) => sums.set(k, (sums.get(k) ?? 0) + v);
        for (const r of batch.daily) if (r.dimension === "channel") add(`${r.metric_key}|${r.date}`, r.value);
        for (const r of batch.period) if (r.dimension === "channel") add(`${r.metric_key}|${r.period_start}|${r.period_end}`, r.value);
        for (const [k, v] of sums) {
          const [key, a, b] = k.split("|");
          out.value("shopify", key, b ? { start: a, end: b } : { date: a }, Math.round(v * 100) / 100);
        }
        out.warn("Store totals were calculated by adding up all sales channels.");
      }
    }
  },
};
