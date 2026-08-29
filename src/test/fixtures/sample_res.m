% Synthetic Serpent 2 _res.m in the real indexed-assignment layout.
% Two burnup steps, so every entry appears twice (Serpent appends a block
% per step and MATLAB accumulates them through the idx counter).

% Increase counter:

if (exist('idx', 'var'));
  idx = idx + 1;
else;
  idx = 1;
end;

% Version, title and date:

VERSION                   (idx, [1: 14])  = 'Serpent 2.1.32' ;
COMPILE_DATE              (idx, [1: 20])  = 'Nov 11 2021 09:00:00' ;
TITLE                     (idx, [1:  8])  = 'Pin cell' ;
INPUT_FILE_NAME           (idx, [1:  6])  = 'pin.in' ;

% Run statistics:

TOT_CPU_TIME              (idx, 1)        =  1.23456E+01 ;
RUNNING_TIME              (idx, 1)        =  2.10000E+00 ;
CYCLE_IDX                 (idx, 1)        = 500 ;
BURNUP                    (idx, [1:  2])  = [  0.00000E+00  0.00000E+00 ];

% Criticality eigenvalues:

ANA_KEFF                  (idx, [1:   6]) = [  1.34728E+00 0.00091  1.34701E+00 0.00104  1.34755E+00 0.00112 ];
IMP_KEFF                  (idx, [1:   2]) = [  1.34721E+00 0.00095 ];
COL_KEFF                  (idx, [1:   2]) = [  1.34718E+00 0.00093 ];
ABS_KEFF                  (idx, [1:   2]) = [  1.34715E+00 0.00090 ];
ABS_KINF                  (idx, [1:   2]) = [  1.34715E+00 0.00090 ];

% Neutron balance:

TOT_FISSRATE              (idx, [1:   2]) = [  6.74215E-01 0.00083 ];
TOT_CAPTRATE              (idx, [1:   2]) = [  3.25933E-01 0.00121 ];
CONVERSION_RATIO          (idx, [1:   2]) = [  5.12340E-01 0.00214 ];

% Increase counter:

if (exist('idx', 'var'));
  idx = idx + 1;
else;
  idx = 1;
end;

VERSION                   (idx, [1: 14])  = 'Serpent 2.1.32' ;
TOT_CPU_TIME              (idx, 1)        =  2.46912E+01 ;
CYCLE_IDX                 (idx, 1)        = 500 ;
BURNUP                    (idx, [1:  2])  = [  1.00000E+01  1.02000E+01 ];

ANA_KEFF                  (idx, [1:   6]) = [  1.28450E+00 0.00098  1.28420E+00 0.00110  1.28480E+00 0.00119 ];
IMP_KEFF                  (idx, [1:   2]) = [  1.28443E+00 0.00101 ];
COL_KEFF                  (idx, [1:   2]) = [  1.28440E+00 0.00099 ];
ABS_KEFF                  (idx, [1:   2]) = [  1.28438E+00 0.00097 ];
ABS_KINF                  (idx, [1:   2]) = [  1.28438E+00 0.00097 ];

TOT_FISSRATE              (idx, [1:   2]) = [  6.70110E-01 0.00089 ];
TOT_CAPTRATE              (idx, [1:   2]) = [  3.29890E-01 0.00126 ];
CONVERSION_RATIO          (idx, [1:   2]) = [  5.98120E-01 0.00231 ];
