WHy I'm I seeing this:

selector failed: Stage 'verification' in phase 'selector' produced insufficient successful workers (0/1). Rejections: [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ] | [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ] | [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ]

In a session with the experience - Mean Reversion

23:48
INFO
session
[session]Session stopped.

23:48
ERROR
orchestrator
cyc·f383d
[orchestrator]selector failed: Stage 'verification' in phase 'selector' produced insufficient successful workers (0/1). Rejections: [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ] | [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ] | [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "candidate" ], "message": "Required" } ]

23:46
INFO
orchestrator
[orchestrator]No-trade cycle complete; scheduling selector research cycle.

23:41
INFO
orchestrator
cyc·b770c
[orchestrator]No trade decision for BTC-USD; cycle complete.

23:41
INFO
orchestrator
[orchestrator]Signal delivery queued; 1 cycles enqueued.

23:40
INFO
session
[session]Session runtime ready.

23:40
INFO
session
[session]Session starting...

23:40
INFO
session
[session]Session created: Reversion

The experience mean reversion is suppose to be automatic? Why would a stage be failing at verification?? I dont get whats going on...check the logs associated...can you explain to me whats going on?

------


Why is, in the developer workbench, we have the ID ontop of the little [orchestractor] indicator? The UI is broken here, can u fix it? And add a "copy all logs/events" like session stopped.


