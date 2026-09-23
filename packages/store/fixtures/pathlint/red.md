# pathlint red fixture — every numbered line below MUST produce a violation.
# Lines marked [info] produce an info surfaced-skip in ADDITION to the violation.

Bare drive path C:\Users\me\file.txt here
Forward-slash drive D:/work/repo/README.md trailing
POSIX home /Users/alice/docs/file.md inline
POSIX tmp /tmp/build-output.log tail
POSIX home-alt /home/bob/.config/x.yml here
AppData bare segment foo AppData\Local\x tail
Win envvar %TEMP%/scratch/file.md tail
Win envvar backslash %APPDATA%\vendor\bin tail
POSIX envvar $HOME/.config/app.toml tail
POSIX envvar brace ${TMPDIR}/run/out.log tail
Tilde ~/.anysearch-cli/session tail
Tilde backslash ~\Documents\x.doc tail
UNC \\share\dir\file.txt tail
UNC wsl \\wsl.localhost\distro\etc\hosts tail
Escape instance adr-0042: %TEMP%/atomcode-r39-sources.txt
Escape instance r77: %TEMP%/r77-scratch-snap-20260922-172728
Inline code is NOT exempt: `%LOCALAPPDATA%/vendor/x`
In-repo ref must be relative: D:/Repo/Root/docs/x.md tail
Malformed marker %TEMP%/x <!-- machine-local: @ 2026-09-22 -->
<!-- machine-local: guards nothing on this line @ 2026-09-22 -->
<!-- machine-local: covers an empty block @ 2026-09-22 -->
```text
plain text inside, no paths at all
```
Unmarked fence:
```text
%TEMP%/unmarked-fence-hit.txt
```
Neighbor control: unmarked fence with in-repo ref still violates (fence not covered):
```text
D:/Repo/Root/docs/x.md inside unmarked fence
```
