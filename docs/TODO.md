
Strategy presets - to the strategy intent tab, add presets so users can just choose that, the presets are common settings traders will want to use, investigate 

when a user closes and reopens, make them click "resume" session before starting the session again.

seeing this error on agent feed:
```
Agent Feed
live
ERROR
01:29
Trade cycle failed: Provider unreachable: No object generated: response did not match schema.
ERROR
01:29
Trade cycle failed: Provider unreachable: No object generated: response did not match schema.
ERROR
01:24
Trade cycle failed: Provider unreachable: No object generated: response did not match schema.
ERROR
01:23
Trade cycle failed: Provider unreachable: No object generated: response did not match schema.
INFO
01:22
Session started.
``` , even when everything is working

Token usage seems to not be tracked properly, opencode says 0.01 cent of credits was used while my dashboard says 0.18 or something

Make sure we are actully cycling during a session. Make sure to add logs that the "session is waiting for trade to close" at the end, and "session is starting bsck up after trade closure", etc 



