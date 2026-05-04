Need to test some things first and refine the goals of certain things

Strategy - This can be a catch all for how we want agents to behave, risk management, search etc
or maybe theres a way to split this up into concept

For strategies what I want is
- Regular position management details
- Higher level details - system prompt for users
- How the AI should go about trading (are we shorting, long, arbitage, all the different strategies )
- We need to do deeper research for the strategy session

We need to figure out its current state, and make it fully fleshed out. I want to give the user peak customizability, can you believe a markdown file that does a deep dive into this with research?


Another markdown is do research on how to build a good harness for an AI model.
Harness are tools like claude code and opencode, they do tool calls, they orchestrate different subagents, they do system prompting etc. They basically make it very easy to use the AI. We need to create a harness and make it specifically suited for analyses of stocks. We need to hook it up to yahoo finance, web search and other things (look up how to perfect this process and the best way to go about this).
The harness we create can make or break our implementation of this AI model.
What needs to happen, flow of a session: 
The first like 10-20 minutes the bot army/farm will talk amongst themself, the researcher will do research, the stock picker will pick the stock, etc. Once the stock is picked with the price, we need a dumber model, whos only jump is...given instructions from one of the smarter models, just monitors the situation (idk if this is the best approach, we can maybe automate it?) The worst that can happen is our stop loss is breached right? We shouldnt be relying on doing in-trade adjustments right? So a long running checker bot...is it really needed? these are the questions we need to answer in the doc.
If the wait is over, win or loss, we track it down, and do it again, do the research again.

Also all information is gathered and stored so we can do an autopsy of the decisions made, so all the AI's thinking text, all the AI's messages need to be logged and recorded in the database.


Once these two primary features are implemented, we can do quality assurance and go over the code and make sure everything works properly (broker setup, setup of models, etc). And then we can test manually, once manual tests are done, can write unit tests and release the bot.

But first we need to get the bot to work first so these 2 markdowns will be the most consequential and the most important.