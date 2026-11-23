import airfieldCodesJson from './airfield_codes.json';
import baggageJson from './baggage.json';
import businessJson from './business.json';
import marketJson from './market.json';
import gseJson from './gse.json';
import groundJson from './ground.json';
import paintJson from './paint.json';
import peopleJson from './people.json';
import needsJson from './needs.json';
import arrivalsJson from './arrivals.json';
import departuresJson from './departures.json';
import profilesJson from './profiles.json';
import spritesJson from './sprites.json';
import staffJson from './staff.json';
import standSizesJson from './stand_sizes.json';
import standAccessJson from './stand_access.json';
import surfacesJson from './surfaces.json';
import turnaroundsJson from './turnarounds.json';
import tenantsJson from './tenants.json';
import fixtureCatalogJson from './fixtures/catalog.json';
import {
  airfieldCodesSchema,
  baggageSchema,
  businessSchema,
  marketSchema,
  gseSchema,
  groundSchema,
  paintSchema,
  peopleSchema,
  needsSchema,
  arrivalsSchema,
  departuresSchema,
  profilesSchema,
  spritesSchema,
  staffSchema,
  standAccessSchema,
  standSizesSchema,
  surfacesSchema,
  turnaroundsSchema,
  tenantsSchema,
  type TenantsData,
  fixtureCatalogSchema,
  type FixtureCatalog,
  type AirfieldCodes,
  type ArrivalsData,
  type DeparturesData,
  type BaggageData,
  type BusinessData,
  type MarketData,
  type NeedsData,
  type GseData,
  type GroundData,
  type PaintData,
  type PeopleData,
  type ProfilesData,
  type SpritesData,
  type StaffData,
  type StandAccessData,
  type StandSizesData,
  type SurfacesData,
  type TurnaroundsData,
} from './schemas';

/** Validated once at load, then trusted (docs/PERFORMANCE.md section 7). */
export const AIRFIELD: AirfieldCodes = airfieldCodesSchema.parse(airfieldCodesJson);
export const BUSINESS: BusinessData = businessSchema.parse(businessJson);
/** Automatic baggage network values, docs/BAGGAGE.md section 11. */
export const BAGGAGE: BaggageData = baggageSchema.parse(baggageJson);
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
/** Passenger needs, wants, group factors and satisfaction terms (T67). */
export const NEEDS: NeedsData = needsSchema.parse(needsJson);
/** Arrival journey: deboarding, claim, outcomes and arrival service nodes (T20). */
export const ARRIVALS: ArrivalsData = arrivalsSchema.parse(arrivalsJson);
/** International departures: passport control in departure mode (T79). */
export const DEPARTURES: DeparturesData = departuresSchema.parse(departuresJson);
/** Staff roles, stations, shifts and breaks (T68). */
export const STAFF: StaffData = staffSchema.parse(staffJson);
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

/** Tenant units, brands, applications and furnishing (T32). */
export const TENANTS: TenantsData = tenantsSchema.parse(tenantsJson);

/** Service roads, apron lanes, the ground handling depot and vehicle trains. */
export const GROUND: GroundData = groundSchema.parse(groundJson);

/** The terminal asset kit catalog: every fixture and prop with its size, mount, zones and stats (T73, T76). */
export const FIXTURE_CATALOG: FixtureCatalog = fixtureCatalogSchema.parse(fixtureCatalogJson);

export type GseSpec = GseData['vehicles'][number];

/** Ground vehicle catalog at real size. The index in this list is the vehicle kind in snapshots. */
export const GSE: readonly GseSpec[] = gseSchema.parse(gseJson).vehicles;
export const GSE_INDEX: Record<string, number> = Object.fromEntries(GSE.map((v, i) => [v.id, i]));
