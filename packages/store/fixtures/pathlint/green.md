# pathlint green fixture — NO line below may produce a violation.

Bare env-var prose: set %PATH% first, inspect %TEMP% later — no separator, not locators
POSIX prose: $HOME and ${TMPDIR} are variable names here
Bare tilde prose: ~50% approximate, or a lone ~ marker
URL shielded by boundary: https://example.com/tmp/x and https://host/Users/u/avatar
Marked same-line: %TEMP%/x <!-- machine-local: green fixture marker @ 2026-09-22 -->
Marked envvar $HOME/x mid-line <!-- machine-local: green fixture marker @ 2026-09-22 -->
Locator class line:
Stack: D:\work\repo\file.ts @ deadbeef
Multi-segment unknown POSIX root is out of registered scope: /var/log/syslog and /d/Aworker/x
Single-segment POSIX root /etc is info surfaced-skip, never a violation
<!-- machine-local: transcript excerpt cover @ 2026-09-22 -->
```text
%TEMP%/inside-marked-fence.txt and ~/covered/tilde
```
Marker-free fence with no paths:
```text
plain code block, nothing local
```
Marked UNC \\host\share\x <!-- machine-local: green fixture marker @ 2026-09-22 -->
Marked AppData AppData\Roaming\x <!-- machine-local: green fixture marker @ 2026-09-22 -->
Exemption domain: marker-covered fence skips ALL checks (in-repo abs path + /x inside):
<!-- machine-local: covered transcript excerpt @ 2026-09-23 -->
```text
%TEMP%/covered-hit.txt plus /etc and D:/Repo/Root/docs/x.md verbatim
```
Exemption domain: /x info also silent inside UNMARKED fence (content is verbatim excerpt):
```text
plain excerpt with /tmp verbatim
```
Exemption domain: locator line exempts in-repo ref and /x info:
Stack: D:/Repo/Root/docs/x.md /etc @ abc1234
