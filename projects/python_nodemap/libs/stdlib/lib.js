/* Plain standard-library modules: they already exist in Python, so all they need is to be importable and have autocomplete. */
PyLibs.add({
  name: 'random',
  members: 'random randint randrange choice choices sample shuffle uniform gauss seed getrandbits triangular normalvariate expovariate',
});
PyLibs.add({
  name: 'math',
  members: 'pi e tau inf nan sqrt pow exp log log2 log10 sin cos tan asin acos atan atan2 sinh cosh tanh floor ceil trunc fabs factorial gcd lcm comb perm hypot isclose isnan isinf degrees radians fsum prod dist copysign fmod modf',
});
PyLibs.add({
  name: 'time',
  members: 'time sleep perf_counter monotonic process_time time_ns strftime localtime gmtime ctime asctime mktime',
});
PyLibs.add({
  name: 'enum',
  members: 'Enum IntEnum Flag IntFlag StrEnum auto unique',
});
