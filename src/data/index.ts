import airfieldCodesJson from './airfield_codes.json';
import businessJson from './business.json';
import { airfieldCodesSchema, businessSchema, type AirfieldCodes, type BusinessData } from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);
