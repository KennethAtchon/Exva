Research and solve this problem: How do I make the AI good at researching ( using web search tools and searching the web) , how does opencode and claude code do research?

Subproblem: How do I make an AI good at reasoning when it finds the data and sorting the data.

Read these all:
/Users/ken/Documents/workspace/Exva/docs/reviews/hello-json-run-post-mortem-2026-05-17.md
/Users/ken/Documents/workspace/Exva/docs/reviews/research-prompt-review.md
/Users/ken/Documents/workspace/Exva/docs/reviews/system-review.md

We will need to refractor our /Users/ken/Documents/workspace/Exva/docs/engineering/ai-model-configuration-guide.md approach entirely to make a system that actually works repeatedly.

I looked at opencode's source code: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/websearch.ts, they delegate their web searching to MCP servers, who have the ability to handle the web search correctly. We can add the MCPs has alternatives and migrate to them at a lower date if they cost money. 

We shouldn't be putting tools in the system prompt, very hard to maintain, the AI should already know about them from description.

This isn't a patch, this is a full on re-architecture. I think it would be better to delete the current runtime code. Replace it with new pattern of doing things that we design. Make it more scalable and easier to edit. 

-------

After you collect all the information, work on creating a spec with /Users/ken/Documents/workspace/Exva/docs/design/product-spec-template.md. In my opinion, we should keep sticking with our own orchestrator because it will be the easiest to edit and control things. What we need to do is split everything from prompt and let code handle it instead like the review docs suggest. We then need to redesign a system in a way thats very scalable - plug and play style. Right now I believe the system is a bunch of independent functions where you have to write a new function to do anything. I want it to be more like config based, where you can just change a config, a new "subagent" pops up and does your task. And instead of treating these as BIG agents (researcher, selector, blah), we can treat them as groups. That way we can dive into each phase and divide their work into subagents to parallelize it and make it much better. What I'm suggesting is a very big refractor that changes the current posture of the code. This will prevent things like the researcher failing multiple times and having to restart everything with a new prompt.

The future of AI is having 100s of them do 1 thing very well, and they pass those 100 results to 10 ai, they consolidate and do their job, then pass it to 1 ai that consolidates and gives the output. This is all just my opinion. 



-------




