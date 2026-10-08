/* Plain standard-library modules: they already exist in Python, so all they need is to be importable and have autocomplete.
   (pathlib works on the run's temporary folder, which is the working directory and is deleted when the run ends.) */
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
PyLibs.add({
  name: 'pathlib',
  members: 'Path PurePath PurePosixPath PureWindowsPath',
  // after "p." when we don't know what p is (a Path): methods, and the attributes people reach for
  methods: 'read_text write_text read_bytes write_bytes exists is_file is_dir mkdir iterdir glob rglob unlink rmdir rename replace touch stat resolve absolute expanduser joinpath with_name with_suffix with_stem relative_to is_relative_to samefile cwd home stem suffix suffixes parent parents',
});
PyLibs.add({
  name: 'typing',
  members: 'Any Callable ClassVar Final Generic Literal Optional Protocol Tuple Type TypeVar Union List Dict Set FrozenSet Deque DefaultDict OrderedDict Counter ChainMap Iterable Iterator Generator Sequence MutableSequence Mapping MutableMapping AbstractSet Collection Container Hashable Sized Reversible Awaitable Coroutine AsyncIterator NamedTuple TypedDict NoReturn Never Self Annotated TypeAlias ParamSpec Concatenate TypeGuard NewType AnyStr Text IO TextIO BinaryIO LiteralString Required NotRequired Unpack TypeVarTuple cast overload final runtime_checkable get_type_hints get_args get_origin assert_type assert_never reveal_type no_type_check TYPE_CHECKING',
});
