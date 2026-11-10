import airfieldCodesJson from './airfield_codes.json';
import businessJson from './business.json';
import gseJson from './gse.json';
import paintJson from './paint.json';
import spritesJson from './sprites.json';
import standSizesJson from './stand_sizes.json';
import surfacesJson from './surfaces.json';
import {
  airfieldCodesSchema,
  businessSchema,
  paintSchema,
  spritesSchema,
  standSizesSchema,
  surfacesSchema,
  type AirfieldCodes,
  type BusinessData,
  type PaintData,
  type SpritesData,
  type StandSizesData,
  type SurfacesData,
} from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);
export const SURFACE_DATA: SurfacesData = surfacesSchema.parse(surfacesJson);
/** Per surface rules, costs and look, keyed by surface name. */
export const SURFACE_SPEC: SurfacesData['surfaces'] = SURFACE_DATA.surfaces;
/** Marking palette and dimensions. */
export const PAINT: PaintData = paintSchema.parse(paintJson);
/** Aircraft sprite tiers, cache limit and liveries. */
export const SPRITES: SpritesData = spritesSchema.parse(spritesJson);
const STAND_DATA: StandSizesData = standSizesSchema.parse(standSizesJson);
export const STAND_SIZES: StandSizesData['sizes'] = STAND_DATA.sizes;
/** Stand marking dimensions. */
export const STAND_MARKINGS: StandSizesData['markings'] = STAND_DATA.markings;

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
