/**
 * Re-exports the shared API helpers used by the insights modules.
 *
 * This gives the insights folder one local place to import from without
 * repeating request logic.
 */
export { buildAuthHeaders, createGetJSON } from "../services/apiClient.js";
