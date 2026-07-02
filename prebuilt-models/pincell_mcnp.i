BEAVRS 3.1 wt% UO2 pin cell, reflected (k-infinity) - OWEN teaching deck
c =====================================================================
c "Hello world" PWR pin cell: a single BEAVRS-spec fuel pin in a
c 1.26 cm square water cell with REFLECTIVE boundaries on all six
c faces, so kcode converges to the infinite-lattice k-inf.
c
c GEOMETRY (BEAVRS rev 2.0.2 fuel pin):
c   fuel pellet r 0.39218 / clad inner r 0.40005 / clad outer r 0.45720
c   pin pitch 1.26 cm; active height 365.76 cm (z = 0 -> 365.76)
c MATERIALS: number densities identical to the BEAVRS full-core deck
c   (3.1 wt% UO2, He gap, Zircaloy-4, 975 ppm borated water, HFP).
c   Cell densities are POSITIVE atoms/b-cm (= per-material sums).
c LIBRARY NOTE: ZAIDs use .80c (ENDF/B-VII.1, 293.6 K). The BEAVRS HFP
c   state is 600 K, so expect a cross-library/temperature k bias; for
c   600 K work substitute a hot library (e.g. .81c/.82c) or tmp cards.
c   lwtr.20t S(a,b) is on WATER ONLY (never on UO2/steel).
c EXPECTED k-inf: ~1.23 +/- 0.02. Companion OpenMC deck
c   (pincell_openmc.py) gives 1.2256 +/- 0.0010 with ENDF/B-VIII.0
c   (600 K neutron data); this MCNP deck is spec-derived and NOT
c   run-verified (and .80c is a 294 K library - see note above).
c =====================================================================
c --- Cell cards ---
1 1 6.88510e-2  -1        11 -12   imp:n=1   $ UO2 3.1 wt% fuel pellet
2 2 2.40440e-4   1 -2     11 -12   imp:n=1   $ He gap
3 3 4.34389e-2   2 -3     11 -12   imp:n=1   $ Zircaloy-4 clad
4 4 7.41863e-2   3 4 -5 6 -7 11 -12 imp:n=1  $ borated water (975 ppm)
5 0            -4:5:-6:7:-11:12    imp:n=0   $ outside world

c --- Surface cards (* = reflective) ---
1  cz 0.39218      $ fuel pellet OR
2  cz 0.40005      $ clad IR
3  cz 0.45720      $ clad OR
*4 px -0.63        $ cell boundary (pitch 1.26)
*5 px  0.63
*6 py -0.63
*7 py  0.63
*11 pz 0.0         $ bottom of active fuel
*12 pz 365.76      $ top of active fuel

c --- Data cards ---
mode n
kcode 5000 1.0 50 250
c Source point at pin axis, mid-height (inside the fuel pellet).
ksrc 0 0 182.88
c UO2-31 (atom density sum = 6.88510e-2 atoms/b-cm)
m1   8016.80c     4.58530e-2
     8017.80c     1.74200e-5
     92234.80c    5.79870e-6
     92235.80c    7.21750e-4
     92238.80c    2.22530e-2
c Helium (atom density sum = 2.40440e-4 atoms/b-cm)
m2   2003.80c     4.80890e-10
     2004.80c     2.40440e-4
c Zircaloy (atom density sum = 4.34389e-2 atoms/b-cm)
m3   24050.80c    3.29620e-6
     24052.80c    6.35640e-5
     24053.80c    7.20760e-6
     24054.80c    1.79410e-6
     26054.80c    8.66980e-6
     26056.80c    1.36100e-4
     26057.80c    3.14310e-6
     26058.80c    4.18290e-7
     8016.80c     3.07440e-4
     8017.80c     1.16800e-7
     50112.80c    4.67350e-6
     50114.80c    3.17990e-6
     50115.80c    1.63810e-6
     50116.80c    7.00550e-5
     50117.80c    3.70030e-5
     50118.80c    1.16690e-4
     50119.80c    4.13870e-5
     50120.80c    1.56970e-4
     50122.80c    2.23080e-5
     50124.80c    2.78970e-5
     40090.80c    2.18280e-2
     40091.80c    4.76010e-3
     40092.80c    7.27590e-3
     40094.80c    7.37340e-3
     40096.80c    1.18790e-3
c Borated water, 975 ppm (atom density sum = 7.41863e-2 atoms/b-cm)
m4   1001.80c     4.94560e-2
     5010.80c     7.97140e-6
     5011.80c     3.22470e-5
     1002.80c     7.70350e-6
     8016.80c     2.46730e-2
     8017.80c     9.37340e-6
mt4  lwtr.20t
prdmp j 250 1 2
