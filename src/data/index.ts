import airfieldCodesJson from './airfield_codes.json';
import businessJson from './business.json';
import marketJson from './market.json';
import gseJson from './gse.json';
import groundJson from './ground.json';
import paintJson from './paint.json';
import peopleJson from './people.json';
import profilesJson from './profiles.json';
import spritesJson from './sprites.json';
import standSizesJson from './stand_sizes.json';
import standAccessJson from './stand_access.json';
import surfacesJson from './surfaces.json';
import turnaroundsJson from './turnarounds.json';
import {
  airfieldCodesSchema,
  businessSchema,
  marketSchema,
  gseSchema,
  groundSchema,
  paintSchema,
  peopleSchema,
  profilesSchema,
  spritesSchema,
  standAccessSchema,
  standSizesSchema,
  surfacesSchema,
  turnaroundsSchema,
  type AirfieldCodes,
  type BusinessData,
  type MarketData,
  type GseData,
  type GroundData,
  type PaintData,
  type PeopleData,
  type ProfilesData,
  type SpritesData,
  type StandAccessData,
  type StandSizesData,
  type SurfacesData,
  type TurnaroundsData,
} from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);
/** Destinations, flight series, airline satisfaction and growth. */
export const MARKET: MarketData = marketSchema.parse(marketJson);
export const SURFACE_DATA: SurfacesData = surfacesSchema.parse(surfacesJson);
/** Per surface rules, costs and look, keyed by surface name. */
export const SURFACE_SPEC: SurfacesData['surfaces'] = SURFACE_DATA.surfaces;
/** Marking palette and dimensions. */
export const PAINT: PaintData = paintSchema.parse(paintJson);
/** Passenger figure recipes, weighted per profile, and people bake tiers. */
export const PEOPLE: PeopleData = peopleSchema.parse(peopleJson);
/** Passenger profiles, shared sizing and boarding rules. */
export const PROFILES: ProfilesData = profilesSchema.parse(profilesJson);
/** Aircraft sprite tiers, cache limit and liveries. */
export const SPRITES: SpritesData = spritesSchema.parse(spritesJson);
const STAND_DATA: StandSizesData = standSizesSchema.parse(standSizesJson);
export const STAND_SIZES: StandSizesData['sizes'] = STAND_DATA.sizes;
/** Single stand placement: lead in reach and rotation steps. */
export const STAND_PLACEMENT: StandSizesData['placement'] = STAND_DATA.placement;
/** Stand marking dimensions. */
export const STAND_MARKINGS: StandSizesData['markings'] = STAND_DATA.markings;

/** Stand upgrade costs and days, and the far stand boarding rule (T66). */
export const STAND_ACCESS: StandAccessData = standAccessSchema.parse(standAccessJson);

/** Turnaround task list of airline flights (T63). */
export const TURNAROUNDS: TurnaroundsData = turnaroundsSchema.parse(turnaroundsJson);

/** Service roads, apron lanes, the ground handling depot and vehicle trains. */
export const GROUND: GroundData = groundSchema.parse(groundJson);

export type GseSpec = GseData['vehicles'][number];

/** Ground vehicle catalog at real size. The index in this list is the vehicle kind in snapshots. */
export const GSE: readonly GseSpec[] = gseSchema.parse(gseJson).vehicles;
export const GSE_INDEX: Record<string, number> = Object.fromEntries(GSE.map((v, i) => [v.id, i]));
