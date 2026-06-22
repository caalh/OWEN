17x17 PWR fuel assembly - OWEN 3D geometry preview test fixture (viz only)
c =====================================================================
c Westinghouse 17x17 PWR assembly: 264 UO2 pins, 24 guide tubes, 1
c central instrument tube. Pitch 1.26 cm; pellet/gap/clad radii
c 0.39218 / 0.40005 / 0.45720 cm (BEAVRS-like). 3.1% enriched UO2.
c NOT a converged/runnable model - geometry & materials are physically
c sane but the kcode block is nominal. ZAID library assumed .80c
c (ENDF/B-VII.1). Open in OWEN: "OWEN: Open 3D Geometry Preview".
c =====================================================================
c ----- Fuel pin (universe 1) -----
1  1 -10.40    -1       u=1  imp:n=1   $ UO2 pellet
2  2 -0.00159   1 -2    u=1  imp:n=1   $ He gap
3  3 -6.55      2 -3    u=1  imp:n=1   $ Zircaloy clad
4  4 -0.74      3       u=1  imp:n=1   $ borated water
c ----- Guide tube (universe 2) -----
5  4 -0.74     -4       u=2  imp:n=1   $ inner water
6  3 -6.55      4 -5    u=2  imp:n=1   $ Zircaloy guide tube
7  4 -0.74      5       u=2  imp:n=1   $ outer water
c ----- Instrument tube (universe 3) -----
8  5 -0.00120  -6       u=3  imp:n=1   $ air (central thimble)
9  3 -6.55      6 -7    u=3  imp:n=1   $ Zircaloy thimble
10 4 -0.74      7 -8    u=3  imp:n=1   $ water annulus
11 3 -6.55      8 -9    u=3  imp:n=1   $ Zircaloy guide tube
12 4 -0.74      9       u=3  imp:n=1   $ outer water
c ----- 17x17 square lattice (universe 10), pitch 1.26 -----
20 0  50 -51 52 -53  lat=1 u=10 imp:n=1
     fill=0:16 0:16 0:0
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  1  1  2  1  1  2  1  1  2  1  1  1  1  1
      1  1  1  2  1  1  1  1  1  1  1  1  1  2  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  2  1  1  2  1  1  2  1  1  2  1  1  2  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  2  1  1  2  1  1  3  1  1  2  1  1  2  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  2  1  1  2  1  1  2  1  1  2  1  1  2  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  2  1  1  1  1  1  1  1  1  1  2  1  1  1
      1  1  1  1  1  2  1  1  2  1  1  2  1  1  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
      1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
c ----- Assembly window + graveyard -----
30 0  -60  fill=10  imp:n=1
31 0   60           imp:n=0

c ===================== SURFACES =====================
1  cz 0.39218
2  cz 0.40005
3  cz 0.4572
4  cz 0.56134
5  cz 0.60198
6  cz 0.43688
7  cz 0.48387
8  cz 0.56134
9  cz 0.60198
50 px -0.63
51 px  0.63
52 py -0.63
53 py  0.63
60 rpp -10.71 10.71 -10.71 10.71 -182.88 182.88

c ===================== DATA =====================
mode n
m1  92235.80c 0.03100 92238.80c 0.96900 8016.80c 2.0     $ UO2 3.1 wt% (atom fractions approx)
m2  2004.80c 1.0                              $ helium gap
m3  40090.80c 0.5145 40091.80c 0.1122 40092.80c 0.1715 40094.80c 0.1738 40096.80c 0.0280  $ Zircaloy-4 clad
m4  1001.80c 2.0 8016.80c 1.0                 $ light water
mt4 lwtr.20t                                  $ S(a,b) H in H2O
m5  7014.80c 0.78 8016.80c 0.21 18040.80c 0.01 $ air
kcode 5000 1.0 30 130
ksrc 0 0 0
