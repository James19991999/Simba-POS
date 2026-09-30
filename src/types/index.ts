// Core domain types for SimbaPOS — multi-tenant restaurant management platform.

export type Role =
  | "owner"
  | "manager"
  | "floor_captain"
  | "waiter"
  | "kitchen"
  | "rider"
  | "accountant";

export const ALL_ROLES: Role[] = [
  "owner",
  "manager",
  "floor_captain",
  "waiter",
  "kitchen",
  "rider",
  "accountant",
];

export interface Membership {
  id: string; // membership row id (was the synthetic `${uid}_${orgId}` under Firestore)
  orgId: string;
  userId: string; // Supabase auth user id (was `uid` under Firebase)
  role: Role;
  displayName: string;
  email: string;
  phone?: string; // M-Pesa number, "2547XXXXXXXX" — required for real tip-pool B2C payout
  active: boolean;
  createdAt: number;
}

// Flat — matches the `organizations` table columns 1:1 via case.ts's
// snake<->camel conversion. Postgres has no nested-object columns the way
// Firestore did (taxConfig.vatRate, kra.pin, plan.tier, ...), so those
// groupings from the Firebase version are flattened here.
export interface Organization {
  id: string;
  name: string; // e.g. "Boma Bistro - Westlands"
  ownerUid: string;
  createdAt: number;
  vatRate: number; // 0.16
  tourismLevyRate: number; // 0.02
  roundingKes: number; // 1
  kraPin: string;
  kraVscuDeviceId: string;
  kraConnected: boolean;
  intasendPublishableKey?: string;
  intasendTillOrPaybill?: string;
  planTier: "starter" | "growth" | "enterprise";
  planStatus: "trialing" | "active" | "past_due" | "canceled";
  planCurrentPeriodEndAt?: number;
  localeDefault: "en" | "sw";
}

export interface Station {
  id: string;
  orgId: string;
  name: string; // "Nairobi Station #04"
  address: string;
  zones: string[]; // ["Indoor Dining", "Verandah / Terrace", "Nyama Choma Garden"]
  createdAt: number;
}

export type TableStatus =
  | "available"
  | "seated"
  | "ordered"
  | "bill_requested"
  | "settled"
  | "cleaning"
  | "reserved";

export interface RestaurantTable {
  id: string;
  orgId: string;
  stationId: string;
  code: string; // "T04"
  zone: string;
  seats: number;
  status: TableStatus;
  waiterUid?: string;
  waiterName?: string;
  seatedAt?: number;
  pax?: number;
  activeOrderId?: string;
}

export interface WaitlistEntry {
  id: string;
  orgId: string;
  stationId: string;
  name: string;
  phone: string;
  pax: number;
  preference?: string;
  createdAt: number;
  notifiedAt?: number;
  seated: boolean;
}

export interface MenuItem {
  id: string;
  orgId: string;
  stationId: string;
  category: string;
  nameEn: string;
  nameSw?: string;
  descriptionEn?: string;
  descriptionSw?: string;
  priceKes: number;
  stockQty?: number; // undefined = unlimited
  isSpecial?: boolean;
  active: boolean;
  modifiers?: { id: string; label: string; priceDeltaKes?: number }[];
}

export type OrderChannel = "dine_in" | "takeaway" | "glovo" | "uber_eats" | "jumia" | "simba_riders";

export type OrderStatus =
  | "incoming"
  | "cooking"
  | "ready"
  | "en_route"
  | "delivered"
  | "served"
  | "cancelled";

export interface OrderLineItem {
  id: string;
  menuItemId: string;
  nameEn: string;
  qty: number;
  unitPriceKes: number;
  modifiers?: string[];
  notes?: string;
}

export interface Order {
  id: string;
  orgId: string;
  stationId: string;
  tableId?: string;
  channel: OrderChannel;
  status: OrderStatus;
  items: OrderLineItem[];
  subtotalKes: number;
  vatKes: number;
  tourismLevyKes: number;
  totalKes: number;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  externalRef?: string; // aggregator order id
  riderUid?: string;
  handoverPin?: string;
}

export type PaymentChannel = "mpesa_stk" | "card" | "cash";
export type PaymentStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface Payment {
  id: string; // apiRef / invoice_id from IntaSend, or generated for cash
  orgId: string;
  stationId: string;
  orderId: string;
  tableId?: string;
  channel: PaymentChannel;
  status: PaymentStatus;
  amountKes: number;
  phone?: string;
  intasendInvoiceId?: string;
  intasendState?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
}

export interface InventoryItem {
  id: string;
  orgId: string;
  stationId: string;
  category: "Butchery & Meats" | "Fresh Produce" | "Bar & Beverages" | "Dry Store" | "LPG & Fuel";
  name: string;
  supplier: string;
  supplierEtimsPin?: string;
  unit: string; // "kg", "pc", "bundle", "btl"
  unitPriceKes: number;
  qtyOnHand: number;
  reorderPoint: number;
  updatedAt: number;
}

export interface PurchaseOrder {
  id: string;
  orgId: string;
  stationId: string;
  inventoryItemId: string;
  qty: number;
  status: "pending" | "in_transit" | "received" | "cancelled";
  createdAt: number;
  createdByUid: string;
}

export interface Shift {
  id: string;
  orgId: string;
  stationId: string;
  label: string; // "Shift B - Afternoon/Evening"
  startAt: number;
  endAt?: number;
  managerUid: string;
  closed: boolean;
}

export interface ShiftCheckIn {
  id: string;
  orgId: string;
  shiftId: string;
  userId: string;
  displayName: string;
  station: "floor" | "grill" | "bar" | "riders";
  checkedInAt: number;
  checkedOutAt?: number;
}

export interface TipPoolEntry {
  id: string;
  orgId: string;
  shiftId: string;
  totalKes: number;
  crewCount: number;
  perHeadKes: number;
  disbursed: boolean;
  disbursedAt?: number;
  intasendTrackingId?: string;
  disbursementResults?: { uid: string; displayName: string; account: string; status: string }[];
  disbursementError?: string; // set when some/all crew have no phone on file, or the B2C call failed
}

export interface LeaveRequest {
  id: string;
  orgId: string;
  userId: string;
  displayName: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface LoyaltyMember {
  id: string;
  orgId: string;
  phone: string;
  name: string;
  points: number;
  tier: "silver" | "gold" | "elite";
  lastVisitAt?: number;
  createdAt: number;
}

export interface LoyaltyLedgerEntry {
  id: string;
  orgId: string;
  memberId: string;
  type: "earn" | "redeem";
  points: number;
  orderId?: string;
  createdAt: number;
}

export interface SmsCampaign {
  id: string;
  orgId: string;
  title: string;
  message: string;
  scheduledAt?: number;
  sentAt?: number;
  audienceCount: number;
  status: "draft" | "scheduled" | "sent";
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface EtimsInvoice {
  id: string;
  orgId: string;
  stationId: string;
  orderId: string;
  controlNumber: string;
  grossKes: number;
  vatKes: number;
  tourismLevyKes: number;
  status: "synced" | "pending" | "error";
  simulated: boolean; // true until a real KRA VSCU credential is wired in
  createdAt: number;
}
