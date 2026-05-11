We need to do a full audit of strategy system (how we reject system prompt, the UI for it, how presets works etc). 

We need to answer these questions
1. We basically inject everything into system prompt and the user prompt is just so the user responds, is there a better way of doing this? For the code part: Is there a way we can simply the code that does this logic to make it more reusable or use a design pattern?
2. The presets needs to work differently I feel. We define presets for certain things like style and rules but not for risk. We can either make a global preset system that basically orchestractes the sub-presets, and we can add a preset to all the major "oil change" fields like 
Style
Rules
Risk
Timeframe
Role profiles
3. A global preset that is just a click and done, that auto selects everything the user needs to properly change that preset will be good, we can also allow users to add their own global presets or edit the existing ones somehow. So the "global" preset is basically a wrapper onto of the sub  presets.
4. Redesign the UI, it looks ugly, the layout is the main problem, we need a better way for this all to look like. Give me a new layout that will match the new branding. I want the strategy tab to be: 
First and foremost, we can go there, click a button, get our presets and be done with configuring.
If we need to dive further, we can create a global preset, or edit an existing one. From there we can fill the fields and etc, basically make it friction less, the AI roles thing adds a lot of friction. Can we add a default AI model so users dont have to add it in whenever they create a session - make the one for openrouter a gemma 31b.
