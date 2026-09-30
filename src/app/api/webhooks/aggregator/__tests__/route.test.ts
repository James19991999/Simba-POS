/**
 * @jest-environment node
 */
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

// Fake Supabase query-builder chain covering the two paths the route uses:
//   .from("orders").select("*").eq(...).eq(...).limit(...)  -> resolves { data, error }
//   .from("orders").update(...).eq(...)                     -> resolves { data, error }
//   .from("orders").insert(...).select().single()            -> resolves { data, error }
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockLimit = jest.fn();

const mockSelectSingle = jest.fn();
const mockInsertSelect = jest.fn(() => ({ single: mockSelectSingle }));

const mockEqUpdate = jest.fn();

function makeFrom() {
  const selectEqChain: { eq: (...args: unknown[]) => typeof selectEqChain; limit: typeof mockLimit } = {
    eq: jest.fn(() => selectEqChain),
    limit: mockLimit,
  };
  return {
    select: jest.fn(() => selectEqChain),
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return { eq: mockEqUpdate };
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return { select: mockInsertSelect };
    },
  };
}

const mockFrom = jest.fn(() => makeFrom());

jest.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: mockFrom }),
}));

// Import the route AFTER the mock is registered.
import { POST } from "../[channel]/route";

const SECRET = "glovo-secret";
const OLD_ENV = process.env;

function sign(body: string) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeRequest(bodyObj: unknown, signature?: string) {
  const body = JSON.stringify(bodyObj);
  return new NextRequest("http://localhost/api/webhooks/aggregator/glovo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-webhook-signature": signature } : {}),
    },
    body,
  });
}

const validPayload = {
  orgId: "org1",
  stationId: "st1",
  externalOrderId: "GLV-1049",
  items: [{ name: "Matoke Stew", quantity: 2, unitPriceKes: 725 }],
  totalKes: 1450,
};

beforeEach(() => {
  process.env = { ...OLD_ENV, AGGREGATOR_WEBHOOK_SECRET_GLOVO: SECRET };
  jest.clearAllMocks();
  mockLimit.mockResolvedValue({ data: [], error: null });
  mockEqUpdate.mockResolvedValue({ data: null, error: null });
  mockSelectSingle.mockResolvedValue({
    data: {
      id: "new-order-id",
      org_id: "org1",
      station_id: "st1",
      channel: "glovo",
      status: "incoming",
      items: [],
      subtotal_kes: 1450,
      vat_kes: 0,
      tourism_levy_kes: 0,
      total_kes: 1450,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by_uid: "system:aggregator-webhook",
      external_ref: "GLV-1049",
    },
    error: null,
  });
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe("aggregator webhook receiver", () => {
  it("rejects a request with no signature header", async () => {
    const req = makeRequest(validPayload);
    const res = await POST(req, { params: { channel: "glovo" } });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong signature", async () => {
    const req = makeRequest(validPayload, "deadbeef");
    const res = await POST(req, { params: { channel: "glovo" } });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown channel", async () => {
    const body = JSON.stringify(validPayload);
    const req = makeRequest(validPayload, sign(body));
    const res = await POST(req, { params: { channel: "some-random-app" } });
    expect(res.status).toBe(404);
  });

  it("creates a new order on first delivery with a valid signature", async () => {
    const body = JSON.stringify(validPayload);
    const req = makeRequest(validPayload, sign(body));
    const res = await POST(req, { params: { channel: "glovo" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(false);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("updates the existing order instead of duplicating on a redelivered webhook (idempotency)", async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ id: "existing-1" }], error: null });
    const body = JSON.stringify(validPayload);
    const req = makeRequest(validPayload, sign(body));
    const res = await POST(req, { params: { channel: "glovo" } });
    const json = await res.json();
    expect(json.updated).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a payload missing required fields", async () => {
    const bad = { orgId: "org1" };
    const body = JSON.stringify(bad);
    const req = makeRequest(bad, sign(body));
    const res = await POST(req, { params: { channel: "glovo" } });
    expect(res.status).toBe(400);
  });
});
