1. Is the AI searching in the right places? Are the searches not obvious/low quality, will it actually find good instruments to invest it?
2. How much is the fault of the mock search attributed to the AI model, how much is the fault of the prompting and tool configuration.
3. Web search only returns a single URL. Why? Can we make it return multiple? How do we know the AI read the contents of the url?
4. Mock data needs to be setup in a way that makes trades advantages, we don't want to KEEP passing on trades for mock trades. Maybe we will need to connect a real broker...First, I want to setup mock data in a way that allows us to trade and not always returning nothing for instrument selection. I want to actually test it works.
5. Can we remove "preview" terminology and functionality, truncating the AI output is really really bad because I can't debug it as effectively. These won't bloat the logs because we have a 7 day retention period and we can always tune the truncating once we have data. Also isn't the AI output saved in our database anyways ~ stop truncating. 
6. Please add the role name of the agent to logs
7. Enhance the developer portal to include more information about what the AI considered for a trade and why it didnt go through with the trade. Right now it doesnt really tell you exactly what happened.

Read hello.json, right now the system is failing because all of the reasons listed above. 