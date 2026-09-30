import type { EtimsInvoice } from "@/types";

/**
 * KRA eTIMS / VSCU adapter interface. Real transmission requires a
 * KRA-issued device certificate and either live VSCU/OSCU hardware or a KRA
 * sandbox account — neither exists in this build environment. This adapter
 * is deliberately simulated and clearly labeled as such (`simulated: true`
 * on every generated invoice) so the UI's "100% Synced" state is never
 * mistaken for a verified round-trip against a real KRA server.
 *
 * To go live: implement `transmitInvoice` against the real KRA VSCU SDK/API
 * using the org's registered PIN and VSCU device id (organizations/{id}.kra),
 * and flip `simulated` to false only once that real credential exists.
 */
export interface EtimsTransmitInput {
  orgId: string;
  stationId: string;
  orderId: string;
  grossKes: number;
  vatKes: number;
  tourismLevyKes: number;
}

export function simulateEtimsTransmit(input: EtimsTransmitInput): Omit<EtimsInvoice, "id"> {
  const controlNumber = `KRA${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
    1000 + Math.random() * 9000
  )}`;
  return {
    orgId: input.orgId,
    stationId: input.stationId,
    orderId: input.orderId,
    controlNumber,
    grossKes: input.grossKes,
    vatKes: input.vatKes,
    tourismLevyKes: input.tourismLevyKes,
    status: "synced",
    simulated: true,
    createdAt: Date.now(),
  };
}
