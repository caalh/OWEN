OWEN v1.3 geometry showcase — CSG primitive gallery
c owen: line-limit=128
c ---------------------------------------------------------------------------
c Paste this into OWEN (Geometry Preview) or https://reactormc.net/belvoirdynamics/visualizer
c No lat/fill/u hierarchy — that is what selects the exact CSG engine over
c the pin-lattice fast path.
c
c 3D colour by material:
c   gold    UO2 spheres, LIKE/TRCL copies, ellipsoid
c   cyan    water torus (tz, lying down)
c   grey    steel chimney, HEX, BOX, standing torus (ty), REC
c   blue    zircaloy off-axis channels (c/x, c/y) + annulus
c   mauve   graphite TRC pedestal + WED
c   black   B4C union-dumbbell + ARB
c
c 2D slice: xy at z=0 for the floor plan; xy at z=8 catches the x-channel
c and the standing torus (the y-channel sits at z=-8 so the two channels
c never cross). Solids are disjoint — no magenta overlap.
c
c The ARB card is 121 columns; dialect 128 should not warn.
c Not verified by execution (no MCNP on this machine). .80c = ENDF/B-VII.1.
c Closed and finite: graveyard 99, ksrc inside cell 1.
c ---------------------------------------------------------------------------
c ---- Cell Cards ----
1   1 -10.97  -1                    imp:n=1  $ UO2 sphere at origin
2   2  -0.998 -2                    imp:n=1  $ water torus (tz)
3   3  -7.92  -3                    imp:n=1  $ steel chimney
4   6  -1.70  -4                    imp:n=1  $ graphite TRC pedestal
5   4  -6.56  -5  7 -8              imp:n=1  $ zircaloy channel // x
6   4  -6.56  -6  9 -10             imp:n=1  $ zircaloy channel // y
7   3  -7.92  -11                   imp:n=1  $ steel HEX can
8   6  -1.70  -12                   imp:n=1  $ graphite wedge
9   3  -7.92  -13                   imp:n=1  $ steel BOX
10  like 1 but trcl=(0 26 0)                 $ UO2 pebble +y (inline TRCL)
11  like 1 but trcl=(0 -26 0)                $ UO2 pebble -y
12  5  -2.52  (-15:-16)             imp:n=1  $ B4C union (dumbbell)
13  4  -6.56  -17 18 -20 19         imp:n=1  $ zircaloy annulus
14  3  -7.92  -21                   imp:n=1  $ steel standing torus (ty)
15  5  -2.52  -14                   imp:n=1  $ B4C ARB (sheared box, 121 cols)
16  1 -10.97  -23                   imp:n=1  $ UO2 ellipsoid pebble
17  3  -7.92  -22                   imp:n=1  $ steel REC (elliptic cylinder)
18  like 1 but trcl=1                        $ UO2 pebble via named *TR1
90  0         -100 (#1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #13 #14 #15 #16 #17 #18) imp:n=1
99  0          100                  imp:n=0  $ graveyard

c ---- Surface Cards ----
1   so  4.5
2   tz  0 0 0  9.5 1.4 1.4
3   rcc 0 0 6.2  0 0 12  2.0
4   trc 0 0 -18  0 0 10  6.5 2.2
5   c/x 14 8 1.35
6   c/y -14 -8 1.35
7   px -38
8   px  38
9   py -32
10  py  32
11  hex 26 0 -8  0 0 16  0 5 0
12  wed -28 -10 -8  10 0 0  0 10 0  0 0 14
13  box -30 12 -6  10 0 0  0 10 0  0 0 12
14  arb 18 -26 -6  28 -26 -6  30 -16 -6  20 -16 -6  18 -26 6  28 -26 6  30 -16 6  20 -16 6  1432 5678 1265 4378 1584 2376
15  s   -24 22 12  3.2
16  s   -18 22 12  3.2
17  c/z 22 18 3.0
18  c/z 22 18 2.1
19  pz -8
20  pz  8
21  ty  0 32 8  6 1.25 1.25
22  rec 10 -30 -6  0 0 12  2.6 0 0  1.3
23  ell -14 26 0  5 0 0  -2.2
100 rpp -42 42 -38 38 -22 20

c ---- Data Cards ----
c *TR1 is translation-only (no matrix → identity rotation). Cell 18
c references it with trcl=1 — the named-transform form of LIKE n BUT.
*tr1  32 26 0
mode n
kcode 1000 1.0 20 50
ksrc 0 0 0
m1  92235.80c 0.045  92238.80c 0.955  8016.80c 2.0   $ UO2 4.5 at%
m2  1001.80c 2.0  8016.80c 1.0                       $ light water
mt2 lwtr.20t
m3  26056.80c 0.70  24052.80c 0.20  28058.80c 0.10   $ SS (Fe/Cr/Ni)
m4  40090.80c 1.0                                   $ zircaloy stand-in
m5  5010.80c 4.0  6000.80c 1.0                      $ B4C
m6  6000.80c 1.0                                    $ graphite
print
