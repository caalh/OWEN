c MCNP split-file lattice — pin universe lives in an include.
c Without expanding READ, Cell Map reports fill=1 as an undeclared universe.
c READ is in the cell block, so the include is cells only (MCNP inlines as-is).
read file = pins.i
10 0  -20 21 -22 23 fill=1 imp:n=1
11 0        20:-21:22:-23     imp:n=0

1 cz 0.40
2 cz 0.50
20 px 0.63
21 px -0.63
22 py 0.63
23 py -0.63

mode n
kcode 500 1.0 10 30
ksrc 0 0 0
m1 92235.80c 0.04 92238.80c 0.96 8016.80c 2.0
m2 40090.80c 1.0
m3 1001.80c 2.0 8016.80c 1.0
mt3 lwtr.20t
