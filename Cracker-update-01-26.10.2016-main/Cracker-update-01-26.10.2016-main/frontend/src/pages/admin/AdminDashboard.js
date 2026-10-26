import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, ShoppingBag, Clock, AlertTriangle, Pencil, X, Check, Plus, PenLine, FileUp, Download, UserPlus, Trash2, ChevronDown, ChevronUp, PackageOpen, Tag, Printer, ScanBarcode, KeyRound, Eye, EyeOff, ShieldAlert, ShieldCheck, Trash } from "lucide-react";
import JsBarcode from "jsbarcode";
import api from "@/lib/api";
import { money } from "@/lib/totals";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import ProductModal from "@/components/ProductModal";
import BulkStockModal from "@/components/BulkStockModal";
import BulkImportModal from "@/components/BulkImportModal";
import BulkBarcodeModal from "@/components/BulkBarcodeModal";
import { useAuth } from "@/context/AuthContext";

// ── Barcode label printing via new window (no CSS conflicts) ──────────────────
function _escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _barcodeSvg(code) {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, code, {
      format: "CODE128", width: 1.8, height: 50, fontSize: 10,
      margin: 2, displayValue: true, lineColor: "#000", background: "#fff",
    });
    return svg.outerHTML;
  } catch {
    return `<div style="font-size:8pt;color:#888;text-align:center;padding:4px;">Invalid barcode</div>`;
  }
}

export function printLabels(products) {
  const items = products.map((p) => ({
    svgHTML: p.barcode ? _barcodeSvg(p.barcode) : "",
    name: p.name,
    brand: p.brand || "",
    retail_price: p.retail_price,
    barcode: p.barcode || "",
  }));

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Barcode Labels</title>
<style>
  @page { size: 62mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2mm; background: #fff; font-family: Arial, sans-serif; }
  .grid { display: flex; flex-wrap: wrap; gap: 2mm; }
  .label { width: 58mm; border: 0.4mm solid #bbb; border-radius: 1mm; padding: 2mm 2mm 3mm; display: flex; flex-direction: column; align-items: center; page-break-inside: avoid; background: #fff; }
  .label svg { width: 54mm !important; height: auto !important; }
  .name { font-size: 8.5pt; font-weight: bold; text-align: center; width: 54mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1.5mm; }
  .brand { font-size: 7pt; color: #a00; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; }
  .price { font-size: 10pt; font-weight: bold; margin-top: 0.5mm; }
  .no-bc { width: 54mm; height: 16mm; background: #f5f5f5; display: flex; align-items: center; justify-content: center; font-size: 8pt; color: #888; }
</style></head>
<body><div class="grid">
${items.map((p) => `<div class="label">
  ${p.svgHTML || `<div class="no-bc">No barcode</div>`}
  <div class="name">${_escHtml(p.name)}</div>
  ${p.brand ? `<div class="brand">${_escHtml(p.brand)}</div>` : ""}
  <div class="price">&#8377;${p.retail_price}</div>
</div>`).join("\n")}
</div></body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  const w = window.open(blobUrl, "_blank", "width=640,height=480");
  if (!w) { alert("Allow popups to print labels, then try again."); URL.revokeObjectURL(blobUrl); return; }
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch (e) { console.warn("Print dialog closed:", e.message); }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }, 500);
}

const orderBadge = (status) =>
  status === "paid" ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-[#FFF0C9] text-[#5C3F00]";

const stockCls = (stock) =>
  stock === 0
    ? "bg-[#FDE3DE] text-maroon"
    : stock <= 10
    ? "bg-[#FFE3A3] text-[#5C3F00]"
    : "bg-[#DDF1E3] text-[#1F5F36]";

function FilterChip({ label, active, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className={"h-8 px-3 rounded-lg font-bold text-xs transition-colors whitespace-nowrap " +
        (active ? "bg-brick text-white" : "bg-chip text-mocha hover:text-ink")}
    >
      {label}
      {count != null && count > 0 && (
        <span className={"ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 " + (active ? "bg-white/20" : "bg-white text-mocha")}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function AdminDashboard() {
  const queryClient = useQueryClient();

  // Stock inline edit
  const [editingId, setEditingId] = useState(null);
  const [editStock, setEditStock] = useState("");
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState("");

  // Low-stock banner
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [bannerExpanded, setBannerExpanded] = useState(true);

  // Product modal
  const [modalProduct, setModalProduct] = useState(null); // null = closed, {} = add, product obj = edit
  const modalOpen = modalProduct !== null;
  const [catsExpanded, setCatsExpanded] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  const handleExportProducts = async () => {
    try {
      const { data } = await api.get("/admin/products/export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    }
  };

  const handleExportBarcodes = async () => {
    try {
      const { data } = await api.get("/admin/products/barcode-export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `barcodes_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {
      alert("Barcode export failed. Please try again.");
    }
  };

  // Salesperson management
  const [spName, setSpName] = useState("");
  const [spBusy, setSpBusy] = useState(false);
  const [spError, setSpError] = useState("");
  const [settingPinFor, setSettingPinFor] = useState(null);
  const [pinVal, setPinVal] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const [accountFormFor, setAccountFormFor] = useState(null); // sp id
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPass, setAcctPass] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctError, setAcctError] = useState("");
  const [emailResetSent, setEmailResetSent] = useState({});
  const [prodCategory, setProdCategory] = useState("All"); // { [sp_id]: 'sending'|'sent'|'error' }

  // Accordion show-all toggles (max 5 visible by default)
  const [showAllLowStock, setShowAllLowStock] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllSalespersons, setShowAllSalespersons] = useState(false);

  const sendResetEmail = async (spId) => {
    setEmailResetSent((prev) => ({ ...prev, [spId]: "sending" }));
    try {
      await api.post(`/admin/salespersons/${spId}/send-reset-email`);
      setEmailResetSent((prev) => ({ ...prev, [spId]: "sent" }));
      setTimeout(() => setEmailResetSent((prev) => { const n = { ...prev }; delete n[spId]; return n; }), 4000);
    } catch (e) {
      setEmailResetSent((prev) => ({ ...prev, [spId]: "error" }));
      setTimeout(() => setEmailResetSent((prev) => { const n = { ...prev }; delete n[spId]; return n; }), 4000);
    }
  };

  // Category management
  const [catName, setCatName] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  // Order filters
  const [dateFilter, setDateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get("/admin/stats").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => api.get("/admin/orders?limit=100").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: salespersons = [], refetch: refetchSP } = useQuery({
    queryKey: ["salespersons"],
    queryFn: () => api.get("/admin/salespersons").then((r) => r.data),
  });

  const { data: categories = [], refetch: refetchCats } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const addCategory = async () => {
    const name = catName.trim();
    if (!name) { setCatError("Enter a category name"); return; }
    setCatBusy(true); setCatError("");
    try {
      await api.post("/admin/categories", { name });
      setCatName(""); refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not save — try again");
    } finally { setCatBusy(false); }
  };

  const renameCategory = async (id) => {
    const name = renameVal.trim();
    if (!name) return;
    setCatBusy(true); setCatError("");
    try {
      await api.patch(`/admin/categories/${id}`, { name });
      setRenamingId(null); setRenameVal("");
      refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories", "products"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not rename");
    } finally { setCatBusy(false); }
  };

  const deleteCategory = async (id) => {
    setCatError("");
    try {
      await api.delete(`/admin/categories/${id}`);
      refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not delete");
    }
  };

  const addSalesperson = async () => {
    const name = spName.trim();
    if (!name) { setSpError("Enter a name"); return; }
    setSpBusy(true); setSpError("");
    try {
      await api.post("/admin/salespersons", { name });
      setSpName("");
      refetchSP();
    } catch { setSpError("Could not save — try again"); }
    finally { setSpBusy(false); }
  };

  const savePin = async (spId) => {
    if (!/^\d{4}$/.test(pinVal)) { setPinError("Enter exactly 4 digits"); return; }
    setPinBusy(true); setPinError("");
    try {
      await api.patch(`/admin/salespersons/${spId}/pin`, { pin: pinVal });
      setSettingPinFor(null); setPinVal("");
      refetchSP();
    } catch (e) {
      setPinError(e?.response?.data?.detail || "Could not save PIN");
    } finally { setPinBusy(false); }
  };

  const saveAccount = async (spId) => {
    if (!acctEmail.trim() || !acctPass.trim()) { setAcctError("Email and password required"); return; }
    setAcctBusy(true); setAcctError("");
    try {
      await api.post(`/admin/salespersons/${spId}/create-account`, { email: acctEmail.trim(), password: acctPass });
      setAccountFormFor(null); setAcctEmail(""); setAcctPass("");
      refetchSP();
    } catch (e) {
      setAcctError(e?.response?.data?.detail || "Could not create account");
    } finally { setAcctBusy(false); }
  };

  const resetPassword = async (spId) => {
    if (!acctPass.trim()) { setAcctError("Enter new password"); return; }
    setAcctBusy(true); setAcctError("");
    try {
      await api.patch(`/admin/salespersons/${spId}/reset-password`, { password: acctPass });
      setAccountFormFor(null); setAcctPass("");
      refetchSP();
    } catch (e) {
      setAcctError(e?.response?.data?.detail || "Could not reset password");
    } finally { setAcctBusy(false); }
  };

  const deleteSalesperson = async (id) => {
    try {
      await api.delete(`/admin/salespersons/${id}`);
      refetchSP();
    } catch (e) {
      console.error("Delete salesperson failed:", e);
    }
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    if (dateFilter !== "all") {
      const start = new Date();
      if (dateFilter === "today") { start.setHours(0, 0, 0, 0); }
      else if (dateFilter === "week") { start.setDate(start.getDate() - 7); }
      else if (dateFilter === "month") { start.setDate(start.getDate() - 30); }
      result = result.filter((o) => new Date(o.created_at) >= start);
    }
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    if (typeFilter !== "all") result = result.filter((o) => typeFilter === "pos" ? o.is_pos : !o.is_pos);

    return result;
  }, [orders, dateFilter, statusFilter, typeFilter]);

  // Stock counts for filter badges
  const orderCounts = useMemo(() => {
    const base = (() => {
      let r = orders;
      if (dateFilter !== "all") {
        const start = new Date();
        if (dateFilter === "today") { start.setHours(0, 0, 0, 0); }
        else if (dateFilter === "week") { start.setDate(start.getDate() - 7); }
        else if (dateFilter === "month") { start.setDate(start.getDate() - 30); }
        r = r.filter((o) => new Date(o.created_at) >= start);
      }
      return r;
    })();
    return {
      paid: base.filter((o) => o.status === "paid").length,
      pending: base.filter((o) => o.status === "pending").length,
      pos: base.filter((o) => o.is_pos).length,
      online: base.filter((o) => !o.is_pos).length,
    };
  }, [orders, dateFilter]);

  // Filtered products (by category chip)
  const filteredProducts = useMemo(
    () => prodCategory === "All" ? products : products.filter((p) => p.category === prodCategory),
    [products, prodCategory]
  );

  // Inline stock edit
  const startEdit = (p) => { setEditingId(p.id); setEditStock(String(p.stock)); setStockError(""); };
  const cancelEdit = () => { setEditingId(null); setEditStock(""); setStockError(""); };
  const saveStock = async (productId) => {
    const val = parseInt(editStock, 10);
    if (isNaN(val) || val < 0) { setStockError("Enter a valid number ≥ 0"); return; }
    setStockBusy(true);
    setStockError("");
    try {
      await api.patch(`/admin/products/${productId}/stock`, { stock: val });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setEditingId(null);
    } catch { setStockError("Save failed — try again"); }
    finally { setStockBusy(false); }
  };

  const statCards = [
    { label: "Today's Revenue", value: money(stats?.today_revenue ?? 0), icon: TrendingUp, color: "text-[#1F5F36]", bg: "bg-[#DDF1E3]" },
    { label: "Today's Orders", value: stats?.today_orders ?? 0, icon: ShoppingBag, color: "text-maroon", bg: "bg-[#FFE3B8]" },
    { label: "Total Orders", value: stats?.total_orders ?? 0, icon: ShoppingBag, color: "text-[#1F3F7A]", bg: "bg-[#E1EAFB]" },
    { label: "Pending Wholesale", value: stats?.pending_wholesale ?? 0, icon: Clock, color: "text-[#5C3F00]", bg: "bg-[#FFF0C9]" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-5" data-testid="admin-dashboard">
      <h1 className="font-display font-bold text-2xl mb-4">Owner Dashboard</h1>

      {/* ── Low stock alert banner ── */}
      {!statsLoading && stats?.low_stock?.length > 0 && !bannerDismissed && (
        <div
          className="mb-4 rounded-2xl border border-[#F5C842] bg-[#FFFBE6] overflow-hidden"
          data-testid="low-stock-banner"
        >
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3">
            <button
              className="flex items-center gap-2.5 flex-1 text-left"
              onClick={() => setBannerExpanded((v) => !v)}
              data-testid="low-stock-banner-toggle"
            >
              <div className="w-8 h-8 rounded-xl bg-[#FFE3A3] flex items-center justify-center flex-none">
                <AlertTriangle size={15} className="text-maroon" />
              </div>
              <div>
                <span className="font-bold text-sm text-ink">
                  {stats.low_stock.length} product{stats.low_stock.length > 1 ? "s" : ""} running low on stock
                </span>
                <span className="ml-2 text-[11px] font-bold bg-maroon text-white rounded-full px-2 py-0.5">
                  ≤ 10 units
                </span>
              </div>
              <div className="ml-auto mr-2 text-mocha">
                {bannerExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-mocha hover:text-maroon transition-colors flex-none"
              data-testid="low-stock-banner-dismiss"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>

          {/* Expanded product list */}
          {bannerExpanded && (
            <div className="border-t border-[#F5C842]/60 px-4 py-3 flex flex-col gap-1.5" data-testid="low-stock-list">
              {(showAllLowStock ? stats.low_stock : stats.low_stock.slice(0, 5)).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-0.5" data-testid={`low-stock-item-${p.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <PackageOpen size={13} className="text-mocha flex-none" />
                    <span className="text-sm text-ink truncate">{p.name}</span>
                    {p.brand && <span className="text-[10px] font-bold text-brick uppercase tracking-wide flex-none">{p.brand}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <span className={"text-xs font-bold rounded-full px-2 py-0.5 " + stockCls(p.stock)}>
                      {p.stock === 0 ? "Out" : `${p.stock} left`}
                    </span>
                    <button
                      onClick={() => { startEdit(p); document.getElementById("products-section")?.scrollIntoView({ behavior: "smooth" }); }}
                      className="text-[11px] font-bold text-brick hover:underline"
                      data-testid={`low-stock-restock-${p.id}`}
                    >
                      Restock
                    </button>
                  </div>
                </div>
              ))}
              {stats.low_stock.length > 5 && (
                <button
                  onClick={() => setShowAllLowStock((v) => !v)}
                  data-testid="low-stock-show-more"
                  className="mt-1 text-[11px] font-bold text-[#5C3F00] hover:text-maroon flex items-center gap-1 self-start"
                >
                  {showAllLowStock
                    ? <><ChevronUp size={12} /> Show less</>
                    : <><ChevronDown size={12} /> Show {stats.low_stock.length - 5} more</>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-2"
            data-testid={`stat-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <div className={"w-9 h-9 rounded-xl flex items-center justify-center " + s.bg}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className={"font-display font-bold text-2xl leading-7 " + s.color}>
              {statsLoading ? <span className="inline-block w-16 h-7 bg-chip rounded animate-pulse" /> : s.value}
            </div>
            <div className="text-xs text-mocha font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Orders */}
      <div className="bg-white border border-line rounded-2xl flex flex-col mb-5"
        data-testid="admin-orders-section">
          <div className="px-4 pt-3 pb-2 border-b border-line flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">Orders</span>
              <span className="text-xs text-mocha">{filteredOrders.length} shown</span>
            </div>
            {/* Date filters */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="order-date-filter">
              {[["all", "All time"], ["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"]].map(([val, label]) => (
                <FilterChip key={val} label={label} active={dateFilter === val} onClick={() => setDateFilter(val)} />
              ))}
            </div>
            {/* Status + Type filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1" data-testid="order-status-filter">
                <FilterChip label="Any status" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
                <FilterChip label="Paid" active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")} count={orderCounts.paid} />
                <FilterChip label="Pending" active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} count={orderCounts.pending} />
              </div>
              <div className="w-px h-5 bg-line" />
              <div className="flex gap-1" data-testid="order-type-filter">
                <FilterChip label="All types" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
                <FilterChip label="POS" active={typeFilter === "pos"} onClick={() => setTypeFilter("pos")} count={orderCounts.pos} />
                <FilterChip label="Online" active={typeFilter === "online"} onClick={() => setTypeFilter("online")} count={orderCounts.online} />
              </div>
            </div>
          </div>

          {ordersLoading ? (
            <div className="p-8 text-center text-mocha text-sm">Loading orders…</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-mocha text-sm" data-testid="admin-orders-empty">
              No orders match your filters.
            </div>
          ) : (
            <>
              <div className="divide-y divide-[#F1E2CC]">
                {(showAllOrders ? filteredOrders : filteredOrders.slice(0, 5)).map((o) => (
                  <Link key={o.id} to={`/order/${o.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-cream transition-colors gap-3"
                    data-testid={`admin-order-row-${o.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm">{o.invoice_no}</div>
                      <div className="text-xs text-mocha truncate">
                        {o.customer_name}
                        {o.is_pos && <span className="ml-1.5 text-[#1F3F7A] font-bold">· POS</span>}
                        {" · "}{new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 flex-none">
                      <span className="font-bold text-sm">₹{o.total.toLocaleString("en-IN")}</span>
                      <span className={"text-xs font-bold rounded-full px-2.5 py-0.5 " + orderBadge(o.status)}>
                        {o.status === "paid" ? "Paid" : "Pending"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              {filteredOrders.length > 5 && (
                <button
                  onClick={() => setShowAllOrders((v) => !v)}
                  data-testid="orders-show-more"
                  className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
                >
                  {showAllOrders
                    ? <><ChevronUp size={13} /> Show less</>
                    : <><ChevronDown size={13} /> Show {filteredOrders.length - 5} more orders</>}
                </button>
              )}
            </>
          )}
        </div>

      {/* Products & Stock */}
      <div className="bg-white border border-line rounded-2xl" id="products-section" data-testid="admin-products-section">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Products & Stock</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportProducts}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="export-products-btn"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={handleExportBarcodes}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="export-barcodes-btn"
              title="Download barcodes CSV for offline label printing"
            >
              <Download size={14} /> Barcode CSV
            </button>
            <button
              onClick={() => setBarcodeOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="assign-barcodes-btn"
              title="Upload a CSV to batch-assign manufacturer barcodes"
            >
              <ScanBarcode size={14} /> Assign Barcodes
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="bulk-import-btn"
            >
              <FileUp size={14} /> Stock CSV
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="product-import-btn"
            >
              <FileUp size={14} /> Products CSV
            </button>
            <button
              onClick={() => setModalProduct({})}
              className="h-9 px-3.5 rounded-xl bg-brick text-white font-bold text-[13px] flex items-center gap-1.5"
              data-testid="add-product-btn"
            >
              <Plus size={15} /> Add product
            </button>
            <button
              onClick={() => printLabels(prodCategory === "All" ? products : products.filter((p) => p.category === prodCategory))}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="print-all-labels-btn"
              title="Print barcode labels for all shown products"
            >
              <Printer size={14} /> Print Labels
            </button>
          </div>
        </div>

        {stockError && (
          <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE] border-b border-[#F1E2CC]">{stockError}</div>
        )}

        {/* Category filter chips */}
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-line" style={{ scrollbarWidth: "none" }} data-testid="product-category-filter">
            {[{ id: "all", name: "All" }, ...categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setProdCategory(c.name)}
                data-testid={`prod-cat-chip-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={"flex-none h-7 px-3 rounded-xl border font-bold text-xs transition-colors " +
                  (prodCategory === c.name
                    ? "bg-brick border-brick text-white"
                    : "bg-cream border-line text-ink hover:border-brick/50")}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="divide-y divide-[#F1E2CC]">
          {(showAllProducts ? filteredProducts : filteredProducts.slice(0, 5)).map((p) => (
            <div key={p.id} className="flex items-center px-4 py-2.5 gap-3" data-testid={`product-stock-row-${p.id}`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ background: iconBg(p.icon) }}>
                <ProductIcon icon={p.icon} size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-mocha">{p.pack_type} · {p.pack_size}</div>
              </div>
              <div className="text-xs text-mocha flex-none hidden sm:flex gap-1.5">
                <span>₹{p.retail_price}</span>
                <span className="text-chip">·</span>
                <span className="text-[#1F5F36]">W ₹{p.wholesale_price}</span>
              </div>

              {editingId === p.id ? (
                <div className="flex items-center gap-1.5 flex-none">
                  <input
                    type="number"
                    value={editStock}
                    onChange={(e) => setEditStock(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveStock(p.id); if (e.key === "Escape") cancelEdit(); }}
                    className="w-[68px] h-9 border-[1.5px] border-brick rounded-xl px-2 text-sm font-bold text-center outline-none"
                    min="0"
                    autoFocus
                    data-testid={`stock-input-${p.id}`}
                  />
                  <button onClick={() => saveStock(p.id)} disabled={stockBusy}
                    className="h-9 w-9 rounded-xl bg-brick text-white flex items-center justify-center disabled:opacity-60"
                    data-testid={`stock-save-${p.id}`}>
                    <Check size={15} />
                  </button>
                  <button onClick={cancelEdit}
                    className="h-9 w-9 rounded-xl border border-line text-mocha flex items-center justify-center hover:border-brick transition-colors"
                    data-testid={`stock-cancel-${p.id}`}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-none">
                  {/* Barcode number — hidden on mobile */}
                  {p.barcode && (
                    <span className="hidden xl:flex text-[10px] text-mocha font-mono bg-chip rounded px-1.5 py-0.5 flex-none" data-testid={`barcode-text-${p.id}`}>
                      {p.barcode}
                    </span>
                  )}
                  <span className={"text-xs font-bold rounded-full px-2.5 py-1 " + stockCls(p.stock)}
                    data-testid={`stock-badge-${p.id}`}>
                    {p.stock === 0 ? "Out" : p.stock}
                  </span>
                  <button onClick={() => printLabels([p])} title="Print barcode label"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`print-label-btn-${p.id}`}>
                    <Printer size={14} />
                  </button>
                  <button onClick={() => startEdit(p)} title="Edit stock"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`stock-edit-btn-${p.id}`}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setModalProduct(p)} title="Edit product"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`product-edit-btn-${p.id}`}>
                    <PenLine size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {filteredProducts.length > 5 && (
          <button
            onClick={() => setShowAllProducts((v) => !v)}
            data-testid="products-show-more"
            className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
          >
            {showAllProducts
              ? <><ChevronUp size={13} /> Show less</>
              : <><ChevronDown size={13} /> Show {filteredProducts.length - 5} more products</>}
          </button>
        )}
      </div>

      {/* Product modal */}
      {modalOpen && (
        <ProductModal
          product={modalProduct?.id ? modalProduct : null}
          onClose={() => setModalProduct(null)}
          onPrintLabel={(p) => printLabels([p])}
        />
      )}

      {/* Bulk stock import modal */}
      {bulkOpen && <BulkStockModal onClose={() => setBulkOpen(false)} />}

      {/* Product import modal */}
      {importOpen && <BulkImportModal onClose={() => setImportOpen(false)} />}

      {/* Bulk barcode assign modal */}
      {barcodeOpen && <BulkBarcodeModal onClose={() => setBarcodeOpen(false)} />}

      {/* Categories */}
      <div className="bg-white border border-line rounded-2xl mt-5" data-testid="categories-section">
        <button
          onClick={() => setCatsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 border-b border-line hover:bg-chip/40 transition-colors rounded-t-2xl"
          data-testid="categories-toggle"
        >
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-mocha" />
            <span className="font-bold text-sm">Categories</span>
            <span className="text-xs text-mocha bg-chip rounded-full px-2 py-0.5">{categories.length}</span>
          </div>
          {catsExpanded ? <ChevronUp size={16} className="text-mocha" /> : <ChevronDown size={16} className="text-mocha" />}
        </button>

        {catsExpanded && (
          <>
            {/* Add row */}
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <input
                type="text"
                value={catName}
                onChange={(e) => { setCatName(e.target.value); setCatError(""); }}
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
                placeholder="New category name (e.g. Sky Shots)"
                className="flex-1 h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="cat-name-input"
              />
              <button
                onClick={addCategory}
                disabled={catBusy}
                className="h-10 px-4 rounded-xl bg-brick text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-60 flex-none"
                data-testid="cat-add-btn"
              >
                <Plus size={15} /> Add
              </button>
            </div>
            {catError && <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE]" data-testid="cat-error">{catError}</div>}

            {categories.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-mocha" data-testid="cat-empty">No categories yet.</div>
            ) : (
              <div className="divide-y divide-[#F1E2CC]">
                {categories.map((cat) => {
                  const inUse = products.filter((p) => p.category === cat.name).length;
                  return (
                    <div key={cat.id} className="flex items-center gap-2 px-4 py-2.5" data-testid={`cat-row-${cat.id}`}>
                      {renamingId === cat.id ? (
                        <>
                          <input
                            autoFocus
                            type="text"
                            value={renameVal}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") renameCategory(cat.id); if (e.key === "Escape") setRenamingId(null); }}
                            className="flex-1 h-9 border border-brick rounded-xl px-3 text-sm outline-none bg-cream"
                            data-testid={`cat-rename-input-${cat.id}`}
                          />
                          <button onClick={() => renameCategory(cat.id)} disabled={catBusy}
                            className="w-8 h-8 rounded-lg bg-brick text-white flex items-center justify-center"
                            data-testid={`cat-rename-save-${cat.id}`}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => setRenamingId(null)}
                            className="w-8 h-8 rounded-lg border border-line text-mocha flex items-center justify-center"
                            data-testid={`cat-rename-cancel-${cat.id}`}>
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium flex-1">{cat.name}</span>
                          <span className="text-[11px] text-mocha bg-chip rounded-full px-2 py-0.5 flex-none">
                            {inUse} product{inUse !== 1 ? "s" : ""}
                          </span>
                          <button
                            onClick={() => { setRenamingId(cat.id); setRenameVal(cat.name); setCatError(""); }}
                            className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                            data-testid={`cat-rename-btn-${cat.id}`}
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => deleteCategory(cat.id)}
                            disabled={inUse > 0}
                            className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-maroon hover:text-maroon transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            data-testid={`cat-delete-btn-${cat.id}`}
                            title={inUse > 0 ? `Used by ${inUse} product(s) — reassign first` : "Delete"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Salespersons */}
      <div className="bg-white border border-line rounded-2xl mt-5" data-testid="salespersons-section">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Salespersons</span>
          <span className="text-xs text-mocha">{salespersons.length} added</span>
        </div>

        {/* Add row */}
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <input
            type="text"
            value={spName}
            onChange={(e) => { setSpName(e.target.value); setSpError(""); }}
            onKeyDown={(e) => e.key === "Enter" && addSalesperson()}
            placeholder="Salesperson name"
            className="flex-1 h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
            data-testid="sp-name-input"
          />
          <button
            onClick={addSalesperson}
            disabled={spBusy}
            className="h-10 px-4 rounded-xl bg-brick text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-60"
            data-testid="sp-add-btn"
          >
            <UserPlus size={15} /> Add
          </button>
        </div>
        {spError && <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE]">{spError}</div>}

        {salespersons.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-mocha" data-testid="sp-empty">No salespersons added yet.</div>
        ) : (
          <>
            <div className="divide-y divide-[#F1E2CC]">
              {(showAllSalespersons ? salespersons : salespersons.slice(0, 5)).map((sp) => (
              <div key={sp.id} className="px-4 py-2.5" data-testid={`sp-row-${sp.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium flex-1 min-w-0">{sp.name}</span>

                  {/* Account badge */}
                  {sp.has_account
                    ? <span className="text-[11px] font-bold bg-[#DDF1E3] text-[#1F5F36] rounded-full px-2 py-0.5 flex-none" data-testid={`sp-acct-status-${sp.id}`}>Account: {sp.email}</span>
                    : <span className="text-[11px] font-bold bg-chip text-mocha rounded-full px-2 py-0.5 flex-none" data-testid={`sp-acct-status-${sp.id}`}>No account</span>
                  }

                  {/* PIN status badge */}
                  <span className={"text-[11px] font-bold rounded-full px-2 py-0.5 flex-none " +
                    (sp.has_pin ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-chip text-mocha")}
                    data-testid={`sp-pin-status-${sp.id}`}>
                    {sp.has_pin ? "PIN set" : "No PIN"}
                  </span>

                  <button onClick={() => { setSettingPinFor(settingPinFor === sp.id ? null : sp.id); setPinVal(""); setPinError(""); setAccountFormFor(null); }}
                    className="text-xs font-bold text-brick hover:underline flex-none"
                    data-testid={`sp-set-pin-btn-${sp.id}`}>
                    {sp.has_pin ? "Change PIN" : "Set PIN"}
                  </button>

                  <button onClick={() => { setAccountFormFor(accountFormFor === sp.id ? null : sp.id); setAcctEmail(sp.email || ""); setAcctPass(""); setAcctError(""); setSettingPinFor(null); }}
                    className="text-xs font-bold text-brick hover:underline flex-none"
                    data-testid={`sp-acct-btn-${sp.id}`}>
                    {sp.has_account ? "Reset Password" : "Create Account"}
                  </button>

                  {sp.has_account && (
                    <button
                      onClick={() => sendResetEmail(sp.id)}
                      disabled={emailResetSent[sp.id] === "sending"}
                      data-testid={`sp-send-reset-email-${sp.id}`}
                      className={`text-xs font-bold flex-none ${
                        emailResetSent[sp.id] === "sent" ? "text-[#1F5F36]" :
                        emailResetSent[sp.id] === "error" ? "text-maroon" :
                        "text-brick hover:underline"
                      }`}
                    >
                      {emailResetSent[sp.id] === "sending" ? "Sending…" :
                       emailResetSent[sp.id] === "sent" ? "Email sent!" :
                       emailResetSent[sp.id] === "error" ? "Send failed" :
                       "Email Reset"}
                    </button>
                  )}

                  <button onClick={() => deleteSalesperson(sp.id)}
                    className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-maroon hover:text-maroon transition-colors flex-none"
                    data-testid={`sp-delete-${sp.id}`} title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* PIN form */}
                {settingPinFor === sp.id && (
                  <div className="mt-2 flex items-center gap-2" data-testid={`sp-pin-form-${sp.id}`}>
                    <input type="password" inputMode="numeric" maxLength={4} value={pinVal}
                      onChange={(e) => { setPinVal(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && savePin(sp.id)}
                      placeholder="4-digit PIN"
                      className="w-28 h-9 border border-line rounded-xl px-3 text-sm text-center tracking-widest font-bold outline-none focus:border-brick bg-cream"
                      autoFocus data-testid={`sp-pin-input-${sp.id}`} />
                    <button onClick={() => savePin(sp.id)} disabled={pinBusy}
                      className="h-9 px-3 rounded-xl bg-brick text-white font-bold text-xs disabled:opacity-60"
                      data-testid={`sp-pin-save-${sp.id}`}>Save</button>
                    <button onClick={() => { setSettingPinFor(null); setPinVal(""); }}
                      className="h-9 px-3 rounded-xl border border-line text-mocha text-xs">Cancel</button>
                    {pinError && <span className="text-xs text-maroon">{pinError}</span>}
                  </div>
                )}

                {/* Account form */}
                {accountFormFor === sp.id && (
                  <div className="mt-2 flex flex-col gap-2" data-testid={`sp-acct-form-${sp.id}`}>
                    {!sp.has_account && (
                      <input type="email" value={acctEmail}
                        onChange={(e) => { setAcctEmail(e.target.value); setAcctError(""); }}
                        placeholder="Email address"
                        className="h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                        autoFocus data-testid={`sp-acct-email-${sp.id}`} />
                    )}
                    <div className="flex items-center gap-2">
                      <input type="password" value={acctPass}
                        onChange={(e) => { setAcctPass(e.target.value); setAcctError(""); }}
                        placeholder={sp.has_account ? "New password (min 6 chars)" : "Password (min 6 chars)"}
                        className="flex-1 h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                        data-testid={`sp-acct-pass-${sp.id}`} />
                      <button
                        onClick={() => sp.has_account ? resetPassword(sp.id) : saveAccount(sp.id)}
                        disabled={acctBusy}
                        className="h-9 px-3 rounded-xl bg-brick text-white font-bold text-xs disabled:opacity-60 flex-none"
                        data-testid={`sp-acct-save-${sp.id}`}>
                        {sp.has_account ? "Reset" : "Create"}
                      </button>
                      <button onClick={() => { setAccountFormFor(null); setAcctPass(""); }}
                        className="h-9 px-3 rounded-xl border border-line text-mocha text-xs flex-none">Cancel</button>
                    </div>
                    {acctError && <span className="text-xs text-maroon" data-testid={`sp-acct-error-${sp.id}`}>{acctError}</span>}
                  </div>
                )}
              </div>
            ))}
            </div>
            {salespersons.length > 5 && (
              <button
                onClick={() => setShowAllSalespersons((v) => !v)}
                data-testid="salespersons-show-more"
                className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
              >
                {showAllSalespersons
                  ? <><ChevronUp size={13} /> Show less</>
                  : <><ChevronDown size={13} /> Show {salespersons.length - 5} more salespersons</>}
              </button>
            )}
          </>
        )}
      </div>
      {/* Settings */}
      <SettingsSection />
      {/* Change Admin Credentials */}
      <ChangeCredentialsSection />
      {/* Blocked IPs */}
      <LockedIPsPanel />
    </div>
  );
}

// ── Locked IPs Panel ─────────────────────────────────────────────────────────
function LockedIPsPanel() {
  const { data: locks = [], refetch, isLoading } = useQuery({
    queryKey: ["locked-ips"],
    queryFn: () => api.get("/admin/locked-ips").then(r => r.data),
    refetchInterval: 30000,
  });
  const [clearing, setClearing] = useState(null);

  const unlock = async (ip) => {
    setClearing(ip);
    try {
      await api.delete(`/admin/locked-ips/${encodeURIComponent(ip)}`);
      refetch();
    } catch (e) { console.error("Unlock IP failed:", e?.response?.data?.detail || e.message); }
    finally { setClearing(null); }
  };

  return (
    <div data-testid="locked-ips-panel" className="bg-cream border border-line rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-brick" />
          <h3 className="font-bold text-sm text-ink">Blocked IPs</h3>
        </div>
        <button onClick={refetch} className="text-xs text-mocha hover:text-brick">Refresh</button>
      </div>
      <p className="text-xs text-mocha -mt-2">IPs blocked after 5 failed login attempts. Block lasts 15 minutes and clears automatically.</p>

      {isLoading && <p className="text-xs text-mocha">Loading…</p>}

      {!isLoading && locks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-[#1F5F36]" data-testid="no-locked-ips">
          <ShieldCheck size={14} /> No IPs currently blocked — all clear.
        </div>
      )}

      {locks.map((lock) => (
        <div key={lock.ip} data-testid={`locked-ip-${lock.ip}`}
          className="flex items-center justify-between bg-[#FDE3DE] border border-[#F5B7B1] rounded-xl px-3.5 py-2.5 gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-bold text-sm text-maroon font-mono truncate">{lock.ip}</span>
            <span className="text-[11px] text-mocha">
              {lock.attempts} attempts{lock.email_hint ? ` · tried "${lock.email_hint}"` : ""} · unlocks in {lock.unlocks_in}
            </span>
          </div>
          <button
            onClick={() => unlock(lock.ip)}
            disabled={clearing === lock.ip}
            data-testid={`unlock-btn-${lock.ip}`}
            className="flex-none text-xs font-bold text-brick hover:text-maroon disabled:opacity-50 flex items-center gap-1"
          >
            <Trash size={13} /> {clearing === lock.ip ? "…" : "Unlock"}
          </button>
        </div>
      ))}
    </div>
  );
}


// ── Change Admin Credentials ──────────────────────────────────────────────────
function ChangeCredentialsSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [currentPwd, setCurrentPwd]   = useState("");
  const [newEmail, setNewEmail]       = useState("");
  const [newPwd, setNewPwd]           = useState("");
  const [confirmPwd, setConfirmPwd]   = useState("");
  const [showCur, setShowCur]         = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  const handleSave = async () => {
    setError(""); setSuccess("");
    if (!currentPwd) { setError("Current password is required"); return; }
    if (newPwd && newPwd !== confirmPwd) { setError("New passwords do not match"); return; }
    if (newPwd && newPwd.length < 6) { setError("New password must be at least 6 characters"); return; }
    if (!newEmail && !newPwd) { setError("Enter a new email or new password to update"); return; }
    setBusy(true);
    try {
      await api.patch("/admin/profile", {
        current_password: currentPwd,
        new_email: newEmail.trim(),
        new_password: newPwd,
      });
      setSuccess("Credentials updated! Logging you out now…");
      setTimeout(async () => {
        await logout();
        navigate("/login");
      }, 1800);
    } catch (e) {
      setError(e.response?.data?.detail || "Update failed. Check your current password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="change-credentials-section" className="bg-cream border border-line rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-brick" />
        <h3 className="font-bold text-sm text-ink">Change Admin Credentials</h3>
      </div>
      <p className="text-xs text-mocha -mt-2">
        Update the admin email or password. You will be logged out immediately after saving — log back in with your new credentials.
      </p>

      {error  && <div data-testid="cred-error"  className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      {success && <div data-testid="cred-success" className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</div>}

      {/* Current Password */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">Current Password <span className="text-brick">*</span></label>
        <div className="relative">
          <input
            type={showCur ? "text" : "password"}
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            placeholder="Enter your current password"
            data-testid="cred-current-password"
            className="w-full h-11 border border-line rounded-xl px-3.5 pr-10 text-sm outline-none focus:border-brick bg-white"
          />
          <button type="button" onClick={() => setShowCur(v => !v)}
            className="absolute right-3 top-3 text-mocha">
            {showCur ? <EyeOff size={16}/> : <Eye size={16}/>}
          </button>
        </div>
      </div>

      {/* New Email */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">New Email <span className="text-mocha/50">(leave blank to keep current)</span></label>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@yourdomain.com"
          data-testid="cred-new-email"
          className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-white"
        />
      </div>

      {/* New Password */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">New Password <span className="text-mocha/50">(leave blank to keep current)</span></label>
        <div className="relative">
          <input
            type={showNew ? "text" : "password"}
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="Min. 6 characters"
            data-testid="cred-new-password"
            className="w-full h-11 border border-line rounded-xl px-3.5 pr-10 text-sm outline-none focus:border-brick bg-white"
          />
          <button type="button" onClick={() => setShowNew(v => !v)}
            className="absolute right-3 top-3 text-mocha">
            {showNew ? <EyeOff size={16}/> : <Eye size={16}/>}
          </button>
        </div>
      </div>

      {/* Confirm New Password */}
      {newPwd && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-mocha">Confirm New Password</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="Repeat new password"
            data-testid="cred-confirm-password"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-white"
          />
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={busy}
        data-testid="cred-save-btn"
        className="h-11 rounded-xl bg-brick text-white font-bold text-sm hover:bg-maroon transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : "Update Credentials"}
      </button>
    </div>
  );
}


// ── Settings Section ──────────────────────────────────────────────────────────
function SettingsSection() {
  const queryClient = useQueryClient();
  const { data: saved, refetch } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.get("/admin/settings").then(r => r.data) });
  const { data: allCategories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api.get("/categories").then(r => r.data) });
  const [notifyEmail, setNotifyEmail]             = useState("");
  const [upiId, setUpiId]                         = useState("");
  const [upiName, setUpiName]                     = useState("");
  const [scannerMode, setScannerMode]             = useState(false);
  const [gstEnabled, setGstEnabled]               = useState(false);
  const [defaultCategory, setDefaultCategory]     = useState("");
  const [heroTitle, setHeroTitle]                 = useState("");
  const [heroSubtitle, setHeroSubtitle]           = useState("");
  const [heroImageUrl, setHeroImageUrl]           = useState("");
  const [busy, setBusy]                           = useState(false);
  const [saved2, setSaved2]                       = useState(false);
  const [error, setError]                         = useState("");

  // Populate fields once data loads
  useState(() => { if (saved) { setNotifyEmail(saved.admin_notify_email || ""); setUpiId(saved.upi_id || ""); setUpiName(saved.upi_name || ""); setScannerMode(saved.scanner_mode || false); setGstEnabled(saved.gst_enabled || false); setDefaultCategory(saved.default_category || ""); } }, [saved]);

  // Use useEffect to sync
  const prevSaved = useState(null);
  if (saved && notifyEmail === "" && upiId === "") {
    setNotifyEmail(saved.admin_notify_email || "");
    setUpiId(saved.upi_id || "");
    setUpiName(saved.upi_name || "");
    setScannerMode(saved.scanner_mode || false);
    setGstEnabled(saved.gst_enabled || false);
    setDefaultCategory(saved.default_category || "");
    setHeroTitle(saved.hero_title || "");
    setHeroSubtitle(saved.hero_subtitle || "");
    setHeroImageUrl(saved.hero_image_url || "");
  }

  const save = async () => {
    setError(""); setBusy(true); setSaved2(false);
    try {
      await api.patch("/admin/settings", {
        admin_notify_email: notifyEmail.trim(),
        upi_id: upiId.trim(),
        upi_name: upiName.trim(),
        scanner_mode: scannerMode,
        gst_enabled: gstEnabled,
        default_category: defaultCategory,
        hero_title: heroTitle.trim(),
        hero_subtitle: heroSubtitle.trim(),
        hero_image_url: heroImageUrl.trim(),
      });
      // Invalidate all components using admin-settings (including AdminPOS)
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      // Also invalidate the public shop-info used by Receipt/Checkout QR codes
      await queryClient.invalidateQueries({ queryKey: ["shop-info"] });
      refetch();
      setSaved2(true);
      setTimeout(() => setSaved2(false), 3000);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-line rounded-2xl mt-5" data-testid="settings-section">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-line">
        <span className="font-bold text-sm">Shop Settings</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-4">

        {/* Notification email */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">Admin notification email</label>
          <p className="text-xs text-mocha">An alert email is sent to this address for every new customer order.</p>
          <input
            type="email"
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="your@email.com"
            data-testid="settings-notify-email"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* UPI ID */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">UPI ID</label>
          <p className="text-xs text-mocha">Used on QR codes shown on checkout and receipts.</p>
          <input
            type="text"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="yourname@upi"
            data-testid="settings-upi-id"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* UPI payee name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">UPI payee name</label>
          <p className="text-xs text-mocha">Name shown on customer's UPI app when they scan the QR.</p>
          <input
            type="text"
            value={upiName}
            onChange={(e) => setUpiName(e.target.value)}
            placeholder="Shop name"
            data-testid="settings-upi-name"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* Scanner Mode toggle */}
        <div className="flex items-center justify-between py-1 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-bold text-[#5A3A30]">Scanner Mode (POS)</label>
            <p className="text-xs text-mocha">When ON, the POS screen shows a dedicated barcode scanner input bar at the top.</p>
          </div>
          <button
            type="button"
            onClick={() => setScannerMode((v) => !v)}
            data-testid="settings-scanner-mode-toggle"
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none ml-4 ${scannerMode ? "bg-brick" : "bg-chip"}`}
            aria-checked={scannerMode}
            role="switch"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${scannerMode ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* GST toggle */}
        <div className="flex items-center justify-between py-1 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-bold text-[#5A3A30]">GST on Bills (CGST 9% + SGST 9%)</label>
            <p className="text-xs text-mocha">When ON, 18% GST is added to every bill total and printed on the invoice.</p>
          </div>
          <button
            type="button"
            onClick={() => setGstEnabled((v) => !v)}
            data-testid="settings-gst-toggle"
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none ml-4 ${gstEnabled ? "bg-brick" : "bg-chip"}`}
            aria-checked={gstEnabled}
            role="switch"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${gstEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* Default Category */}
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <label className="text-xs font-bold text-[#5A3A30]">Default Category (Shop & POS)</label>
          <p className="text-xs text-mocha">The category selected by default when customers open the shop or staff open the POS.</p>
          <select
            value={defaultCategory}
            onChange={(e) => setDefaultCategory(e.target.value)}
            data-testid="settings-default-category"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          >
            <option value="">All (show everything)</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* ── Hero Banner ── */}
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div>
            <label className="text-xs font-bold text-[#5A3A30]">Shop Hero Banner</label>
            <p className="text-xs text-mocha mt-0.5">Shown above the search bar on the shop page. Leave all fields blank to hide the banner.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Headline</label>
            <input
              type="text"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="e.g. Biggest Sale of the Season"
              data-testid="settings-hero-title"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Subheading</label>
            <input
              type="text"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="e.g. Shop the best fireworks at unbeatable prices"
              data-testid="settings-hero-subtitle"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Background Image URL</label>
            <input
              type="url"
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
              data-testid="settings-hero-image-url"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          {/* Live preview */}
          {(heroTitle || heroImageUrl) && (
            <div
              data-testid="settings-hero-preview"
              className="rounded-xl overflow-hidden relative h-24 flex items-end"
              style={{
                background: heroImageUrl
                  ? `linear-gradient(to top, rgba(43,23,18,0.85) 0%, rgba(43,23,18,0.3) 60%, transparent 100%), url('${heroImageUrl}') center/cover no-repeat`
                  : "linear-gradient(135deg, #7A1410 0%, #2B1712 100%)",
              }}
            >
              <div className="px-4 pb-3">
                {heroTitle && <p className="text-white font-bold text-sm leading-tight">{heroTitle}</p>}
                {heroSubtitle && <p className="text-white/60 text-xs mt-0.5">{heroSubtitle}</p>}
              </div>
            </div>
          )}
        </div>

        {error && <div className="text-sm text-maroon bg-[#FDE3DE] rounded-xl px-3 py-2">{error}</div>}

        <button
          onClick={save}
          disabled={busy}
          data-testid="settings-save-btn"
          className="h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-60 self-start px-6"
        >
          {busy ? "Saving…" : saved2 ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
