// GENERATED FILE — do not edit by hand.
//
// Written by scripts/export-nrdp-snapshot.mjs from the ReactorMC site repo
// (public/data/nrdp-materials.json, itself generated from
// scripts/nrdp/recipes.mjs). Regenerate with:
//
//   npm run export-nrdp
//
// Each entry is either a PNNL-15870 Rev. 2 material verbatim (source: 'pnnl')
// or a derived recipe with stated provenance. Cards are generated from these
// element trees by src/inputBuilder/pnnlCards.ts, which is the same code
// reactormc.net runs, so the builder cannot disagree with the site.

import type { PnnlElement } from './pnnlCards';

export interface NrdpLibraryMaterial {
    id: string;
    name: string;
    formula?: string;
    category: string;
    /** g/cm3 */
    density: number;
    /** atoms/(barn*cm) */
    atomDensity: number;
    description: string;
    provenance: string;
    source: 'pnnl' | 'derived';
    /** Keys into SAB_LIBRARY in pnnlCards.ts, e.g. ['lwtr']. */
    sabNames?: string[];
    elements: PnnlElement[];
}

export const NRDP_LIBRARY: NrdpLibraryMaterial[] = [
    {
        "id": "uo2-3pct",
        "name": "UO2 (3% enriched)",
        "formula": "UO₂",
        "category": "fuels",
        "density": 10.96,
        "atomDensity": 0.073348,
        "description": "Uranium dioxide at 3 wt% U-235 enrichment. Standard fuel for commercial PWRs and BWRs. This is the compendium's own UO₂ entry, whose uranium is 3.0 wt% enriched.",
        "provenance": "PNNL-15870 Rev. 2, \"Uranium Dioxide\" (id uranium-dioxide): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.118533,
                "af": 0.666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.118212,
                        "ad": 0.0487798
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000047857,
                        "ad": 0.0000185815
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.000273364,
                        "ad": 0.000100242
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.881467,
                "af": 0.333333,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.000235352,
                        "ad": 0.00000663723
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.026444,
                        "ad": 0.000742574
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.000121642,
                        "ad": 0.00000340135
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.854666,
                        "ad": 0.0236967
                    }
                ]
            }
        ]
    },
    {
        "id": "uo2-4.5pct",
        "name": "UO2 (4.5% enriched)",
        "formula": "UO₂",
        "category": "fuels",
        "density": 10.96,
        "atomDensity": 0.07336056416885266,
        "description": "Uranium dioxide at 4.5 wt% U-235 enrichment. Common in high-burnup PWR fuel assemblies.",
        "provenance": "UO₂ stoichiometry with uranium enriched to 4.5 wt% U-235. Density is the compendium's UO₂ value (10.96 g/cm³); U-234 and U-236 scale with U-235 at the ratios the compendium's LEU formulation uses.",
        "source": "derived",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.11855332294756282,
                "af": 0.6666666666666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.11823204643957541,
                        "ad": 0.048788198597275165
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.0000478652823444374,
                        "ad": 0.000018584692785718956
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.0002734112256429725,
                        "ad": 0.000100259489174232
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.8814466770524371,
                "af": 0.33333333333333337,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.00035301939415950103,
                        "ad": 0.000009955611560845483
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.03966510046735966,
                        "ad": 0.0011138346166398364
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.00018245946214985446,
                        "ad": 0.000005101899045229079
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.841246097728768,
                        "ad": 0.023324629262371645
                    }
                ]
            }
        ]
    },
    {
        "id": "uo2-5pct",
        "name": "UO2 (5% enriched)",
        "formula": "UO₂",
        "category": "fuels",
        "density": 10.96,
        "atomDensity": 0.07336475964592169,
        "description": "Uranium dioxide at 5 wt% U-235 enrichment. The licensing ceiling for standard commercial fuel in the United States.",
        "provenance": "UO₂ stoichiometry with uranium enriched to 5.0 wt% U-235; density from the compendium's UO₂ entry.",
        "source": "derived",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.1185601029901309,
                "af": 0.6666666666666666,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.11823880810839953,
                        "ad": 0.0487909887853111
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.00004786801975106387,
                        "ad": 0.0000185857556408551
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.0002734268619802962,
                        "ad": 0.00010026522299583694
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.8814398970098691,
                "af": 0.33333333333333337,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.0003922407541693918,
                        "ad": 0.000011061705536436323
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.04407199485049345,
                        "ad": 0.001237584498979081
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.00020273117631226987,
                        "ad": 0.000005668733112981847
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.836772930228894,
                        "ad": 0.0232006049443454
                    }
                ]
            }
        ]
    },
    {
        "id": "uo2-haleu",
        "name": "UO2 (19.75% HALEU)",
        "formula": "UO₂",
        "category": "fuels",
        "density": 10.96,
        "atomDensity": 0.07348849718985792,
        "description": "Uranium dioxide at 19.75 wt% U-235 — high-assay low-enriched uranium, the working fuel of most advanced reactor and research reactor designs.",
        "provenance": "UO₂ stoichiometry with uranium enriched to 19.75 wt% U-235; density from the compendium's UO₂ entry. The U-234/U-236 ratios are extrapolated from the compendium's LEU entry, which is an interpolation of cascade behaviour rather than a measured vector.",
        "source": "derived",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.11876006733300654,
                "af": 0.6666666666666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.11843823055296136,
                        "ad": 0.04887328002633271
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000047948754305714836,
                        "ad": 0.000018617102513199506
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.0002738880257394487,
                        "ad": 0.00010043433105937593
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.8812399326669933,
                "af": 0.3333333333333333,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.0015489994916454077,
                        "ad": 0.00004368382446376639
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.1740448867017312,
                        "ad": 0.004887349770286635
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.0008006064788279635,
                        "ad": 0.000022386416038987873
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.7048454399947888,
                        "ad": 0.01954274571916325
                    }
                ]
            }
        ]
    },
    {
        "id": "mox-5pct",
        "name": "MOX (mixed oxide, ~5% Pu)",
        "formula": "(U,Pu)O₂",
        "category": "fuels",
        "density": 11,
        "atomDensity": 0.073571,
        "description": "Mixed-oxide fuel: reactor-grade plutonium in a depleted-uranium matrix (0.25 wt% U-235). Plutonium is 4.7 wt% of the heavy metal.",
        "provenance": "PNNL-15870 Rev. 2, \"Uranium-Plutonium, Mixed Oxide (MOX)\" (id uranium-plutonium-mixed-oxide-mox): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.118462,
                "af": 0.666666,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.118141,
                        "ad": 0.0489285
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.0000478284,
                        "ad": 0.0000186381
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.0002732,
                        "ad": 0.000100548
                    }
                ]
            },
            {
                "sym": "Pu",
                "z": 94,
                "wf": 0.0411911,
                "af": 0.0154733,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "94238",
                        "wf": 0.00102978,
                        "ad": 0.0000286563
                    },
                    {
                        "zaid": "94239",
                        "wf": 0.0225315,
                        "ad": 0.000624369
                    },
                    {
                        "zaid": "94240",
                        "wf": 0.0107509,
                        "ad": 0.000296674
                    },
                    {
                        "zaid": "94241",
                        "wf": 0.00391315,
                        "ad": 0.000107535
                    },
                    {
                        "zaid": "94242",
                        "wf": 0.00296576,
                        "ad": 0.0000811631
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.840347,
                "af": 0.31786,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.0000100001,
                        "ad": 2.83046e-7
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.00210087,
                        "ad": 0.0000592097
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.838236,
                        "ad": 0.023326
                    }
                ]
            }
        ]
    },
    {
        "id": "un",
        "name": "Uranium Nitride",
        "formula": "UN",
        "category": "fuels",
        "density": 14.31,
        "atomDensity": 0.068404,
        "description": "Uranium mononitride at 3 wt% U-235. High uranium density and high thermal conductivity make it attractive for advanced and space reactors.",
        "provenance": "PNNL-15870 Rev. 2, \"Uranium Nitride\" (id uranium-nitride): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "N",
                "z": 7,
                "wf": 0.0555905,
                "af": 0.5,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "7014",
                        "wf": 0.0553732,
                        "ad": 0.0340774
                    },
                    {
                        "zaid": "7015",
                        "wf": 0.000216698,
                        "ad": 0.000124495
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.94441,
                "af": 0.5,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.000252157,
                        "ad": 0.00000928475
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.0283323,
                        "ad": 0.00103878
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.000130329,
                        "ad": 0.00000475811
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.915695,
                        "ad": 0.0331491
                    }
                ]
            }
        ]
    },
    {
        "id": "uc",
        "name": "Uranium Carbide",
        "formula": "UC",
        "category": "fuels",
        "density": 13.63,
        "atomDensity": 0.065674,
        "description": "Uranium monocarbide at 3 wt% U-235. High heavy-metal density and good thermal properties for fast and space reactor fuel.",
        "provenance": "PNNL-15870 Rev. 2, \"Uranium Carbide\" (id uranium-carbide): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.0480484,
                "af": 0.5,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.0474923,
                        "ad": 0.0324855
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.000556613,
                        "ad": 0.000351354
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.951952,
                "af": 0.5,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.000254171,
                        "ad": 0.00000891417
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.0285585,
                        "ad": 0.000997318
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.000131369,
                        "ad": 0.0000045682
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.923007,
                        "ad": 0.031826
                    }
                ]
            }
        ]
    },
    {
        "id": "uzrh",
        "name": "UZrH₁.₆ (TRIGA fuel)",
        "formula": "UZrH₁.₆",
        "category": "fuels",
        "density": 5.97,
        "atomDensity": 0.09341758383510973,
        "description": "Uranium–zirconium hydride fuel used in TRIGA research reactors. The hydride matrix is what gives TRIGA its large prompt negative temperature coefficient.",
        "provenance": "Standard TRIGA fuel meat: 8.5 wt% uranium at 19.75 wt% enrichment in a ZrH1.6 matrix. Atom fractions from a 100 g basis; density by ideal mixing of uranium metal (18.94 g/cm³) with ZrH1.6 (5.61 g/cm³, the compendium's Zr5H8).",
        "source": "derived",
        "sabNames": [
            "h-zr",
            "zr-h"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.015893166881751995,
                "af": 0.6069066219534613,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.015893166881751995,
                        "ad": 0.05669575023642072
                    }
                ]
            },
            {
                "sym": "Zr",
                "z": 40,
                "wf": 0.8991090983830354,
                "af": 0.37931663872091337,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "40090",
                        "wf": 0.4559035176456135,
                        "ad": 0.01823124019780166
                    },
                    {
                        "zaid": "40091",
                        "wf": 0.10052832204957458,
                        "ad": 0.003975788645168059
                    },
                    {
                        "zaid": "40092",
                        "wf": 0.1553490876217232,
                        "ad": 0.006077074058777124
                    },
                    {
                        "zaid": "40094",
                        "wf": 0.16086032714028986,
                        "ad": 0.006158567147400014
                    },
                    {
                        "zaid": "40096",
                        "wf": 0.026467843925834324,
                        "ad": 0.0009921738486160987
                    }
                ]
            },
            {
                "sym": "U",
                "z": 92,
                "wf": 0.0849977347352126,
                "af": 0.01377673932562528,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "92234",
                        "wf": 0.00014940476823081995,
                        "ad": 0.000002295078862615026
                    },
                    {
                        "zaid": "92235",
                        "wf": 0.01678705261020449,
                        "ad": 0.0002567736064706307
                    },
                    {
                        "zaid": "92236",
                        "wf": 0.00007722044200694066,
                        "ad": 0.0000011761467978474072
                    },
                    {
                        "zaid": "92238",
                        "wf": 0.06798405691477036,
                        "ad": 0.0010267448687949596
                    }
                ]
            }
        ]
    },
    {
        "id": "zirc2",
        "name": "Zircaloy-2",
        "category": "cladding-structural",
        "density": 6.56,
        "atomDensity": 0.043483,
        "description": "Zirconium alloy cladding used in BWRs. Low absorption cross section with good corrosion resistance.",
        "provenance": "PNNL-15870 Rev. 2, \"Zircaloy-2\" (id zircaloy-2): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.001197,
                "af": 0.00679738,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.00119376,
                        "ad": 0.000294841
                    },
                    {
                        "zaid": "8017",
                        "wf": 4.83282e-7,
                        "ad": 1.12313e-7
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00000276056,
                        "ad": 6.05897e-7
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.000997,
                "af": 0.00174211,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.0000416117,
                        "ad": 0.00000329131
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.000834483,
                        "ad": 0.0000634697
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.0000964457,
                        "ad": 0.00000719695
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.0000244601,
                        "ad": 0.00000179147
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.000997,
                "af": 0.00162204,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.0000562864,
                        "ad": 0.0000041224
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.000916261,
                        "ad": 0.0000647129
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.0000215389,
                        "ad": 0.0000014945
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.00000291668,
                        "ad": 1.98891e-7
                    }
                ]
            },
            {
                "sym": "Ni",
                "z": 28,
                "wf": 0.000499,
                "af": 0.000772436,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "28058",
                        "wf": 0.000335317,
                        "ad": 0.0000228647
                    },
                    {
                        "zaid": "28060",
                        "wf": 0.000133611,
                        "ad": 0.00000880741
                    },
                    {
                        "zaid": "28061",
                        "wf": 0.00000590496,
                        "ad": 3.82854e-7
                    },
                    {
                        "zaid": "28062",
                        "wf": 0.0000191363,
                        "ad": 0.00000122074
                    },
                    {
                        "zaid": "28064",
                        "wf": 0.00000503012,
                        "ad": 3.10844e-7
                    }
                ]
            },
            {
                "sym": "Zr",
                "z": 40,
                "wf": 0.982348,
                "af": 0.97838,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "40090",
                        "wf": 0.498109,
                        "ad": 0.0218875
                    },
                    {
                        "zaid": "40091",
                        "wf": 0.109835,
                        "ad": 0.00477314
                    },
                    {
                        "zaid": "40092",
                        "wf": 0.16973,
                        "ad": 0.00729584
                    },
                    {
                        "zaid": "40094",
                        "wf": 0.175752,
                        "ad": 0.00739368
                    },
                    {
                        "zaid": "40096",
                        "wf": 0.0289181,
                        "ad": 0.00119116
                    }
                ]
            },
            {
                "sym": "Sn",
                "z": 50,
                "wf": 0.013962,
                "af": 0.0106859,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "50112",
                        "wf": 0.000127668,
                        "ad": 0.00000450699
                    },
                    {
                        "zaid": "50114",
                        "wf": 0.0000884176,
                        "ad": 0.00000306661
                    },
                    {
                        "zaid": "50115",
                        "wf": 0.0000459486,
                        "ad": 0.00000157977
                    },
                    {
                        "zaid": "50116",
                        "wf": 0.00198205,
                        "ad": 0.0000675584
                    },
                    {
                        "zaid": "50117",
                        "wf": 0.00105596,
                        "ad": 0.0000356842
                    },
                    {
                        "zaid": "50118",
                        "wf": 0.00335857,
                        "ad": 0.000112535
                    },
                    {
                        "zaid": "50119",
                        "wf": 0.00120129,
                        "ad": 0.0000399124
                    },
                    {
                        "zaid": "50120",
                        "wf": 0.0045945,
                        "ad": 0.000151379
                    },
                    {
                        "zaid": "50122",
                        "wf": 0.000663831,
                        "ad": 0.0000215128
                    },
                    {
                        "zaid": "50124",
                        "wf": 0.000843779,
                        "ad": 0.0000269026
                    }
                ]
            }
        ]
    },
    {
        "id": "zirc4",
        "name": "Zircaloy-4",
        "category": "cladding-structural",
        "density": 6.56,
        "atomDensity": 0.043496,
        "description": "Zirconium alloy cladding used in PWRs. No nickel, which improves hydrogen pickup resistance in PWR coolant chemistry.",
        "provenance": "PNNL-15870 Rev. 2, \"Zircaloy-4\" (id zircaloy-4): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.00119612,
                "af": 0.00679001,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.00119288,
                        "ad": 0.000294625
                    },
                    {
                        "zaid": "8017",
                        "wf": 4.82927e-7,
                        "ad": 1.1223e-7
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00000275853,
                        "ad": 6.05452e-7
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.000996715,
                "af": 0.001741,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.0000415998,
                        "ad": 0.00000329037
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.000834244,
                        "ad": 0.0000634515
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.0000964181,
                        "ad": 0.00000719489
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.0000244531,
                        "ad": 0.00000179096
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.00199342,
                "af": 0.003242,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.00011254,
                        "ad": 0.0000082424
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.00183199,
                        "ad": 0.000129388
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.0000430653,
                        "ad": 0.00000298813
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.00000583165,
                        "ad": 3.97666e-7
                    }
                ]
            },
            {
                "sym": "Zr",
                "z": 40,
                "wf": 0.981858,
                "af": 0.97755,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "40090",
                        "wf": 0.49786,
                        "ad": 0.0218766
                    },
                    {
                        "zaid": "40091",
                        "wf": 0.10978,
                        "ad": 0.00477076
                    },
                    {
                        "zaid": "40092",
                        "wf": 0.169646,
                        "ad": 0.0072922
                    },
                    {
                        "zaid": "40094",
                        "wf": 0.175665,
                        "ad": 0.00739
                    },
                    {
                        "zaid": "40096",
                        "wf": 0.0289037,
                        "ad": 0.00119056
                    }
                ]
            },
            {
                "sym": "Sn",
                "z": 50,
                "wf": 0.0139553,
                "af": 0.010677,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "50112",
                        "wf": 0.000127606,
                        "ad": 0.00000450482
                    },
                    {
                        "zaid": "50114",
                        "wf": 0.0000883749,
                        "ad": 0.00000306513
                    },
                    {
                        "zaid": "50115",
                        "wf": 0.0000459264,
                        "ad": 0.00000157901
                    },
                    {
                        "zaid": "50116",
                        "wf": 0.00198109,
                        "ad": 0.0000675258
                    },
                    {
                        "zaid": "50117",
                        "wf": 0.00105545,
                        "ad": 0.000035667
                    },
                    {
                        "zaid": "50118",
                        "wf": 0.00335695,
                        "ad": 0.000112481
                    },
                    {
                        "zaid": "50119",
                        "wf": 0.00120071,
                        "ad": 0.0000398932
                    },
                    {
                        "zaid": "50120",
                        "wf": 0.00459228,
                        "ad": 0.000151306
                    },
                    {
                        "zaid": "50122",
                        "wf": 0.00066351,
                        "ad": 0.0000215024
                    },
                    {
                        "zaid": "50124",
                        "wf": 0.000843371,
                        "ad": 0.0000268896
                    }
                ]
            }
        ]
    },
    {
        "id": "ss304",
        "name": "Stainless Steel 304",
        "category": "cladding-structural",
        "density": 8.03,
        "atomDensity": 0.088599,
        "description": "Austenitic stainless steel used for reactor structural components, piping, and vessel internals.",
        "provenance": "PNNL-15870 Rev. 2, \"Steel, Stainless 304\" (id steel-stainless-304): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.0008,
                "af": 0.00363547,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.000790742,
                        "ad": 0.000318654
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00000926754,
                        "ad": 0.00000344648
                    }
                ]
            },
            {
                "sym": "Mn",
                "z": 25,
                "wf": 0.02,
                "af": 0.0198698,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "25055",
                        "wf": 0.02,
                        "ad": 0.00176045
                    }
                ]
            },
            {
                "sym": "P",
                "z": 15,
                "wf": 0.00045,
                "af": 0.000792965,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "15031",
                        "wf": 0.00045,
                        "ad": 0.0000702563
                    }
                ]
            },
            {
                "sym": "S",
                "z": 16,
                "wf": 0.0003,
                "af": 0.000510613,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "16032",
                        "wf": 0.000284122,
                        "ad": 0.0000429735
                    },
                    {
                        "zaid": "16033",
                        "wf": 0.00000231343,
                        "ad": 3.393e-7
                    },
                    {
                        "zaid": "16034",
                        "wf": 0.0000135056,
                        "ad": 0.0000019227
                    },
                    {
                        "zaid": "16036",
                        "wf": 3.36482e-8,
                        "ad": 4.524e-9
                    }
                ]
            },
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.01,
                "af": 0.019434,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.00918681,
                        "ad": 0.00158793
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.000483371,
                        "ad": 0.0000806681
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.000329994,
                        "ad": 0.0000532392
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.19,
                "af": 0.199443,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.00793001,
                        "ad": 0.000767784
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.159029,
                        "ad": 0.014806
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.0183798,
                        "ad": 0.00167888
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.00466139,
                        "ad": 0.000417908
                    }
                ]
            },
            {
                "sym": "Ni",
                "z": 28,
                "wf": 0.095,
                "af": 0.0883426,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "28058",
                        "wf": 0.0638379,
                        "ad": 0.00532845
                    },
                    {
                        "zaid": "28060",
                        "wf": 0.025437,
                        "ad": 0.0020525
                    },
                    {
                        "zaid": "28061",
                        "wf": 0.00112419,
                        "ad": 0.0000892211
                    },
                    {
                        "zaid": "28062",
                        "wf": 0.00364318,
                        "ad": 0.000284484
                    },
                    {
                        "zaid": "28064",
                        "wf": 0.000957639,
                        "ad": 0.0000724398
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.68345,
                "af": 0.667972,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.0385847,
                        "ad": 0.00345918
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.628103,
                        "ad": 0.0543018
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.0147651,
                        "ad": 0.00125406
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.0019994,
                        "ad": 0.000166893
                    }
                ]
            }
        ]
    },
    {
        "id": "ss316",
        "name": "Stainless Steel 316",
        "category": "cladding-structural",
        "density": 8,
        "atomDensity": 0.087134,
        "description": "Molybdenum-bearing austenitic stainless steel with improved corrosion resistance. Used in fast reactor cladding, PWR internals, and hot-leg piping.",
        "provenance": "PNNL-15870 Rev. 2, \"Steel, Stainless 316\" (id steel-stainless-316): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.0008,
                "af": 0.00368278,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.000790742,
                        "ad": 0.000317464
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00000926754,
                        "ad": 0.0000034336
                    }
                ]
            },
            {
                "sym": "Mn",
                "z": 25,
                "wf": 0.02,
                "af": 0.0201283,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "25055",
                        "wf": 0.02,
                        "ad": 0.00175387
                    }
                ]
            },
            {
                "sym": "P",
                "z": 15,
                "wf": 0.00045,
                "af": 0.000803284,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "15031",
                        "wf": 0.00045,
                        "ad": 0.0000699938
                    }
                ]
            },
            {
                "sym": "S",
                "z": 16,
                "wf": 0.0003,
                "af": 0.000517257,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "16032",
                        "wf": 0.000284122,
                        "ad": 0.0000428129
                    },
                    {
                        "zaid": "16033",
                        "wf": 0.00000231343,
                        "ad": 3.38032e-7
                    },
                    {
                        "zaid": "16034",
                        "wf": 0.0000135056,
                        "ad": 0.00000191552
                    },
                    {
                        "zaid": "16036",
                        "wf": 3.36482e-8,
                        "ad": 4.5071e-9
                    }
                ]
            },
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.01,
                "af": 0.0196868,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.00918681,
                        "ad": 0.001582
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.000483371,
                        "ad": 0.0000803667
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.000329994,
                        "ad": 0.0000530403
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.17,
                "af": 0.180771,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.00709527,
                        "ad": 0.000684398
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.142289,
                        "ad": 0.0131979
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.0164451,
                        "ad": 0.00149654
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.00417072,
                        "ad": 0.000372521
                    }
                ]
            },
            {
                "sym": "Ni",
                "z": 28,
                "wf": 0.12,
                "af": 0.113043,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "28058",
                        "wf": 0.0806373,
                        "ad": 0.00670553
                    },
                    {
                        "zaid": "28060",
                        "wf": 0.032131,
                        "ad": 0.00258295
                    },
                    {
                        "zaid": "28061",
                        "wf": 0.00142003,
                        "ad": 0.000112279
                    },
                    {
                        "zaid": "28062",
                        "wf": 0.00460191,
                        "ad": 0.000358005
                    },
                    {
                        "zaid": "28064",
                        "wf": 0.00120965,
                        "ad": 0.000091161
                    }
                ]
            },
            {
                "sym": "Mo",
                "z": 42,
                "wf": 0.025,
                "af": 0.0144061,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "42092",
                        "wf": 0.00347943,
                        "ad": 0.00018239
                    },
                    {
                        "zaid": "42094",
                        "wf": 0.00223875,
                        "ad": 0.000114857
                    },
                    {
                        "zaid": "42095",
                        "wf": 0.00391691,
                        "ad": 0.000198834
                    },
                    {
                        "zaid": "42096",
                        "wf": 0.00416553,
                        "ad": 0.000209253
                    },
                    {
                        "zaid": "42097",
                        "wf": 0.00242391,
                        "ad": 0.000120506
                    },
                    {
                        "zaid": "42098",
                        "wf": 0.00622176,
                        "ad": 0.000306159
                    },
                    {
                        "zaid": "42100",
                        "wf": 0.00255626,
                        "ad": 0.000123267
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.65345,
                "af": 0.646962,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.036891,
                        "ad": 0.00329499
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.600532,
                        "ad": 0.0517242
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.014117,
                        "ad": 0.00119454
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.00191164,
                        "ad": 0.000158971
                    }
                ]
            }
        ]
    },
    {
        "id": "inconel-718",
        "name": "Inconel 718",
        "category": "cladding-structural",
        "density": 8.19,
        "atomDensity": 0.085469,
        "description": "Nickel–chromium superalloy used in vessel head penetrations, springs, and high-temperature structure.",
        "provenance": "PNNL-15870 Rev. 2, \"Inconel Alloy 718\" (id inconel-alloy-718): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "B",
                "z": 5,
                "wf": 0.000055,
                "af": 0.000293512,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "5010",
                        "wf": 0.0000101347,
                        "ad": 0.00000499211
                    },
                    {
                        "zaid": "5011",
                        "wf": 0.0000448527,
                        "ad": 0.0000200939
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.000728,
                "af": 0.00349781,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.000719575,
                        "ad": 0.000295753
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00000843346,
                        "ad": 0.00000319879
                    }
                ]
            },
            {
                "sym": "Al",
                "z": 13,
                "wf": 0.005,
                "af": 0.0106938,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "13027",
                        "wf": 0.005,
                        "ad": 0.000913983
                    }
                ]
            },
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.003184,
                "af": 0.00654227,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.00292508,
                        "ad": 0.000515671
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.000153905,
                        "ad": 0.0000261965
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.00010507,
                        "ad": 0.0000172891
                    }
                ]
            },
            {
                "sym": "P",
                "z": 15,
                "wf": 0.000136,
                "af": 0.000253381,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "15031",
                        "wf": 0.000136,
                        "ad": 0.0000216561
                    }
                ]
            },
            {
                "sym": "S",
                "z": 16,
                "wf": 0.000136,
                "af": 0.000244739,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "16032",
                        "wf": 0.000128802,
                        "ad": 0.0000198695
                    },
                    {
                        "zaid": "16033",
                        "wf": 0.00000104875,
                        "ad": 1.56881e-7
                    },
                    {
                        "zaid": "16034",
                        "wf": 0.00000612253,
                        "ad": 8.88991e-7
                    },
                    {
                        "zaid": "16036",
                        "wf": 1.52538e-8,
                        "ad": 2.09174e-9
                    }
                ]
            },
            {
                "sym": "Ti",
                "z": 22,
                "wf": 0.009,
                "af": 0.0108502,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "22046",
                        "wf": 0.000712805,
                        "ad": 0.0000765059
                    },
                    {
                        "zaid": "22047",
                        "wf": 0.000656797,
                        "ad": 0.0000689944
                    },
                    {
                        "zaid": "22048",
                        "wf": 0.00664602,
                        "ad": 0.000683638
                    },
                    {
                        "zaid": "22049",
                        "wf": 0.000497894,
                        "ad": 0.0000501693
                    },
                    {
                        "zaid": "22050",
                        "wf": 0.000486437,
                        "ad": 0.0000480364
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.19,
                "af": 0.210869,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.00793001,
                        "ad": 0.000783082
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.159029,
                        "ad": 0.015101
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.0183798,
                        "ad": 0.00171233
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.00466139,
                        "ad": 0.000426235
                    }
                ]
            },
            {
                "sym": "Mn",
                "z": 25,
                "wf": 0.003184,
                "af": 0.00334449,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "25055",
                        "wf": 0.003184,
                        "ad": 0.000285848
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.17,
                "af": 0.175669,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.00959747,
                        "ad": 0.000877574
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.156233,
                        "ad": 0.013776
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.00367264,
                        "ad": 0.000318149
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.000497327,
                        "ad": 0.0000423398
                    }
                ]
            },
            {
                "sym": "Ni",
                "z": 28,
                "wf": 0.525,
                "af": 0.516178,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "28058",
                        "wf": 0.352788,
                        "ad": 0.0300335
                    },
                    {
                        "zaid": "28060",
                        "wf": 0.140573,
                        "ad": 0.0115688
                    },
                    {
                        "zaid": "28061",
                        "wf": 0.00621263,
                        "ad": 0.000502888
                    },
                    {
                        "zaid": "28062",
                        "wf": 0.0201334,
                        "ad": 0.00160347
                    },
                    {
                        "zaid": "28064",
                        "wf": 0.00529221,
                        "ad": 0.000408302
                    }
                ]
            },
            {
                "sym": "Co",
                "z": 27,
                "wf": 0.009098,
                "af": 0.00890873,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "27059",
                        "wf": 0.009098,
                        "ad": 0.000761414
                    }
                ]
            },
            {
                "sym": "Cu",
                "z": 29,
                "wf": 0.002729,
                "af": 0.00247825,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "29063",
                        "wf": 0.0018688,
                        "ad": 0.000146468
                    },
                    {
                        "zaid": "29065",
                        "wf": 0.000860203,
                        "ad": 0.0000653439
                    }
                ]
            },
            {
                "sym": "Nb",
                "z": 41,
                "wf": 0.05125,
                "af": 0.031833,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "41093",
                        "wf": 0.05125,
                        "ad": 0.00272072
                    }
                ]
            },
            {
                "sym": "Mo",
                "z": 42,
                "wf": 0.0305,
                "af": 0.0183436,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "42092",
                        "wf": 0.00424491,
                        "ad": 0.000227801
                    },
                    {
                        "zaid": "42094",
                        "wf": 0.00273127,
                        "ad": 0.000143453
                    },
                    {
                        "zaid": "42095",
                        "wf": 0.00477863,
                        "ad": 0.000248339
                    },
                    {
                        "zaid": "42096",
                        "wf": 0.00508195,
                        "ad": 0.000261352
                    },
                    {
                        "zaid": "42097",
                        "wf": 0.00295717,
                        "ad": 0.000150508
                    },
                    {
                        "zaid": "42098",
                        "wf": 0.00759055,
                        "ad": 0.000382386
                    },
                    {
                        "zaid": "42100",
                        "wf": 0.00311863,
                        "ad": 0.000153958
                    }
                ]
            }
        ]
    },
    {
        "id": "hastelloy-n",
        "name": "Hastelloy-N",
        "category": "cladding-structural",
        "density": 8.86,
        "atomDensity": 0.08686970252566659,
        "description": "Nickel–molybdenum alloy developed for molten-salt service. The structural material of the MSRE and of most proposed MSR designs.",
        "provenance": "Nominal INOR-8 / Alloy N composition (Ni 71, Mo 16, Cr 7, Fe 5, Si 0.5, Mn 0.5 wt%) and density carried over from the previous NRDP entry. Not in the compendium and not re-derived here.",
        "source": "derived",
        "elements": [
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.005000000000000001,
                "af": 0.010936712949023219,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.004611148995697896,
                        "ad": 0.0008794146676537832
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.0002342507035361203,
                        "ad": 0.00004313400003270279
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.0001546003007659845,
                        "ad": 0.00002752033280376681
                    }
                ]
            },
            {
                "sym": "Cr",
                "z": 24,
                "wf": 0.07,
                "af": 0.08269921278312525,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "24050",
                        "wf": 0.0030415025776322924,
                        "ad": 0.0003249165227625431
                    },
                    {
                        "zaid": "24052",
                        "wf": 0.05865230214895355,
                        "ad": 0.006025088471377267
                    },
                    {
                        "zaid": "24053",
                        "wf": 0.006650693918935019,
                        "ad": 0.0006702893793541782
                    },
                    {
                        "zaid": "24054",
                        "wf": 0.0016555013544791485,
                        "ad": 0.00016376164008290503
                    }
                ]
            },
            {
                "sym": "Mn",
                "z": 25,
                "wf": 0.005,
                "af": 0.005590017584746066,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "25055",
                        "wf": 0.005,
                        "ad": 0.00048560316470013594
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.049999999999999996,
                "af": 0.054996815151902106,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.0029224989785924587,
                        "ad": 0.0002890887863691181
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.045877002903977705,
                        "ad": 0.004376192882925325
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.0010594980151212943,
                        "ad": 0.00009928928858696465
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.00014100010230854058,
                        "ad": 0.00001298601422340189
                    }
                ]
            },
            {
                "sym": "Ni",
                "z": 28,
                "wf": 0.7100000000000001,
                "af": 0.7433047467541171,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "28058",
                        "wf": 0.48334646473437687,
                        "ad": 0.04451428274335532
                    },
                    {
                        "zaid": "28060",
                        "wf": 0.18618356840896919,
                        "ad": 0.016575867451759603
                    },
                    {
                        "zaid": "28061",
                        "wf": 0.00809328572879805,
                        "ad": 0.0007087135664908442
                    },
                    {
                        "zaid": "28062",
                        "wf": 0.025805625290666066,
                        "ad": 0.002223358577765363
                    },
                    {
                        "zaid": "28064",
                        "wf": 0.006571055837189825,
                        "ad": 0.0005484398970749548
                    }
                ]
            },
            {
                "sym": "Mo",
                "z": 42,
                "wf": 0.16000000000000003,
                "af": 0.10247249477708599,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "42092",
                        "wf": 0.02324801814284978,
                        "ad": 0.0013496535690283875
                    },
                    {
                        "zaid": "42094",
                        "wf": 0.014639997751441116,
                        "ad": 0.0008318334326907265
                    },
                    {
                        "zaid": "42095",
                        "wf": 0.02534401063199188,
                        "ad": 0.0014248420595384074
                    },
                    {
                        "zaid": "42096",
                        "wf": 0.026672036359532823,
                        "ad": 0.0014838886966901778
                    },
                    {
                        "zaid": "42097",
                        "wf": 0.015360006443631445,
                        "ad": 0.0008457183307101962
                    },
                    {
                        "zaid": "42098",
                        "wf": 0.03902390729896479,
                        "ad": 0.0021267094605341035
                    },
                    {
                        "zaid": "42100",
                        "wf": 0.015712023371588203,
                        "ad": 0.0008391095891563849
                    }
                ]
            }
        ]
    },
    {
        "id": "carbon-steel",
        "name": "Carbon Steel (AISI 1045)",
        "category": "cladding-structural",
        "density": 7.872,
        "atomDensity": 0.08651,
        "description": "Plain medium-carbon steel, for structural supports, containment liner, and shielding geometry where the exact alloy does not matter.",
        "provenance": "PNNL-15870 Rev. 2, \"Steel, Medium Carbon (1045)\" (id steel-medium-carbon-1045): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.005,
                "af": 0.0228127,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.00494213,
                        "ad": 0.0019524
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.0000579221,
                        "ad": 0.0000211167
                    }
                ]
            },
            {
                "sym": "Mn",
                "z": 25,
                "wf": 0.009,
                "af": 0.00897721,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "25055",
                        "wf": 0.009,
                        "ad": 0.000776614
                    }
                ]
            },
            {
                "sym": "P",
                "z": 15,
                "wf": 0.0004,
                "af": 0.000707682,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "15031",
                        "wf": 0.0004,
                        "ad": 0.0000612212
                    }
                ]
            },
            {
                "sym": "S",
                "z": 16,
                "wf": 0.0005,
                "af": 0.000854431,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "16032",
                        "wf": 0.000473537,
                        "ad": 0.0000702132
                    },
                    {
                        "zaid": "16033",
                        "wf": 0.00000385571,
                        "ad": 5.54373e-7
                    },
                    {
                        "zaid": "16034",
                        "wf": 0.0000225093,
                        "ad": 0.00000314145
                    },
                    {
                        "zaid": "16036",
                        "wf": 5.60803e-8,
                        "ad": 7.39164e-9
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.9851,
                "af": 0.966648,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.0556145,
                        "ad": 0.00488783
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.905324,
                        "ad": 0.0767286
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.0212818,
                        "ad": 0.001772
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.00288186,
                        "ad": 0.00023582
                    }
                ]
            }
        ]
    },
    {
        "id": "light-water",
        "name": "Light Water",
        "formula": "H₂O",
        "category": "moderators-coolants",
        "density": 0.997,
        "atomDensity": 0.099983,
        "description": "Room-temperature light water — moderator and coolant in PWRs and BWRs.",
        "provenance": "PNNL-15870 Rev. 2, \"Water, Liquid\" (id water-liquid): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "lwtr"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.111902,
                "af": 0.666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.111872,
                        "ad": 0.0666474
                    },
                    {
                        "zaid": "1002",
                        "wf": 0.0000257138,
                        "ad": 0.00000766534
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.888098,
                "af": 0.333333,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.885692,
                        "ad": 0.0332466
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000358565,
                        "ad": 0.0000126645
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00204816,
                        "ad": 0.0000683215
                    }
                ]
            }
        ]
    },
    {
        "id": "heavy-water",
        "name": "Heavy Water",
        "formula": "D₂O",
        "category": "moderators-coolants",
        "density": 1.1044,
        "atomDensity": 0.099625,
        "description": "Deuterium oxide at room temperature — moderator and coolant in CANDU and other heavy-water reactors, where the neutron economy allows natural-uranium fuel.",
        "provenance": "PNNL-15870 Rev. 2, \"Water, Heavy\" (id water-heavy): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "hwtr"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.201133,
                "af": 0.666667,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "1002",
                        "wf": 0.201133,
                        "ad": 0.0664169
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.798867,
                "af": 0.333333,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.796703,
                        "ad": 0.0331277
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000322538,
                        "ad": 0.0000126192
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00184237,
                        "ad": 0.0000680773
                    }
                ]
            }
        ]
    },
    {
        "id": "graphite",
        "name": "Graphite",
        "formula": "C",
        "category": "moderators-coolants",
        "density": 1.7,
        "atomDensity": 0.085238,
        "description": "Nuclear-grade graphite moderator, for gas-cooled reactors (AGR, HTGR), RBMK, and molten-salt designs.",
        "provenance": "PNNL-15870 Rev. 2, \"Carbon, Graphite (reactor grade)\" (id carbon-graphite-reactor-grade): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "grph"
        ],
        "elements": [
            {
                "sym": "B",
                "z": 5,
                "wf": 0.000001,
                "af": 0.0000011107,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "5010",
                        "wf": 1.84267e-7,
                        "ad": 1.88402e-8
                    },
                    {
                        "zaid": "5011",
                        "wf": 8.15504e-7,
                        "ad": 7.58344e-8
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.999999,
                "af": 0.999999,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.988426,
                        "ad": 0.0843262
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.0115844,
                        "ad": 0.00091205
                    }
                ]
            }
        ]
    },
    {
        "id": "beryllium",
        "name": "Beryllium",
        "formula": "Be",
        "category": "moderators-coolants",
        "density": 1.848,
        "atomDensity": 0.123487,
        "description": "Beryllium metal reflector and moderator for research and test reactors. Excellent neutron economy, and Be-9(n,2n) makes it a multiplier as well as a reflector.",
        "provenance": "PNNL-15870 Rev. 2, \"Beryllium\" (id beryllium): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "be-met"
        ],
        "elements": [
            {
                "sym": "Be",
                "z": 4,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "4009",
                        "wf": 1,
                        "ad": 0.123487
                    }
                ]
            }
        ]
    },
    {
        "id": "beo",
        "name": "Beryllium Oxide",
        "formula": "BeO",
        "category": "moderators-coolants",
        "density": 3.01,
        "atomDensity": 0.144946,
        "description": "Beryllia moderator and reflector for compact reactors. Denser than graphite with excellent thermal conductivity.",
        "provenance": "PNNL-15870 Rev. 2, \"Beryllium Oxide\" (id beryllium-oxide): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "be-o",
            "o-be"
        ],
        "elements": [
            {
                "sym": "Be",
                "z": 4,
                "wf": 0.36032,
                "af": 0.5,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "4009",
                        "wf": 0.36032,
                        "ad": 0.072473
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.63968,
                "af": 0.5,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.637946,
                        "ad": 0.0722969
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000258267,
                        "ad": 0.0000275397
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00147525,
                        "ad": 0.00014857
                    }
                ]
            }
        ]
    },
    {
        "id": "flibe",
        "name": "FLiBe",
        "formula": "Li₂BeF₄",
        "category": "moderators-coolants",
        "density": 1.94,
        "atomDensity": 0.08257530339233797,
        "description": "Lithium fluoride–beryllium fluoride molten salt, the coolant and fuel carrier of fluoride-salt-cooled and molten-salt reactors.",
        "provenance": "2LiF·BeF₂ stoichiometry with lithium enriched to 99.995 at% Li-7. Density carried over from the previous NRDP entry (≈1.94 g/cm³ near 950–1000 K); not in the compendium.",
        "source": "derived",
        "elements": [
            {
                "sym": "Li",
                "z": 3,
                "wf": 0.14168238986899373,
                "af": 0.2857142857142857,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "3006",
                        "wf": 0.0000060735701019283985,
                        "ad": 0.0000011796471913191138
                    },
                    {
                        "zaid": "3007",
                        "wf": 0.1416763162988918,
                        "ad": 0.02359176417919096
                    }
                ]
            },
            {
                "sym": "Be",
                "z": 4,
                "wf": 0.09099758981043683,
                "af": 0.14285714285714285,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "4009",
                        "wf": 0.09099758981043683,
                        "ad": 0.011796471913191138
                    }
                ]
            },
            {
                "sym": "F",
                "z": 9,
                "wf": 0.7673200203205695,
                "af": 0.5714285714285714,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "9019",
                        "wf": 0.7673200203205695,
                        "ad": 0.047185887652764553
                    }
                ]
            }
        ]
    },
    {
        "id": "flinak",
        "name": "FLiNaK",
        "formula": "LiF-NaF-KF",
        "category": "moderators-coolants",
        "density": 2.09,
        "atomDensity": 0.06096433326806313,
        "description": "Lithium–sodium–potassium fluoride eutectic, used as a secondary coolant and heat-transfer salt in molten-salt designs.",
        "provenance": "Eutectic LiF-NaF-KF at 46.5-11.5-42.0 mol% with natural lithium. Density carried over from the previous NRDP entry; not in the compendium and not re-derived here.",
        "source": "derived",
        "elements": [
            {
                "sym": "Li",
                "z": 3,
                "wf": 0.07815613230342963,
                "af": 0.23249999999999998,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "3006",
                        "wf": 0.00514147698533917,
                        "ad": 0.0010758222988511714
                    },
                    {
                        "zaid": "3007",
                        "wf": 0.07301465531809047,
                        "ad": 0.013098385185973506
                    }
                ]
            },
            {
                "sym": "F",
                "z": 9,
                "wf": 0.46011424275218654,
                "af": 0.5,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "9019",
                        "wf": 0.46011424275218654,
                        "ad": 0.030482166634031565
                    }
                ]
            },
            {
                "sym": "Na",
                "z": 11,
                "wf": 0.06402961960292834,
                "af": 0.0575,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "11023",
                        "wf": 0.06402961960292834,
                        "ad": 0.00350544916291363
                    }
                ]
            },
            {
                "sym": "K",
                "z": 19,
                "wf": 0.3977000053414555,
                "af": 0.21000000000000002,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "19039",
                        "wf": 0.369610669107809,
                        "ad": 0.0119393771680734
                    },
                    {
                        "zaid": "19040",
                        "wf": 0.00004756121516070678,
                        "ad": 0.0000014978940079761162
                    },
                    {
                        "zaid": "19041",
                        "wf": 0.0280417750184858,
                        "ad": 0.0008616349242118834
                    }
                ]
            }
        ]
    },
    {
        "id": "sodium",
        "name": "Sodium",
        "formula": "Na",
        "category": "moderators-coolants",
        "density": 0.971,
        "atomDensity": 0.025435,
        "description": "Sodium coolant for sodium-cooled fast reactors — EBR-II, BN-600/800, Natrium.",
        "provenance": "PNNL-15870 Rev. 2, \"Sodium\" (id sodium): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "Na",
                "z": 11,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "11023",
                        "wf": 1,
                        "ad": 0.0254352
                    }
                ]
            }
        ]
    },
    {
        "id": "lead",
        "name": "Lead",
        "formula": "Pb",
        "category": "moderators-coolants",
        "density": 11.35,
        "atomDensity": 0.032988,
        "description": "Natural lead coolant for lead-cooled fast reactors, and a workhorse gamma shield.",
        "provenance": "PNNL-15870 Rev. 2, \"Lead\" (id lead): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "Pb",
                "z": 82,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "82204",
                        "wf": 0.013782,
                        "ad": 0.000461833
                    },
                    {
                        "zaid": "82206",
                        "wf": 0.239575,
                        "ad": 0.00795013
                    },
                    {
                        "zaid": "82207",
                        "wf": 0.220761,
                        "ad": 0.00729037
                    },
                    {
                        "zaid": "82208",
                        "wf": 0.525964,
                        "ad": 0.0172858
                    }
                ]
            }
        ]
    },
    {
        "id": "lbe",
        "name": "Lead-Bismuth Eutectic",
        "formula": "Pb-Bi",
        "category": "moderators-coolants",
        "density": 10.17,
        "atomDensity": 0.029417905751839023,
        "description": "Lead–bismuth eutectic: a liquid-metal coolant for fast reactors and spallation targets, melting at about 125 °C instead of lead's 327 °C.",
        "provenance": "Eutectic composition 44.5 wt% Pb / 55.5 wt% Bi, with the lead expanded over its natural isotopes. Density carried over from the previous NRDP entry; not in the compendium.",
        "source": "derived",
        "elements": [
            {
                "sym": "Pb",
                "z": 82,
                "wf": 0.445,
                "af": 0.44709855613147154,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "82204",
                        "wf": 0.006230009790967956,
                        "ad": 0.00018706273576204276
                    },
                    {
                        "zaid": "82206",
                        "wf": 0.10724514241919478,
                        "ad": 0.0031888589228766533
                    },
                    {
                        "zaid": "82207",
                        "wf": 0.09834506814288618,
                        "ad": 0.0029100764043081813
                    },
                    {
                        "zaid": "82208",
                        "wf": 0.23317977964695108,
                        "ad": 0.00686670512311206
                    }
                ]
            },
            {
                "sym": "Bi",
                "z": 83,
                "wf": 0.555,
                "af": 0.5529014438685285,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "83209",
                        "wf": 0.555,
                        "ad": 0.016265202565780085
                    }
                ]
            }
        ]
    },
    {
        "id": "co2",
        "name": "Carbon Dioxide",
        "formula": "CO₂",
        "category": "moderators-coolants",
        "density": 0.00184212,
        "atomDensity": 0.000075,
        "description": "Carbon dioxide at room conditions — coolant in Magnox and AGR reactors, and the working fluid of supercritical CO₂ power cycles.",
        "provenance": "PNNL-15870 Rev. 2, \"Carbon Dioxide\" (id carbon-dioxide): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.27291,
                "af": 0.333333,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.269751,
                        "ad": 0.0000249374
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.0031615,
                        "ad": 2.69716e-7
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.72709,
                "af": 0.666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.72512,
                        "ad": 0.0000502918
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000293559,
                        "ad": 1.91574e-8
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00167684,
                        "ad": 1.03349e-7
                    }
                ]
            }
        ]
    },
    {
        "id": "helium",
        "name": "Helium",
        "formula": "He",
        "category": "moderators-coolants",
        "density": 0.000166322,
        "atomDensity": 0.000025,
        "description": "Helium at room conditions — HTGR and VHTR coolant, and the fill gas in a fuel-cladding gap.",
        "provenance": "PNNL-15870 Rev. 2, \"Helium, Natural\" (id helium-natural): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "He",
                "z": 2,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "2003",
                        "wf": 0.00000100971,
                        "ad": 3.35323e-11
                    },
                    {
                        "zaid": "2004",
                        "wf": 0.999999,
                        "ad": 0.0000250241
                    }
                ]
            }
        ]
    },
    {
        "id": "concrete",
        "name": "Ordinary Concrete (Portland)",
        "category": "shielding",
        "density": 2.3,
        "atomDensity": 0.081429,
        "description": "Portland cement concrete — the primary biological shield in most reactor facilities.",
        "provenance": "PNNL-15870 Rev. 2, \"Concrete, Portland\" (id concrete-portland): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "lwtr"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.01,
                "af": 0.168753,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.00999736,
                        "ad": 0.0137398
                    },
                    {
                        "zaid": "1002",
                        "wf": 0.00000229789,
                        "ad": 0.00000158025
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.001,
                "af": 0.00141624,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.000988427,
                        "ad": 0.000114089
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.0000115844,
                        "ad": 0.00000123395
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.529107,
                "af": 0.562525,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.527673,
                        "ad": 0.0456943
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000213624,
                        "ad": 0.0000174061
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00122024,
                        "ad": 0.0000939015
                    }
                ]
            },
            {
                "sym": "Na",
                "z": 11,
                "wf": 0.016,
                "af": 0.0118382,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "11023",
                        "wf": 0.016,
                        "ad": 0.000963971
                    }
                ]
            },
            {
                "sym": "Mg",
                "z": 12,
                "wf": 0.002,
                "af": 0.00139968,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "12024",
                        "wf": 0.00155897,
                        "ad": 0.0000900277
                    },
                    {
                        "zaid": "12025",
                        "wf": 0.000205598,
                        "ad": 0.0000113974
                    },
                    {
                        "zaid": "12026",
                        "wf": 0.000235394,
                        "ad": 0.0000125485
                    }
                ]
            },
            {
                "sym": "Al",
                "z": 13,
                "wf": 0.033872,
                "af": 0.0213538,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "13027",
                        "wf": 0.033872,
                        "ad": 0.00173881
                    }
                ]
            },
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.337021,
                "af": 0.204119,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.309615,
                        "ad": 0.0153285
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.0162906,
                        "ad": 0.000778701
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.0111215,
                        "ad": 0.000513926
                    }
                ]
            },
            {
                "sym": "K",
                "z": 19,
                "wf": 0.013,
                "af": 0.00565571,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "19039",
                        "wf": 0.0120818,
                        "ad": 0.000429488
                    },
                    {
                        "zaid": "19040",
                        "wf": 0.00000155468,
                        "ad": 5.38828e-8
                    },
                    {
                        "zaid": "19041",
                        "wf": 0.000916627,
                        "ad": 0.000030995
                    }
                ]
            },
            {
                "sym": "Ca",
                "z": 20,
                "wf": 0.044,
                "af": 0.0186745,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "20040",
                        "wf": 0.0425312,
                        "ad": 0.00147412
                    },
                    {
                        "zaid": "20042",
                        "wf": 0.000298038,
                        "ad": 0.00000983852
                    },
                    {
                        "zaid": "20043",
                        "wf": 0.0000636696,
                        "ad": 0.00000205286
                    },
                    {
                        "zaid": "20044",
                        "wf": 0.00100664,
                        "ad": 0.0000317205
                    },
                    {
                        "zaid": "20046",
                        "wf": 0.00000201803,
                        "ad": 6.08255e-8
                    },
                    {
                        "zaid": "20048",
                        "wf": 0.0000984464,
                        "ad": 0.00000284359
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.014,
                "af": 0.00426428,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.00079038,
                        "ad": 0.0000202958
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.0128662,
                        "ad": 0.000318601
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.000302452,
                        "ad": 0.00000735789
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.0000409563,
                        "ad": 9.792e-7
                    }
                ]
            }
        ]
    },
    {
        "id": "baryte-concrete",
        "name": "Baryte Concrete",
        "category": "shielding",
        "density": 3.35,
        "atomDensity": 0.065468,
        "description": "High-density concrete with baryte (BaSO₄) aggregate, for gamma shielding where thickness is limited.",
        "provenance": "PNNL-15870 Rev. 2, \"Concrete, Barite (Type BA)\" (id concrete-barite-type-ba): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "lwtr"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.003585,
                "af": 0.109599,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.00358406,
                        "ad": 0.0071744
                    },
                    {
                        "zaid": "1002",
                        "wf": 8.23795e-7,
                        "ad": 8.25151e-7
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.311622,
                "af": 0.600196,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.310778,
                        "ad": 0.039198
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000125816,
                        "ad": 0.0000149315
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.000718672,
                        "ad": 0.0000805516
                    }
                ]
            },
            {
                "sym": "Mg",
                "z": 12,
                "wf": 0.001195,
                "af": 0.00151507,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "12024",
                        "wf": 0.000931486,
                        "ad": 0.0000783487
                    },
                    {
                        "zaid": "12025",
                        "wf": 0.000122845,
                        "ad": 0.00000991881
                    },
                    {
                        "zaid": "12026",
                        "wf": 0.000140648,
                        "ad": 0.0000109206
                    }
                ]
            },
            {
                "sym": "Al",
                "z": 13,
                "wf": 0.004183,
                "af": 0.00477738,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "13027",
                        "wf": 0.004183,
                        "ad": 0.000312764
                    }
                ]
            },
            {
                "sym": "Si",
                "z": 14,
                "wf": 0.010457,
                "af": 0.0114736,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "14028",
                        "wf": 0.00960666,
                        "ad": 0.000692736
                    },
                    {
                        "zaid": "14029",
                        "wf": 0.000505462,
                        "ad": 0.0000351916
                    },
                    {
                        "zaid": "14030",
                        "wf": 0.000345075,
                        "ad": 0.0000232257
                    }
                ]
            },
            {
                "sym": "S",
                "z": 16,
                "wf": 0.107858,
                "af": 0.103647,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "16032",
                        "wf": 0.10215,
                        "ad": 0.00644557
                    },
                    {
                        "zaid": "16033",
                        "wf": 0.000831739,
                        "ad": 0.0000508914
                    },
                    {
                        "zaid": "16034",
                        "wf": 0.00485562,
                        "ad": 0.000288385
                    },
                    {
                        "zaid": "16036",
                        "wf": 0.0000120974,
                        "ad": 6.78552e-7
                    }
                ]
            },
            {
                "sym": "Ca",
                "z": 20,
                "wf": 0.0501941,
                "af": 0.0385935,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "20040",
                        "wf": 0.0485185,
                        "ad": 0.00244934
                    },
                    {
                        "zaid": "20042",
                        "wf": 0.000339994,
                        "ad": 0.0000163473
                    },
                    {
                        "zaid": "20043",
                        "wf": 0.0000726326,
                        "ad": 0.00000341095
                    },
                    {
                        "zaid": "20044",
                        "wf": 0.00114835,
                        "ad": 0.0000527055
                    },
                    {
                        "zaid": "20046",
                        "wf": 0.00000230211,
                        "ad": 1.01065e-7
                    },
                    {
                        "zaid": "20048",
                        "wf": 0.000112305,
                        "ad": 0.0000047248
                    }
                ]
            },
            {
                "sym": "Fe",
                "z": 26,
                "wf": 0.047505,
                "af": 0.0262134,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "26054",
                        "wf": 0.00268193,
                        "ad": 0.000100308
                    },
                    {
                        "zaid": "26056",
                        "wf": 0.043658,
                        "ad": 0.00157462
                    },
                    {
                        "zaid": "26057",
                        "wf": 0.00102629,
                        "ad": 0.0000363649
                    },
                    {
                        "zaid": "26058",
                        "wf": 0.000138974,
                        "ad": 0.0000048395
                    }
                ]
            },
            {
                "sym": "Ba",
                "z": 56,
                "wf": 0.4634,
                "af": 0.103985,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "56130",
                        "wf": 0.000464661,
                        "ad": 0.00000721609
                    },
                    {
                        "zaid": "56132",
                        "wf": 0.000449556,
                        "ad": 0.00000687571
                    },
                    {
                        "zaid": "56134",
                        "wf": 0.0109213,
                        "ad": 0.000164541
                    },
                    {
                        "zaid": "56135",
                        "wf": 0.0300088,
                        "ad": 0.000448759
                    },
                    {
                        "zaid": "56136",
                        "wf": 0.0360185,
                        "ad": 0.000534672
                    },
                    {
                        "zaid": "56137",
                        "wf": 0.0518895,
                        "ad": 0.000764634
                    },
                    {
                        "zaid": "56138",
                        "wf": 0.333648,
                        "ad": 0.00488094
                    }
                ]
            }
        ]
    },
    {
        "id": "borated-poly",
        "name": "Borated Polyethylene (10% B)",
        "formula": "(CH₂)ₙ + B",
        "category": "shielding",
        "density": 1,
        "atomDensity": 0.119303,
        "description": "Polyethylene loaded with 10 wt% natural boron: hydrogen slows the neutrons down and B-10 absorbs them, in one material.",
        "provenance": "PNNL-15870 Rev. 2, \"Polyethylene, Borated\" (id polyethylene-borated): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "poly"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.125355,
                "af": 0.627756,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.125322,
                        "ad": 0.0748847
                    },
                    {
                        "zaid": "1002",
                        "wf": 0.0000288052,
                        "ad": 0.00000861273
                    }
                ]
            },
            {
                "sym": "B",
                "z": 5,
                "wf": 0.1,
                "af": 0.0466802,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "5010",
                        "wf": 0.0184267,
                        "ad": 0.00110825
                    },
                    {
                        "zaid": "5011",
                        "wf": 0.0815504,
                        "ad": 0.00446085
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.774645,
                "af": 0.325564,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.76568,
                        "ad": 0.0384253
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00897382,
                        "ad": 0.000415597
                    }
                ]
            }
        ]
    },
    {
        "id": "polyethylene",
        "name": "Polyethylene",
        "formula": "(CH₂)ₙ",
        "category": "shielding",
        "density": 0.93,
        "atomDensity": 0.119785,
        "description": "High-density polyethylene — the densest practical hydrogen source, and so an efficient neutron shield per centimetre.",
        "provenance": "PNNL-15870 Rev. 2, \"Polyethylene, Non-borated\" (id polyethylene-non-borated): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "sabNames": [
            "poly"
        ],
        "elements": [
            {
                "sym": "H",
                "z": 1,
                "wf": 0.143724,
                "af": 0.666667,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "1001",
                        "wf": 0.143686,
                        "ad": 0.0798478
                    },
                    {
                        "zaid": "1002",
                        "wf": 0.0000330262,
                        "ad": 0.00000918355
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.856276,
                "af": 0.333333,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.846366,
                        "ad": 0.0395013
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00991947,
                        "ad": 0.000427235
                    }
                ]
            }
        ]
    },
    {
        "id": "b4c-natural",
        "name": "B₄C (natural boron)",
        "formula": "B₄C",
        "category": "absorbers",
        "density": 2.52,
        "atomDensity": 0.137301,
        "description": "Boron carbide with natural boron (19.9 at% B-10) — control rod and shutdown absorber, and the most common burnable absorber outside the fuel.",
        "provenance": "PNNL-15870 Rev. 2, \"Boron Carbide\" (id boron-carbide): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "B",
                "z": 5,
                "wf": 0.782671,
                "af": 0.8,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "5010",
                        "wf": 0.144221,
                        "ad": 0.0218584
                    },
                    {
                        "zaid": "5011",
                        "wf": 0.638271,
                        "ad": 0.0879826
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.217329,
                "af": 0.2,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.214814,
                        "ad": 0.0271664
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00251763,
                        "ad": 0.000293825
                    }
                ]
            }
        ]
    },
    {
        "id": "b4c-enriched",
        "name": "B₄C (90% B-10 enriched)",
        "formula": "B₄C",
        "category": "absorbers",
        "density": 2.393,
        "atomDensity": 0.13734945522481048,
        "description": "Boron carbide enriched to 90 at% B-10, for control rods and shields that need maximum absorption per unit volume.",
        "provenance": "B₄C stoichiometry with boron enriched to 90 at% B-10. Density scaled from the compendium's natural boron carbide (2.52 g/cm³) by the molar-mass ratio, since enrichment changes the mass of the lattice and not its spacing.",
        "source": "derived",
        "elements": [
            {
                "sym": "B",
                "z": 5,
                "wf": 0.771054096700119,
                "af": 0.8,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "5010",
                        "wf": 0.6871113118282878,
                        "ad": 0.09889160776186356
                    },
                    {
                        "zaid": "5011",
                        "wf": 0.08394278487183124,
                        "ad": 0.010987956417984838
                    }
                ]
            },
            {
                "sym": "C",
                "z": 6,
                "wf": 0.228945903299881,
                "af": 0.20000000000000004,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.22629372813612092,
                        "ad": 0.027175963427985114
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.0026521751637600707,
                        "ad": 0.00029392761697698847
                    }
                ]
            }
        ]
    },
    {
        "id": "ag-in-cd",
        "name": "Ag-In-Cd Control Rod",
        "formula": "Ag-In-Cd",
        "category": "absorbers",
        "density": 10.17,
        "atomDensity": 0.05615227122641701,
        "description": "Silver–indium–cadmium alloy, the standard PWR control rod absorber. Absorbs across a wide energy range instead of relying on one resonance.",
        "provenance": "The standard PWR control rod alloy, 80-15-5 wt% Ag-In-Cd, with each element expanded over its natural isotopes. Density carried over from the previous NRDP entry; the alloy is not in the compendium.",
        "source": "derived",
        "elements": [
            {
                "sym": "Ag",
                "z": 47,
                "wf": 0.8000000000000002,
                "af": 0.8089810988593777,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "47107",
                        "wf": 0.4147120461376006,
                        "ad": 0.023758567382522952
                    },
                    {
                        "zaid": "47109",
                        "wf": 0.38528795386239956,
                        "ad": 0.021667558697673693
                    }
                ]
            },
            {
                "sym": "Cd",
                "z": 48,
                "wf": 0.05,
                "af": 0.0485268951946846,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "48106",
                        "wf": 0.0006249994065474522,
                        "ad": 0.000036143401032858664
                    },
                    {
                        "zaid": "48108",
                        "wf": 0.0004449998536869718,
                        "ad": 0.00002525770695145453
                    },
                    {
                        "zaid": "48110",
                        "wf": 0.00624499827402419,
                        "ad": 0.0003480124834487511
                    },
                    {
                        "zaid": "48111",
                        "wf": 0.006399997289540362,
                        "ad": 0.0003534303558959328
                    },
                    {
                        "zaid": "48112",
                        "wf": 0.012064998203241487,
                        "ad": 0.0006603256639171436
                    },
                    {
                        "zaid": "48113",
                        "wf": 0.006110004004401996,
                        "ad": 0.00033143837756195347
                    },
                    {
                        "zaid": "48114",
                        "wf": 0.014365004478732431,
                        "ad": 0.0007723979540050791
                    },
                    {
                        "zaid": "48116",
                        "wf": 0.003744998489825116,
                        "ad": 0.0001978894379346687
                    }
                ]
            },
            {
                "sym": "In",
                "z": 49,
                "wf": 0.15000000000000002,
                "af": 0.1424920059459375,
                "natural": false,
                "isotopes": [
                    {
                        "zaid": "49113",
                        "wf": 0.006435008298011686,
                        "ad": 0.00034906909577271113
                    },
                    {
                        "zaid": "49115",
                        "wf": 0.14356499170198833,
                        "ad": 0.007652180669699796
                    }
                ]
            }
        ]
    },
    {
        "id": "gd2o3",
        "name": "Gadolinium Oxide",
        "formula": "Gd₂O₃",
        "category": "absorbers",
        "density": 7.41,
        "atomDensity": 0.061550010658947815,
        "description": "Gadolinia burnable absorber, usually mixed into UO₂ pellets at a few weight percent. Gd-155 and Gd-157 have the largest thermal capture cross sections of any stable nuclides.",
        "provenance": "Gd₂O₃ stoichiometry with natural gadolinium (abundances from the compendium's gadolinium entries). Density carried over from the previous NRDP entry; the oxide is not in the compendium.",
        "source": "derived",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.13240794855038338,
                "af": 0.6,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.13204912635727742,
                        "ad": 0.03684026642847588
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000053459014765997586,
                        "ad": 0.00001403341491184917
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00030536317833996395,
                        "ad": 0.00007570655198095157
                    }
                ]
            },
            {
                "sym": "Gd",
                "z": 64,
                "wf": 0.8675920514496167,
                "af": 0.4,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "64152",
                        "wf": 0.0016763428525186303,
                        "ad": 0.000049240010642848734
                    },
                    {
                        "zaid": "64154",
                        "wf": 0.018512843603733307,
                        "ad": 0.0005367156847316839
                    },
                    {
                        "zaid": "64155",
                        "wf": 0.12650163193223313,
                        "ad": 0.0036437642052246605
                    },
                    {
                        "zaid": "64156",
                        "wf": 0.17609380703962776,
                        "ad": 0.005039713059046434
                    },
                    {
                        "zaid": "64157",
                        "wf": 0.13549476874126426,
                        "ad": 0.0038530304055961816
                    },
                    {
                        "zaid": "64158",
                        "wf": 0.2164309885333299,
                        "ad": 0.006115606766738694
                    },
                    {
                        "zaid": "64160",
                        "wf": 0.1928816687469097,
                        "ad": 0.005381934131598625
                    }
                ]
            }
        ]
    },
    {
        "id": "hafnium",
        "name": "Hafnium",
        "formula": "Hf",
        "category": "absorbers",
        "density": 13.31,
        "atomDensity": 0.044908368785910424,
        "description": "Hafnium metal control rod absorber. Used where a rod has to last: successive captures walk through the isotope chain and every step still absorbs.",
        "provenance": "Natural hafnium metal. The compendium has no hafnium at all, so the isotopic abundances and masses come from the IUPAC/AME tables listed in scripts/nrdp/compendium.mjs, and the density is carried over from the previous NRDP entry.",
        "source": "derived",
        "elements": [
            {
                "sym": "Hf",
                "z": 72,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "72174",
                        "wf": 0.00155925769422736,
                        "ad": 0.00007185339005745668
                    },
                    {
                        "zaid": "72176",
                        "wf": 0.051850402828095,
                        "ad": 0.0023621801981388883
                    },
                    {
                        "zaid": "72177",
                        "wf": 0.1843933343137589,
                        "ad": 0.00835295659417934
                    },
                    {
                        "zaid": "72178",
                        "wf": 0.2719727105525437,
                        "ad": 0.012251003004796363
                    },
                    {
                        "zaid": "72179",
                        "wf": 0.136551661328404,
                        "ad": 0.0061165198286409995
                    },
                    {
                        "zaid": "72180",
                        "wf": 0.35367263328297105,
                        "ad": 0.015753855770097375
                    }
                ]
            }
        ]
    },
    {
        "id": "eu2o3",
        "name": "Europium Oxide",
        "formula": "Eu₂O₃",
        "category": "absorbers",
        "density": 7.42,
        "atomDensity": 0.06348509742479183,
        "description": "Europia control and burnable absorber material, used in Russian reactor designs and in research reactor control elements.",
        "provenance": "Eu₂O₃ stoichiometry with natural europium (abundances from the compendium's europium-doped entries). Density carried over from the previous NRDP entry; the oxide is not in the compendium.",
        "source": "derived",
        "elements": [
            {
                "sym": "O",
                "z": 8,
                "wf": 0.13638669879981594,
                "af": 0.6,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.1360170942941226,
                        "ad": 0.037998497129863223
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.000055065414311215946,
                        "ad": 0.000014474615086874155
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00031453909138211294,
                        "ad": 0.00007808670992499775
                    }
                ]
            },
            {
                "sym": "Eu",
                "z": 63,
                "wf": 0.8636133012001841,
                "af": 0.4,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "63151",
                        "wf": 0.4100555795646347,
                        "ad": 0.012140897776393489
                    },
                    {
                        "zaid": "63153",
                        "wf": 0.45355772163554947,
                        "ad": 0.013253141193523247
                    }
                ]
            }
        ]
    },
    {
        "id": "air",
        "name": "Dry Air",
        "category": "gases",
        "density": 0.001205,
        "atomDensity": 0.00005,
        "description": "Dry air near sea level, for streaming paths, room modelling, and atmospheric transport.",
        "provenance": "PNNL-15870 Rev. 2, \"Air (dry, near sea level)\" (id air-dry-near-sea-level): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "C",
                "z": 6,
                "wf": 0.000124,
                "af": 0.000150193,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "6012",
                        "wf": 0.000122565,
                        "ad": 7.41179e-9
                    },
                    {
                        "zaid": "6013",
                        "wf": 0.00000143647,
                        "ad": 8.01639e-11
                    }
                ]
            },
            {
                "sym": "N",
                "z": 7,
                "wf": 0.755268,
                "af": 0.784429,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "7014",
                        "wf": 0.752316,
                        "ad": 0.0000389865
                    },
                    {
                        "zaid": "7015",
                        "wf": 0.00294413,
                        "ad": 1.42429e-7
                    }
                ]
            },
            {
                "sym": "O",
                "z": 8,
                "wf": 0.231781,
                "af": 0.21075,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "8016",
                        "wf": 0.231153,
                        "ad": 0.0000104871
                    },
                    {
                        "zaid": "8017",
                        "wf": 0.0000935803,
                        "ad": 3.99481e-9
                    },
                    {
                        "zaid": "8018",
                        "wf": 0.00053454,
                        "ad": 2.15509e-8
                    }
                ]
            },
            {
                "sym": "Ar",
                "z": 18,
                "wf": 0.012827,
                "af": 0.00467114,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "18036",
                        "wf": 0.0000385272,
                        "ad": 7.7731e-10
                    },
                    {
                        "zaid": "18038",
                        "wf": 0.00000766722,
                        "ad": 1.46561e-10
                    },
                    {
                        "zaid": "18040",
                        "wf": 0.0127807,
                        "ad": 2.32083e-7
                    }
                ]
            }
        ]
    },
    {
        "id": "argon",
        "name": "Argon",
        "formula": "Ar",
        "category": "gases",
        "density": 0.00166201,
        "atomDensity": 0.000025,
        "description": "Argon at room conditions — cover gas above sodium in an SFR, where it keeps air away from the coolant.",
        "provenance": "PNNL-15870 Rev. 2, \"Argon\" (id argon): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "Ar",
                "z": 18,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "18036",
                        "wf": 0.0030036,
                        "ad": 8.35825e-8
                    },
                    {
                        "zaid": "18038",
                        "wf": 0.000597741,
                        "ad": 1.57594e-8
                    },
                    {
                        "zaid": "18040",
                        "wf": 0.996394,
                        "ad": 0.0000249554
                    }
                ]
            }
        ]
    },
    {
        "id": "nitrogen",
        "name": "Nitrogen",
        "formula": "N₂",
        "category": "gases",
        "density": 0.00116528,
        "atomDensity": 0.00005,
        "description": "Nitrogen at room conditions, for inerting containment and fuel handling areas.",
        "provenance": "PNNL-15870 Rev. 2, \"Nitrogen\" (id nitrogen): density and full isotopic composition are taken from the compendium unchanged.",
        "source": "pnnl",
        "elements": [
            {
                "sym": "N",
                "z": 7,
                "wf": 1,
                "af": 1,
                "natural": true,
                "isotopes": [
                    {
                        "zaid": "7014",
                        "wf": 0.996091,
                        "ad": 0.000049918
                    },
                    {
                        "zaid": "7015",
                        "wf": 0.00389812,
                        "ad": 1.82365e-7
                    }
                ]
            }
        ]
    }
] as NrdpLibraryMaterial[];
