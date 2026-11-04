import airfieldCodesJson from './airfield_codes.json';
import businessJson from './business.json';
import gseJson from './gse.json';
import { airfieldCodesSchema, businessSchema, type AirfieldCodes, type BusinessData } from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);

export interface GseSpec {
  id: string;
  name: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  docks: boolean;
  articulated: boolean;
  towedBy: string | null;
}

/** Ground vehicle catalog at real size. The index in this list is the vehicle kind in snapshots. */
export const GSE: readonly GseSpec[] = (gseJson as { vehicles: GseSpec[] }).vehicles;
export const GSE_INDEX: Record<string, number> = Object.fromEntries(GSE.map((v, i) => [v.id, i]));
