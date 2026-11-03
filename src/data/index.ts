import airfieldCodesJson from './airfield_codes.json';
import { airfieldCodesSchema, type AirfieldCodes } from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
