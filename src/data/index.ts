import airfieldCodesJson from './airfield_codes.json';
import businessJson from './business.json';
import gseJson from './gse.json';
import standSizesJson from './stand_sizes.json';
import surfacesJson from './surfaces.json';
import {
  airfieldCodesSchema,
  businessSchema,
  standSizesSchema,
  surfacesSchema,
  type AirfieldCodes,
  type BusinessData,
  type StandSizesData,
  type SurfacesData,
} from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);
export const SURFACE_DATA: SurfacesData = surfacesSchema.parse(surfacesJson);
/** Per surface rules, costs and look, keyed by surface name. */
export const SURFACE_SPEC: SurfacesData['surfaces'] = SURFACE_DATA.surfaces;
export const STAND_SIZES: StandSizesData['sizes'] = standSizesSchema.parse(standSizesJson).sizes;

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
