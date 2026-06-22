// Shared geometry types for the OWEN 3D preview.
//
// The preview renders a scene as a flat list of `CylinderSpec`s (nested open
// shells per pin layer). Each cylinder carries a `component` tag (fuel, clad,
// gap, moderator, guide_tube, …) so the webview can group meshes and offer
// live show/hide toggles. Keeping the wire format a flat cylinder list keeps
// the three.js side simple while still expressing full lattices and
// multi-region cores.

export interface CylinderSpec {
    /** Axis-of-symmetry mid-point in cm. */
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    /** Inner radius for annular pin layers (default 0). */
    innerRadius?: number;
    /** Hex CSS color used by the webview when present. */
    color?: string;
    /** Opacity (0-1); webview falls back to its default when omitted. */
    opacity?: number;
    /** Human-readable label, useful in tests and debug overlays. */
    label?: string;
    materialId?: string;
    /** Optional surface id from the source deck (MCNP only). */
    surfaceId?: string;
    /**
     * Logical layer/component this cylinder belongs to (fuel, clad, gap,
     * moderator, guide_tube, instrument_tube, …). Drives the show/hide UI.
     */
    component?: string;
    /** Raw material name (drives the material-based toggle group). */
    material?: string;
    /**
     * Primitive shape. Defaults to 'cylinder'. 'box' uses `radius` as the
     * half-width of a square prism (square grid sleeves / structural panels).
     */
    shape?: 'cylinder' | 'box';
}

/** A logical layer the webview can show/hide, with a representative color. */
export interface ComponentSummary {
    id: string;
    label: string;
    color: string;
    count: number;
}

/** A material the webview can show/hide, with its representative color. */
export interface MaterialSummary {
    name: string;
    color: string;
    count: number;
}

/**
 * Everything the webview needs to render and offer toggles. `extractCylinders`
 * still returns the flat list for back-compat; `buildScene` wraps it with the
 * legend summaries and any parser warnings (so the UI can say *why* a deck only
 * partially rendered instead of silently drawing one pin).
 */
export interface GeometryScene {
    language: string;
    cylinders: CylinderSpec[];
    components: ComponentSummary[];
    materials: MaterialSummary[];
    warnings: string[];
    notes: string[];
    primitiveCount: number;
    fidelity: FidelityState;
}

/**
 * Render fidelity knobs. The same deck can be expanded at different levels of
 * detail so a full BEAVRS core stays interactive: `detail` chooses single-disc
 * pins vs. concentric radial layers, and `axial` opts into the deck's real
 * z-segment structure (active fuel / plenum / grids / dashpot / end plugs).
 *
 * `'auto'` lets each parser pick based on pin count (disc for huge cores,
 * layers for a single assembly) with a one-click override from the webview.
 */
export interface FidelityOptions {
    detail?: 'auto' | 'disc' | 'layers';
    axial?: boolean;
}

/** Resolved fidelity the parser actually used, echoed back to the webview. */
export interface FidelityState {
    detail: 'disc' | 'layers';
    axial: boolean;
    /** Auto choice for `detail` given the pin count (drives the default UI). */
    autoDetail: 'disc' | 'layers';
    /** Number of placed pin positions (before layering/axial expansion). */
    totalPins: number;
    /** True when the deck actually defines axial segment structure to show. */
    hasAxial: boolean;
}

/** Per-code parser return value: geometry plus any caveats worth surfacing. */
export interface ParseResult {
    cylinders: CylinderSpec[];
    /** Hard problems: parts of the deck that could not be rendered. */
    warnings?: string[];
    /** Soft notes: approximations made (hex→rect, disc mode, …). */
    notes?: string[];
    /** Fidelity actually applied, for the webview's toggle state. */
    fidelity?: FidelityState;
}

/**
 * Canonical component identifiers. Parsers should prefer these so the toggle
 * UI groups equivalent layers across codes, but any string is permitted.
 */
export const Component = {
    Fuel: 'fuel',
    Gap: 'gap',
    Clad: 'clad',
    Moderator: 'moderator',
    GuideTube: 'guide_tube',
    InstrumentTube: 'instrument_tube',
    Absorber: 'absorber',
    Structure: 'structure',
    Grid: 'grid',
    Plenum: 'plenum',
    EndPlug: 'end_plug',
    Reflector: 'reflector',
    Vessel: 'vessel',
    Other: 'other',
} as const;

export type ComponentId = (typeof Component)[keyof typeof Component] | string;

/** Friendly labels for the webview checkboxes. */
export const COMPONENT_LABELS: Readonly<Record<string, string>> = {
    fuel: 'Fuel',
    gap: 'Gap',
    clad: 'Clad',
    moderator: 'Moderator / Coolant',
    guide_tube: 'Guide Tubes',
    instrument_tube: 'Instrument Tubes',
    absorber: 'Absorber',
    structure: 'Structure',
    grid: 'Grid Spacers',
    plenum: 'Plenum / Spring',
    end_plug: 'End Plugs / Nozzles',
    reflector: 'Reflector',
    vessel: 'Vessel / Barrel',
    other: 'Other',
};
