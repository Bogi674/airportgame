import { z } from 'zod';

const CODE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const codeLetter = z.enum(CODE_LETTERS);
const surfaceName = z.enum(['grass', 'dirt', 'gravel', 'asphalt', 'concrete']);
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/);

const codeRow = z.strictObject({
  spanM: z.number().positive(),
  standLengthM: z.number().positive(),
  runwayWidthM: z.number().positive(),
  runwayShoulderM: z.number().nonnegative(),
  taxiwayWidthM: z.number().positive(),
  turnRadiusM: z.number().positive(),
  taxiwayShoulderM: z.number().nonnegative(),
  taxiSepM: z.number().positive(),
  taxiObjectM: z.number().positive(),
});

const perCode = z.strictObject({ A: z.number(), B: z.number(), C: z.number(), D: z.number(), E: z.number(), F: z.number() });
const perApproach = z.strictObject({ visual: z.number(), nonPrecision: z.number(), precision: z.number() });

const obstacleSurface = z.strictObject({
  innerEdgeM: z.number().positive(),
  startM: z.number().nonnegative(),
  divergence: z.number().nonnegative(),
  slope: z.number().positive(),
  lengthM: z.number().positive(),
  transitionalSlope: z.number().positive(),
});

export const airfieldCodesSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string(),
    codes: z.strictObject({ A: codeRow, B: codeRow, C: codeRow, D: codeRow, E: codeRow, F: codeRow }),
    runwayToTaxiwaySepM: z.strictObject({ visual: perCode, nonPrecision: perCode, precision: perCode }),
    holdingDistanceM: perApproach,
    stripWidthM: perApproach,
    gradingCostPerM3: z.number().nonnegative(),
    /** Runway end turn pads (docs/GAME_DESIGN.md section 6, prefab pieces). */
    turnPad: z.strictObject({
      note: z.string(),
      widthM: perCode,
      lengthM: perCode,
      taperM: perCode,
      backtrackSpeedMs: z.number().positive(),
      turnSeconds: z.number().positive(),
    }),
    /** Runway works durations (docs/GAME_DESIGN.md section 6, runway tool). */
    runwayWorks: z.strictObject({ note: z.string(), areaFactor: z.number().positive(), approachDays: perApproach }),
    /** Taxiway tool snapping (docs/DESIGN_REVISION_2.md section 2.2). */
    taxiwayTool: z.strictObject({ snapRadiusM: z.number().positive(), minNodeGapM: z.number().positive(), angleStepDeg: z.number().positive(), angleTolDeg: z.number().positive() }),
    /** Construction grid along a runway or taxiway (task T42). */
    constructionGrid: z.strictObject({ note: z.string(), spacingMinorM: z.number().positive(), spacingMajorM: z.number().positive() }),
    /** Approach and transitional surfaces (docs/GAME_DESIGN.md section 6, clearances). */
    obstacleSurfaces: z.strictObject({
      note: z.string(),
      approach: z.strictObject({ visual: obstacleSurface, nonPrecision: obstacleSurface, precision: obstacleSurface }),
      transitionalTopM: z.number().positive(),
      toleranceM: z.number().nonnegative(),
      coverHeightM: z.strictObject({ forest: z.number().nonnegative(), village: z.number().nonnegative(), industrial: z.number().nonnegative(), road: z.number().nonnegative() }),
      terminalHeightM: z.number().positive(),
      maxReported: z.number().int().positive(),
    }),
  })
  .superRefine((d, ctx) => {
    for (const c of CODE_LETTERS) {
      const r = d.codes[c];
      if (r.turnRadiusM <= r.taxiwayWidthM / 2) ctx.addIssue({ code: 'custom', path: ['codes', c, 'turnRadiusM'], message: 'turn radius must exceed half the taxiway width' });
    }
    if (d.constructionGrid.spacingMajorM % d.constructionGrid.spacingMinorM !== 0) {
      ctx.addIssue({ code: 'custom', path: ['constructionGrid', 'spacingMajorM'], message: 'major grid spacing must be a whole multiple of the minor one' });
    }
  });

export type AirfieldCodes = z.infer<typeof airfieldCodesSchema>;

const surfaceRow = z
  .strictObject({
    allowedCodes: z.array(codeLetter).min(1),
    paint: z.enum(['full', 'markers']),
    color: hexColor,
    shoulderColor: hexColor.nullable(),
    slabJointM: z.number().positive().nullable(),
    costPerM2: z.number().positive(),
    pcrTiers: z.array(z.number().positive()).min(1),
    upkeepPct: z.number().nonnegative(),
    worksDaysPerKm2: z.number().positive(),
    refundShare: z.number().min(0).max(1),
    unpavedMarkerSpacingM: z.number().positive().nullable(),
  })
  .refine((s) => (s.paint === 'markers') === (s.unpavedMarkerSpacingM !== null), { message: 'marker spacing is set exactly for unpainted surfaces' })
  .refine((s) => (s.paint === 'full') === (s.shoulderColor !== null), { message: 'shoulder color is set exactly for painted surfaces' });

export const surfacesSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  tierCostFactor: z.array(z.number().positive()).min(1),
  minWorksDays: z.number().positive(),
  surfaces: z.strictObject({ grass: surfaceRow, dirt: surfaceRow, gravel: surfaceRow, asphalt: surfaceRow, concrete: surfaceRow }),
});

export type SurfacesData = z.infer<typeof surfacesSchema>;

const standSize = z
  .strictObject({
    codes: z.array(codeLetter).min(1),
    maxSpanM: z.number().positive(),
    surfaces: z.array(surfaceName).min(1),
    widthM: z.number().positive(),
    depthM: z.number().positive(),
    forkRadiusM: z.number().positive(),
    wingtipClearanceM: z.number().positive(),
    noseClearanceM: z.number().positive().nullable(),
    mergeable: z.boolean(),
    /** Build cost of one stand of this size. */
    cost: z.strictObject({ contact: z.number().nonnegative(), remote: z.number().nonnegative() }),
    /** Spacing of the stop bars of the type groups, jet bridges on a contact stand, hydrant fuel pits. */
    stopBarGapM: z.number().positive(),
    jetBridges: z.number().int().nonnegative(),
    hydrants: z.boolean(),
  })
  .refine((s) => s.widthM >= s.maxSpanM + 2 * s.wingtipClearanceM - 1, { message: 'stand width must hold the largest span plus both wingtip clearances' });

export const standSizesSchema = z
  .strictObject({
    version: z.literal(1),
    note: z.string(),
    sizes: z.strictObject({ small: standSize, medium: standSize, large: standSize, xl: standSize }),
    markings: z.strictObject({
      note: z.string(),
      funnelSideM: z.number().positive(),
      funnelNoseInsetM: z.number().positive(),
      funnelStartM: z.number().positive(),
      funnelStepM: z.number().positive(),
      funnelClearM: z.number().positive(),
      boundaryExtendM: z.number().positive(),
      cornerInsetM: z.number().positive(),
      serviceRoadM: z.number().positive(),
      roadEdgeInsetM: z.number().positive(),
      roadArrowAt: z.number().positive(),
      cabLengthM: z.number().positive(),
      cabWidthM: z.number().positive(),
      tunnelWidthM: z.number().positive(),
      linkWidthM: z.number().positive(),
      rotundaRadiusM: z.number().positive(),
      rotundaOffsetM: z.number().positive(),
      rotundaStepM: z.tuple([z.number(), z.number()]),
      pitSizeM: z.number().positive(),
      tieRingDiameterM: z.number().positive(),
      coneSpacingM: z.number().positive(),
      numberAt: z.number().positive(),
      maxStopBars: z.number().int().positive(),
      stopBarWidthM: z.number().positive(),
      stopBarMinPx: z.number().positive(),
      boundaryWidthM: z.number().positive(),
      boundaryMinPx: z.number().positive(),
      hatchSpacingM: z.number().positive(),
    }),
  })
  .refine((d) => d.sizes.small.maxSpanM < d.sizes.medium.maxSpanM && d.sizes.medium.maxSpanM < d.sizes.large.maxSpanM && d.sizes.large.maxSpanM < d.sizes.xl.maxSpanM, {
    message: 'sizes must be ordered by span',
  });

export type StandSizesData = z.infer<typeof standSizesSchema>;
export type StandSize = keyof StandSizesData['sizes'];

const positive = z.number().positive();
const nonnegative = z.number().nonnegative();

/** Tower art levels in meters. Every level sits inside the 15 m paint window, so no ring can reach past it. */
const towerLevelSchema = z.strictObject({
  heightM: positive,
  baseM: positive,
  shaftM: positive,
  cabM: positive,
  cabSides: z.number().int().positive(),
  glassSweepDeg: positive,
  glassBandM: positive,
  walkwayM: nonnegative,
  antennas: z.number().int().nonnegative(),
  radomeM: nonnegative,
});

const towerLevelsSchema = z
  .array(towerLevelSchema)
  .length(5)
  .refine((levels) => levels.every((l) => l.baseM <= 15 && l.cabM <= 15 && l.walkwayM <= 15), {
    message: 'tower base, cab and walkway must fit 15 m',
  })
  .refine((levels) => levels.every((l, i) => i === 0 || levels[i - 1].heightM < l.heightM), {
    message: 'tower heights must strictly rise by level',
  });

export const paintSchema = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  colors: z.strictObject({ yellow: hexColor, red: hexColor, white: hexColor, outline: hexColor, markerOutline: hexColor, signBlack: hexColor, snap: hexColor }),
  taxiway: z.strictObject({
    centerlineWidthM: positive,
    centerlineMinPx: positive,
    edgeLineWidthM: positive,
    edgeLineMinPx: positive,
    edgeLineInsetsM: z.array(positive).min(1),
    concreteOutlinePx: positive,
    shoulderStripeSpacingM: positive,
    shoulderStripeInsetM: positive,
    shoulderStripeEndGapM: positive,
    shoulderStripeWidthM: positive,
    shoulderStripeMinPx: positive,
    shoulderStripeEdgeClearM: positive,
    shoulderStripeReachFactor: positive,
    unpavedMarkerSizeM: positive,
    unpavedMarkerMinPx: positive,
    signOffsetM: positive,
    signBeforeJunctionM: positive,
    signHeightM: positive,
    signCharWidthM: positive,
  }),
  tower: z.strictObject({
    shadowPerM: positive,
    shadowColor: z.string(),
    mullionWidthM: positive,
    mullionStepDeg: positive,
    mullionMinScale: positive,
    antennaRadiusM: positive,
    antennaRingFrac: positive,
    antennaStartDeg: nonnegative,
    shadowOffsetM: positive,
    baseRoofInsetM: positive,
    outlineMinM: positive,
    outlinePx: positive,
    padEdgeMinM: positive,
    padEdgePx: positive,
    colors: z.strictObject({
      pad: z.string(),
      padEdge: z.string(),
      base: z.string(),
      baseRoof: z.string(),
      wall: z.string(),
      glass: z.string(),
      roof: z.string(),
      walkway: z.string(),
      antenna: z.string(),
      radome: z.string(),
      outline: z.string(),
    }),
    levels: towerLevelsSchema,
  }),
});

export type PaintData = z.infer<typeof paintSchema>;
