/**
 * Re-exports the shared HTTP helpers used by the insights feature modules.
 *
 * Keeping this as a thin wrapper lets the insights folder import API helpers
 * from one local place without duplicating request logic.
 */
export { buildAuthHeaders, createGetJSON } from "../services/apiClient.js";
